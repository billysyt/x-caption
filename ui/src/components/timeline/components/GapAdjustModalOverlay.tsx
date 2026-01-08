import { cn } from "../../../lib/cn";
import type { GapAdjustModalState } from "../hooks/useCaptionTimelineState";
import type { TranscriptSegment } from "../../../types";

type GapAdjustModalOverlayProps = {
  gapAdjustModal: GapAdjustModalState | null;
  setGapAdjustModal: (value: GapAdjustModalState | null) => void;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  onAdjustGapAfter: (segment: TranscriptSegment, mode: "insert" | "remove", ms: number, maxRemoveMs: number) => void;
};

export function GapAdjustModalOverlay({
  gapAdjustModal,
  setGapAdjustModal,
  notify,
  onAdjustGapAfter
}: GapAdjustModalOverlayProps) {
  if (!gapAdjustModal) return null;
  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => setGapAdjustModal(null)}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div>
            <div className="text-sm font-semibold text-slate-100">Adjust Gap After</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Insert or remove time after this caption (milliseconds).
            </p>
          </div>
          <div className="mt-4">
            <div className="relative flex items-center rounded-full bg-[#151515] p-1 text-[11px] font-semibold">
              <span
                className={cn(
                  "absolute inset-y-1 w-1/2 rounded-full bg-white transition-transform duration-200",
                  gapAdjustModal.mode === "insert" ? "translate-x-0" : "translate-x-full"
                )}
              />
              <button
                className={cn(
                  "relative z-10 inline-flex flex-1 items-center justify-center rounded-full px-3 py-1.5 transition",
                  gapAdjustModal.mode === "insert" ? "text-[#0b0b0b]" : "text-slate-200"
                )}
                onClick={() => {
                  if (gapAdjustModal.mode === "insert") return;
                  const nextMs = gapAdjustModal.ms.trim() ? gapAdjustModal.ms : "1000";
                  setGapAdjustModal({ ...gapAdjustModal, mode: "insert", ms: nextMs });
                }}
                type="button"
              >
                Insert
              </button>
              <button
                className={cn(
                  "relative z-10 inline-flex flex-1 items-center justify-center rounded-full px-3 py-1.5 transition",
                  gapAdjustModal.hasGap
                    ? gapAdjustModal.mode === "remove"
                      ? "text-[#0b0b0b]"
                      : "text-slate-200"
                    : "cursor-not-allowed text-slate-500"
                )}
                onClick={() => {
                  if (!gapAdjustModal.hasGap) return;
                  const currentMs = gapAdjustModal.ms.trim();
                  const numeric = currentMs ? Number(currentMs) : Number.NaN;
                  const clamped =
                    Number.isFinite(numeric) && gapAdjustModal.maxRemoveMs > 0
                      ? Math.min(Math.max(0, numeric), gapAdjustModal.maxRemoveMs)
                      : gapAdjustModal.maxRemoveMs;
                  setGapAdjustModal({
                    ...gapAdjustModal,
                    mode: "remove",
                    ms: String(clamped)
                  });
                }}
                type="button"
                disabled={!gapAdjustModal.hasGap}
              >
                Remove
              </button>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2">
            <input
              type="number"
              min={0}
              step={100}
              max={gapAdjustModal.mode === "remove" ? gapAdjustModal.maxRemoveMs : undefined}
              value={gapAdjustModal.ms}
              onChange={(event) => {
                const nextValue = event.target.value;
                if (nextValue === "") {
                  setGapAdjustModal({ ...gapAdjustModal, ms: "" });
                  return;
                }
                if (gapAdjustModal.mode === "remove") {
                  const numeric = Number(nextValue);
                  if (Number.isFinite(numeric) && gapAdjustModal.maxRemoveMs > 0) {
                    const clamped = Math.min(Math.max(0, numeric), gapAdjustModal.maxRemoveMs);
                    setGapAdjustModal({ ...gapAdjustModal, ms: String(clamped) });
                    return;
                  }
                }
                setGapAdjustModal({ ...gapAdjustModal, ms: nextValue });
              }}
              className="w-full flex-1 rounded-md bg-[#0b0b0b] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/60"
              autoFocus
            />
            <span className="text-[11px] text-slate-500">ms</span>
          </div>
          {gapAdjustModal.mode === "remove" && gapAdjustModal.hasGap ? (
            <p className="mt-2 text-[10px] text-slate-500">
              Max removable: {gapAdjustModal.maxRemoveMs} ms
            </p>
          ) : null}
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="rounded-md bg-transparent px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
              onClick={() => setGapAdjustModal(null)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0b0b0b] transition hover:brightness-95"
              onClick={() => {
                const valueMs = gapAdjustModal.ms.trim() ? Number(gapAdjustModal.ms) : 0;
                if (!Number.isFinite(valueMs) || valueMs <= 0) {
                  notify("Please enter a valid gap in milliseconds.", "error");
                  return;
                }
                if (gapAdjustModal.mode === "remove" && valueMs > gapAdjustModal.maxRemoveMs) {
                  notify("Remove gap exceeds the available gap.", "error");
                  return;
                }
                onAdjustGapAfter(gapAdjustModal.segment, gapAdjustModal.mode, valueMs, gapAdjustModal.maxRemoveMs);
                setGapAdjustModal(null);
              }}
              type="button"
            >
              Apply
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
