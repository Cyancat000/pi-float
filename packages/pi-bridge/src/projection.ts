import type { ExtensionContext, SessionEntry } from "@earendil-works/pi-coding-agent";
import type { ChatMessage, MessageBlock, SessionSnapshot, StreamingMessage, TodoSource } from "@pi-float/protocol";
import { projectTodos } from "./todos.js";

type Content =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | { type: "image" }
  | { type: "toolCall"; id: string; name: string; arguments: unknown };

export function contentBlocks(content: string | readonly Content[]): MessageBlock[] {
  if (typeof content === "string") return [{ kind: "text", text: content }];
  return content.flatMap((part): MessageBlock[] => {
    switch (part.type) {
      case "text": return [{ kind: "text", text: part.text }];
      case "thinking": return [{ kind: "thinking", text: part.thinking }];
      case "image": return [{ kind: "image", text: "图片附件" }];
      case "toolCall": return [{ kind: "toolCall", text: JSON.stringify(part.arguments ?? {}), toolName: part.name, toolCallId: part.id }];
    }
    return [];
  });
}

export function projectEntry(entry: SessionEntry): ChatMessage | null {
  const base = { id: entry.id, timestamp: entry.timestamp };
  if (entry.type === "custom_message" && entry.display) return { ...base, role: "notice", blocks: contentBlocks(entry.content) };
  if (entry.type !== "message") return null;
  const { message } = entry;
  if (message.role === "user") return { ...base, role: "user", blocks: contentBlocks(message.content) };
  if (message.role === "toolResult") return { ...base, role: "tool", blocks: contentBlocks(message.content), toolCallId: message.toolCallId, toolName: message.toolName, isError: message.isError };
  if (message.role !== "assistant") return null;
  const { usage } = message;
  return {
    ...base, role: "assistant", blocks: contentBlocks(message.content), model: `${message.provider}/${message.model}`,
    ...(message.stopReason === "aborted" || message.stopReason === "error" ? { stopReason: message.stopReason } : {}),
    ...(message.stopReason === "error" && message.errorMessage ? { error: message.errorMessage } : {}),
    usage: { input: usage.input, output: usage.output, cacheRead: usage.cacheRead, cacheWrite: usage.cacheWrite,
      reasoning: usage.reasoning, totalTokens: usage.totalTokens, cost: usage.cost.total },
  };
}

export function availableModels(ctx: ExtensionContext) {
  const scoped = ctx.scopedModels ?? [];
  return ctx.modelRegistry.getAvailable().filter((model) => !scoped.length || scoped.some((item) => item.model.provider === model.provider && item.model.id === model.id));
}

export function snapshot(ctx: ExtensionContext, streaming: StreamingMessage | null, todoSource: TodoSource): SessionSnapshot {
  const branch = ctx.sessionManager.getBranch();
  const messages = branch.flatMap((entry) => projectEntry(entry) ?? []);
  const firstUser = messages.find((message) => message.role === "user")?.blocks.find((block) => block.kind === "text")?.text;
  return {
    schemaVersion: 1, sessionId: ctx.sessionManager.getSessionId(), cwd: ctx.cwd,
    name: ctx.sessionManager.getSessionName()?.trim() || firstUser?.replace(/\s+/g, " ").trim().slice(0, 50) || "",
    model: ctx.model ? `${ctx.model.provider}/${ctx.model.id}` : null,
    thinkingLevel: ctx.thinkingLevel ?? null, idle: ctx.isIdle(), messages, streaming,
    contextUsage: ctx.getContextUsage() ?? null,
    todos: projectTodos(branch, todoSource),
    models: availableModels(ctx).map(({ id, name, provider }) => ({ id, name, provider })),
  };
}
