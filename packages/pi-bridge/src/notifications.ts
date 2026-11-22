import type { ExtensionContext } from "@earendil-works/pi-coding-agent";
import type { NotificationLevel } from "../../protocol/src/index.js";

// Pi 1.6.0 has no notification event. Its TUI extension runner exposes the same
// mutable UI object to event and command contexts. Keep this adapter local to that
// object; if Pi stops exposing it this way, leave the native UI untouched.
export function observeNotifications(
  ui: ExtensionContext["ui"],
  observe: (message: string, level: NotificationLevel) => void,
): () => void {
  const descriptor = Object.getOwnPropertyDescriptor(ui, "notify");
  if (!descriptor?.writable || typeof descriptor.value !== "function") return () => {};
  const original: typeof ui.notify = descriptor.value;
  let active = true;
  const notify: typeof ui.notify = function (this: typeof ui, ...args) {
    original.apply(this, args);
    if (active) observe(args[0], args[1] ?? "info");
  };
  ui.notify = notify;
  return () => {
    active = false;
    // Don't remove another extension's wrapper if it was installed after ours.
    const current = Object.getOwnPropertyDescriptor(ui, "notify");
    if (current?.writable && current.value === notify) ui.notify = original;
  };
}
