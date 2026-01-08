import { useEffect, useId, useMemo, useRef, useState } from "react";
import { cn } from "../../lib/cn";
import { AppIcon } from "./AppIcon";

export type SelectOption = {
  value: string;
  label: string;
  disabled?: boolean;
};

export function Select(props: {
  id?: string;
  buttonId?: string;
  value: string;
  options: SelectOption[];
  onChange: (value: string) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
}) {
  const reactId = useId();
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

  const buttonId = props.buttonId ?? `select-${reactId}`;
  const menuId = `select-menu-${reactId}`;

  const selected = useMemo(
    () => props.options.find((o) => o.value === props.value) ?? null,
    [props.options, props.value]
  );

  const [open, setOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  const hasEnabledOption = useMemo(() => props.options.some((o) => !o.disabled), [props.options]);

  function closestEnabledIndex(startIndex: number) {
    if (!hasEnabledOption) return 0;
    const clampedStart = Math.max(0, Math.min(props.options.length - 1, startIndex));
    if (!props.options[clampedStart]?.disabled) return clampedStart;

    for (let offset = 1; offset < props.options.length; offset += 1) {
      const next = (clampedStart + offset) % props.options.length;
      if (!props.options[next]?.disabled) return next;
    }
    return 0;
  }

  function moveHighlight(delta: number) {
    if (!hasEnabledOption) return;
    let next = highlightedIndex;
    for (let i = 0; i < props.options.length; i += 1) {
      next = (next + delta + props.options.length) % props.options.length;
      if (!props.options[next]?.disabled) break;
    }
    setHighlightedIndex(next);
  }

  useEffect(() => {
    if (!open) return;
    const selectedIndex = props.options.findIndex((o) => o.value === props.value);
    setHighlightedIndex(closestEnabledIndex(selectedIndex >= 0 ? selectedIndex : 0));
  }, [open, props.options, props.value, hasEnabledOption]);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      const wrapper = wrapperRef.current;
      if (!wrapper) return;
      if (wrapper.contains(event.target as Node)) return;
      setOpen(false);
    }

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        window.setTimeout(() => buttonRef.current?.focus(), 0);
      }
    }

    document.addEventListener("pointerdown", onPointerDown, true);
    document.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown, true);
      document.removeEventListener("keydown", onKeyDown, true);
    };
  }, [open]);

  function selectValue(value: string) {
    const option = props.options.find((o) => o.value === value);
    if (!option || option.disabled) return;
    props.onChange(value);
    setOpen(false);
    window.setTimeout(() => buttonRef.current?.focus(), 0);
  }

  function selectHighlighted() {
    const option = props.options[highlightedIndex];
    if (!option || option.disabled) return;
    selectValue(option.value);
  }

  function toggleOpen() {
    if (props.disabled) return;
    if (!open) {
      const selectedIndex = props.options.findIndex((o) => o.value === props.value);
      setHighlightedIndex(closestEnabledIndex(selectedIndex >= 0 ? selectedIndex : 0));
    }
    setOpen((prev) => !prev);
  }

  const buttonLabel = selected?.label ?? props.placeholder ?? "Select…";

  return (
    <div ref={wrapperRef} className={cn("relative", props.className)}>
      {props.id ? (
        <select
          id={props.id}
          value={props.value}
          onChange={() => undefined}
          tabIndex={-1}
          aria-hidden="true"
          className="sr-only"
        >
          {props.options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
      ) : null}

      <button
        ref={buttonRef}
        id={buttonId}
        type="button"
        disabled={props.disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={menuId}
        className={cn(
          "relative h-8 w-full rounded-md border border-border bg-white px-3 pr-9 text-left text-[13px] shadow-sm transition-colors",
          "hover:border-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--primary-rgb),0.18)]",
          props.disabled && "cursor-not-allowed bg-secondary text-text-secondary opacity-80 hover:border-border",
          open && "border-primary"
        )}
        onClick={toggleOpen}
        onKeyDown={(event) => {
          if (props.disabled) return;

          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            if (open) {
              selectHighlighted();
            } else {
              toggleOpen();
            }
            return;
          }

          if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!open) toggleOpen();
            moveHighlight(1);
            return;
          }

          if (event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) toggleOpen();
            moveHighlight(-1);
            return;
          }
        }}
      >
        <span className={cn("block truncate", selected ? "text-text-primary" : "text-text-secondary")}>
          {buttonLabel}
        </span>
        <AppIcon
          name="chevronDown"
          className={cn(
            "pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-[12px] text-text-secondary transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open ? (
        <div
          id={menuId}
          role="listbox"
          aria-labelledby={buttonId}
          className="absolute left-0 right-0 z-[2000] mt-1 overflow-hidden rounded-md border border-border bg-white shadow-[0_10px_30px_rgba(0,0,0,0.12)]"
        >
          <div className="max-h-60 overflow-auto py-1 stt-scrollbar">
            {props.options.map((option, index) => {
              const isSelected = option.value === props.value;
              const isHighlighted = index === highlightedIndex;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  disabled={option.disabled}
                  className={cn(
                    "flex w-full items-center justify-between gap-3 px-3 py-1.5 text-left text-[13px] transition-colors",
                    option.disabled ? "cursor-not-allowed text-text-secondary opacity-60" : "text-text-primary",
                    !option.disabled && "hover:bg-secondary",
                    isHighlighted && !option.disabled && "bg-secondary",
                    isSelected && "font-semibold"
                  )}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  onClick={() => selectValue(option.value)}
                >
                  <span className="min-w-0 flex-1 truncate">{option.label}</span>
                  {isSelected ? <AppIcon name="check" className="text-primary" /> : null}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
