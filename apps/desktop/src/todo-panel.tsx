import type { TodoSnapshot, TodoStatus } from "@pi-float/protocol";
import { CheckCircle2, Circle, CircleDot, ListTodo } from "lucide-react";

const statusView = {
  pending: { Icon: Circle, label: "待开始", color: "text-slate-400", order: 1 },
  in_progress: { Icon: CircleDot, label: "进行中", color: "text-sky-300", order: 0 },
  completed: { Icon: CheckCircle2, label: "已完成", color: "text-emerald-300", order: 2 },
} satisfies Record<TodoStatus, { Icon: typeof Circle; label: string; color: string; order: number }>;

export function TodoPanel({ todos }: { todos: TodoSnapshot }) {
  const completed = todos.items.filter(({ status }) => status === "completed").length;
  const items = [...todos.items].sort((a, b) => statusView[a.status].order - statusView[b.status].order);
  return <details open className="shrink-0 border-b border-white/10 px-2.5 py-1.5 text-xs">
    <summary className="cursor-pointer select-none text-slate-200">
      <span className="inline-flex items-center gap-1 align-middle">
        <ListTodo size={14} aria-hidden="true" /> 待办 <span className="text-slate-400">{completed}/{items.length}</span>
      </span>
      <span className="float-right text-[11px] text-slate-400">来源：{todos.source}</span>
    </summary>
    {!items.length ? <p className="mt-1 pl-4 text-slate-400">暂无任务</p> :
      <ul aria-label="当前会话待办" className="mt-1 max-h-28 overflow-y-auto pl-3">
        {items.map(({ id, subject, status }) => {
          const { Icon, label, color } = statusView[status];
          return <li key={id} className="flex items-start gap-1.5 py-0.5">
            <Icon size={13} aria-hidden="true" className={`mt-0.5 shrink-0 ${color}`} />
            <span className="sr-only">{label}：</span>
            <span className={`min-w-0 break-words ${status === "completed" ? "text-slate-400 line-through" : "text-slate-200"}`}>{subject}</span>
          </li>;
        })}
      </ul>}
  </details>;
}
