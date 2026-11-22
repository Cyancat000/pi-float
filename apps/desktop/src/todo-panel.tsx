import type { TodoSnapshot, TodoStatus } from "@pi-float/protocol";
import { CheckCircle2, Circle, CircleDot, ListTodo } from "lucide-react";

const statusView = {
  pending: { Icon: Circle, label: "待开始", color: "muted", order: 1 },
  in_progress: { Icon: CircleDot, label: "进行中", color: "accent-text", order: 0 },
  completed: { Icon: CheckCircle2, label: "已完成", color: "success-text", order: 2 },
} satisfies Record<TodoStatus, { Icon: typeof Circle; label: string; color: string; order: number }>;

export function TodoPanel({ todos }: { todos: TodoSnapshot }) {
  const completed = todos.items.filter(({ status }) => status === "completed").length;
  const items = [...todos.items].sort((a, b) => statusView[a.status].order - statusView[b.status].order);
  return <details open className="todo-panel">
    <summary className="cursor-pointer select-none secondary">
      <span className="inline-flex items-center gap-1 align-middle">
        <ListTodo size={14} aria-hidden="true" /> 待办 <span className="muted">{completed}/{items.length}</span>
      </span>
      <span className="float-right text-[11px] muted">来源：{todos.source}</span>
    </summary>
    {!items.length ? <p className="mt-1 pl-4 muted">暂无任务</p> :
      <ul aria-label="当前会话待办" className="mt-1 max-h-28 overflow-y-auto pl-3">
        {items.map(({ id, subject, status }) => {
          const { Icon, label, color } = statusView[status];
          return <li key={id} className="flex items-start gap-1.5 py-0.5">
            <Icon size={13} aria-hidden="true" className={`mt-0.5 shrink-0 ${color}`} />
            <span className="sr-only">{label}：</span>
            <span className={`min-w-0 break-words ${status === "completed" ? "muted line-through" : "secondary"}`}>{subject}</span>
          </li>;
        })}
      </ul>}
  </details>;
}
