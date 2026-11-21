import type { ChatMessage, SessionSnapshot, SyncEvent, TokenUsage } from "@pi-float/protocol";
import { Channel, invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import type { Provider } from "./preferences";

interface ChatState {
  snapshot: SessionSnapshot;
  durations: Record<string, number>;
  requestId: string | null;
}

export const useChat = create<ChatState>(() => ({
  snapshot: {
    schemaVersion: 1, sessionId: crypto.randomUUID(), cwd: "", name: "", model: null, thinkingLevel: null,
    idle: true, messages: [], streaming: null, contextUsage: null,
  },
  durations: {},
  requestId: null,
}));

export function applyChatEvent(event: SyncEvent) {
  if (event.type === "snapshot") {
    useChat.setState({ snapshot: event.session });
  } else if (event.type === "stream") {
    useChat.setState(({ snapshot }) => event.sessionId === snapshot.sessionId
      ? { snapshot: { ...snapshot, streaming: event.message } }
      : {});
  }
}

interface ChatOutcome {
  blocks: ChatMessage["blocks"];
  usage: TokenUsage | null;
  error: string | null;
  aborted: boolean;
}

export async function sendChat(text: string, provider: Provider, model: string) {
  const { snapshot, requestId } = useChat.getState();
  if (requestId || !text.trim()) return;
  const id = crypto.randomUUID();
  const started = performance.now();
  const timestamp = new Date().toISOString();
  const modelName = `${provider.name}/${model}`;
  const message: ChatMessage = { id: crypto.randomUUID(), timestamp, role: "user", blocks: [{ kind: "text", text }] };
  const session = { ...snapshot, messages: [...snapshot.messages, message], model: modelName, idle: false };
  useChat.setState({ requestId: id });
  applyChatEvent({ type: "snapshot", session });
  const updates = new Channel<ChatMessage["blocks"]>();
  updates.onmessage = (blocks) => {
    if (useChat.getState().requestId !== id) return;
    applyChatEvent({ type: "stream", sessionId: session.sessionId, message: { role: "assistant", id: "stream", timestamp, blocks } });
  };
  const history = session.messages.flatMap((item) => {
    if (item.role !== "user" && item.role !== "assistant") return [];
    if (item.role === "assistant" && item.error) return [];
    const content = item.blocks.flatMap((block) => block.kind === "text" ? [block.text] : []).join("\n");
    return content.trim() ? [{ role: item.role, content }] : [];
  });
  let result: ChatOutcome;
  try {
    result = await invoke("start_chat", {
      id, updates, request: { kind: provider.kind, baseUrl: provider.baseUrl, apiKey: provider.apiKey, model, messages: history },
    });
  } catch (cause) {
    result = { blocks: [], usage: null, aborted: false, error: String(cause) };
  }
  if (useChat.getState().requestId !== id) return;
  useChat.setState(({ durations }) => ({ requestId: null, durations: { ...durations, [id]: performance.now() - started } }));
  applyChatEvent({ type: "stream", sessionId: session.sessionId, message: null });
  const assistant: ChatMessage = {
    id, timestamp, role: "assistant", blocks: result.blocks, model: modelName,
    ...(result.usage ? { usage: result.usage } : {}),
    ...(result.error ? { error: result.error } : {}),
  };
  const showReply = !result.aborted || result.blocks.length > 0;
  applyChatEvent({ type: "snapshot", session: { ...session, idle: true, messages: showReply ? [...session.messages, assistant] : session.messages } });
}

export async function stopChat() {
  const id = useChat.getState().requestId;
  if (id) await invoke("stop_chat", { id });
}
