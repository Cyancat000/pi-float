import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function launchDesktop(port: number) {
  const name = process.platform === "win32" ? "pi-float.exe" : "pi-float";
  const repo = fileURLToPath(new URL("../../../", import.meta.url));
  const pathEntries = (process.env.PATH ?? "").split(delimiter).filter(Boolean);
  const configured = process.env.PI_FLOAT_BIN;
  const bin = configured ? resolve(configured) : [
    ...pathEntries.map((folder) => join(folder, name)),
    join(repo, "apps", "desktop", "src-tauri", "target", "release", name),
    join(repo, "apps", "desktop", "src-tauri", "target", "debug", name),
  ].find(existsSync);
  if (!bin || !existsSync(bin)) throw new Error("找不到 pi-float。请设置 PI_FLOAT_BIN 或将桌面程序加入 PATH。");
  return new Promise<void>((accept, reject) => {
    const child = spawn(bin, ["--port", String(port)], { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", reject);
    child.once("spawn", () => { child.unref(); accept(); });
  });
}
