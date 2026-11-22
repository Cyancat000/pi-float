import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { RetryTarget, SessionTree, SessionTreeEntry } from "../../protocol/src/index.js";

type Session = ExtensionContext["sessionManager"];

function describeEntry(entry: SessionEntry): Pick<SessionTreeEntry, "kind" | "preview"> | undefined {
  if (entry.type === "compaction" || entry.type === "branch_summary") return { kind: "summary", preview: entry.summary };
  if (entry.type === "custom_message" && entry.display) return { kind: "notice", preview: previewContent(entry.content) || "通知" };
  if (entry.type !== "message") return;
  const { message } = entry;
  if (message.role !== "user" && message.role !== "assistant") return;
  const preview = previewContent(message.content).trim();
  if (preview) return { kind: message.role, preview };
  if (message.role === "assistant") {
    if (message.stopReason === "aborted") return { kind: "assistant", preview: "回复已中止" };
    if (message.stopReason === "error") return { kind: "assistant", preview: "回复失败" };
    const names = message.content.flatMap(block => block.type === "toolCall" ? [block.name.toLowerCase()] : []);
    if (names.length) return { kind: "assistant", preview: `工具调用 ${names.join("、")}` };
  }
  return { kind: message.role, preview: "无文本消息" };
}

function previewContent(content: string | readonly { type: string; text?: string }[]) {
  if (typeof content === "string") return content;
  let preview = "";
  for (const block of content) {
    const text = block.type === "text" ? block.text : block.type === "image" ? "[图片]" : undefined;
    if (text) preview += `${preview ? " " : ""}${text.slice(0, 1024)}`;
    if (preview.length >= 1024) break;
  }
  return preview;
}

export function projectTree(session: Session): SessionTree {
  const leafId = session.getLeafId();
  const entries: SessionTreeEntry[] = [];
  const stack = session.getTree().reverse().map(node => ({ node, parentId: null as string | null }));
  while (stack.length) {
    const { node, parentId } = stack.pop()!;
    const { entry, label } = node;
    // Preserve exact branch tips even when the final entry is an internal state change.
    const display = describeEntry(entry) ?? (entry.id === leafId || label || !node.children.length ? { kind: "position", preview: "会话位置" } as const : undefined);
    if (display) entries.push({
      id: entry.id, parentId, kind: display.kind, label: label?.slice(0, 120),
      landing: display.kind === "user" || entry.type === "custom_message" ? "before" : "at",
      preview: display.preview.slice(0, 1024).replace(/\s+/g, " ").trim().slice(0, 160),
    });
    for (let i = node.children.length - 1; i >= 0; i--) {
      stack.push({ node: node.children[i], parentId: display ? entry.id : parentId });
    }
  }
  return { leafId, entries };
}

export function findRetry(session: Session): (RetryTarget & { parentId: string | null; text: string }) | undefined {
  const leafId = session.getLeafId();
  if (!leafId) return;
  const branch = session.getBranch();
  let assistantId: string | undefined;
  for (let i = branch.length - 1; i >= 0; i--) {
    const entry = branch[i];
    // Do not cross a summary, a rewritten context, or an extension-authored prompt.
    if (entry.type === "compaction" || entry.type === "branch_summary" || entry.type === "context_edit" || entry.type === "custom_message") return;
    if (entry.type !== "message") continue;
    const { message } = entry;
    if (message.role === "assistant" && assistantId === undefined) {
      if (message.stopReason !== "aborted" && message.stopReason !== "error") return;
      assistantId = entry.id;
    } else if (message.role === "user") {
      if (!assistantId || entry.id === leafId) return;
      const text = typeof message.content === "string" ? message.content
        : message.content.length === 1 && message.content[0].type === "text" ? message.content[0].text : "";
      if (!text.trim()) return;
      return { leafId, promptId: entry.id, assistantId, parentId: entry.parentId, text };
    } else if (message.role === "bashExecution") return;
  }
}
