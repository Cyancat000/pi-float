import assert from "node:assert/strict";
import { test } from "node:test";
import { currentTodo, latestMessage } from "../src/compact-summary.ts";

const text = (text) => ({ kind: "text", text });
const call = (toolName, toolCallId = toolName) => ({ kind: "toolCall", toolName, toolCallId, text: "raw arguments" });
const message = (role, blocks, extra) => ({ id: role, timestamp: "2026-01-01T00:00:00.000Z", role, blocks, ...extra });

test("tool call previews include names but not thinking, arguments, or tool results", () => {
  const messages = [message("assistant", [text("Latest\n\nreply"), text(" continued ")]),
    message("assistant", [text("Let me check"), call("Read"), call("Grep")]),
    message("tool", [text("raw tool output")])];
  const streaming = message("assistant", [{ kind: "thinking", text: "hidden" }]);
  const snapshot = { messages, streaming };
  assert.equal(latestMessage(snapshot).text, "工具调用 read、grep");
  assert.equal(latestMessage(snapshot, false).text, "Let me check");
  assert.equal(latestMessage({ ...snapshot, messages: messages.slice(0, 1) }).text, "Latest reply continued");
});

test("live tool activity supersedes the previous reply until a visible stream arrives", () => {
  const tool = call("Read", "parent/1");
  const snapshot = { messages: [message("user", [text("Check the file")])], streaming: null };
  const toolStream = latestMessage({ ...snapshot, streaming: message("assistant", [tool]) });
  snapshot.latestToolCall = { toolName: tool.toolName, toolCallId: tool.toolCallId };
  assert.deepEqual(latestMessage(snapshot), toolStream);
  assert.equal(latestMessage(snapshot, false).text, "Check the file");
  snapshot.latestToolCall = { toolName: "Read", toolCallId: "parent/2" };
  assert.equal(latestMessage(snapshot).text, toolStream.text);
  assert.notEqual(latestMessage(snapshot).key, toolStream.key);

  snapshot.streaming = message("assistant", [{ kind: "thinking", text: "hidden" }]);
  assert.equal(latestMessage(snapshot).text, toolStream.text);
  snapshot.streaming.blocks.push(text("Live reply"));
  const first = latestMessage(snapshot);
  snapshot.streaming.blocks.push(text("continues"));
  assert.equal(latestMessage(snapshot).key, first.key);
  assert.equal(latestMessage(snapshot).text, "Live reply continues");
  snapshot.messages.push({ ...snapshot.streaming, id: "saved-reply" });
  snapshot.streaming = null;
  delete snapshot.latestToolCall;
  assert.equal(latestMessage(snapshot).key, first.key);
});

test("latest chat preview handles empty states, images and errors", () => {
  assert.equal(latestMessage(null), null);
  const snapshot = { messages: [], streaming: null };
  assert.equal(latestMessage(snapshot), null);
  snapshot.messages.push(message("user", [{ kind: "image", text: "" }]));
  assert.equal(latestMessage(snapshot).text, "[图片]");
  snapshot.messages.push(message("assistant", [], { stopReason: "error", error: "Connection lost" }));
  assert.equal(latestMessage(snapshot).text, "Connection lost");
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
