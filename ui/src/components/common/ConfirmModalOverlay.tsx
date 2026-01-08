import { AppIcon } from "./AppIcon";
import type { ConfirmOverlayProps } from "../layout/AppOverlays.types";

export function ConfirmModalOverlay({ confirmModal, setConfirmModal }: ConfirmOverlayProps) {
  if (!confirmModal) return null;

  const tone = confirmModal.tone ?? "info";

  const handleClose = () => {
    confirmModal.onCancel?.();
    setConfirmModal(null);
  };

  const handleConfirm = () => {
    confirmModal.onConfirm();
    setConfirmModal(null);
  };

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleClose}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111827] text-[#60a5fa]">
              <AppIcon
                name={
                  tone === "success"
                    ? "checkCircle"
                    : tone === "error"
                      ? "exclamationTriangle"
                      : "exclamationCircle"
                }
                className="text-[16px]"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">{confirmModal.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{confirmModal.message}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="inline-flex h-7 items-center justify-center rounded-md border border-slate-700/60 bg-transparent px-3 text-[11px] font-semibold text-slate-300 transition hover:bg-slate-800/50"
              onClick={handleClose}
              type="button"
            >
              {confirmModal.cancelLabel ?? "Cancel"}
            </button>
            <button
              className="inline-flex h-7 items-center justify-center rounded-md bg-[#1b1b22] px-3 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
              onClick={handleConfirm}
              type="button"
            >
              {confirmModal.confirmLabel ?? "Confirm"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
