import { AppIcon } from "./AppIcon";
import type { AlertOverlayProps } from "../layout/AppOverlays.types";

type AlertModalOverlayProps = Pick<AlertOverlayProps, "alertModal" | "setAlertModal">;

export function AlertModalOverlay({ alertModal, setAlertModal }: AlertModalOverlayProps) {
  if (!alertModal) return null;
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => setAlertModal(null)}
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
                  alertModal.tone === "success"
                    ? "checkCircle"
                    : alertModal.tone === "error"
                      ? "exclamationTriangle"
                      : "exclamationCircle"
                }
                className="text-[16px]"
              />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">{alertModal.title}</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">{alertModal.message}</p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="inline-flex h-7 items-center justify-center rounded-md bg-[#1b1b22] px-3 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
              onClick={() => setAlertModal(null)}
              type="button"
            >
              OK
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
