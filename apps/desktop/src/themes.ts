export const THEMES = [
  { id: "light", name: "Light · 浅灰" },
  { id: "one-dark", name: "One Dark · 夜蓝" },
  { id: "github-light", name: "GitHub Light · 云白" },
  { id: "nord", name: "Nord · 极夜" },
  { id: "mocha", name: "Catppuccin Mocha · 摩卡" },
  { id: "luna", name: "Sakurakouji Luna · 露娜" },
  { id: "merly", name: "Merly Lynch · 琳琪" },
  { id: "ange", name: "Ushiromiya Ange · 缘寿" },
  { id: "eustia", name: "Eustia Astraea · 提娅" },
] as const;

export type ThemeId = typeof THEMES[number]["id"];
export const DEFAULT_THEME: ThemeId = "light";

export function normalizeTheme(value: unknown): ThemeId {
  return THEMES.find(({ id }) => id === value)?.id ?? DEFAULT_THEME;
}
