import type { ModuleVisibility } from "@pi-float/protocol";
import { useState } from "react";
import { savePreference, usePreferences } from "./preferences";
import { THEMES } from "./themes";

const modules: [keyof ModuleVisibility, string][] = [
  ["showThinking", "思考过程"], ["showToolCalls", "工具调用与结果"],
  ["showTokenUsage", "Token 用量"], ["showTimestamp", "消息时间"],
];

export function SettingsWindow({ ready, report }: { ready: boolean; report: (error: unknown) => void }) {
  const visibility = usePreferences((prefs) => prefs.modules);
  const theme = usePreferences((prefs) => prefs.theme);
  const [pending, setPending] = useState(false);

  function setVisible(key: keyof ModuleVisibility, checked: boolean) {
    setPending(true);
    void savePreference("modules", { ...visibility, [key]: checked }).catch(report).finally(() => setPending(false));
  }

  return (
    <main className="settings-surface">
      <section aria-labelledby="appearance-heading">
        <h1 id="appearance-heading" className="settings-heading">外观</h1>
        <fieldset className="theme-fieldset" disabled={!ready}>
          <legend>主题</legend>
          <div className="theme-grid">
            {THEMES.map(({ id, name }) => (
              <label key={id} className="theme-choice">
                <input type="radio" name="theme" value={id} className="sr-only" checked={theme === id}
                  aria-label={name}
                  onChange={() => void savePreference("theme", id).catch(report)} />
                <span className="theme-card">
                  <span className="theme-preview" data-palette={id} aria-hidden="true">
                    <span className="theme-preview-chrome"><i /><i /><i /></span>
                    <span className="theme-preview-chat"><i /><i /></span>
                    <span className="theme-preview-composer"><i /><b /></span>
                  </span>
                  <span className="theme-name">{name}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>
      <h2 className="settings-heading settings-modules-heading">模块显隐</h2>
      {modules.map(([key, label]) => (
        <label key={key} className="settings-row">
          {label}
          <input type="checkbox" role="switch" className="settings-switch" checked={visibility[key]} disabled={!ready || pending} onChange={(event) => setVisible(key, event.currentTarget.checked)} />
        </label>
      ))}
    </main>
  );
}
