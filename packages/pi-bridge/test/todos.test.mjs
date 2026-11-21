import assert from "node:assert/strict";
import { test } from "node:test";
import { projectTodos, registerNativeTodo, selectTodoSource } from "../src/todos.ts";

const item = (id, subject, status = "pending") => ({ id, subject, status });
const details = (...tasks) => ({ tasks, nextId: 10 });
const rpiv = (...tasks) => ({ type: "custom", customType: "rpiv-todo-state", data: details(...tasks) });
const native = (...items) => ({ type: "custom", customType: "pi-float-todo-state", data: { items } });
const legacy = (...tasks) => ({ type: "message", message: { role: "toolResult", toolName: "todo", details: details(...tasks), isError: false } });

const tool = (name, source, path = "") => ({ name, sourceInfo: { source, path } });
test("uses only known rpiv-todo tool provenance, not the generic tool name", () => {
  assert.equal(selectTodoSource([]), "pi-float");
  assert.equal(selectTodoSource([tool("todo", "npm:another-todo")]), "pi-float");
  assert.equal(selectTodoSource([tool("todo", "npm:@juicesharp/rpiv-todo@2.15.0")]), "rpiv-todo");
  assert.equal(selectTodoSource([tool("todo", "local", "C:\\node_modules\\@juicesharp\\rpiv-todo\\index.ts")]), "rpiv-todo");
});

test("prefers the latest valid rpiv snapshot over legacy results and ignores tombstones", () => {
  const task = item(1, "keep", "in_progress");
  const branch = [rpiv(item(1, "old")), rpiv(task, item(2, "hidden", "deleted")), rpiv("malformed"), legacy(item(1, "stale"))];
  assert.deepEqual(projectTodos(branch, "rpiv-todo"), { source: "rpiv-todo", items: [task] });
  assert.deepEqual(projectTodos([...branch, rpiv()], "rpiv-todo").items, []);
});

test("handles legacy plugin history, independent providers and branch changes", () => {
  const older = item(1, "legacy");
  const own = item(1, "built in", "completed");
  const root = [legacy(older), native(own)];
  const branch = [...root, native(), rpiv(item(1, "newer"))];
  assert.deepEqual(projectTodos(branch, "pi-float").items, []);
  assert.deepEqual(projectTodos(branch, "rpiv-todo").items, [item(1, "newer")]);
  assert.deepEqual(projectTodos(root, "pi-float").items, [own]);
  assert.deepEqual(projectTodos(root, "rpiv-todo").items, [older]);
  assert.deepEqual(projectTodos([], "pi-float").items, []);
});

test("native tool writes only its own branch state and publishes on changes", async () => {
  const branch = [rpiv(item(1, "untouched"))];
  let definition;
  const published = [];
  registerNativeTodo({ registerTool: (def) => { definition = def; }, appendEntry: (customType, data) => {
    branch.push({ type: "custom", customType, data });
  } }, (id) => published.push(id));
  const ctx = { sessionManager: { getBranch: () => branch, getSessionId: () => "active" } };
  const execute = (params) => definition.execute("call", params, undefined, undefined, ctx);
  assert.equal(definition.name, "pi_float_todo");
  await assert.rejects(execute({ action: "set" }));
  await assert.rejects(execute({ action: "set", items: [{ subject: "   ", status: "pending" }] }));
  await execute({ action: "set", items: [{ subject: "  native  ", status: "in_progress" }] });
  assert.deepEqual((await execute({ action: "list" })).details.items, [item(1, "native", "in_progress")]);
  await execute({ action: "set", items: [] });
  assert.deepEqual((await execute({ action: "list" })).details.items, []);
  assert.deepEqual(projectTodos(branch, "rpiv-todo").items, [item(1, "untouched")]);
  assert.deepEqual(published, ["active", "active"]);
});
