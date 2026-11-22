import type { SessionSnapshot } from "@pi-float/protocol";
import { ListTodo } from "lucide-react";
import { currentTodo, latestMessage } from "./compact-summary";

const roles = { user: "你", assistant: "助手", notice: "通知" };

export function CompactPane({ snapshot, emptyMessage }: { snapshot: SessionSnapshot | null; emptyMessage: string }) {
  const message = latestMessage(snapshot);
  const { item, completed, total } = currentTodo(snapshot?.todos);
  const todoText = item?.subject ?? (total ? "待办已全部完成" : "暂无待办");
  const status = item?.status === "in_progress" ? "进行中" : item ? "待开始" : "";
  return <div className="compact-pane">
    <p className="compact-message" aria-label="最新消息" title={message?.text}>
      {message ? <><strong className="secondary">{roles[message.role]}：</strong>{message.text}</> : <span className="muted">{emptyMessage}</span>}
    </p>
    <div className="compact-todo" aria-label="当前待办">
      <ListTodo size={14} className="shrink-0 muted" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate" title={status ? status + "：" + todoText : todoText}>
        {status && <span className="sr-only">{status}：</span>}{todoText}
      </span>
      <span className="compact-progress" aria-label={`待办进度：${completed}/${total}`}>{completed}/{total}</span>
    </div>
  </div>;
}
