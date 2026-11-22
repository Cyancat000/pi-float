import assert from "node:assert/strict";
import { test } from "node:test";
import { currentTodo, latestMessage } from "../src/compact-summary.ts";

const text = (text) => ({ kind: "text", text });
const message = (role, blocks, extra) => ({ role, blocks, ...extra });

test("latest chat preview follows the stream without showing thinking or tool traffic", () => {
  const messages = [
    message("user", [text("Older prompt")]),
    message("assistant", [text("Latest\n\nreply"), text(" continued ")]),
    message("assistant", [{ kind: "toolCall", text: "arguments" }]),
    message("tool", [text("raw tool output")]),
  ];
  const streaming = message("assistant", [{ kind: "thinking", text: "hidden" }]);
  assert.deepEqual(latestMessage({ messages, streaming }), { role: "assistant", text: "Latest reply continued" });
  streaming.blocks.push(text("Live reply"));
  assert.deepEqual(latestMessage({ messages, streaming }), { role: "assistant", text: "Live reply" });
});

test("latest chat preview handles empty states, images and errors", () => {
  assert.equal(latestMessage(null), null);
  const snapshot = { messages: [], streaming: null };
  assert.equal(latestMessage(snapshot), null);
  snapshot.messages.push(message("user", [{ kind: "image", text: "" }]));
  assert.deepEqual(latestMessage(snapshot), { role: "user", text: "[图片]" });
  snapshot.messages.push(message("assistant", [], { stopReason: "error", error: "Connection lost" }));
  assert.deepEqual(latestMessage(snapshot), { role: "assistant", text: "Connection lost" });
});

test("current todo prefers active work, then the next pending task, and counts completed tasks", () => {
  const items = ["completed", "pending", "completed", "in_progress", "completed"].map((status, id) => ({ id, subject: `Task ${id}`, status }));
  assert.deepEqual(currentTodo({ items }), { item: items[3], completed: 3, total: 5 });
  items[3].status = "completed";
  assert.deepEqual(currentTodo({ items }), { item: items[1], completed: 4, total: 5 });
  items[1].status = "completed";
  assert.deepEqual(currentTodo({ items }), { item: undefined, completed: 5, total: 5 });
  assert.deepEqual(currentTodo(undefined), { item: undefined, completed: 0, total: 0 });
});
