import assert from "node:assert/strict";
import { test } from "node:test";
import { findRetry, projectTree } from "../src/tree.ts";

const user = (id, parentId, content = "Ask me") => ({ type: "message", id, parentId, message: { role: "user", content } });
const assistant = (id, parentId, stopReason) => ({ type: "message", id, parentId, message: { role: "assistant", content: [], stopReason } });
const custom = (id, parentId, type = "custom") => ({ type, id, parentId });
const node = (entry, ...children) => ({ entry, children });
const session = (branch, roots = []) => ({ getLeafId: () => branch.at(-1)?.id ?? null, getTree: () => [...roots], getBranch: () => branch });

test("Tree hides internal entries but preserves branch ancestry and the exact tips", () => {
  const prompt = user("u", null, [{ type: "text", text: "One\n  two" }, { type: "image", data: "not sent" }]);
  const hidden = custom("h", "u");
  const failure = assistant("e", "h", "aborted");
  const success = assistant("a", "h", "stop");
  const state = custom("s", "a");
  const root = node(prompt, node(hidden, node(failure), node(success, node(state))));
  const tree = projectTree(session([prompt, hidden, failure], [root]));
  assert.equal(tree.leafId, "e");
  assert.deepEqual(tree.entries.map(({ id, parentId, kind, landing }) => [id, parentId, kind, landing]), [
    ["u", null, "user", "before"], ["e", "u", "assistant", "at"], ["a", "u", "assistant", "at"], ["s", "a", "position", "at"],
  ]);
  assert.equal(tree.entries[0].preview, "One two [图片]");
  assert.equal(tree.entries[1].preview, "回复已中止");
});

test("Tree marks a non-tip current position and preserves the landing rule for hidden custom messages", () => {
  const prompt = user("u", null);
  const state = custom("s", "u");
  const hiddenPrompt = custom("h", "s", "custom_message");
  const tree = projectTree(session([prompt, state], [node(prompt, node(state, node(hiddenPrompt)))]));
  assert.equal(tree.leafId, "s");
  assert.equal(tree.entries.find(({ id }) => id === "s")?.kind, "position");
  assert.equal(tree.entries.find(({ id }) => id === "h")?.landing, "before");
  assert.deepEqual(projectTree(session([])), { leafId: null, entries: [] });
});

test("retry targets the original plain text without changing it and matches the real branch leaf", () => {
  const text = "  /literal\ntext\n";
  const prompt = user("u", null, [{ type: "text", text }]);
  const planning = assistant("p", "u", "toolUse");
  for (const stopReason of ["aborted", "error"]) {
    const failed = assistant("a", "p", stopReason);
    assert.deepEqual(findRetry(session([prompt, planning, failed, custom("tail", "a")])), {
      leafId: "tail", promptId: "u", assistantId: "a", parentId: null, text,
    });
  }
});

test("retry is unavailable without a failed response for an unambiguous supported prompt", () => {
  const prompt = user("u", null);
  const failure = assistant("a", "u", "error");
  for (const branch of [
    [], [prompt], [prompt, assistant("a", "u", "stop")], [prompt, failure, user("later", "a")],
    [user("u", null, [{ type: "image" }]), failure], [user("u", null, "   "), failure],
    ...["compaction", "branch_summary", "context_edit", "custom_message"].map(type => [prompt, custom("boundary", "u", type), failure]),
  ]) assert.equal(findRetry(session(branch)), undefined);
});
