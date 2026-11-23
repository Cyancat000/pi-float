import type { ChatMessage, SessionSnapshot, StreamingMessage, TodoSnapshot, ToolActivity } from "@pi-float/protocol";

export interface CompactPreview {
  key: string;
  role: "user" | "assistant" | "notice";
  text: string;
}

function preview(message: Exclude<ChatMessage, { role: "tool" }> | StreamingMessage, showTools: boolean): CompactPreview | null {
  const text = message.blocks.flatMap((block) =>
    block.kind === "text" ? [block.text] : block.kind === "image" ? [block.text || "[图片]"] : [],
  ).join(" ").replace(/\s+/g, " ").trim();
  const key = message.role === "assistant" ? `assistant:${message.timestamp}` : message.id;
  if ("stopReason" in message && message.stopReason) {
    const status = message.stopReason === "aborted" ? "回复已中止" : message.error || "回复失败";
    return { key, role: message.role, text: text ? `${status} · ${text}` : status };
  }
  if (showTools && message.role === "assistant") {
    const last = message.blocks.slice().reverse().find((block) => block.kind === "image"
      || (block.kind === "text" && block.text.trim()) || (block.kind === "toolCall" && block.toolName.trim()));
    if (last?.kind === "toolCall") {
      const calls = message.blocks.flatMap((block) => block.kind === "toolCall" && block.toolName.trim() ? [block] : []);
      return toolPreview(calls);
    }
  }
  return text ? { key, role: message.role, text } : null;
}

function toolPreview(calls: ToolActivity[]): CompactPreview {
  return {
    key: `tools:${JSON.stringify(calls.map((call) => call.toolCallId))}`,
    role: "assistant",
    text: `工具调用 ${calls.map((call) => call.toolName.toLowerCase()).join("、")}`,
  };
}

export function latestMessage(snapshot: Pick<SessionSnapshot, "messages" | "streaming" | "latestToolCall"> | null, showTools = true) {
  if (!snapshot) return null;
  const streaming = snapshot.streaming && preview(snapshot.streaming, showTools);
  if (streaming) return streaming;
  if (showTools && snapshot.latestToolCall) return toolPreview([snapshot.latestToolCall]);
  for (let index = snapshot.messages.length - 1; index >= 0; index--) {
    const message = snapshot.messages[index];
    if (message.role === "tool") continue;
    const summary = preview(message, showTools);
    if (summary) return summary;
  }
  return null;
}

export function currentTodo(todos: TodoSnapshot | undefined) {
  const items = todos?.items ?? [];
  return {
    item: items.find(({ status }) => status === "in_progress") ?? items.find(({ status }) => status === "pending"),
    completed: items.filter(({ status }) => status === "completed").length,
    total: items.length,
  };
}
