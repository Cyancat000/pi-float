import { randomUUID } from "node:crypto";
import { SessionManager, type ExtensionAPI, type ExtensionContext, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import type { BridgeEvent, StreamingMessage, TodoSource, WorkspaceSession } from "@pi-float/protocol";
import type { WebSocket } from "ws";
import { launchDesktop } from "./launcher.js";
import { observeNotifications } from "./notifications.js";
import { availableModels, contentBlocks, snapshot } from "./projection.js";
import { registerNativeTodo, selectTodoSource } from "./todos.js";
import { transport } from "./transport.js";

export default function piFloat(pi: ExtensionAPI): void {
  let ctx: ExtensionContext | undefined;
  let streaming: StreamingMessage | null = null;
  let todoSource: TodoSource = "pi-float";
  let nativeTodoRegistered = false;
  let lastStreamAt = 0;
  let commandPending = false;
  let unobserveNotifications: (() => void) | undefined;
  const { publish, send } = transport;
  let pendingAction: { nonce: string; run(ctx: ExtensionCommandContext): Promise<void> } | undefined;

  // Only a registered slash command receives Pi's session replacement API.
  function runSessionAction(sessionId: string, path?: string) {
    if (!pi.getCommands().some(cmd => cmd.name === "ui")) throw new Error("/ui 命令不可用");
    return new Promise<void>((resolve, reject) => {
      const nonce = randomUUID();
      const timer = setTimeout(() => { pendingAction = undefined; reject(new Error("终端未执行会话操作")); }, 5000);
      pendingAction = { nonce, async run(active) {
        clearTimeout(timer);
        try {
          if (active.sessionManager.getSessionId() !== sessionId || !active.isIdle()) throw new Error("终端忙碌或会话已切换");
          const result = path ? await active.switchSession(path) : await active.newSession();
          if (result.cancelled) throw new Error("会话操作已取消");
          resolve();
        } catch (error) { reject(error); }
      } };
      try { pi.sendUserMessage(`/ui ${nonce}`, { expandPromptTemplates: true }); }
      catch (error) { clearTimeout(timer); pendingAction = undefined; reject(error); }
    });
  }

  function sessionSnapshot(active: ExtensionContext) {
    return { ...snapshot(active, streaming, todoSource), sessionActions: true, commands: pi.getCommands().map(({ name, description }) => ({ name, description })) };
  }

  function publishSnapshot() {
    if (ctx && transport.hasClients) publish({ type: "snapshot", session: sessionSnapshot(ctx) });
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

  async function dispatch(socket: WebSocket, text: string) {
    let requestId: string | undefined;
    let error: string | undefined;
    let sessions: WorkspaceSession[] | undefined;
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
          } else if (["list_sessions", "new_session", "resume_session"].includes(request.type)) {
            if (!active.isIdle()) throw new Error("请等待当前回复结束后切换会话");
            if (request.type === "new_session") await runSessionAction(request.sessionId);
            else {
              const history = await SessionManager.list(active.cwd, active.sessionManager.getSessionDir());
              if (ctx?.sessionManager.getSessionId() !== request.sessionId) throw new Error("会话已切换");
              if (request.type === "list_sessions") sessions = history.filter(row => row.id !== request.sessionId).map(row => ({
                id: row.id, label: (row.name || row.firstMessage || "未命名会话").slice(0, 100), modified: row.modified.toISOString(),
              }));
              else {
                const target = history.find(row => row.id === request.targetId && row.id !== request.sessionId);
                if (!target) throw new Error("当前工作区中找不到此历史会话");
                await runSessionAction(request.sessionId, target.path);
              }
            }
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
    if (requestId !== undefined) send(socket, JSON.stringify({ type: "request_result", requestId, sessions, ...(error ? { error } : {}) } satisfies BridgeEvent));
    else socket.close(1008, "invalid request");
  }

  pi.on("session_start", async (_event, active) => {
    if (active.mode !== "tui") return;
    ctx = active;
    const sessionId = active.sessionManager.getSessionId();
    todoSource = selectTodoSource(pi.getAllTools());
    if (todoSource === "pi-float" && !nativeTodoRegistered) {
      registerNativeTodo(pi, (id) => {
        if (ctx?.sessionManager.getSessionId() === id) publishSnapshot();
      });
      nativeTodoRegistered = true;
    }
    unobserveNotifications?.();
    unobserveNotifications = observeNotifications(active.ui, (message, level) => {
      if (transport.registration?.sessionId !== sessionId || !transport.hasClients) return;
      publish({ type: "notification", sessionId, sequence: transport.nextSequence(), level, message });
    });
    try {
      await transport.bind(active.cwd, sessionId, { dispatch, connected(socket) {
        if (ctx) send(socket, JSON.stringify({ type: "snapshot", session: sessionSnapshot(ctx) } satisfies BridgeEvent));
      } });
    } catch (error) { active.ui.notify(`pi-float: ${String(error)}`, "error"); }
  });
  pi.on("session_shutdown", async (event) => {
    unobserveNotifications?.();
    unobserveNotifications = undefined;
    ctx = undefined;
    streaming = null;
    lastStreamAt = 0;
    await transport.detach(["new", "resume", "fork"].includes(event.reason));
  });
  pi.on("agent_start", (_event, active) => updateContext(active));
  pi.on("agent_end", (_event, active) => updateContext(active));
  pi.on("agent_settled", (_event, active) => { clearStream(active); updateContext(active); });
  pi.on("model_select", (_event, active) => updateContext(active));
  pi.on("thinking_level_select", (_event, active) => updateContext(active));
  pi.on("session_info_changed", (_event, active) => updateContext(active));
  pi.on("session_tree", (_event, active) => updateContext(active));
  pi.on("tool_execution_end", (event, active) => {
    if (todoSource === "rpiv-todo" && (event.toolName === "todo" || event.toolName === "codemode")
      && ctx?.sessionManager.getSessionId() === active.sessionManager.getSessionId()) publishSnapshot();
  });
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
    if (!transport.hasClients || event.message.role !== "assistant") return;
    streaming = { id: "stream", role: "assistant", timestamp: new Date(event.message.timestamp).toISOString(), blocks: contentBlocks(event.message.content) };
    const now = Date.now();
    if (now - lastStreamAt < 60) return;
    lastStreamAt = now;
    publish({ type: "stream", sessionId: active.sessionManager.getSessionId(), message: streaming });
  });

  pi.registerCommand("ui", {
    description: "Open this terminal session in pi-float",
    handler: async (args, active) => {
      if (pendingAction && args === pendingAction.nonce) {
        const action = pendingAction; pendingAction = undefined;
        await action.run(active); return;
      }
      const { registration } = transport;
      if (!registration) { active.ui.notify("pi-float：当前终端未注册", "error"); return; }
      try { await launchDesktop(registration.port); }
      catch (error) { active.ui.notify(`pi-float: ${String(error)}`, "error"); }
    },
  });
}
