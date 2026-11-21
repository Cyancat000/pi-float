import type { ModuleVisibility } from "@pi-float/protocol";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { useState, type FormEvent } from "react";
import { modelChoices, modelKey, savePreference, usePreferences, type Provider } from "./preferences";

const modules: [keyof ModuleVisibility, string][] = [
  ["showThinking", "思考过程"], ["showToolCalls", "工具调用与结果"],
  ["showTokenUsage", "Token 用量与耗时"], ["showTimestamp", "消息时间"],
];

interface Draft extends Omit<Provider, "models"> { models: string }
const blank: Draft = { id: "", name: "", kind: "open-ai-compatible", baseUrl: "", apiKey: "", models: "" };

export function SettingsWindow({ ready, report }: { ready: boolean; report: (error: unknown) => void }) {
  const prefs = usePreferences();
  const [tab, setTab] = useState<"modules" | "providers">("modules");
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pending, setPending] = useState(false);
  const [formError, setFormError] = useState("");
  const disabled = !ready || pending;
  const choices = modelChoices(prefs.providers);

  function save(action: () => Promise<void>) {
    setPending(true);
    void action().catch(report).finally(() => setPending(false));
  }

  async function saveProviders(items: Provider[]) {
    const options = modelChoices({ items, defaultModel: null });
    const current = prefs.providers.defaultModel;
    const first = options[0];
    const defaultModel = options.some(({ key }) => key === modelKey(current)) ? current
      : first ? { providerId: first.provider.id, model: first.model } : null;
    await savePreference("providers", { items, defaultModel });
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || disabled) return;
    const name = draft.name.trim();
    const baseUrl = draft.baseUrl.trim();
    try {
      const url = new URL(baseUrl);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error();
    } catch {
      setFormError("请输入不含凭据、查询参数或片段的 HTTP(S) Base URL。");
      return;
    }
    const models = [...new Set(draft.models.split(/\r?\n/).map((id) => id.trim()).filter(Boolean))];
    if (!name || models.length === 0) {
      setFormError("请填写提供商名称和至少一个模型 ID。");
      return;
    }
    const provider: Provider = { ...draft, id: draft.id || crypto.randomUUID(), name, baseUrl, apiKey: draft.apiKey.trim(), models };
    save(async () => {
      const items = draft.id ? prefs.providers.items.map((item) => item.id === draft.id ? provider : item) : [...prefs.providers.items, provider];
      await saveProviders(items);
      setDraft(null);
    });
  }

  return (
    <main className="h-full overflow-auto bg-[#171b23] p-5 text-sm">
      <nav className="flex gap-1 border-b border-white/10" aria-label="设置分类">
        <button type="button" className="settings-tab" aria-pressed={tab === "modules"} onClick={() => setTab("modules")}>模块显隐</button>
        <button type="button" className="settings-tab" aria-pressed={tab === "providers"} onClick={() => setTab("providers")}>模型与提供商</button>
      </nav>
      {tab === "modules" ? (
        <section className="mt-3" aria-label="模块显隐">
          {modules.map(([key, label]) => (
            <label key={key} className="flex items-center justify-between border-b border-white/8 py-3">
              {label}
              <input type="checkbox" role="switch" className="accent-sky-400" checked={prefs.modules[key]} disabled={disabled} onChange={(event) => {
                const checked = event.currentTarget.checked;
                save(() => savePreference("modules", { ...prefs.modules, [key]: checked }));
              }} />
            </label>
          ))}
        </section>
      ) : (
        <section className="mt-4 space-y-3" aria-label="模型与提供商">
          <label className="flex items-center gap-3">
            <span>默认模型</span>
            <select className="field" disabled={disabled || !choices.length} value={modelKey(prefs.providers.defaultModel)} onChange={(event) => {
              const choice = choices.find(({ key }) => key === event.currentTarget.value);
              if (choice) save(() => savePreference("providers", { ...prefs.providers, defaultModel: { providerId: choice.provider.id, model: choice.model } }));
            }}>
              {!choices.length && <option value="">还未配置模型</option>}
              {choices.map(({ key, model, provider }) => <option key={key} value={key}>{provider.name} / {model}</option>)}
            </select>
          </label>
          <ul className="divide-y divide-white/10">
            {prefs.providers.items.map((provider) => (
              <li key={provider.id} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1 break-words">
                  <div>{provider.name} <span className="ml-1 text-xs text-slate-400">{provider.kind === "anthropic" ? "Anthropic" : "OpenAI-Compatible"}</span></div>
                  <p className="text-xs text-slate-400">{provider.models.join(" · ")}</p>
                </div>
                <button type="button" className="icon-button" title="编辑" aria-label={"编辑 " + provider.name} disabled={disabled} onClick={() => { setFormError(""); setDraft({ ...provider, models: provider.models.join("\n") }); }}><Pencil size={14} /></button>
                <button type="button" className="icon-button" title="删除" aria-label={"删除 " + provider.name} disabled={disabled} onClick={() => save(async () => {
                  await saveProviders(prefs.providers.items.filter((item) => item.id !== provider.id));
                  if (draft?.id === provider.id) setDraft(null);
                })}><Trash2 size={14} /></button>
              </li>
            ))}
          </ul>
          {draft ? (
            <form className="grid gap-3 rounded-lg border border-white/12 p-3" onSubmit={submit}>
              <div className="grid grid-cols-2 gap-3">
                <label className="grid gap-1">名称<input className="field" required value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.currentTarget.value })} /></label>
                <label className="grid gap-1">类型<select className="field" value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.currentTarget.value === "anthropic" ? "anthropic" : "open-ai-compatible" })}>
                  <option value="open-ai-compatible">OpenAI-Compatible</option><option value="anthropic">Anthropic</option>
                </select></label>
              </div>
              <label className="grid gap-1">Base URL<input className="field" type="url" placeholder={draft.kind === "anthropic" ? "https://api.anthropic.com/v1" : "https://api.openai.com/v1"} required value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.currentTarget.value })} /></label>
              <label className="grid gap-1">API Key<input className="field" type="password" autoComplete="off" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.currentTarget.value })} /></label>
              <label className="grid gap-1">模型 ID（每行一个）<textarea className="field resize-y" rows={2} required value={draft.models} onChange={(event) => setDraft({ ...draft, models: event.currentTarget.value })} /></label>
              {formError && <p role="alert" className="text-xs text-red-300">{formError}</p>}
              <div className="flex justify-end gap-2">
                <button className="action-button" type="button" disabled={pending} onClick={() => setDraft(null)}>取消</button>
                <button className="action-button primary-action" type="submit" disabled={disabled}>保存</button>
              </div>
            </form>
          ) : (
            <button className="action-button flex items-center gap-1.5" type="button" disabled={disabled} onClick={() => { setFormError(""); setDraft(blank); }}><Plus size={14} />添加提供商</button>
          )}
        </section>
      )}
    </main>
  );
}
