import type { NotificationEvent, NotificationLevel } from "@pi-float/protocol";
import { useEffect } from "react";

const presentation: Record<NotificationLevel, { label: string; color: string }> = {
  info: { label: "Info", color: "border-sky-400/50 bg-slate-900 text-sky-100" },
  warning: { label: "Warning", color: "border-amber-500/60 bg-amber-950 text-amber-100" },
  error: { label: "Error", color: "border-red-500/60 bg-red-950 text-red-100" },
};

type Props = { dismiss: (notice: NotificationEvent) => void };

function NotificationToast({ notice, dismiss }: Props & { notice: NotificationEvent }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice), 8000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  const { label, color } = presentation[notice.level];
  return (
    <div className={"pointer-events-auto flex items-start gap-2 rounded-lg border p-2 text-xs shadow-lg " + color}>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words" role={notice.level === "error" ? "alert" : "status"}>
        <strong>{label}:</strong>{" "}{notice.message}
      </div>
      <button type="button" aria-label="关闭通知" onClick={() => dismiss(notice)}>×</button>
    </div>
  );
}

export function NotificationStack({ notices, dismiss }: Props & { notices: NotificationEvent[] }) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-10 z-10 flex max-h-[calc(100%-3rem)] flex-col gap-1 overflow-y-auto" aria-label="Pi 通知">
      {notices.map((notice) => <NotificationToast key={notice.sequence} notice={notice} dismiss={dismiss} />)}
    </div>
  );
}
