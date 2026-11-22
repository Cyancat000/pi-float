import type { NotificationEvent, NotificationLevel } from "@pi-float/protocol";
import { useEffect } from "react";

const presentation: Record<NotificationLevel, { label: string; color: string }> = {
  info: { label: "提示", color: "toast-info" },
  warning: { label: "警告", color: "toast-warning" },
  error: { label: "错误", color: "toast-error" },
};

type Props = { dismiss: (notice: NotificationEvent) => void };

function NotificationToast({ notice, dismiss }: Props & { notice: NotificationEvent }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice), 8000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  const { label, color } = presentation[notice.level];
  return (
    <div className={"toast pointer-events-auto flex items-start gap-2 p-2 text-xs " + color}>
      <div className="min-w-0 flex-1 whitespace-pre-wrap break-words" role={notice.level === "error" ? "alert" : "status"}>
        <strong>{label}:</strong>{" "}{notice.message}
      </div>
      <button className="icon-button" type="button" aria-label="关闭通知" onClick={() => dismiss(notice)}>×</button>
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
