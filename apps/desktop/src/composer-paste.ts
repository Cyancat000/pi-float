import { invertedEffects, isolateHistory } from "@codemirror/commands";
import { EditorState, MapMode, StateEffect, StateField, type ChangeDesc, type Extension } from "@codemirror/state";
import { Decoration, EditorView, WidgetType } from "@codemirror/view";

interface PasteRange { id: number; lines?: number; expanded?: boolean; from: number; to: number }

function mapRange(range: PasteRange, changes: ChangeDesc): PasteRange | undefined {
  if (range.lines === undefined || range.expanded) {
    // Visible paste text is editable; preserve its origin while its first character survives.
    const from = changes.mapPos(range.from, 1, MapMode.TrackAfter);
    return from === null ? undefined : { ...range, from, to: changes.mapPos(range.to, -1) };
  }
  // An edit into a fold exposes any remaining text instead of hiding the edit.
  if (changes.touchesRange(range.from + 1, range.to - 1)) return undefined;
  return { ...range, from: changes.mapPos(range.from, 1), to: changes.mapPos(range.to, -1) };
}

const addPaste = StateEffect.define<PasteRange>({ map: mapRange });
const removePaste = StateEffect.define<number>();
export const expandPastes = StateEffect.define<null>();

const isCollapsed = (range: PasteRange) => range.lines !== undefined && !range.expanded;

class PasteLabel extends WidgetType {
  readonly label: string;
  constructor(label: string) { super(); this.label = label; }
  eq(other: PasteLabel) { return this.label === other.label; }
  toDOM(view: EditorView) {
    const node = view.dom.ownerDocument.createElement("span");
    node.className = "composer-paste";
    node.textContent = this.label;
    return node;
  }
}

const pasteRanges = StateField.define<{ ranges: PasteRange[]; nextId: number; nextPathId: number }>({
  create: () => ({ ranges: [], nextId: 1, nextPathId: 1 }),
  update(value, tr) {
    const added = tr.effects.filter(effect => effect.is(addPaste)).map(effect => effect.value);
    const removed = new Set(tr.effects.filter(effect => effect.is(removePaste)).map(effect => effect.value));
    const expand = tr.effects.some(effect => effect.is(expandPastes));
    if (!expand && !added.length && !removed.size && (!tr.docChanged || !value.ranges.length)) return value;
    const ranges = value.ranges.flatMap(range => {
      const mapped = !removed.has(range.id) && mapRange(range, tr.changes);
      if (!mapped) return [];
      return [expand && isCollapsed(mapped) ? { ...mapped, expanded: true } : mapped];
    });
    return {
      ranges: ranges.concat(added),
      nextId: Math.max(value.nextId, ...added.filter(({ id }) => id > 0).map(({ id }) => id + 1)),
      nextPathId: Math.max(value.nextPathId, ...added.filter(({ id }) => id < 0).map(({ id }) => 1 - id)),
    };
  },
});

const pasteDecorations = StateField.define({
  create: () => Decoration.none,
  update(value, tr) {
    const pastes = tr.state.field(pasteRanges);
    if (pastes === tr.startState.field(pasteRanges)) return value;
    return Decoration.set(pastes.ranges.filter(isCollapsed).map(({ id, lines, from, to }) => Decoration.replace({
      widget: new PasteLabel(`[粘贴内容 #${id} ${lines}行]`),
    }).range(from, to)), true);
  },
  provide: field => [EditorView.decorations.from(field), EditorView.atomicRanges.of(view => view.state.field(field))],
});

export const foldPastes: Extension = [
  pasteRanges,
  pasteDecorations,
  EditorState.transactionExtender.of(tr => {
    if (!tr.docChanged) return null;
    const effects: StateEffect<PasteRange>[] = [];
    let { nextId, nextPathId, ranges } = tr.startState.field(pasteRanges);
    if (tr.isUserEvent("input.paste.path")) {
      // Keep paths visible and editable, but never interpret a leading Unix path as a slash command.
      tr.changes.iterChanges((_a, _b, from, to) => {
        if (from !== to) effects.push(addPaste.of({ id: -nextPathId++, from, to }));
      });
    } else if (tr.isUserEvent("input.paste")) {
      tr.changes.iterChanges((_from, _to, from, to, inserted) => {
        const lines = inserted.lines - Number(inserted.lines > 1 && !inserted.line(inserted.lines).length);
        if (lines > 10 || inserted.length > 1000) effects.push(addPaste.of({ id: nextId++, lines, from, to }));
      });
    }
    // Deleting a whole fold is a separate undo step, just like inserting one.
    return effects.length || ranges.some(range => !mapRange(range, tr.changes))
      ? { effects, annotations: isolateHistory.of("full") } : null;
  }),
  invertedEffects.of(tr => {
    const before = tr.startState.field(pasteRanges).ranges;
    const after = tr.state.field(pasteRanges).ranges;
    return [
      ...after.filter(range => !before.some(old => old.id === range.id)).map(range => removePaste.of(range.id)),
      ...before.filter(range => !after.some(next => next.id === range.id)).map(range => addPaste.of(range)),
    ];
  }),
];

export function readComposerDraft(state: EditorState) {
  const text = state.doc.toString();
  const { ranges } = state.field(pasteRanges);
  const start = text.length - text.trimStart().length;
  return {
    text,
    hasLargePaste: ranges.some(({ lines }) => lines !== undefined),
    hasCollapsedPaste: ranges.some(isCollapsed),
    startsInPaste: ranges.some(({ from, to }) => from <= start && start < to),
  };
}
