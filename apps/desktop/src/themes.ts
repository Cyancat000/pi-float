export const THEMES = [
  { id: "light", name: "Light · 浅灰", description: "经典浅灰 · 默认" },
  { id: "one-dark", name: "One Dark · 夜蓝", description: "Atom / Zed · 冷灰蓝" },
  { id: "github-light", name: "GitHub Light · 云白", description: "Primer · 白底蓝色" },
  { id: "nord", name: "Nord · 极夜", description: "Nord · 极地蓝灰" },
  { id: "mocha", name: "Catppuccin Mocha · 摩卡", description: "Catppuccin · 薰衣草紫" },
  { id: "luna", name: "Sakurakouji Luna · 露娜", description: "银白 · 绯红" },
  { id: "merly", name: "Merly Lynch · 琳琪", description: "暖白 · 亚麻浅黄" },
  { id: "ange", name: "Ushiromiya Ange · 缘寿", description: "暖深灰 · 红色" },
  { id: "eustia", name: "Eustia Astraea · 提娅", description: "银白 · 玫瑰粉" },
] as const;

export type ThemeId = typeof THEMES[number]["id"];
export const DEFAULT_THEME: ThemeId = "light";

export function normalizeTheme(value: unknown): ThemeId {
  return THEMES.find(({ id }) => id === value)?.id ?? DEFAULT_THEME;
}
