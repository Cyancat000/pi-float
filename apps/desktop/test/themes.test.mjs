import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { DEFAULT_THEME, normalizeTheme, THEMES } from "../src/themes.ts";

const css = readFileSync(new URL("../src/themes.css", import.meta.url), "utf8");
const palettes = new Map([...css.matchAll(/([^{}]+)\{([^{}]+)\}/g)].flatMap(([, selector, body]) => {
  const id = selector.match(/\[data-palette="([\w-]+)"\]/)?.[1];
  if (!id) return [];
  return [[id, Object.fromEntries([...body.matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, name, value]) => [name, value]))]];
}));

test("Light is the default for missing and unknown preferences", () => {
  assert.equal(DEFAULT_THEME, "light");
  for (const value of [undefined, null, 0, {}, "", "retired-theme", "toString"]) assert.equal(normalizeTheme(value), DEFAULT_THEME);
  for (const { id } of THEMES) assert.equal(normalizeTheme(id), id);
});

test("theme names use the original name followed by a two-character Chinese name", () => {
  for (const { name } of THEMES) assert.match(name, /^[A-Za-z ]+ · \p{Script=Han}{2}$/u);
});

test("character themes declare their intended color schemes", () => {
  for (const [id, scheme] of [["luna", "light"], ["merly", "light"], ["ange", "dark"], ["eustia", "light"]]) {
    assert.ok(css.includes(`[data-palette="${id}"] {\n  color-scheme: ${scheme};`), id);
  }
});

test("every selectable theme has a complete palette for both the window and its preview", () => {
  assert.deepEqual([...palettes.keys()].sort(), THEMES.map(({ id }) => id).sort());
  const required = Object.keys(palettes.get(DEFAULT_THEME)).sort();
  for (const [id, palette] of palettes) {
    assert.deepEqual(Object.keys(palette).sort(), required, id);
    if (id !== DEFAULT_THEME) assert.ok(css.includes(`:root[data-theme="${id}"], [data-palette="${id}"]`), id);
  }
});

function luminance(hex) {
  assert.match(hex, /^#[\da-f]{6}$/i);
  return hex.slice(1).match(/../g).reduce((sum, byte, channel) => {
    const srgb = parseInt(byte, 16) / 255;
    const linear = srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4;
    return sum + linear * [0.2126, 0.7152, 0.0722][channel];
  }, 0);
}

test("core text, code and status colors meet 4.5:1 contrast at full opacity", () => {
  for (const [id, palette] of palettes) {
    const color = (token) => palette[token] === "var(--accent)" ? palette.accent : palette[token];
    const check = (foreground, background) => {
      const a = luminance(color(foreground));
      const b = luminance(color(background));
      const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
      assert.ok(ratio >= 4.5, `${id}: ${foreground} on ${background} is ${ratio.toFixed(2)}:1`);
    };
    for (const background of ["canvas", "panel", "chrome", "surface", "message-fill", "accent-fill", "hover"]) {
      for (const foreground of ["text", "secondary", "muted", "accent-ink"]) check(foreground, background);
    }
    for (const [foreground, background] of [
      ["text", "selection"], ["on-accent", "accent"], ["on-accent", "accent-hover"],
      ["success", "panel"], ["warning", "surface"], ["danger", "danger-fill"], ["success", "success-fill"],
    ]) check(foreground, background);
    for (const token of Object.keys(palette).filter((key) => key.startsWith("syntax-"))) check(token, "surface");
  }
});
