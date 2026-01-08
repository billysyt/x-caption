import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";
import type { ExportOverlayProps } from "../../layout/AppOverlays.types";

type ExportModalOverlayProps = ExportOverlayProps;

export function ExportModalOverlay({
  showExportModal,
  setShowExportModal,
  isExporting,
  onExportSrt,
  onExportTranscript
}: ExportModalOverlayProps) {
  if (!showExportModal) return null;
  const isDisabled = isExporting;
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (isDisabled) return;
        setShowExportModal(false);
      }}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div>
            <div className="text-sm font-semibold text-slate-100">Export</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Choose a format to export your captions.
            </p>
          </div>
          <div className="relative mt-4 space-y-3">
            {isExporting ? (
              <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl">
                <AppIcon name="spinner" className="text-[20px] text-white/80" spin />
              </div>
            ) : null}
            <button
              className={cn(
                "group w-full rounded-xl px-4 py-3 text-left transition",
                isDisabled ? "cursor-not-allowed" : "hover:bg-[#151515]"
              )}
              onClick={() => {
                if (isDisabled) return;
                onExportSrt();
              }}
              disabled={isDisabled}
              type="button"
            >
              <div className="flex items-start gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center", isDisabled ? "text-slate-500" : "text-white")}>
                  <AppIcon name="captions" className="text-[18px]" />
                </div>
                <div>
                  <div className={cn("text-[12px] font-semibold", isDisabled ? "text-slate-500" : "text-slate-100")}>
                    Standard SRT
                  </div>
                  <p className={cn("mt-1 text-[11px]", isDisabled ? "text-slate-600" : "text-slate-400")}>
                    Best for video editors and media players.
                  </p>
                </div>
              </div>
            </button>
            <button
              className={cn(
                "group w-full rounded-xl px-4 py-3 text-left transition",
                isDisabled ? "cursor-not-allowed" : "hover:bg-[#151515]"
              )}
              onClick={() => {
                if (isDisabled) return;
                onExportTranscript();
              }}
              disabled={isDisabled}
              type="button"
            >
              <div className="flex items-start gap-3">
                <div className={cn("flex h-10 w-10 items-center justify-center", isDisabled ? "text-slate-500" : "text-white")}>
                  <AppIcon name="edit" className="text-[17px]" />
                </div>
                <div>
                  <div className={cn("text-[12px] font-semibold", isDisabled ? "text-slate-500" : "text-slate-100")}>
                    Plain Text
                  </div>
                  <p className={cn("mt-1 text-[11px]", isDisabled ? "text-slate-600" : "text-slate-400")}>
                    A clean transcript without timestamps.
                  </p>
                </div>
              </div>
            </button>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className={cn(
                "rounded-md bg-transparent px-3 py-1.5 text-[11px] font-semibold transition",
                isDisabled ? "cursor-not-allowed text-slate-500" : "text-slate-200 hover:bg-[#1b1b22]"
              )}
              onClick={() => {
                if (isDisabled) return;
                setShowExportModal(false);
              }}
              disabled={isDisabled}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
