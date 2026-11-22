import type { ModuleVisibility } from "@pi-float/protocol";
import { emitTo, listen } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { create } from "zustand";
import { DEFAULT_THEME, normalizeTheme, type ThemeId } from "./themes";

export interface WindowPrefs {
  alwaysOnTop: boolean;
  opacity: number;
}

interface Preferences extends WindowPrefs {
  modules: ModuleVisibility;
  theme: ThemeId;
}

const defaults: Preferences = {
  theme: DEFAULT_THEME,
  alwaysOnTop: true,
  opacity: 1,
  modules: { showThinking: true, showToolCalls: true, showTokenUsage: true, showTimestamp: true },
};

const file = new LazyStore("preferences.json");
const changed = "pi-float:preferences-changed";
export const usePreferences = create<Preferences>(() => defaults);
let pendingSave = Promise.resolve();

async function readPreferences() {
  const [alwaysOnTop, opacity, modules, theme] = await Promise.all([
    file.get<boolean>("alwaysOnTop"), file.get<number>("opacity"),
    file.get<Partial<ModuleVisibility> & { thinking?: boolean; tools?: boolean; tokenUsage?: boolean }>("modules"),
    file.get<unknown>("theme"),
  ]);
  return {
    theme: normalizeTheme(theme),
    alwaysOnTop: alwaysOnTop ?? defaults.alwaysOnTop,
    opacity: Math.min(1, Math.max(0.35, opacity ?? defaults.opacity)),
    modules: {
      showThinking: modules?.showThinking ?? modules?.thinking ?? defaults.modules.showThinking,
      showToolCalls: modules?.showToolCalls ?? modules?.tools ?? defaults.modules.showToolCalls,
      showTokenUsage: modules?.showTokenUsage ?? modules?.tokenUsage ?? defaults.modules.showTokenUsage,
      showTimestamp: modules?.showTimestamp ?? defaults.modules.showTimestamp,
    },
  };
}

export async function loadPreferences() {
  usePreferences.setState(await readPreferences());
}

export function watchPreferences(report: (error: unknown) => void) {
  let generation = 0;
  return listen(changed, () => {
    const id = ++generation;
    void readPreferences().then(({ modules, theme }) => {
      if (id === generation) usePreferences.setState({ modules, theme });
    }).catch(report);
  });
}

export function savePreference<K extends keyof Preferences>(key: K, value: Preferences[K]) {
  usePreferences.setState({ [key]: value } as Pick<Preferences, K>);
  // Persist rapid changes (e.g. moving through themes with arrow keys) in order.
  const save = pendingSave.then(async () => {
    await file.set(key, value);
    await file.save();
    if (key === "modules" || key === "theme") await emitTo("main", changed);
  });
  pendingSave = save.catch(() => {});
  return save;
}
