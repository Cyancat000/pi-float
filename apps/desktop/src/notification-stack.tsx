import type { NotificationEvent, NotificationLevel } from "@pi-float/protocol";
import { CircleAlert, Info, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";

const presentation = {
  info: { label: "提示", Icon: Info },
  warning: { label: "警告", Icon: TriangleAlert },
  error: { label: "错误", Icon: CircleAlert },
};

export type ReportedError = { message: string; dismiss: () => void };
type PiNotices = { notifications: NotificationEvent[]; dismissNotification: (notice: NotificationEvent) => void };

function NoticeRow({ level, message, dismiss }: ReportedError & { level: NotificationLevel }) {
  const { label, Icon } = presentation[level];
  return (
    <div className="notice-row" data-level={level}>
      <div className="notice-content" role={level === "error" ? "alert" : "status"}>
        <Icon size={14} className="notice-icon" aria-hidden="true" />
        <div className="notice-text"><strong>{label}</strong>{" "}{message}</div>
      </div>
      <button className="icon-button notice-close" type="button" title="关闭通知" aria-label="关闭通知" onClick={dismiss}><X size={14} aria-hidden="true" /></button>
    </div>
  );
}

function PiNotice({ notice, dismiss }: { notice: NotificationEvent; dismiss: PiNotices["dismissNotification"] }) {
  useEffect(() => {
    const timer = window.setTimeout(() => dismiss(notice), 8000);
    return () => clearTimeout(timer);
  }, [notice, dismiss]);

  return <NoticeRow level={notice.level} message={notice.message} dismiss={() => dismiss(notice)} />;
}

export function NotificationStack({ pi, error }: { pi?: PiNotices; error?: ReportedError }) {
  if (!pi?.notifications.length && !error) return null;
  return (
    <section className="notice-stack" aria-label="通知">
      {error && <NoticeRow level="error" {...error} />}
      {pi?.notifications.map((notice) => <PiNotice key={notice.sequence} notice={notice} dismiss={pi.dismissNotification} />)}
    </section>
  );
}
