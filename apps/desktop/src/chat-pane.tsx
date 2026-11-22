import type { ChatMessage, ContextUsage, MessageBlock, ModuleVisibility, SessionTree, StreamingMessage, WorkspaceSession } from "@pi-float/protocol";
import { ArrowUp, Check, ChevronDown, ChevronUp, Copy, GitBranch, History, MessageSquare, Plus, RotateCw, Square, UnfoldVertical } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import Markdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { TerminalBridge } from "./bridge-client";
import { Code } from "./code-highlight";
import { useComposerEditor } from "./composer-editor";
import { formatTokens } from "./format-tokens";
import { Picker } from "./picker";
import { usePreferences } from "./preferences";
import { SessionTreePanel } from "./session-tree";
import { TodoPanel } from "./todo-panel";
import { ToolCallDetail, ToolResult } from "./tool-content";

const CODE_PREVIEW_LINES = 8;

function CodeFence({ source, languageClass }: { source: string; languageClass?: string }) {
  const [expanded, setExpanded] = useState(false);
  const codeId = useId();
  // Markdown adds a trailing newline; it isn't an extra source line.
  const code = source.replace(/\n$/, "");
  const lines = code.split("\n");
  const foldable = lines.length > CODE_PREVIEW_LINES;
  const visibleSource = foldable && !expanded ? lines.slice(0, CODE_PREVIEW_LINES).join("\n") + "\n" : source;
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  const timer = useRef<number>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setFailed(false);
    } catch { setFailed(true); }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => { setCopied(false); setFailed(false); }, 1400);
  }
  return (
    <div className="code-fence">
      <button className="icon-button code-fence-copy" type="button" title="复制代码" aria-label="复制代码" onClick={() => void copy()}>{copied ? <Check size={13} /> : <Copy size={13} />}</button>
      {(copied || failed) && <span className="sr-only" role="status">{copied ? "代码已复制" : "未能复制代码"}</span>}
      <pre id={codeId}><Code className={languageClass}>{visibleSource}</Code></pre>
      {foldable && <button className="code-fence-toggle" type="button" aria-controls={codeId} aria-expanded={expanded} onClick={() => setExpanded((open) => !open)}>
        {expanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
        {expanded ? "收起代码" : `展开全部 ${lines.length} 行`}
      </button>}
    </div>
  );
}

const markdownComponents: Components = {
  code: ({ node: _, ...props }) => <Code {...props} />,
  pre: ({ node }) => {
    const code = node?.children[0];
    if (code?.type !== "element") return null;
    const source = code.children.map((child) => child.type === "text" ? child.value : "").join("");
    const classes = code.properties.className;
    const languageClass = Array.isArray(classes) ? classes.join(" ") : undefined;
    return <CodeFence source={source} languageClass={languageClass} />;
  },
  // Don't load tracking images or navigate the app webview from provider output.
  img: ({ alt }) => <span>{alt || "[图片]"}</span>,
  a: ({ children, href }) => <span title={href} className="accent-text underline">{children}</span>,
};

function MarkdownText({ text }: { text: string }) {
  return <div className="markdown"><Markdown skipHtml remarkPlugins={[remarkGfm]} components={markdownComponents}>{text}</Markdown></div>;
}

function Block({ block, modules, results }: { block: MessageBlock; modules: ModuleVisibility; results: Extract<ChatMessage, { role: "tool" }>[] }) {
  if (block.kind === "thinking") return modules.showThinking && <details className="chat-detail"><summary>思考过程</summary><MarkdownText text={block.text} /></details>;
  if (block.kind === "toolCall") return modules.showToolCalls && <ToolCallDetail block={block} results={results} />;
  if (block.kind === "image") return <p className="muted">{block.text}</p>;
  return <MarkdownText text={block.text} />;
}

function Message({ message, modules, results, retry }: { message: ChatMessage | StreamingMessage; modules: ModuleVisibility; results: Extract<ChatMessage, { role: "tool" }>[]; retry?: { enabled: boolean; run: () => void } }) {
  const stopReason = "stopReason" in message ? message.stopReason : undefined;
  const usage = modules.showTokenUsage && "usage" in message ? message.usage : undefined;
  const visibleBlocks = message.blocks.filter((block) => {
    if (block.kind === "thinking") return modules.showThinking;
    if (block.kind === "toolCall") return modules.showToolCalls;
    return true;
  });
  if (message.role === "assistant" && !visibleBlocks.length && !stopReason && !("error" in message && message.error) && !usage) return null;
  const label = message.role === "user" ? "你" : message.role === "assistant" ? "助手" : message.role === "tool" ? "工具结果 · " + message.toolName : "通知";
  const time = new Date(message.timestamp);
  return (
    <article className={"message " + (message.role === "user" ? "message-user" : "")}>
      <header className="mb-1 flex items-baseline justify-between gap-2 text-[11px] muted">
        <span>{label}</span>
        {modules.showTimestamp && !Number.isNaN(time.valueOf()) && <time dateTime={message.timestamp}>{time.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</time>}
      </header>
      {message.role === "tool" ? <ToolResult message={message} /> : message.blocks.map((block, index) => <Block key={index} block={block} modules={modules} results={results} />)}
      {stopReason === "aborted" && <p className="text-xs warning-text">回复已中止</p>}
      {(stopReason === "error" || ("error" in message && message.error)) && <p className="text-xs error-text" role="alert">{"error" in message && message.error ? message.error : "回复失败"}</p>}
      {retry && <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]">
        <button type="button" className="control"
          disabled={!retry.enabled} onClick={retry.run}><RotateCw size={12} />重试</button>
        <span className="muted">从原提示重新生成，不撤销已执行的操作。</span>
      </div>}
      {usage && <p className="mt-1 text-[11px] muted">
        {formatTokens(usage.totalTokens)} tokens（输入 {formatTokens(usage.input)} · 输出 {formatTokens(usage.output)}
        {usage.cacheRead ? ` · 缓存读 ${formatTokens(usage.cacheRead)}` : ""}
        {usage.cacheWrite ? ` · 缓存写 ${formatTokens(usage.cacheWrite)}` : ""}
        {usage.reasoning !== undefined ? ` · 推理 ${formatTokens(usage.reasoning)}` : ""}）
      </p>}
    </article>
  );
}

function ContextMeter({ usage }: { usage: ContextUsage }) {
  return <span className="text-[11px] muted">上下文 {usage.tokens === null ? "—" : formatTokens(usage.tokens)} / {formatTokens(usage.contextWindow)}{usage.percent !== null && ` · ${Math.round(usage.percent)}%`}</span>;
}

export function ChatPane({ terminal, ready, report, visible }: { terminal: TerminalBridge; ready: boolean; report: (error: unknown) => void; visible: boolean }) {
  const { snapshot } = terminal;
  const connected = terminal.connection === "connected" && !!snapshot;
  const modules = usePreferences((prefs) => prefs.modules);
  const [{ text: draft, hasLargePaste, hasCollapsedPaste, startsInPaste }, setDraft] = useState({
    text: "", hasLargePaste: false, hasCollapsedPaste: false, startsInPaste: false,
  });
  const feed = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [sending, setSending] = useState(false);
  const busy = connected && snapshot.idle === false;
  const [choice, setChoice] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const commandList = useRef<HTMLDivElement>(null);
  const [history, setHistory] = useState<WorkspaceSession[] | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [tree, setTree] = useState<SessionTree | null>(null);
  const [changing, setChanging] = useState(false);
  const treeSupported = snapshot?.treeLeafId !== undefined;
  const canAct = ready && connected && !changing && !sending;
  const sessionEnabled = canAct && snapshot?.sessionActions && !busy;
  const treeStale = !!tree && tree.leafId !== snapshot?.treeLeafId;
  const retryTarget = connected && !busy ? snapshot?.retryTarget : undefined;
  const commands = [...(snapshot?.commands ?? [])];
  if (snapshot?.sessionActions) commands.unshift({ name: "new", description: "在当前工作区新建会话" }, { name: "resume", description: "选择当前工作区的历史会话" });
  async function sessionAction(type: "new_session" | "list_sessions" | "resume_session", targetId?: string) {
    if (!sessionEnabled) return;
    setChanging(true);
    setTreeOpen(false);
    try {
      const result = await terminal.request(type === "resume_session" ? { type, targetId: targetId! } : { type });
      if (type === "list_sessions") setHistory(result.sessions ?? []);
    } catch (error) { report(error); }
    finally { setChanging(false); }
  }

  async function openTree() {
    if (!canAct || !treeSupported) return;
    setTreeOpen(true);
    setTree(null);
    setHistory(null);
    setChanging(true);
    try {
      const result = await terminal.request({ type: "get_tree" });
      if (!result.tree) throw new Error("终端未返回会话树");
      setTree(result.tree);
    } catch (error) { report(error); }
    finally { setChanging(false); }
  }

  async function navigateTree(targetId: string) {
    if (!canAct || busy || !tree || treeStale) return;
    setChanging(true);
    stick.current = true;
    try {
      await terminal.request({ type: "navigate_tree", expectedLeafId: tree.leafId, targetId });
      setTreeOpen(false);
    } catch (error) { report(error); }
    finally { setChanging(false); }
  }

  async function retryTurn() {
    if (!canAct || !retryTarget) return;
    setChanging(true);
    stick.current = true;
    try {
      await terminal.request({ type: "retry_turn", expectedLeafId: retryTarget.leafId, promptId: retryTarget.promptId });
      setTreeOpen(false);
    } catch (error) { report(error); }
    finally { setChanging(false); }
  }

  const menuOpen = connected && !dismissed && !hasLargePaste && !startsInPaste && /^\/[^\s]*$/.test(draft);
  const matches = menuOpen ? commands.filter(({ name }) => name.toLowerCase().startsWith(draft.slice(1).toLowerCase()))
    .sort((a, b) => Number(b.name === draft.slice(1)) - Number(a.name === draft.slice(1)) || a.name.localeCompare(b.name)) : [];
  const index = Math.min(choice, matches.length - 1);
  useEffect(() => {
    commandList.current?.children[index]?.scrollIntoView({ block: "nearest" });
  }, [index, draft]);
  const isDraftCommand = !startsInPaste && draft.trimStart().startsWith("/");
  const canSend = ready && connected && !changing && !sending && !!draft.trim() && !(busy && isDraftCommand);
  const composer = useComposerEditor({
    disabled: !connected || !ready,
    hint: busy ? "插话给终端…" : "输入消息…",
    showCommands: menuOpen,
    activeCommand: index,
    report,
    onEdit(next) { setDraft(next); setChoice(0); setDismissed(false); },
    onKeyDown(event): boolean {
      if (menuOpen && event.key === "Escape") { setDismissed(true); return true; }
      if (index >= 0 && !event.shiftKey) {
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          setChoice((index + (event.key === "ArrowDown" ? 1 : -1) + matches.length) % matches.length);
          return true;
        }
        if (event.key === "Tab") {
          const insert = `/${matches[index].name} `;
          const editor = composer.view.current;
          if (editor) editor.dispatch({ changes: { from: 0, to: editor.state.doc.length, insert }, selection: { anchor: insert.length }, scrollIntoView: true });
          return true;
        }
        if (event.key === "Enter") { submit(undefined, `/${matches[index].name}`); return true; }
      }
      if (event.key !== "Enter" || event.shiftKey) return false;
      submit();
      return true;
    },
  });
  const messages = snapshot?.messages ?? [];
  const results = messages.filter((message) => message.role === "tool");
  const matched = new Set(messages.flatMap((message) => message.blocks.flatMap((block) => block.kind === "toolCall" ? [block.toolCallId] : [])));
  const terminalModels = snapshot?.models ?? [];
  const modelKey = snapshot?.model ?? "";
  const providerEnd = modelKey.indexOf("/");
  const modelFallback = providerEnd > 0
    ? { label: modelKey.slice(providerEnd + 1), detail: modelKey.slice(0, providerEnd) }
    : modelKey || "无终端模型";

  useLayoutEffect(() => {
    if (visible && stick.current && feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [snapshot?.messages, snapshot?.streaming, modules, busy, visible]);

  function submit(event?: FormEvent<HTMLFormElement>, command?: string) {
    event?.preventDefault();
    if (!canSend) return;
    const isCommand = command !== undefined || isDraftCommand;
    // Keep the original indentation and trailing newline of pasted code, even after expanding it.
    const text = command ?? (hasLargePaste && !isCommand ? draft : draft.trim());
    if (isCommand && snapshot?.sessionActions && /^\/(new|resume)(?:\s|$)/.test(text)) {
      if (text !== "/new" && text !== "/resume") { report("请直接使用 /new 或 /resume，不需要参数"); return; }
      composer.clear(); void sessionAction(text === "/new" ? "new_session" : "list_sessions"); return;
    }
    if (isCommand && !commands.some(({ name }) => name === text.slice(1).split(/\s/, 1)[0])) {
      report(snapshot?.commands ? "此命令不在当前会话列表中；仅限终端的命令请在 Pi 中执行。" : "请先在 Pi 终端重新加载 pi-float 扩展以启用命令。");
      return;
    }
    const submitted = composer.view.current?.state.doc;
    stick.current = true;
    setSending(true);
    void terminal.request({ type: isCommand ? "command" : "send", text }).then(() => {
      // Leave the draft intact on failure or if the user started editing it again.
      if (composer.view.current?.state.doc === submitted) composer.clear();
    }).catch(report).finally(() => setSending(false));
  }

  return <>
    <div className="chat-panels">
      {snapshot?.sessionActions && <section className="session-panel" aria-label="会话操作">
        <div className="session-toolbar">
          <MessageSquare size={14} className="muted shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate font-medium" title={snapshot.name}>{snapshot.name || "当前会话"}</span>
          <div className="session-actions">
            <button type="button" className="control" disabled={!sessionEnabled} aria-label="新建会话" title={busy ? "请等待回复结束" : "在当前工作区新建会话"}
              onClick={() => void sessionAction("new_session")}><Plus size={14} /><span>新建</span></button>
            <button type="button" className="control" disabled={!sessionEnabled} aria-label="历史会话" title="历史会话" aria-expanded={history !== null}
              onClick={() => history === null ? void sessionAction("list_sessions") : setHistory(null)}><History size={14} /><span>历史</span></button>
            {treeSupported && <button type="button" className="control" disabled={!canAct} aria-label="会话树" title="会话树" aria-expanded={treeOpen}
              onClick={() => treeOpen ? setTreeOpen(false) : void openTree()}><GitBranch size={14} /><span>会话树</span></button>}
          </div>
        </div>
        {changing && !treeOpen && <p role="status">正在处理会话操作…</p>}
        {treeOpen && <SessionTreePanel tree={tree} stale={treeStale} pending={changing} canRefresh={canAct} canNavigate={canAct && !busy}
          onRefresh={() => void openTree()} onNavigate={(id) => void navigateTree(id)} onClose={() => setTreeOpen(false)} />}
        {history !== null && <div className="session-history popup-enter" aria-label="当前工作区的历史会话">
          {!history.length && <p role="status">当前工作区没有其他历史会话</p>}
          {history.map(row => <button key={row.id} type="button" className="panel-row flex gap-2" disabled={!sessionEnabled} onClick={() => void sessionAction("resume_session", row.id)}>
            <span className="flex-1 truncate" title={row.label}>{row.label}</span><time className="muted">{new Date(row.modified).toLocaleString()}</time>
          </button>)}
        </div>}
      </section>}
      {connected && snapshot.todos && <TodoPanel todos={snapshot.todos} />}
    </div>
    <div ref={feed} className="chat-feed" onScroll={(event) => {
      const el = event.currentTarget;
      if (visible) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
    }}>
      <div>
        {!connected && <div className="px-2 py-1 text-xs muted">
          <p role="status">{terminal.connection === "failed" ? "无法读取 Pi 终端会话。请确认终端仍在运行，或在目标终端执行 /ui 重新附着。"
            : terminal.connection === "disconnected" ? "连接已断开，即将重试…" : "正在连接 Pi 终端…"}</p>
          {terminal.connection === "failed" && <button type="button" className="control mt-1" onClick={terminal.retry}>重新连接</button>}
        </div>}
        {connected && !messages.length && !busy && <div className="empty-chat"><MessageSquare size={22} aria-hidden="true" /><strong>开始对话</strong><p>发送消息，或输入 <code>/</code> 查看命令。</p></div>}
        {messages.map((message) => message.role === "tool" && (!modules.showToolCalls || matched.has(message.toolCallId)) ? null :
          <Message key={message.id} message={message} modules={modules} results={results}
            retry={retryTarget?.assistantId === message.id ? { enabled: canAct, run: () => void retryTurn() } : undefined} />)}
        {snapshot?.streaming && <Message message={snapshot.streaming} modules={modules} results={results} />}
      </div>
      <div role="status">
        {busy && <><span className="sr-only">Pi 正在工作…</span><div className="working-blocks" aria-hidden="true" /></>}
      </div>
    </div>
    <form className="composer-dock" onSubmit={submit}>
      {menuOpen && <div className="popup command-popup">
        <p className="px-2 py-1 muted">{busy ? "终端忙碌中，结束后可执行命令" : "↑↓ 选择 · Tab 补全 · Enter 或点击执行"}</p>
        <div id="pi-commands" ref={commandList} role="listbox" aria-label="Pi 命令" className="max-h-48 overflow-y-auto">
          {matches.map(({ name, description }, i) => <button type="button" tabIndex={-1} role="option" id={`pi-command-${i}`} aria-selected={index === i} key={`${name}:${i}`} title={description}
            className="panel-row truncate px-2"
            onMouseDown={(e) => e.preventDefault()} onClick={() => submit(undefined, `/${name}`)}>/{name} <span className="secondary">{description}</span></button>)}
        </div>
        {!matches.length && <p className="px-2 py-1">{snapshot?.commands ? "没有匹配的命令" : "请在终端重新加载 pi-float 扩展"}</p>}
      </div>}
      <div className="composer">
        <div ref={composer.host} />
        <div className="composer-toolbar">
          <Picker className="model-picker" label="模型" value={modelKey} fallback={modelFallback} above inlineDetail
            disabled={!connected || busy || changing || sending}
            options={terminalModels.map(({ provider, id, name }) => ({ value: `${provider}/${id}`, label: name || id, detail: provider }))}
            onChange={(value) => {
              const model = terminalModels.find(({ provider, id }) => `${provider}/${id}` === value);
              if (model) void terminal.request({ type: "set_model", provider: model.provider, modelId: model.id }).catch(report);
            }} />
          {modules.showTokenUsage && snapshot?.contextUsage && <ContextMeter usage={snapshot.contextUsage} />}
          <div className="flex shrink-0 gap-1">
            {hasCollapsedPaste && <button className="icon-button" type="button" aria-label="展开粘贴内容" title="展开粘贴内容"
              onClick={composer.expand}><UnfoldVertical size={15} /></button>}
            {busy && <button className="icon-button" type="button" aria-label="中止" title="中止" disabled={!connected} onClick={() => void terminal.request({ type: "abort" }).catch(report)}><Square size={15} /></button>}
            <button className="icon-button primary-action" type="submit" aria-label={busy ? "插话" : "发送"} title={busy ? "插话" : "发送"} disabled={!canSend}><ArrowUp size={16} /></button>
          </div>
        </div>
      </div>
    </form>
  </>;
}
