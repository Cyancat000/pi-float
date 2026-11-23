import type { NotificationEvent, SessionSnapshot } from "@pi-float/protocol";
import { Terminal } from "lucide-react";
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { TerminalBridge } from "../../src/bridge-client";
import { ChatPane } from "../../src/chat-pane";
import { normalizeTheme, THEMES } from "../../src/themes";
import "../../src/styles.css";

const timestamp = new Date().toISOString();
const snapshot: SessionSnapshot = {
  schemaVersion: 1, sessionId: "preview", cwd: "pi-float", name: "通知样式预览",
  model: "preview/演示模型", thinkingLevel: null, idle: true, streaming: null,
  contextUsage: null, sessionActions: true, treeLeafId: null,
  todos: { source: "pi-float", items: [
    { id: 1, subject: "统一浮窗通知样式", status: "completed" },
    { id: 2, subject: "检查待办与消息区布局", status: "in_progress" },
    { id: 3, subject: "验证浅色与深色主题", status: "pending" },
  ] },
  messages: [
    { id: "1", timestamp, role: "user", blocks: [{ kind: "text", text: "通知出现时，还能操作待办和输入区吗？" }] },
    { id: "2", timestamp, role: "assistant", blocks: [{ kind: "text", text: "可以。通知在**消息区顶部**单独占一行，不覆盖待办或输入框。" }] },
  ],
};

function sampleNotices(first: number): NotificationEvent[] {
  return ([
    { level: "info", message: "设置已保存。" },
    { level: "warning", message: "当前会话的上下文即将用满。" },
    { level: "error", message: "未能加载历史会话，请稍后重试。" },
  ] as const).map(({ level, message }, index): NotificationEvent => ({
    type: "notification", sessionId: snapshot.sessionId, sequence: first + index, level, message,
  }));
}

function Preview() {
  const [theme, setTheme] = useState(normalizeTheme(new URLSearchParams(location.search).get("theme")));
  const [notifications, setNotifications] = useState(() => sampleNotices(1));
  const next = useRef(4);
  const dismissNotification = useCallback((notice: NotificationEvent) => {
    setNotifications((notices) => notices.filter((item) => item !== notice));
  }, []);
  useLayoutEffect(() => { document.documentElement.dataset.theme = theme; }, [theme]);

  const terminal: TerminalBridge = {
    snapshot, notifications, dismissNotification, sessions: [], selected: "preview", connection: "connected",
    retry() {}, attach() {}, select() {},
    async request() { throw new Error("这是网页演示，未连接 Pi 终端。"); },
  };
  return <main className="demo">
    <h1>pi-float · 通知演示</h1>
    <div className="demo-controls">
      <select className="control" aria-label="演示主题" value={theme} onChange={(event) => setTheme(normalizeTheme(event.currentTarget.value))}>
        {THEMES.map(({ id, name }) => <option key={id} value={id}>{name}</option>)}
      </select>
      <button type="button" className="control" onClick={() => {
        setNotifications(sampleNotices(next.current));
        next.current += 3;
      }}>重播三种通知</button>
    </div>
    <div className="demo-window floating-shell flex flex-col overflow-hidden">
      <header className="titlebar"><span className="control"><Terminal size={15} aria-hidden="true" />pi-float</span><span className="flex-1" /><span className="connection-dot" data-state="connected" /></header>
      <ChatPane terminal={terminal} visible ready={false} report={console.error} />
    </div>
    <p className="muted">使用示例会话。通知可手动关闭，也会在 8 秒后自动消失。</p>
  </main>;
}

createRoot(document.getElementById("root")!).render(<Preview />);
