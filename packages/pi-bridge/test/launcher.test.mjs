import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { findDesktop } from "../src/launcher.ts";

function sandbox(t) {
  const home = mkdtempSync(join(tmpdir(), "pi-float-launcher-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const config = join(home, ".pi-float");
  const pathDir = join(home, "on PATH");
  mkdirSync(config);
  mkdirSync(pathDir);
  const name = process.platform === "win32" ? "pi-float.exe" : "pi-float";
  const pathBin = join(pathDir, name);
  writeFileSync(pathBin, "");
  return { home, pathDir, pathBin, name, registration: join(config, "desktop-path.json") };
}

test("explicit PI_FLOAT_BIN overrides PATH and a bad override is reported", t => {
  const { home, pathDir, pathBin } = sandbox(t);
  const override = join(home, "explicit.exe");
  writeFileSync(override, "");
  assert.equal(findDesktop({ PATH: pathDir, PI_FLOAT_BIN: override }, home), override);
  assert.throws(() => findDesktop({ PATH: pathDir, PI_FLOAT_BIN: home }, home), /PI_FLOAT_BIN/);
  assert.equal(findDesktop({ PATH: pathDir }, home), pathBin);
});

test("Windows uses the registered location without PATH and falls back if it becomes invalid", { skip: process.platform !== "win32" }, t => {
  const { home, pathDir, pathBin, name, registration } = sandbox(t);
  const desktop = join(home, "桌面应用");
  mkdirSync(desktop);
  const exe = join(desktop, name);
  writeFileSync(exe, "");
  writeFileSync(registration, JSON.stringify(exe));
  assert.equal(findDesktop({}, home), exe);
  assert.equal(findDesktop({ PATH: pathDir }, home), exe);
  rmSync(exe);
  assert.equal(findDesktop({ PATH: pathDir }, home), pathBin);
  writeFileSync(registration, "not JSON");
  assert.equal(findDesktop({ PATH: pathDir }, home), pathBin);
});
