import type { SessionTree } from "@pi-float/protocol";
import { RotateCw, X } from "lucide-react";
import { useId, useMemo, useRef, useState } from "react";

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
  const canSwitch = !!selected && canNavigate && !stale && !pending;
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descriptionId = useId();

  function openConfirmation() {
    if (!canSwitch || !dialog.current) return;
    dialog.current.returnValue = "";
    dialog.current.showModal();
  }

  return <section className="session-history" aria-label="会话树">
    <div className="flex items-center gap-2">
      <span className="flex-1 font-medium">会话树</span>
      <button type="button" className="icon-button" title="刷新会话树" aria-label="刷新会话树" disabled={!canRefresh} onClick={onRefresh}>
        <RotateCw size={14} aria-hidden="true" />
      </button>
      <button type="button" className="icon-button" title="关闭会话树" aria-label="关闭会话树" onClick={onClose}>
        <X size={16} aria-hidden="true" />
      </button>
    </div>
    {stale && !pending && <p role="status" className="warning-text">会话位置已变化，请刷新后再切换。</p>}
    {!tree && <p role="status" className="muted">{pending ? "正在读取会话树…" : "未能读取会话树，请刷新。"}</p>}
    {tree && !rows.length && <p className="muted">当前会话没有可显示的节点。</p>}
    {selected && <div className="flex justify-end gap-2 py-1" aria-label="会话树选择操作">
      <button type="button" className="control" disabled={pending} onClick={() => setSelection(null)}>取消</button>
      <button type="button" className="control" disabled={!canSwitch} onClick={openConfirmation}>确认切换</button>
    </div>}
    {tree && rows.length > 0 && <ul className="max-h-[36vh] overflow-auto py-1" aria-label="会话节点">
      {rows.map(row => <li key={row.id} style={{ paddingInlineStart: Math.min(row.depth, 8) * 10 }}>
        <button type="button" aria-pressed={selected?.id === row.id} aria-current={row.current ? "location" : undefined}
          title={row.preview} disabled={row.current || pending}
          className="panel-row flex items-baseline gap-1.5"
          onClick={() => setSelection({ tree, id: row.id })}>
          {row.branch && <span className="shrink-0 muted">分支 {row.branch}</span>}
          <span className={`shrink-0 ${row.active ? "accent-text" : "muted"}`}>{names[row.kind]}</span>
          <span className="min-w-0 flex-1 truncate">{row.label ? `${row.label} · ` : ""}{row.preview}</span>
          {row.current && <span className="shrink-0 accent-text">当前位置</span>}
        </button>
      </li>)}
    </ul>}
    <dialog ref={dialog} className="tree-confirmation" aria-labelledby={titleId} aria-describedby={descriptionId}
      onClose={(event) => {
        if (event.currentTarget.returnValue === "switch" && canSwitch && selected) onNavigate(selected.id);
      }}>
      <form method="dialog">
        <h2 id={titleId} className="font-semibold">切换会话位置？</h2>
        <p id={descriptionId} className="mt-2 secondary">{!canSwitch ? "会话状态已变化，请关闭弹窗后重试。"
          : `${selected.landing === "before" ? "将切换到所选消息之前" : "将切换到所选节点"}。已修改的文件不会还原。`}</p>
        <div className="mt-3 flex justify-end gap-2">
          <button type="submit" className="control" value="cancel">取消</button>
          <button type="submit" className="control primary-action" disabled={!canSwitch} value="switch">切换</button>
        </div>
      </form>
    </dialog>
  </section>;
}
