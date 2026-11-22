import type { ExtensionAPI, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { TodoItem, TodoSnapshot, TodoSource } from "../../protocol/src/index.js";
import { Type } from "typebox";

const nativeEntry = "pi-float-todo-state";
const rpivEntry = "rpiv-todo-state";
const nativeTool = "pi_float_todo";
const rpivPackage = /^npm:@juicesharp\/rpiv-todo(?:@[^/]+)?$/;
const rpivPath = /(?:^|[/\\])@juicesharp[/\\]rpiv-todo[/\\]/i;

type ToolIdentity = { name: string; sourceInfo: { source: string; path: string } };

export function selectTodoSource(tools: readonly ToolIdentity[]): TodoSource {
  return tools.some(({ name, sourceInfo }) => name === "todo"
    && (rpivPackage.test(sourceInfo.source) || rpivPath.test(sourceInfo.path))) ? "rpiv-todo" : "pi-float";
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? value as Record<string, unknown> : undefined;
}

function readItems(value: unknown, source: TodoSource): TodoItem[] | undefined {
  const envelope = record(value);
  const rows = source === "rpiv-todo" ? envelope?.tasks : envelope?.items;
  if (!Array.isArray(rows) || (source === "rpiv-todo" && !Number.isSafeInteger(envelope?.nextId))) return;
  const items: TodoItem[] = [];
  const seen = new Set<number>();
  for (const row of rows) {
    const task = record(row);
    if (!task) return;
    const { id, subject, status } = task;
    if (typeof id !== "number" || !Number.isSafeInteger(id) || seen.has(id) || typeof subject !== "string") return;
    seen.add(id);
    if (status === "deleted" && source === "rpiv-todo") continue;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") return;
    items.push({ id, subject, status });
  }
  return items;
}

export function projectTodos(branch: readonly SessionEntry[], source: TodoSource): TodoSnapshot {
  const customType = source === "rpiv-todo" ? rpivEntry : nativeEntry;
  let legacy: TodoItem[] | undefined;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    if (entry.type === "custom" && entry.customType === customType) {
      const items = readItems(entry.data, source);
      if (items) return { source, items };
    }
    // Before rpiv-todo used custom entries, it persisted its state in tool results.
    if (source === "rpiv-todo" && !legacy && entry.type === "message" && entry.message.role === "toolResult"
      && entry.message.toolName === "todo" && !entry.message.isError) {
      legacy = readItems(entry.message.details, source);
    }
  }
  return { source, items: legacy ?? [] };
}

const rows = Type.Array(Type.Object({
  subject: Type.String({ minLength: 1, maxLength: 500 }),
  status: Type.Union([Type.Literal("pending"), Type.Literal("in_progress"), Type.Literal("completed")]),
}, { additionalProperties: false }), { maxItems: 50 });

export function registerNativeTodo(pi: ExtensionAPI, publish: (sessionId: string) => void) {
  pi.registerTool({
    name: nativeTool,
    label: "pi-float ToDo",
    description: "List or replace the pi-float task list for the current session branch. To update a task, first list and then set the full list with the changed status, keeping the other tasks. Set an empty list to clear it. Use for tracking multi-step work.",
    promptSnippet: "Track multi-step work in the session's pi-float ToDo panel",
    parameters: Type.Object({
      action: Type.Union([Type.Literal("list"), Type.Literal("set")]),
      items: Type.Optional(rows),
    }, { additionalProperties: false }),
    executionMode: "sequential",
    async execute(_id, params, _signal, _onUpdate, ctx) {
      let items: TodoItem[];
      if (params.action === "list") {
        items = projectTodos(ctx.sessionManager.getBranch(), "pi-float").items;
      } else {
        if (!params.items || params.items.some(({ subject }) => !subject.trim())) throw new Error("Provide items with non-blank task titles.");
        items = params.items.map(({ subject, status }, i) => ({ id: i + 1, subject: subject.trim(), status }));
        pi.appendEntry(nativeEntry, { items });
        publish(ctx.sessionManager.getSessionId());
      }
      return {
        content: [{ type: "text", text: items.length ? JSON.stringify(items) : "No tasks." }],
        details: { items },
      };
    },
  });
}
