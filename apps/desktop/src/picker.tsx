import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";

export interface PickerOption {
  value: string;
  label: string;
  detail?: string;
}

export function Picker({ label, value, options, onChange, disabled, above, icon, fallback, inlineDetail, className = "" }: {
  label: string;
  value: string;
  options: PickerOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  above?: boolean;
  icon?: ReactNode;
  fallback: string | Pick<PickerOption, "label" | "detail">;
  inlineDetail?: boolean;
  className?: string;
}) {
  const id = useId();
  const root = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [activeValue, setActiveValue] = useState<string | null>(null);
  const selected = options.findIndex((option) => option.value === value);
  const current = options.findIndex((option) => option.value === activeValue);
  const active = current >= 0 ? current : Math.max(selected, 0);
  const unavailable = disabled || options.length === 0;
  const open = activeValue !== null && !unavailable;

  useEffect(() => {
    if (unavailable) setActiveValue(null);
  }, [unavailable]);
  useEffect(() => {
    if (!open) return;
    function dismiss(event: PointerEvent) {
      if (event.target instanceof Node && !root.current?.contains(event.target)) setActiveValue(null);
    }
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [open]);
  useEffect(() => {
    if (open) list.current?.children[active]?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  function choose(index: number) {
    setActiveValue(null);
    const option = options[index];
    if (option && option.value !== value) onChange(option.value);
  }

  function onKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const { key } = event;
    if (key === "Escape" && open) {
      event.preventDefault();
      event.stopPropagation();
      setActiveValue(null);
    } else if ((key === "Enter" || key === " ") && open) {
      event.preventDefault();
      choose(active);
    } else if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
      event.preventDefault();
      const last = options.length - 1;
      const next = key === "Home" ? 0 : key === "End" ? last : !open
        ? selected >= 0 ? selected : key === "ArrowDown" ? 0 : last
        : Math.max(0, Math.min(last, active + (key === "ArrowDown" ? 1 : -1)));
      setActiveValue(options[next]?.value ?? null);
    }
  }

  const display = options[selected] ?? (typeof fallback === "string" ? { label: fallback } : fallback);
  const displayText = inlineDetail && display.detail ? `${display.detail} / ${display.label}` : display.label;
  return <div ref={root} className={`picker ${above ? "picker-above" : ""} ${className}`}>
    <button type="button" role="combobox" className="control picker-trigger" aria-label={`${label}：${displayText}`} title={displayText}
      aria-haspopup="listbox" aria-expanded={open} aria-controls={open ? id : undefined} aria-activedescendant={open ? `${id}-${active}` : undefined}
      disabled={unavailable} onBlur={() => setActiveValue(null)} onKeyDown={onKeyDown}
      onClick={() => setActiveValue(open ? null : options[active]?.value ?? null)}>
      {icon}{inlineDetail ? <InlineLabel {...display} /> : <span className="truncate">{display.label}</span>}
      <ChevronDown size={13} className="picker-chevron" aria-hidden="true" />
    </button>
    {open && <div ref={list} id={id} role="listbox" aria-label={label} className="popup picker-list">
      {options.map((option, index) => <div role="option" key={option.value} id={`${id}-${index}`} aria-selected={index === selected}
        className="picker-option" data-active={index === active} title={inlineDetail && option.detail ? `${option.detail} / ${option.label}` : option.detail ?? option.label}
        onMouseDown={(event) => event.preventDefault()} onClick={() => choose(index)}>
        <span className="picker-check">{index === selected && <Check size={14} aria-hidden="true" />}</span>
        {inlineDetail ? <InlineLabel {...option} /> : <span className="min-w-0"><span className="block truncate">{option.label}</span>{option.detail && <span className="muted block truncate text-[11px]">{option.detail}</span>}</span>}
      </div>)}
    </div>}
  </div>;
}

function InlineLabel({ label, detail }: Pick<PickerOption, "label" | "detail">) {
  return <span className="picker-inline-label">
    {detail && <><span className="picker-inline-detail truncate">{detail}</span><span className="muted" aria-hidden="true">/</span></>}
    <span className="picker-inline-name truncate">{label}</span>
  </span>;
}
