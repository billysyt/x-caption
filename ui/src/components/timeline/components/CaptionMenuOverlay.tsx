import { cn } from "../../../lib/cn";
import type { TranscriptSegment } from "../../../types";
import type { CaptionMenuState } from "../hooks/useCaptionTimelineState";

type CaptionMenuOverlayProps = {
  captionMenu: CaptionMenuState | null;
  captionMenuPosition: { left: number; top: number } | null;
  captionMenuGapAfter: {
    hasNext: boolean;
    hasGap: boolean;
    gapStart: number;
    gapEnd: number;
  } | null;
  captionMenuGapHighlight: boolean;
  setCaptionMenuGapHighlight: (value: boolean) => void;
  onSplitCaption: (segment: TranscriptSegment) => void;
  onDeleteCaption: (segment: TranscriptSegment) => void;
  onOpenGapAdjust: (segment: TranscriptSegment, maxRemoveMs: number, hasGap: boolean) => void;
  onCloseCaptionMenu: () => void;
};

export function CaptionMenuOverlay({
  captionMenu,
  captionMenuPosition,
  captionMenuGapAfter,
  captionMenuGapHighlight,
  setCaptionMenuGapHighlight,
  onSplitCaption,
  onDeleteCaption,
  onOpenGapAdjust,
  onCloseCaptionMenu
}: CaptionMenuOverlayProps) {
  if (!captionMenu || !captionMenuPosition) return null;
  return (
    <div
      className="fixed inset-0 z-[125]"
      onClick={onCloseCaptionMenu}
      onContextMenu={(event) => {
        event.preventDefault();
        onCloseCaptionMenu();
      }}
    >
      <div
        className="absolute w-[180px] overflow-hidden rounded-lg border border-slate-700/60 bg-[#121212] shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        style={{ left: `${captionMenuPosition.left}px`, top: `${captionMenuPosition.top}px` }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
          onClick={() => {
            onSplitCaption(captionMenu.segment);
            onCloseCaptionMenu();
          }}
          type="button"
        >
          Split caption
        </button>
        <button
          className={cn(
            "w-full px-3 py-2 text-left text-[11px] font-semibold transition",
            captionMenuGapAfter?.hasNext
              ? "text-slate-200 hover:bg-[#1b1b22]"
              : "cursor-not-allowed text-slate-500"
          )}
          onClick={() => {
            if (!captionMenuGapAfter?.hasNext) return;
            const hasGap = Boolean(captionMenuGapAfter?.hasGap);
            const maxRemoveMs = Math.max(
              0,
              Math.round(((captionMenuGapAfter?.gapEnd ?? 0) - (captionMenuGapAfter?.gapStart ?? 0)) * 1000)
            );
            onOpenGapAdjust(captionMenu.segment, maxRemoveMs, hasGap);
            onCloseCaptionMenu();
          }}
          onMouseEnter={() => {
            if (captionMenuGapAfter?.hasGap) {
              setCaptionMenuGapHighlight(true);
            }
          }}
          onMouseLeave={() => setCaptionMenuGapHighlight(false)}
          type="button"
          disabled={!captionMenuGapAfter?.hasNext}
          aria-pressed={captionMenuGapHighlight}
        >
          Insert/Remove Gap After…
        </button>
        <button
          className="w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
          onClick={() => {
            onDeleteCaption(captionMenu.segment);
            onCloseCaptionMenu();
          }}
          type="button"
        >
          Delete caption
        </button>
      </div>
    </div>
  );
}
