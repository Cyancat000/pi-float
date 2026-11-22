import { mkdirSync, readFileSync, renameSync, rmdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { TerminalRegistration } from "../../protocol/src/index.js";

const dir = join(homedir(), ".pi-float");
const path = join(dir, "sessions.json");
const lock = join(dir, "sessions.lock");

// Shared with the desktop cleanup command. Keep the locked work synchronous and short.
export function updateRegistry(update: (rows: TerminalRegistration[]) => TerminalRegistration[]) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const until = Date.now() + 1500;
  for (;;) {
    try { mkdirSync(lock, { mode: 0o700 }); break; }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 30_000) rmdirSync(lock); } catch { /* another writer */ }
      if (Date.now() >= until) throw new Error("pi-float 会话注册表正忙");
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  const temporary = join(dir, `sessions.${randomUUID()}.tmp`);
  try {
    let rows: TerminalRegistration[] = [];
    try {
      const value = JSON.parse(readFileSync(path, "utf8"));
      if (Array.isArray(value)) rows = value;
    } catch (error) {
      if (!(error instanceof SyntaxError) && (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    writeFileSync(temporary, JSON.stringify(update(rows.filter(isRegistration)), null, 2) + "\n", { mode: 0o600, flag: "wx" });
    renameSync(temporary, path);
  } finally {
    try { rmSync(temporary, { force: true }); } finally { rmdirSync(lock); }
  }
}

function isRegistration(value: unknown): value is TerminalRegistration {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Partial<TerminalRegistration>;
  return Number.isInteger(row.pid) && row.pid! > 0 && Number.isInteger(row.port) && row.port! > 0 && row.port! <= 65535
    && typeof row.cwd === "string" && typeof row.sessionId === "string" && typeof row.startedAt === "string"
    && typeof row.token === "string" && /^[a-f0-9]{64}$/.test(row.token);
}
