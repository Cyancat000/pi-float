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
    <main className="h-full overflow-auto bg-[#171b23] p-5 text-sm">
      <h1 className="border-b border-white/10 pb-2 text-base font-semibold">模块显隐</h1>
      {modules.map(([key, label]) => (
        <label key={key} className="flex items-center justify-between border-b border-white/8 py-3">
          {label}
          <input type="checkbox" role="switch" className="accent-sky-400" checked={visibility[key]} disabled={!ready || pending} onChange={(event) => setVisible(key, event.currentTarget.checked)} />
        </label>
      ))}
    </main>
  );
}
