import type { BridgeEvent, BridgeRequest, NotificationEvent, SessionSnapshot, TerminalRegistration, WorkspaceSession } from "@pi-float/protocol";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { create } from "zustand";

export interface LaunchTarget { cwd: string | null; port: number | null }
type Payload<T> = T extends unknown ? Omit<T, "requestId" | "sessionId"> : never;
type Command = Payload<BridgeRequest>;
const useRemote = create<{
  snapshot: SessionSnapshot | null;
  connection: "connecting" | "connected" | "disconnected" | "failed";
  notifications: NotificationEvent[];
}>(() => ({ snapshot: null, connection: "disconnected", notifications: [] }));

function dismissNotification(notification: NotificationEvent) {
  useRemote.setState(({ notifications }) => ({ notifications: notifications.filter((item) => item !== notification) }));
}

export function sessionKey(row: TerminalRegistration) { return `${row.pid}:${row.port}:${row.startedAt}`; }
export function projectFolder(cwd: string) { return cwd.split(/[/\\]/).filter(Boolean).at(-1) ?? cwd; }

export class BridgeClient {
  private socket: WebSocket | undefined;
  private timer: number | undefined;
  private stopped = false;
  private attempts = 0;
  private lastNotificationSequence = 0;

  retry() {
    if (!this.stopped && useRemote.getState().connection === "failed") {
      this.attempts = 0;
      this.connect();
    }
  }

  private failedAttempt() {
    clearTimeout(this.timer);
    this.socket = undefined;
    this.failPending();
    if (this.attempts >= 3) {
      useRemote.setState({ connection: "failed", notifications: [] });
    } else {
      useRemote.setState({ connection: "disconnected", notifications: [] });
      this.timer = window.setTimeout(() => this.connect(), 1250);
    }
  }
  private pending = new Map<string, { resolve: (sessions?: WorkspaceSession[]) => void; reject: (error: Error) => void; timer: number }>();

  constructor(private port: number, private token: string) { this.connect(); }

  private connect() {
    useRemote.setState({ connection: "connecting" });
    this.attempts++;
    let socket: WebSocket;
    try { socket = new WebSocket(`ws://127.0.0.1:${this.port}/`, ["pi-float.v1", this.token]); }
    catch { this.failedAttempt(); return; }
    this.socket = socket;
    // Opening the socket alone is not enough: wait for a usable session snapshot.
    this.timer = window.setTimeout(() => {
      this.failedAttempt();
      socket.close();
    }, 8000);
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket || this.stopped || typeof data !== "string") return;
      let event: BridgeEvent;
      try { event = JSON.parse(data); } catch { return; }
      if (event.type === "request_result") {
        const entry = this.pending.get(event.requestId);
        if (!entry) return;
        this.pending.delete(event.requestId);
        clearTimeout(entry.timer);
        if (event.error) entry.reject(new Error(event.error)); else entry.resolve(event.sessions);
      } else if (event.type === "snapshot" && event.session.schemaVersion === 1) {
        clearTimeout(this.timer);
        this.attempts = 0;
        useRemote.setState(({ snapshot, notifications }) => ({
          snapshot: event.session,
          connection: "connected",
          notifications: snapshot?.sessionId === event.session.sessionId ? notifications : [],
        }));
      } else if (event.type === "notification") {
        const { snapshot, connection, notifications } = useRemote.getState();
        if (connection !== "connected" || snapshot?.sessionId !== event.sessionId
          || !Number.isSafeInteger(event.sequence) || event.sequence <= this.lastNotificationSequence
          || typeof event.message !== "string" || !["info", "warning", "error"].includes(event.level)) return;
        this.lastNotificationSequence = event.sequence;
        useRemote.setState({ notifications: [...notifications.slice(-4), event] });
      } else if (event.type === "stream") {
        const { snapshot } = useRemote.getState();
        if (snapshot?.sessionId === event.sessionId) useRemote.setState({ snapshot: { ...snapshot, streaming: event.message } });
      }
    };
    socket.onclose = () => {
      if (this.socket !== socket || this.stopped) return;
      this.failedAttempt();
    };
  }

  private failPending() {
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(new Error("终端连接已关闭"));
    }
    this.pending.clear();
  }

  request(command: Command): Promise<WorkspaceSession[] | undefined> {
    const { snapshot, connection } = useRemote.getState();
    const socket = this.socket;
    if (!snapshot || connection !== "connected" || socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error("尚未连接终端"));
    const requestId = crypto.randomUUID();
    const message: BridgeRequest = { ...command, requestId, sessionId: snapshot.sessionId };
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error("终端未及时确认指令"));
      }, 10_000);
      this.pending.set(requestId, { resolve, reject, timer });
      try { socket.send(JSON.stringify(message)); }
      catch (error) { clearTimeout(timer); this.pending.delete(requestId); reject(error); }
    });
  }

  close() {
    this.stopped = true;
    clearTimeout(this.timer);
    this.socket?.close();
    this.failPending();
    useRemote.setState({ snapshot: null, connection: "disconnected", notifications: [] });
  }
}

function normalizePath(path: string) {
  const normalized = path.replace(/\\/g, "/").replace(/\/+$/, "");
  return /^([a-z]:|\/\/)/i.test(normalized) ? normalized.toLowerCase() : normalized;
}

export function useTerminalBridge(report: (error: unknown) => void) {
  const [sessions, setSessions] = useState<TerminalRegistration[]>([]);
  const [selected, setSelected] = useState("");
  const [target, setTarget] = useState<(LaunchTarget & { expires: number })>();
  const client = useRef<BridgeClient>(null);
  const { snapshot, connection, notifications } = useRemote();

  useEffect(() => {
    let active = true;
    let timer: number;
    let warn = true;
    async function refresh() {
      try {
        const rows = await invoke<TerminalRegistration[]>("terminal_sessions");
        if (!active) return;
        rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
        setSessions(rows);
        setSelected((key) => key && !rows.some((row) => sessionKey(row) === key) ? "" : key);
        warn = true;
      } catch (error) {
        if (active && warn) { warn = false; report(error); }
      } finally { if (active) timer = window.setTimeout(refresh, 750); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [report]);

  useEffect(() => {
    if (!target) return;
    const match = target.port !== null ? sessions.find((row) => row.port === target.port)
      : target.cwd ? sessions.find((row) => normalizePath(row.cwd) === normalizePath(target.cwd!)) : undefined;
    if (match) {
      const key = sessionKey(match);
      if (key === selected) client.current?.retry();
      setSelected(key);
      setTarget(undefined);
    }
    else if (Date.now() >= target.expires) {
      setTarget(undefined);
      report("没有找到指定的 Pi 终端会话");
    }
  }, [sessions, selected, target, report]);

  const row = sessions.find((entry) => sessionKey(entry) === selected);
  const port = row?.port;
  const token = row?.token;
  useLayoutEffect(() => {
    if (!port || !token) return;
    const active = new BridgeClient(port, token);
    client.current = active;
    return () => { client.current = null; active.close(); };
  }, [port, token]);

  const attach = useCallback((args: LaunchTarget) => {
    if (args.port !== null || args.cwd) setTarget({ ...args, expires: Date.now() + 8000 });
  }, []);
  return {
    sessions, selected, snapshot, connection, attach, notifications, dismissNotification,
    retry() { client.current?.retry(); },
    select(key: string) { setTarget(undefined); setSelected(key); },
    request(command: Command) { return client.current?.request(command) ?? Promise.reject(new Error("尚未连接终端")); },
  };
}

export type TerminalBridge = ReturnType<typeof useTerminalBridge>;
