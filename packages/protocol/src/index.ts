/** pi-float DTOs; these are not Pi extension API types. */
export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  reasoning?: number;
  totalTokens: number;
  cost: number;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export type MessageBlock =
  | { kind: "text" | "thinking" | "image"; text: string }
  | { kind: "toolCall"; text: string; toolName: string; toolCallId: string };

interface MessageBase {
  id: string;
  timestamp: string;
  blocks: MessageBlock[];
}

export type ChatMessage = MessageBase & (
  | { role: "user" | "notice" }
  | { role: "assistant"; usage?: TokenUsage; model?: string; error?: string }
  | { role: "tool"; toolCallId: string; toolName: string; isError: boolean }
);

export interface ActiveSessionRegistration {
  sessionId: string;
  cwd: string;
  name: string;
  model: string | null;
  thinkingLevel: string | null;
  idle: boolean;
}

export interface TerminalRegistration {
  pid: number;
  cwd: string;
  sessionId: string;
  port: number;
  startedAt: string;
  token: string;
}

export interface TerminalModel { provider: string; id: string; name: string }

export interface WorkspaceSession { id: string; label: string; modified: string }

export interface SessionSnapshot extends ActiveSessionRegistration {
  schemaVersion: 1;
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  contextUsage: ContextUsage | null;
  sessionActions?: boolean;
  models?: TerminalModel[];
  commands?: { name: string; description?: string }[];
}

export type StreamingMessage = MessageBase & { role: "assistant" };

export type SyncEvent =
  | { type: "session_registered"; session: ActiveSessionRegistration }
  | { type: "session_unregistered"; sessionId: string }
  | { type: "snapshot"; session: SessionSnapshot }
  | { type: "stream"; sessionId: string; message: StreamingMessage | null };

export type BridgeRequest = { requestId: string; sessionId: string } & (
  | { type: "send"; text: string }
  | { type: "command"; text: string }
  | { type: "list_sessions" | "new_session" }
  | { type: "resume_session"; targetId: string }
  | { type: "abort" }
  | { type: "set_model"; provider: string; modelId: string }
);

export type NotificationLevel = "info" | "warning" | "error";

export interface NotificationEvent {
  type: "notification";
  sessionId: string;
  /** Strictly increasing for the lifetime of a bridge registration. */
  sequence: number;
  level: NotificationLevel;
  message: string;
}

export type BridgeEvent = SyncEvent | NotificationEvent | { type: "request_result"; requestId: string; error?: string; sessions?: WorkspaceSession[] };

export interface ModuleVisibility {
  showThinking: boolean;
  showToolCalls: boolean;
  showTokenUsage: boolean;
  showTimestamp: boolean;
}
