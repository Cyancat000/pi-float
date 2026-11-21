import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import markdown from "highlight.js/lib/languages/markdown";
import powershell from "highlight.js/lib/languages/powershell";
import python from "highlight.js/lib/languages/python";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";
import type { ComponentPropsWithoutRef } from "react";
import "highlight.js/styles/github-dark.css";

for (const [name, language] of Object.entries({ bash, c, cpp, csharp, css, go, java, javascript, json, markdown, powershell, python, rust, sql, typescript, xml, yaml })) {
  hljs.registerLanguage(name, language);
}

const fileLanguages = new Map(Object.entries({
  sh: "bash", bash: "bash", zsh: "bash", c: "c", h: "c", cpp: "cpp", hpp: "cpp", cc: "cpp", cs: "csharp",
  css: "css", go: "go", java: "java", js: "javascript", jsx: "javascript", mjs: "javascript", cjs: "javascript",
  json: "json", md: "markdown", ps1: "powershell", psm1: "powershell", py: "python", rs: "rust", sql: "sql",
  ts: "typescript", tsx: "typescript", mts: "typescript", cts: "typescript",
  html: "xml", htm: "xml", svg: "xml", xml: "xml", yaml: "yaml", yml: "yaml",
}));

export function languageForPath(path: unknown) {
  return typeof path === "string" ? fileLanguages.get(path.match(/\.([\w]+)$/)?.[1]?.toLowerCase() ?? "") : undefined;
}

export function Code({ className, children }: ComponentPropsWithoutRef<"code">) {
  const language = className?.match(/\blanguage-([\w+-]+)/)?.[1];
  if (!language || !hljs.getLanguage(language)) return <code className={className}>{children}</code>;
  // highlight.js escapes the source before generating span markup.
  return <code className={className} dangerouslySetInnerHTML={{ __html: hljs.highlight(String(children ?? ""), { language }).value }} />;
}
