import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { BridgeEvent, TerminalRegistration } from "../../protocol/src/index.js";
import { WebSocket, WebSocketServer } from "ws";
import { updateRegistry } from "./registry.js";

const protocol = "pi-float.v1";
const desktopOrigins = new Set(["tauri://localhost", "http://tauri.localhost", "https://tauri.localhost", "http://127.0.0.1:1420"]);

interface Hooks { connected(socket: WebSocket): void; dispatch(socket: WebSocket, text: string): Promise<void> }

function createTransport() {
  let hooks: Hooks | undefined;
  let registration: TerminalRegistration | undefined;
  let stopServer: (() => Promise<void>) | undefined;
  let sockets: WebSocketServer | undefined;
  let sequence = 0;
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

  function unregister() {
    const row = registration;
    if (!row) return;
    registration = undefined;
    try { updateRegistry((rows) => rows.filter(({ token }) => token !== row.token)); }
    catch (error) { console.error("pi-float: 会话清理失败", error); }
  }

  async function startServer(cwd: string, sessionId: string) {
    const token = randomBytes(32).toString("hex");
    const server = createServer((_req, res) => { res.writeHead(404).end(); });
    const wss = new WebSocketServer({ noServer: true, maxPayload: 256 * 1024, handleProtocols: () => protocol });
    server.on("upgrade", (req, socket, head) => {
      const offered = (req.headers["sec-websocket-protocol"] ?? "").split(",").map((part) => part.trim());
      const candidate = offered.find((part) => /^[a-f0-9]{64}$/.test(part));
      const origin = req.headers.origin;
      if (!hooks || req.url !== "/" || (origin && !desktopOrigins.has(origin)) || !offered.includes(protocol)
        || !candidate || !timingSafeEqual(Buffer.from(candidate), Buffer.from(token))) {
        socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
        return;
      }
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws));
    });
    wss.on("connection", (socket) => {
      socket.on("error", () => socket.terminate());
      if (!hooks) { socket.close(1012); return; }
      hooks.connected(socket);
      socket.on("message", (data, binary) => {
        if (binary) socket.close(1003);
        else if (hooks) void hooks.dispatch(socket, data.toString());
        else socket.close(1012);
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
      const row = { pid: process.pid, cwd, sessionId, port: address.port, startedAt: new Date().toISOString(), token };
      updateRegistry((rows) => [...rows.filter(({ pid }) => pid !== row.pid), row]);
      registration = row;
      process.on("exit", unregister);
      stopServer = stop;
    } catch (error) { await stop(); throw error; }
  }

  return {
    send, publish, nextSequence: () => ++sequence,
    get registration() { return registration; },
    get hasClients() { return !!sockets?.clients.size; },
    async bind(cwd: string, sessionId: string, next: Hooks) {
      hooks = next;
      if (!registration) await startServer(cwd, sessionId);
      else {
        const row = { ...registration, cwd, sessionId };
        updateRegistry(rows => [...rows.filter(r => r.pid !== row.pid), row]);
        registration = row;
        for (const socket of sockets!.clients) next.connected(socket);
      }
    },
    async detach(replacing: boolean) {
      hooks = undefined;
      if (!replacing) { await stopServer?.(); stopServer = undefined; }
    },
  };
}

// Pi may load a fresh extension factory on session replacement. Keep only the
// terminal transport across that boundary, never a stale command context.
const host = process as NodeJS.Process & { __piFloatTransportV1?: ReturnType<typeof createTransport> };
export const transport = host.__piFloatTransportV1 ??= createTransport();
