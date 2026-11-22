import type { ChatMessage, MessageBlock } from "@pi-float/protocol";
import { useState } from "react";
import { Code, languageForPath } from "./code-highlight";

type ToolCall = Extract<MessageBlock, { kind: "toolCall" }>;
type ToolMessage = Extract<ChatMessage, { role: "tool" }>;
type Snippet = { label: string; source: string; language: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function splitArguments(args: Record<string, unknown>, toolName: string) {
  const metadata = { ...args };
  const snippets: Snippet[] = [];
  function take(field: string, language: string | undefined) {
    const source = args[field];
    if (!language || typeof source !== "string") return;
    snippets.push({ label: field, source, language });
    delete metadata[field];
  }
  const fileLanguage = languageForPath(args.path);
  if (toolName === "bash" || toolName === "powershell") take("command", toolName);
  if (toolName === "write") take("content", fileLanguage);
  if (toolName === "edit" && fileLanguage) {
    take("oldText", fileLanguage);
    take("newText", fileLanguage);
    if (Array.isArray(args.edits) && args.edits.length && args.edits.every((edit): edit is { oldText: string; newText: string } => isRecord(edit)
      && typeof edit.oldText === "string" && typeof edit.newText === "string" && Object.keys(edit).length === 2)) {
      args.edits.forEach((edit, index) => {
        snippets.push({ label: `edits[${index}].oldText`, source: edit.oldText, language: fileLanguage });
        snippets.push({ label: `edits[${index}].newText`, source: edit.newText, language: fileLanguage });
      });
      delete metadata.edits;
    }
  }
  return { metadata, snippets };
}

function ToolCode({ source, language }: { source: string; language?: string }) {
  // Large tool payloads stay readable without running a grammar over them on the UI thread.
  const className = language && source.length <= 64 * 1024 ? `language-${language}` : undefined;
  return <pre className="tool-code wrap-anywhere whitespace-pre-wrap"><Code className={className}>{source}</Code></pre>;
}

export function ToolResult({ message, readLanguage }: { message: ToolMessage; readLanguage?: string }) {
  return <div className={message.isError ? "error-text" : "secondary"}>
    {message.blocks.map((block, index) => <ToolCode key={index} source={block.text}
      language={!message.isError && message.toolName === "read" && block.kind === "text" ? readLanguage : undefined} />)}
  </div>;
}

function ToolCallBody({ block, results }: { block: ToolCall; results: ToolMessage[] }) {
  let source = block.text;
  let language: string | undefined;
  let readLanguage: string | undefined;
  let snippets: Snippet[] = [];
  // The bridge sends JSON arguments, but keep incomplete or unrecognized payloads visible.
  if (source.length <= 64 * 1024) {
    let args: unknown;
    try { args = JSON.parse(source); } catch { /* Incomplete args stay plain text. */ }
    if (args !== undefined) {
      language = "json";
      if (isRecord(args)) {
        const parts = splitArguments(args, block.toolName);
        snippets = parts.snippets;
        if (block.toolName === "read") readLanguage = languageForPath(args.path);
        source = snippets.length && !Object.keys(parts.metadata).length ? "" : JSON.stringify(parts.metadata, null, 2);
      } else {
        source = JSON.stringify(args, null, 2);
      }
    }
  }
  return <>
    {source && <ToolCode source={source} language={language} />}
    {snippets.map(({ label, source, language }) => <div key={label} className="mt-1">
      <div className="text-[11px] muted">{label}</div>
      <ToolCode source={source} language={language} />
    </div>)}
    {results.filter((item) => item.toolCallId === block.toolCallId).map((item) => <ToolResult key={item.id} message={item} readLanguage={readLanguage} />)}
  </>;
}

export function ToolCallDetail({ block, results }: { block: ToolCall; results: ToolMessage[] }) {
  const [open, setOpen] = useState(false);
  return <details className="chat-detail" onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>工具调用 · {block.toolName || "等待名称"}</summary>
    {open && <ToolCallBody block={block} results={results} />}
  </details>;
}
