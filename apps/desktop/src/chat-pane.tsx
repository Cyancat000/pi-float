import type { ChatMessage, ContextUsage, MessageBlock, ModuleVisibility, StreamingMessage } from "@pi-float/protocol";
import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import python from "highlight.js/lib/languages/python";
import typescript from "highlight.js/lib/languages/typescript";
import { ArrowUp, Check, Copy, Square } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type ComponentPropsWithoutRef, type FormEvent } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TerminalBridge } from "./bridge-client";
import { sendChat, stopChat, useChat } from "./chat-state";
import { modelChoices, modelKey, usePreferences } from "./preferences";
import "highlight.js/styles/github-dark.css";

for (const [name, language] of Object.entries({ bash, javascript, json, python, typescript })) hljs.registerLanguage(name, language);

function Code({ className, children }: ComponentPropsWithoutRef<"code">) {
  const code = String(children ?? "");
  const language = className?.match(/\blanguage-([\w+-]+)/)?.[1];
  if (!language || !hljs.getLanguage(language)) return <code className={className}>{children}</code>;
  // highlight.js escapes the source before generating span markup.
  return <code className={className} dangerouslySetInnerHTML={{ __html: hljs.highlight(code, { language }).value }} />;
}

function CodeFence({ source, children }: { source: string; children: React.ReactNode }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(source.replace(/\n$/, ""));
      setCopied(true);
      setFailed(false);
    } catch { setFailed(true); }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setCopied(false); setFailed(false); }, 1400);
  }
  return (
    <div className="code-fence">
      <button className="icon-button" type="button" title="复制代码" aria-label="复制代码" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      {(copied || failed) && <span className="sr-only" role="status">{copied ? "代码已复制" : "未能复制代码"}</span>}
      <pre>{children}</pre>
    </div>
  );
}

function MarkdownText({ text }: { text: string }) {
  return <div className="markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={{
    code: ({ node: _, ...props }) => <Code {...props} />,
    pre: ({ node, children }) => {
      const code = node?.children[0];
      const source = code?.type === "element" ? code.children.map((child) => child.type === "text" ? child.value : "").join("") : "";
      return <CodeFence source={source}>{children}</CodeFence>;
    },
    // Don't load tracking images or navigate the app webview from provider output.
    img: ({ alt }) => <span>{alt || "[图片]"}</span>,
    a: ({ children, href }) => <span title={href} className="text-sky-300 underline">{children}</span>,
  }}>{text}</Markdown></div>;
}

function ToolResult({ message }: { message: Extract<ChatMessage, { role: "tool" }> }) {
  return <div className={message.isError ? "text-red-300" : "text-slate-300"}>
    {message.blocks.map((block, index) => <pre key={index} className="wrap-anywhere whitespace-pre-wrap">{block.text}</pre>)}
  </div>;
}

function Block({ block, modules, results }: { block: MessageBlock; modules: ModuleVisibility; results: Extract<ChatMessage, { role: "tool" }>[] }) {
  if (block.kind === "thinking") return modules.showThinking && <details className="chat-detail"><summary>思考过程</summary><MarkdownText text={block.text} /></details>;
  if (block.kind === "toolCall") return modules.showToolCalls && <details className="chat-detail"><summary>工具调用 · {block.toolName || "等待名称"}</summary>
    <pre className="wrap-anywhere whitespace-pre-wrap">{block.text}</pre>
    {results.filter((item) => item.toolCallId === block.toolCallId).map((item) => <ToolResult key={item.id} message={item} />)}
  </details>;
  if (block.kind === "image") return <p className="text-slate-400">{block.text}</p>;
  return <MarkdownText text={block.text} />;
}

function Message({ message, modules, results, duration }: { message: ChatMessage | StreamingMessage; modules: ModuleVisibility; results: Extract<ChatMessage, { role: "tool" }>[]; duration?: number }) {
  const usage = "usage" in message ? message.usage : undefined;
  const showUsage = modules.showTokenUsage && (usage || duration !== undefined);
  const visibleBlocks = message.blocks.filter((block) => {
    if (block.kind === "thinking") return modules.showThinking;
    if (block.kind === "toolCall") return modules.showToolCalls;
    return true;
  });
  if (message.role === "assistant" && !visibleBlocks.length && !("error" in message && message.error) && !showUsage) return null;
  const label = message.role === "user" ? "你" : message.role === "assistant" ? "助手" : message.role === "tool" ? "工具结果 · " + message.toolName : "通知";
  const time = new Date(message.timestamp);
  return (
    <article className={"message " + (message.role === "user" ? "message-user" : "")}>
      <header className="mb-1 flex items-baseline justify-between gap-2 text-[11px] text-slate-400">
        <span>{label}</span>
        {modules.showTimestamp && !Number.isNaN(time.valueOf()) && <time dateTime={message.timestamp}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>}
      </header>
      {message.role === "tool" ? <ToolResult message={message} /> : message.blocks.map((block, index) => <Block key={index} block={block} modules={modules} results={results} />)}
      {"error" in message && message.error && <p className="text-xs text-red-300" role="alert">{message.error}</p>}
      {showUsage && <p className="mt-1 text-[11px] text-slate-400">
        {usage && <span>{usage.totalTokens} tokens（输入 {usage.input} · 输出 {usage.output}{usage.cacheRead ? ` · 缓存读 ${usage.cacheRead}` : ""}{usage.cacheWrite ? ` · 缓存写 ${usage.cacheWrite}` : ""}{usage.reasoning !== undefined ? ` · 推理 ${usage.reasoning}` : ""}）</span>}
        {duration !== undefined && <span>{usage ? " · " : ""}{(duration / 1000).toFixed(1)} s</span>}
      </p>}
    </article>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage }) {
  return <span className="text-[11px] text-slate-400">上下文 {usage.tokens ?? "—"} / {usage.contextWindow}{usage.percent !== null && ` · ${Math.round(usage.percent)}%`}</span>;
}

export function ChatPane({ terminal, ready, report }: { terminal?: TerminalBridge; ready: boolean; report: (error: unknown) => void }) {
  const standalone = useChat();
  const snapshot = terminal ? terminal.snapshot : standalone.snapshot;
  const connected = !terminal || (terminal.connection === "connected" && !!terminal.snapshot);
  const { modules, providers } = usePreferences();
  const models = modelChoices(providers);
  const [override, setOverride] = useState("");
  const selection = models.find(({ key }) => key === override) ?? models.find(({ key }) => key === modelKey(providers.defaultModel)) ?? models[0];
  const [draft, setDraft] = useState("");
  const input = useRef<HTMLTextAreaElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [sending, setSending] = useState(false);
  const busy = snapshot?.idle === false;
  const canSend = ready && connected && !sending && !!draft.trim() && (!!terminal || (!busy && !!selection));
  const messages = snapshot?.messages ?? [];
  const results = messages.filter((message) => message.role === "tool");
  const matched = new Set(messages.flatMap((message) => message.blocks.flatMap((block) => block.kind === "toolCall" ? [block.toolCallId] : [])));
  const terminalModels = snapshot?.models ?? [];
  const terminalModelSelected = terminalModels.some(({ provider, id }) => `${provider}/${id}` === snapshot?.model);

  useLayoutEffect(() => {
    if (!input.current) return;
    const el = input.current;
    el.style.height = "auto";
    const height = el.scrollHeight + el.offsetHeight - el.clientHeight;
    el.style.height = `${Math.min(116, height)}px`;
    el.style.overflowY = height > 116 ? "auto" : "hidden";
  }, [draft]);
  useLayoutEffect(() => {
    if (stick.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [snapshot?.messages, snapshot?.streaming, modules]);

  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!canSend) return;
    const text = draft.trim();
    setDraft("");
    stick.current = true;
    if (terminal) {
      setSending(true);
      void terminal.request({ type: "send", text }).catch((error) => {
        setDraft((current) => current || text);
        report(error);
      }).finally(() => setSending(false));
    } else if (selection) {
      void sendChat(text, selection.provider, selection.model).catch(report);
    }
  }

  return <>
    <div ref={feed} className="min-h-0 flex-1 overflow-auto px-2.5 py-2" onScroll={(event) => {
      const el = event.currentTarget;
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    }}>
      {terminal && !connected && <p className="px-2 py-1 text-xs text-slate-400" role="status">正在连接 Pi 终端…</p>}
      {connected && !messages.length && !busy && <div className="empty-chat">{terminal || selection ? "发送消息开始对话" : "请先在设置中添加提供商和模型"}</div>}
      {messages.map((message) => message.role === "tool" && (!modules.showToolCalls || matched.has(message.toolCallId)) ? null : <Message key={message.id} message={message} modules={modules} results={results} duration={terminal ? undefined : standalone.durations[message.id]} />)}
      {snapshot?.streaming && <Message message={snapshot.streaming} modules={modules} results={results} />}
      {busy && !snapshot?.streaming && <p className="px-2 text-xs text-slate-400" role="status">正在等待回复…</p>}
    </div>
    <form className="shrink-0 border-t border-white/12 p-2" onSubmit={submit}>
      <textarea ref={input} rows={1} className="field block w-full resize-none" aria-label="消息" placeholder={terminal && busy ? "插话给终端…" : "输入消息…"} value={draft} disabled={!connected || !ready} onChange={(event) => setDraft(event.currentTarget.value)} onKeyDown={(event) => {
        if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing || event.keyCode === 229) return;
        event.preventDefault();
        submit();
      }} />
      <div className="mt-1.5 flex items-center justify-between gap-1.5">
        {terminal ? <select className="field model-select" aria-label="模型" disabled={!connected || busy || !terminalModels.length} value={snapshot?.model ?? ""} onChange={(event) => {
          const model = terminalModels.find(({ provider, id }) => `${provider}/${id}` === event.currentTarget.value);
          if (model) void terminal.request({ type: "set_model", provider: model.provider, modelId: model.id }).catch(report);
        }}>
          {!terminalModelSelected && <option value={snapshot?.model ?? ""}>{snapshot?.model ?? "无终端模型"}</option>}
          {terminalModels.map(({ provider, id, name }) => <option key={`${provider}/${id}`} value={`${provider}/${id}`}>{provider} / {name || id}</option>)}
        </select> : <select className="field model-select" aria-label="模型" disabled={busy || !models.length} value={selection?.key ?? ""} onChange={(event) => setOverride(event.currentTarget.value)}>
          {!models.length && <option value="">未配置模型</option>}
          {models.map(({ key, provider, model }) => <option key={key} value={key}>{provider.name} / {model}</option>)}
        </select>}
        {modules.showTokenUsage && snapshot?.contextUsage && <ContextMeter usage={snapshot.contextUsage} />}
        <div className="flex shrink-0 gap-1">
          {busy && <button className="icon-button" type="button" aria-label="中止" title="中止" disabled={!connected} onClick={() => void (terminal ? terminal.request({ type: "abort" }) : stopChat()).catch(report)}><Square size={15} /></button>}
          {(!busy || terminal) && <button className="icon-button primary-action" type="submit" aria-label={terminal && busy ? "插话" : "发送"} title={terminal && busy ? "插话" : "发送"} disabled={!canSend}><ArrowUp size={16} /></button>}
        </div>
      </div>
    </form>
  </>;
}
