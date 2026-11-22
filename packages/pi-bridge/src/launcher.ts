import { spawn } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const RELEASES_URL = "https://github.com/Cyancat000/pi-float/releases";

function isFile(path: string) {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

function registeredDesktop(home: string, name: string): string | undefined {
  try {
    const path: unknown = JSON.parse(readFileSync(join(home, ".pi-float", "desktop-path.json"), "utf8"));
    if (typeof path === "string" && isAbsolute(path) && basename(path).toLowerCase() === name) return path;
  } catch { /* An absent or invalid registration should not prevent other fallbacks. */ }
}

export function findDesktop(env = process.env, home = homedir()) {
  const windows = process.platform === "win32";
  const name = windows ? "pi-float.exe" : "pi-float";
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  if (env.PI_FLOAT_BIN) {
    const configured = resolve(env.PI_FLOAT_BIN);
    if (isFile(configured)) return configured;
    throw new Error(`PI_FLOAT_BIN 指向的桌面程序不存在：${configured}。请修正或清除该变量。`);
  }
  const registered = windows ? registeredDesktop(home, name) : undefined;
  const bin = [
    ...(registered ? [registered] : []),
    ...(env.PATH ?? "").split(delimiter).filter(isAbsolute).map((folder) => join(folder, name)),
    join(repo, "apps", "desktop", "src-tauri", "target", "release", name),
    join(repo, "apps", "desktop", "src-tauri", "target", "debug", name),
  ].find(isFile);
  if (bin) return bin;
  const instructions = windows
    ? "下载 pi-float.exe 并双击一次，再运行 /float-ui。"
    : "安装适用于当前平台的桌面程序，并设置 PI_FLOAT_BIN。";
  throw new Error(`未找到 pi-float 桌面程序。${RELEASES_URL} — ${instructions}`);
}

export function launchDesktop(port: number) {
  const bin = findDesktop();
  return new Promise<void>((accept, reject) => {
    const child = spawn(bin, ["--port", String(port)], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); accept(); });
  });
}
