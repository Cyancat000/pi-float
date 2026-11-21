import type { SessionTree } from "@pi-float/protocol";
import { useMemo, useState } from "react";

const names = { user: "你", assistant: "助手", notice: "通知", summary: "摘要", position: "会话位置" };

function treeRows(tree: SessionTree | null) {
  if (!tree) return [];
  const counts = new Map<string | null, number>();
  const parents = new Map(tree.entries.map(({ id, parentId }) => [id, parentId]));
  for (const { parentId } of tree.entries) counts.set(parentId, (counts.get(parentId) ?? 0) + 1);
  const active = new Set<string>();
  for (let id = tree.leafId; id !== null; id = parents.get(id) ?? null) active.add(id);
  const depths = new Map<string, number>();
  const siblings = new Map<string | null, number>();
  return tree.entries.map((entry) => {
    const { parentId } = entry;
    const split = (counts.get(parentId) ?? 0) > 1;
    const depth = parentId === null ? 0 : (depths.get(parentId) ?? 0) + Number(split);
    depths.set(entry.id, depth);
    const branch = split ? (siblings.get(parentId) ?? 0) + 1 : undefined;
    if (branch) siblings.set(parentId, branch);
    return { ...entry, depth, branch, current: entry.id === tree.leafId, active: active.has(entry.id) };
  });
}

export function SessionTreePanel({ tree, stale, pending, canNavigate, canRefresh, onRefresh, onNavigate, onClose }: {
  tree: SessionTree | null;
  stale: boolean;
  pending: boolean;
  canNavigate: boolean;
  canRefresh: boolean;
  onRefresh: () => void;
  onNavigate: (targetId: string) => void;
  onClose: () => void;
}) {
  const rows = useMemo(() => treeRows(tree), [tree]);
  const [selection, setSelection] = useState<{ tree: SessionTree; id: string } | null>(null);
  const selected = selection && selection.tree === tree ? rows.find(row => row.id === selection.id) : undefined;
  const before = selected?.landing === "before";
  return <section className="mt-1 border-t border-white/10 pt-1" aria-label="会话树">
    <div className="flex items-center gap-2">
      <span className="flex-1 font-medium">会话树</span>
      <button type="button" className="text-sky-300 disabled:opacity-40" disabled={!canRefresh} onClick={onRefresh}>刷新</button>
      <button type="button" className="text-slate-300" onClick={onClose}>关闭</button>
    </div>
    {stale && !pending && <p role="status" className="text-amber-300">会话位置已变化，请刷新后再切换。</p>}
    {!tree && <p role="status" className="text-slate-400">{pending ? "正在读取会话树…" : "未能读取会话树，请刷新。"}</p>}
    {tree && !rows.length && <p className="text-slate-400">当前会话没有可显示的节点。</p>}
    {tree && rows.length > 0 && <ul className="max-h-[36vh] overflow-auto py-1" aria-label="会话节点">
      {rows.map(row => <li key={row.id} style={{ paddingInlineStart: Math.min(row.depth, 8) * 10 }}>
        <button type="button" aria-pressed={selected?.id === row.id} aria-current={row.current ? "location" : undefined}
          title={row.preview} disabled={row.current || pending}
          className={`flex w-full items-baseline gap-1.5 rounded px-1 py-1 text-left ${selected?.id === row.id ? "bg-sky-900/60" : "hover:bg-white/10"}`}
          onClick={() => setSelection({ tree, id: row.id })}>
          {row.branch && <span className="shrink-0 text-slate-400">分支 {row.branch}</span>}
          <span className={`shrink-0 ${row.active ? "text-sky-300" : "text-slate-400"}`}>{names[row.kind]}</span>
          <span className="min-w-0 flex-1 truncate">{row.label ? `${row.label} · ` : ""}{row.preview}</span>
          {row.current && <span className="shrink-0 text-sky-300">当前位置</span>}
        </button>
      </li>)}
    </ul>}
    {selected && <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-white/10 py-1">
      <p className="min-w-32 flex-1 text-slate-300">{before ? "回到这条消息之前" : "保留到这个节点"}；不生成摘要，也不还原文件。</p>
      <button type="button" className="text-slate-300" disabled={pending} onClick={() => setSelection(null)}>取消</button>
      <button type="button" className="text-sky-300 disabled:opacity-40" disabled={!canNavigate || stale || pending} onClick={() => onNavigate(selected.id)}>确认切换</button>
    </div>}
  </section>;
}
