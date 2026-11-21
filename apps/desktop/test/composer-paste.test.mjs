import assert from "node:assert/strict";
import { test } from "node:test";
import { history, redo, undo } from "@codemirror/commands";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { foldPastes, readComposerDraft } from "../src/composer-paste.ts";

const code = Array.from({ length: 12 }, (_, i) => `  const line${i} = ${i};\n`).join("");
const editor = (doc = "") => EditorState.create({ doc, extensions: [history(), foldPastes] });
const paste = (state, insert, from = state.doc.length, to = from) =>
  state.update({ changes: { from, to, insert }, userEvent: "input.paste" }).state;

function folds(state) {
  const result = [];
  for (const set of state.facet(EditorView.decorations)) {
    set.between(0, state.doc.length, (from, to, deco) => result.push([from, to, deco.spec.widget.label]));
  }
  return result;
}

function runHistory(command, state) {
  assert.equal(command({ state, dispatch: tr => { state = tr.state; } }), true);
  return state;
}

test("large pastes replace the selection visually while retaining the original text", () => {
  let state = paste(editor("前 删除 后"), code, 2, 4);
  state = paste(state, "x".repeat(1001));
  assert.deepEqual(folds(state), [[2, 2 + code.length, "[粘贴内容 #1 12行]"], [state.doc.length - 1001, state.doc.length, "[粘贴内容 #2 1行]"]]);
  assert.equal(readComposerDraft(state).text, `前 ${code} 后${"x".repeat(1001)}`);
});

test("short pastes, manually typed multiline text, and literal labels are not folded", () => {
  const literal = "[粘贴内容 #1 12行]";
  const state = paste(editor(code), literal);
  assert.deepEqual(folds(state), []);
  assert.equal(readComposerDraft(state).text, code + literal);
});

test("edits outside folds move them; removal and undo/redo preserve their provenance", () => {
  let state = paste(editor(), code);
  state = state.update({ changes: { from: 0, insert: "Ask:\n" } }).state;
  assert.deepEqual(folds(state), [[5, 5 + code.length, "[粘贴内容 #1 12行]"]]);
  state = state.update({ changes: { from: 5, to: state.doc.length }, userEvent: "delete.backward" }).state;
  assert.deepEqual(folds(state), []);
  state = runHistory(undo, state);
  assert.equal(readComposerDraft(state).text, "Ask:\n" + code);
  assert.deepEqual(folds(state), [[5, 5 + code.length, "[粘贴内容 #1 12行]"]]);
  state = runHistory(redo, state);
  assert.equal(readComposerDraft(state).text, "Ask:\n");
  assert.deepEqual(folds(state), []);
});

test("undo then redo restores the original paste and its label", () => {
  let state = paste(editor(), code);
  assert.equal(readComposerDraft(state).startsInPaste, true);
  state = runHistory(undo, state);
  assert.equal(readComposerDraft(state).text, "");
  assert.deepEqual(folds(state), []);
  state = runHistory(redo, state);
  assert.equal(readComposerDraft(state).text, code);
  assert.deepEqual(folds(state), [[0, code.length, "[粘贴内容 #1 12行]"]]);
});
