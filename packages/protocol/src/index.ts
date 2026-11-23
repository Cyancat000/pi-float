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
  | { role: "assistant"; usage?: TokenUsage; model?: string; error?: string; stopReason?: "aborted" | "error" }
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

export interface SessionTreeEntry {
  id: string;
  parentId: string | null;
  kind: "user" | "assistant" | "notice" | "summary" | "position";
  landing: "before" | "at";
  preview: string;
  label?: string;
}

export interface SessionTree { leafId: string | null; entries: SessionTreeEntry[] }
export interface RetryTarget { promptId: string; assistantId: string; leafId: string }

export type TodoSource = "pi-float" | "rpiv-todo";
export type TodoStatus = "pending" | "in_progress" | "completed";
export interface TodoItem { id: number; subject: string; status: TodoStatus }
export interface TodoSnapshot { source: TodoSource; items: TodoItem[] }

export interface SessionSnapshot extends ActiveSessionRegistration {
  schemaVersion: 1;
  messages: ChatMessage[];
  streaming: StreamingMessage | null;
  latestToolCall?: ToolActivity;
  contextUsage: ContextUsage | null;
  sessionActions?: boolean;
  /** Undefined means the attached bridge does not support Tree. */
  treeLeafId?: string | null;
  retryTarget?: RetryTarget;
  todos?: TodoSnapshot;
  models?: TerminalModel[];
  commands?: { name: string; description?: string }[];
}

export type StreamingMessage = MessageBase & { role: "assistant" };
export interface ToolActivity { toolCallId: string; toolName: string }

export type SyncEvent =
  | { type: "session_registered"; session: ActiveSessionRegistration }
  | { type: "session_unregistered"; sessionId: string }
  | { type: "snapshot"; session: SessionSnapshot }
  | { type: "stream"; sessionId: string; message: StreamingMessage | null }
  | { type: "tool_call"; sessionId: string; call: ToolActivity };

export type BridgeRequest = { requestId: string; sessionId: string } & (
  | { type: "send"; text: string }
  | { type: "command"; text: string }
  | { type: "list_sessions" | "new_session" }
  | { type: "resume_session"; targetId: string }
  | { type: "get_tree" }
  | { type: "navigate_tree"; targetId: string; expectedLeafId: string | null }
  | { type: "retry_turn"; promptId: string; expectedLeafId: string }
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

export interface RequestResult {
  type: "request_result";
  requestId: string;
  error?: string;
  sessions?: WorkspaceSession[];
  tree?: SessionTree;
}

export type BridgeEvent = SyncEvent | NotificationEvent | RequestResult;

export interface ModuleVisibility {
  showThinking: boolean;
  showToolCalls: boolean;
  showTokenUsage: boolean;
  showTimestamp: boolean;
}
