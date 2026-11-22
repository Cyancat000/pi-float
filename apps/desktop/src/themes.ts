export const THEMES = [
  { id: "light", name: "Light", description: "经典浅灰 · 默认" },
  { id: "one-dark", name: "One Dark", description: "Atom / Zed · 冷灰蓝" },
  { id: "github-light", name: "GitHub Light", description: "Primer · 白底蓝色" },
  { id: "nord", name: "Nord", description: "Nord · 极地蓝灰" },
  { id: "mocha", name: "Catppuccin Mocha", description: "Catppuccin · 薰衣草紫" },
] as const;

export type ThemeId = typeof THEMES[number]["id"];
export const DEFAULT_THEME: ThemeId = "light";

export function normalizeTheme(value: unknown): ThemeId {
  return THEMES.find(({ id }) => id === value)?.id ?? DEFAULT_THEME;
}
