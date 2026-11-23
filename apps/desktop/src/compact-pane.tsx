import type { SessionSnapshot } from "@pi-float/protocol";
import { ListTodo } from "lucide-react";
import { useState } from "react";
import { currentTodo, latestMessage } from "./compact-summary";
import { usePreferences } from "./preferences";

const roles = { user: "你", assistant: "助手", notice: "通知" };

type MessageLine = { key: string; role?: keyof typeof roles; text: string };

function MessagePreview({ line }: { line: MessageLine }) {
  const [frame, setFrame] = useState({ line, leaving: null as MessageLine | null, revision: 0 });
  const changed = frame.line.key !== line.key;
  if (changed || frame.line.text !== line.text) {
    setFrame(changed ? { line, leaving: frame.line, revision: frame.revision + 1 } : { ...frame, line });
  }

  function content(value: MessageLine) {
    return value.role ? <><strong className="secondary">{roles[value.role]}：</strong>{value.text}</> : <span className="muted">{value.text}</span>;
  }

  return <div className="compact-message-window" aria-label="最新消息">
    {frame.leaving && <p key={frame.revision - 1} className="compact-message compact-message-out" aria-hidden="true"
      onAnimationEnd={({ animationName }) => {
        if (animationName === "compact-message-out") setFrame((current) => current.revision === frame.revision ? { ...current, leaving: null } : current);
      }}>
      {content(frame.leaving)}
    </p>}
    <p key={frame.revision} className={frame.revision ? "compact-message compact-message-in" : "compact-message"} title={line.role ? line.text : undefined}>
      {content(line)}
    </p>
  </div>;
}

export function CompactPane({ snapshot, emptyMessage }: { snapshot: SessionSnapshot | null; emptyMessage: string }) {
  const showTools = usePreferences((state) => state.modules.showToolCalls);
  const message = latestMessage(snapshot, showTools);
  const { item, completed, total } = currentTodo(snapshot?.todos);
  const todoText = item?.subject ?? (total ? "待办已全部完成" : "暂无待办");
  const status = item?.status === "in_progress" ? "进行中" : item ? "待开始" : "";
  return <div className="compact-pane">
    <MessagePreview line={message ?? { key: "empty", text: emptyMessage }} />
    <div className="compact-todo" aria-label="当前待办">
      <ListTodo size={14} className="shrink-0 muted" aria-hidden="true" />
      <span className="min-w-0 flex-1" title={status ? status + "：" + todoText : todoText}>
        {status && <span className="sr-only">{status}：</span>}
        {snapshot?.idle === false && <span className="sr-only">Pi 正在工作：</span>}
        <span className="compact-todo-title" data-working={snapshot?.idle === false}>{todoText}</span>
      </span>
      <span className="compact-progress" aria-label={`待办进度：${completed}/${total}`}>{completed}/{total}</span>
    </div>
  </div>;
}
