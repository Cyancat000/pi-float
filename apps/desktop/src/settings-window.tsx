import type { ModuleVisibility } from "@pi-float/protocol";
import { useState } from "react";
import { savePreference, usePreferences } from "./preferences";

const modules: [keyof ModuleVisibility, string][] = [
  ["showThinking", "思考过程"], ["showToolCalls", "工具调用与结果"],
  ["showTokenUsage", "Token 用量"], ["showTimestamp", "消息时间"],
];

export function SettingsWindow({ ready, report }: { ready: boolean; report: (error: unknown) => void }) {
  const visibility = usePreferences((prefs) => prefs.modules);
  const [pending, setPending] = useState(false);

  function setVisible(key: keyof ModuleVisibility, checked: boolean) {
    setPending(true);
    void savePreference("modules", { ...visibility, [key]: checked }).catch(report).finally(() => setPending(false));
  }

  return (
    <main className="settings-surface">
      <h1 className="settings-heading">模块显隐</h1>
      {modules.map(([key, label]) => (
        <label key={key} className="settings-row">
          {label}
          <input type="checkbox" role="switch" className="settings-switch" checked={visibility[key]} disabled={!ready || pending} onChange={(event) => setVisible(key, event.currentTarget.checked)} />
        </label>
      ))}
    </main>
  );
}
