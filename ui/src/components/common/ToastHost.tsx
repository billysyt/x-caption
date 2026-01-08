import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { AppIcon, type AppIconName } from "./AppIcon";

export type ToastType = "info" | "success" | "error" | "warning";

export type Toast = {
  id: string;
  message: string;
  type: ToastType;
  createdAt: number;
};

const EXIT_ANIMATION_MS = 220;

function toastMeta(type: ToastType): { icon: AppIconName; borderClass: string; iconWrapClass: string; iconClass: string; barClass: string } {
  if (type === "success") {
    return {
      icon: "checkCircle",
      borderClass: "border-success",
      iconWrapClass: "bg-[rgba(16,185,129,0.14)]",
      iconClass: "text-success",
      barClass: "bg-success"
    };
  }
  if (type === "error") {
    return {
      icon: "exclamationCircle",
      borderClass: "border-error",
      iconWrapClass: "bg-[rgba(239,68,68,0.14)]",
      iconClass: "text-error",
      barClass: "bg-error"
    };
  }
  if (type === "warning") {
    return {
      icon: "exclamationTriangle",
      borderClass: "border-warning",
      iconWrapClass: "bg-[rgba(245,158,11,0.14)]",
      iconClass: "text-warning",
      barClass: "bg-warning"
    };
  }
  return {
    icon: "exclamationCircle",
    borderClass: "border-primary",
    iconWrapClass: "bg-[rgba(var(--primary-rgb),0.14)]",
    iconClass: "text-primary",
    barClass: "bg-primary"
  };
}

function ToastItem(props: { toast: Toast; autoHideMs: number; onDismiss: (id: string) => void }) {
  const meta = useMemo(() => toastMeta(props.toast.type), [props.toast.type]);
  const [isClosing, setIsClosing] = useState(false);
  const [progressArmed, setProgressArmed] = useState(false);

  useEffect(() => {
    const raf = window.requestAnimationFrame(() => setProgressArmed(true));
    return () => window.cancelAnimationFrame(raf);
  }, []);

  useEffect(() => {
    if (isClosing) return;
    const timer = window.setTimeout(() => setIsClosing(true), props.autoHideMs);
    return () => window.clearTimeout(timer);
  }, [isClosing, props.autoHideMs, props.toast.id]);

  useEffect(() => {
    if (!isClosing) return;
    const timer = window.setTimeout(() => props.onDismiss(props.toast.id), EXIT_ANIMATION_MS);
    return () => window.clearTimeout(timer);
  }, [isClosing, props.onDismiss, props.toast.id]);

  function beginClose() {
    if (isClosing) return;
    setIsClosing(true);
  }

  return (
    <button
      type="button"
      className={cn(
        "group pointer-events-auto w-full cursor-pointer rounded-xl border border-border bg-white px-4 py-3 text-left shadow-[0_10px_30px_rgba(15,23,42,0.14)] ring-1 ring-black/5",
        isClosing ? "animate-toastOut" : "animate-toastIn",
        "transition hover:bg-secondary focus:outline-none focus:ring-2 focus:ring-[rgba(var(--primary-rgb),0.28)]",
        meta.borderClass
      )}
      onClick={beginClose}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start gap-3">
        <div className={cn("mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-full", meta.iconWrapClass)}>
          <AppIcon name={meta.icon} className={cn("text-[14px]", meta.iconClass)} />
        </div>

        <div className="min-w-0 flex-1">
          <p className="break-words text-[13px] font-semibold leading-5 text-text-primary">{props.toast.message}</p>
        </div>

        <div className="ml-2 flex-none text-text-secondary opacity-60 transition-opacity group-hover:opacity-100">
          <AppIcon name="times" className="text-[12px]" />
        </div>
      </div>

      <div className="mt-2 h-0.5 w-full overflow-hidden rounded bg-border">
        <div
          className={cn("h-full w-full origin-left", meta.barClass)}
          style={{
            transform: progressArmed ? "scaleX(0)" : "scaleX(1)",
            transition: `transform ${props.autoHideMs}ms linear`
          }}
        />
      </div>
    </button>
  );
}

export function ToastHost(props: {
  toasts: Toast[];
  onDismiss: (id: string) => void;
  autoHideMs?: number;
}) {
  const autoHideMs = props.autoHideMs ?? 2000;

  return (
    <div className="pointer-events-none fixed right-5 top-5 z-[3000] flex w-[360px] max-w-[calc(100vw-40px)] flex-col gap-3">
      {props.toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} autoHideMs={autoHideMs} onDismiss={props.onDismiss} />
      ))}
    </div>
  );
}
