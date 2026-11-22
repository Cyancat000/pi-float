import type { ChatMessage, SessionSnapshot, StreamingMessage, TodoSnapshot } from "@pi-float/protocol";

function preview(message: ChatMessage | StreamingMessage) {
  const text = message.blocks.flatMap((block) =>
    block.kind === "text" ? [block.text] : block.kind === "image" ? [block.text || "[图片]"] : [],
  ).join(" ").replace(/\s+/g, " ").trim();
  if ("stopReason" in message && message.stopReason) {
    const status = message.stopReason === "aborted" ? "回复已中止" : message.error || "回复失败";
    return text ? `${status} · ${text}` : status;
  }
  return text;
}

export function latestMessage(snapshot: Pick<SessionSnapshot, "messages" | "streaming"> | null) {
  if (!snapshot) return null;
  const streamingText = snapshot.streaming && preview(snapshot.streaming);
  if (streamingText) return { role: "assistant" as const, text: streamingText };
  for (let index = snapshot.messages.length - 1; index >= 0; index--) {
    const message = snapshot.messages[index];
    if (message.role === "tool") continue;
    const text = preview(message);
    if (text) return { role: message.role, text };
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
