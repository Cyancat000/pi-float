import type { ModuleVisibility } from "@pi-float/protocol";
import { emitTo, listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";

export interface WindowPrefs {
  alwaysOnTop: boolean;
  opacity: number;
}

export interface Provider {
  id: string;
  name: string;
  kind: "open-ai-compatible" | "anthropic";
  baseUrl: string;
  apiKey: string;
  models: string[];
}

export interface ModelRef { providerId: string; model: string }
export interface ProvidersConfig { items: Provider[]; defaultModel: ModelRef | null }

interface Preferences extends WindowPrefs {
  modules: ModuleVisibility;
  providers: ProvidersConfig;
}

const defaults: Preferences = {
  alwaysOnTop: true,
  opacity: 1,
  modules: { showThinking: true, showToolCalls: true, showTokenUsage: true, showTimestamp: true },
  providers: { items: [], defaultModel: null },
};

const file = new LazyStore("preferences.json");
const changed = "pi-float:preferences-changed";
export const usePreferences = create<Preferences>(() => defaults);

async function readPreferences() {
  const [alwaysOnTop, opacity, modules, providers] = await Promise.all([
    file.get<boolean>("alwaysOnTop"), file.get<number>("opacity"),
    file.get<Partial<ModuleVisibility> & { thinking?: boolean; tools?: boolean; tokenUsage?: boolean }>("modules"),
    file.get<ProvidersConfig>("providers"),
  ]);
  return {
    alwaysOnTop: alwaysOnTop ?? defaults.alwaysOnTop,
    opacity: Math.min(1, Math.max(0.35, opacity ?? defaults.opacity)),
    modules: {
      showThinking: modules?.showThinking ?? modules?.thinking ?? defaults.modules.showThinking,
      showToolCalls: modules?.showToolCalls ?? modules?.tools ?? defaults.modules.showToolCalls,
      showTokenUsage: modules?.showTokenUsage ?? modules?.tokenUsage ?? defaults.modules.showTokenUsage,
      showTimestamp: modules?.showTimestamp ?? defaults.modules.showTimestamp,
    },
    providers: providers ?? defaults.providers,
  };
}

export async function loadPreferences() {
  usePreferences.setState(await readPreferences());
}

export function watchPreferences(report: (error: unknown) => void) {
  // Payload contains only a key, never credentials. Read the latest value from the shared store.
  let generation = 0;
  return listen<"modules" | "providers">(changed, ({ payload: key }) => {
    if (key !== "modules" && key !== "providers") return;
    const id = ++generation;
    void readPreferences().then(({ modules, providers }) => {
      if (id === generation) usePreferences.setState({ modules, providers });
    }).catch(report);
  });
}

export async function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  await file.set(key, value);
  usePreferences.setState({ [key]: value } as Pick<Preferences, K>);
  await file.save();
  if (key === "modules" || key === "providers") await emitTo("main", changed, key);
}

export function modelChoices(config: ProvidersConfig) {
  return config.items.flatMap((provider) => provider.models.map((model) => ({
    provider, model, key: modelKey({ providerId: provider.id, model }),
  })));
}

export function modelKey(ref: ModelRef | null) {
  return ref ? JSON.stringify([ref.providerId, ref.model]) : "";
}
