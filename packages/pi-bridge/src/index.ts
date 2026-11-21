import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { BridgeEvent, StreamingMessage, TerminalRegistration } from "@pi-float/protocol";
import { WebSocket, WebSocketServer } from "ws";
import { launchDesktop } from "./launcher.js";
import { availableModels, contentBlocks, snapshot } from "./projection.js";
import { updateRegistry } from "./registry.js";

const protocol = "pi-float.v1";
const desktopOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://127.0.0.1:1420"]);

export default function piFloat(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let streaming: StreamingMessage | null = null;
  let lastStreamAt = 0;
  let registration: TerminalRegistration | undefined;
  let commandPending = false;
  let stopServer: (() => Promise<void>) | undefined;
  let sockets: WebSocketServer | undefined;

  function send(socket: WebSocket, data: string) {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 16 * 1024 * 1024) socket.terminate();
    else socket.send(data);
  }

  function publish(event: BridgeEvent) {
    if (!sockets?.clients.size) return;
    const data = JSON.stringify(event);
    for (const socket of sockets.clients) send(socket, data);
  }

  function sessionSnapshot(active: ExtensionContext) {
    return { ...snapshot(active, streaming), commands: pi.getCommands().map(({ name, description }) => ({ name, description })) };
  }

  function publishSnapshot() {
    if (ctx && sockets?.clients.size) publish({ type: "snapshot", session: sessionSnapshot(ctx) });
  }

  function updateContext(active: ExtensionContext) {
    ctx = active;
    publishSnapshot();
  }

  function clearStream(active: ExtensionContext) {
    streaming = null;
    lastStreamAt = 0;
    publish({ type: "stream", sessionId: active.sessionManager.getSessionId(), message: null });
  }

  function unregister() {
    const row = registration;
    if (!row) return;
    registration = undefined;
    try { updateRegistry((rows) => rows.filter(({ token }) => token !== row.token)); }
    catch (error) { console.error("pi-float: 会话清理失败", error); }
  }

  async function dispatch(socket: WebSocket, text: string) {
    let requestId: string | undefined;
    let error: string | undefined;
    try {
      const request = JSON.parse(text);
      if (!request || typeof request.requestId !== "string" || request.requestId.length > 128) throw new Error("无效请求");
      requestId = request.requestId;
      const active = ctx;
      if (!active || request.sessionId !== active.sessionManager.getSessionId()) throw new Error("终端会话已切换");
      if (request.type === "abort") {
        if (!active.isIdle()) active.abort();
      } else {
        if (commandPending) throw new Error("终端正在处理上一条指令");
        commandPending = true;
        try {
          if (request.type === "send") {
            if (typeof request.text !== "string" || !request.text.trim() || request.text.length > 32_000) throw new Error("请输入 1–32000 字符的消息");
            if (/^\s*[!/]/.test(request.text)) throw new Error("请在终端直接执行斜杠或 Shell 指令");
            pi.sendUserMessage(request.text, { expandPromptTemplates: true, ...(active.isIdle() ? {} : { deliverAs: "steer" }) });
          } else if (request.type === "command") {
            if (!active.isIdle()) throw new Error("请等待当前回复结束后执行命令");
            const text = request.text;
            const name = typeof text === "string" && text.match(/^\/([^\s/]+)(?: |$)/)?.[1];
            if (!name || text.length > 32_000 || !pi.getCommands().some((cmd) => cmd.name === name)) throw new Error("当前终端不支持从浮窗执行此命令");
            pi.sendUserMessage(text, { expandPromptTemplates: true });
          } else if (request.type === "set_model") {
            if (!active.isIdle()) throw new Error("请等待当前回复结束后切换模型");
            if (typeof request.provider !== "string" || typeof request.modelId !== "string") throw new Error("无效模型");
            const model = active.modelRegistry.find(request.provider, request.modelId);
            if (!model || !availableModels(active).some((item) => item.provider === model.provider && item.id === model.id)) throw new Error("模型不可用");
            if (!await pi.setModel(model)) throw new Error("模型提供方未配置认证");
            publishSnapshot();
          } else throw new Error("未知指令");
        } finally { commandPending = false; }
      }
    } catch (cause) { error = cause instanceof Error ? cause.message : "终端指令失败"; }
    if (requestId !== undefined) send(socket, JSON.stringify({ type: "request_result", requestId, ...(error ? { error } : {}) } satisfies BridgeEvent));
    else socket.close(1008, "invalid request");
  }

  async function startServer(active: ExtensionContext) {
    const token = randomBytes(32).toString("hex");
    const server = createServer((_req, res) => { res.writeHead(404).end(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, handleProtocols: () => protocol });
    server.on("upgrade", (req, socket, head) => {
      const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((part) => part.trim());
      const candidate = offered.find((part) => /^[a-f0-9]{64}$/.test(part));
      const origin = req.headers.origin;
      if (!ctx || req.url !== "/" || (origin && !desktopOrigins.has(origin)) || !offered.includes(protocol)
        || !candidate || !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    });
    wss.on("connection", (socket) => {
      socket.on("error", () => socket.terminate());
      if (!ctx) { socket.close(1012); return; }
      send(socket, JSON.stringify({ type: "snapshot", session: sessionSnapshot(ctx) } satisfies BridgeEvent));
      socket.on("message", (data, binary) => {
        if (binary) socket.close(1003);
        else void dispatch(socket, data.toString());
      });
    });
    const stop = async () => {
      process.off("exit", unregister);
      unregister();
      sockets = undefined;
      for (const socket of wss.clients) socket.terminate();
      wss.close();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    };
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); });
      });
      server.on("error", (error) => console.error("pi-float: WebSocket 服务错误", error));
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("无法获取本地监听端口");
      sockets = wss;
      const row = { pid: process.pid, cwd: active.cwd, sessionId: active.sessionManager.getSessionId(), port: address.port, startedAt: new Date().toISOString(), token };
      updateRegistry((rows) => [...rows.filter(({ pid }) => pid !== row.pid), row]);
      registration = row;
      process.on("exit", unregister);
      stopServer = stop;
    } catch (error) { await stop(); throw error; }
  }

  pi.on("session_start", async (_event, active) => {
    if (active.mode !== "tui") return;
    ctx = active;
    try {
      if (!registration) await startServer(active);
      else {
        const row = { ...registration, cwd: active.cwd, sessionId: active.sessionManager.getSessionId() };
        updateRegistry((rows) => [...rows.filter(({ pid }) => pid !== row.pid), row]);
        registration = row;
        publishSnapshot();
      }
    } catch (error) { active.ui.notify(`pi-float: ${String(error)}`, "error"); }
  });
  pi.on("session_shutdown", async (event) => {
    ctx = undefined;
    streaming = null;
    lastStreamAt = 0;
    if (["new", "resume", "fork"].includes(event.reason)) return;
    const stop = stopServer;
    stopServer = undefined;
    await stop?.();
  });
  pi.on("agent_start", (_event, active) => updateContext(active));
  pi.on("agent_end", (_event, active) => updateContext(active));
  pi.on("agent_settled", (_event, active) => { clearStream(active); updateContext(active); });
  pi.on("model_select", (_event, active) => updateContext(active));
  pi.on("thinking_level_select", (_event, active) => updateContext(active));
  pi.on("session_info_changed", (_event, active) => updateContext(active));
  pi.on("message_end", (event, active) => {
    if (event.message.role === "assistant") clearStream(active);
    ctx = active;
    const sessionId = active.sessionManager.getSessionId();
    // Pi emits message_end before appending the entry, so read the branch afterward.
    setImmediate(() => {
      if (ctx?.sessionManager.getSessionId() === sessionId) publishSnapshot();
    });
  });
  pi.on("message_update", (event, active) => {
    ctx = active;
    if (!sockets || event.message.role !== "assistant") return;
    streaming = { id: "stream", role: "assistant", timestamp: new Date(event.message.timestamp).toISOString(), blocks: contentBlocks(event.message.content) };
    const now = Date.now();
    if (now - lastStreamAt < 60) return;
    lastStreamAt = now;
    publish({ type: "stream", sessionId: active.sessionManager.getSessionId(), message: streaming });
  });

  pi.registerCommand("ui", {
    description: "Open this terminal session in pi-float",
    handler: async (_args, active) => {
      if (!registration) { active.ui.notify("pi-float：当前终端未注册", "error"); return; }
      try { await launchDesktop(registration.port); }
      catch (error) { active.ui.notify(`pi-float: ${String(error)}`, "error"); }
    },
  });
}
