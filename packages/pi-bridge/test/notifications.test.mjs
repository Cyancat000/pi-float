import assert from "node:assert/strict";
import { test } from "node:test";
import { observeNotifications } from "../src/notifications.ts";

test("forwards each native notification once with its original text and effective level", () => {
  const native = [];
  const forwarded = [];
  const original = function (...args) {
    assert.equal(this, ui);
    native.push(args);
  };
  const ui = { notify: original };
  const stop = observeNotifications(ui, (...args) => forwarded.push(args));
  ui.notify("same\n<text>", "warning");
  ui.notify("same\n<text>", "warning");
  ui.notify("failed", "error");
  ui.notify("default level");
  assert.deepEqual(native, [["same\n<text>", "warning"], ["same\n<text>", "warning"], ["failed", "error"], ["default level"]]);
  assert.deepEqual(forwarded, [["same\n<text>", "warning"], ["same\n<text>", "warning"], ["failed", "error"], ["default level", "info"]]);

  stop();
  assert.equal(ui.notify, original);
  ui.notify("after shutdown", "info");
  assert.equal(native.length, 5);
  assert.equal(forwarded.length, 4);
});

test("does not overwrite a later wrapper and never forwards through a stale one", () => {
  const native = [];
  const oldSession = [];
  const currentSession = [];
  const ui = { notify: (message) => native.push(message) };
  const stopOld = observeNotifications(ui, (message) => oldSession.push(message));
  const oldWrapper = ui.notify;
  const otherWrapper = (...args) => oldWrapper.apply(ui, args);
  ui.notify = otherWrapper;
  stopOld();
  assert.equal(ui.notify, otherWrapper);

  const stopCurrent = observeNotifications(ui, (message) => currentSession.push(message));
  ui.notify("next session");
  assert.deepEqual(native, ["next session"]);
  assert.deepEqual(oldSession, []);
  assert.deepEqual(currentSession, ["next session"]);
  stopCurrent();
  assert.equal(ui.notify, otherWrapper);
});

test("leaves a read-only Pi UI unchanged", () => {
  const ui = Object.freeze({ notify() {} });
  const original = ui.notify;
  const stop = observeNotifications(ui, () => assert.fail("should not wrap frozen UI"));
  ui.notify("native only");
  assert.equal(ui.notify, original);
  stop();
});
