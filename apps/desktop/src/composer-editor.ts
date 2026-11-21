import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { useLayoutEffect, useRef } from "react";
import { foldPastes, readComposerDraft } from "./composer-paste";

interface ComposerOptions {
  disabled: boolean;
  hint: string;
  showCommands: boolean;
  activeCommand: number;
  onEdit: (draft: ReturnType<typeof readComposerDraft>) => void;
  onKeyDown: (event: KeyboardEvent) => boolean;
}

function editorOptions({ disabled, hint, showCommands, activeCommand }: ComposerOptions) {
  return [
    EditorState.readOnly.of(disabled),
    EditorView.editable.of(!disabled),
    EditorView.contentAttributes.of({
      role: "textbox",
      "aria-label": "消息",
      "aria-multiline": "true",
      "aria-disabled": String(disabled),
      "aria-placeholder": hint,
      ...(showCommands ? { "aria-controls": "pi-commands" } : {}),
      ...(activeCommand >= 0 ? { "aria-activedescendant": `pi-command-${activeCommand}` } : {}),
    }),
    placeholder(hint),
  ];
}

export function useComposerEditor(options: ComposerOptions) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView>(null);
  const callbacks = useRef(options);
  const compartment = useRef(new Compartment());
  useLayoutEffect(() => { callbacks.current = options; });

  function emptyState() {
    return EditorState.create({
      extensions: [
        history(), foldPastes, EditorView.lineWrapping,
        compartment.current.of(editorOptions(callbacks.current)),
        EditorView.domEventHandlers({
          keydown(event) {
            if (event.isComposing || event.keyCode === 229) return false;
            return callbacks.current.onKeyDown(event);
          },
        }),
        keymap.of([...defaultKeymap, ...historyKeymap]),
        EditorView.updateListener.of(update => {
          if (!update.docChanged) return;
          callbacks.current.onEdit(readComposerDraft(update.state));
        }),
      ],
    });
  }

  useLayoutEffect(() => {
    const editor = new EditorView({ parent: host.current!, state: emptyState() });
    view.current = editor;
    return () => { view.current = null; editor.destroy(); };
  }, []);

  const { disabled, hint, showCommands, activeCommand } = options;
  useLayoutEffect(() => {
    view.current?.dispatch({ effects: compartment.current.reconfigure(editorOptions(callbacks.current)) });
  }, [disabled, hint, showCommands, activeCommand]);

  function clear() {
    const editor = view.current;
    if (!editor) return;
    // Start a fresh draft: undo must not recall already-sent text or paste numbers.
    const state = emptyState();
    editor.setState(state);
    callbacks.current.onEdit(readComposerDraft(state));
  }

  return { host, view, clear };
}
