import type { GapMenuState } from "../hooks/useCaptionTimelineState";

type GapMenuOverlayProps = {
  gapMenu: GapMenuState | null;
  gapMenuPosition: { left: number; top: number } | null;
  setGapMenuHighlight: (value: boolean) => void;
  onRemoveGap: (gapStart: number, gapEnd: number) => void;
  onCloseGapMenu: () => void;
};

export function GapMenuOverlay({
  gapMenu,
  gapMenuPosition,
  setGapMenuHighlight,
  onRemoveGap,
  onCloseGapMenu
}: GapMenuOverlayProps) {
  if (!gapMenu || !gapMenuPosition) return null;
  return (
    <div
      className="fixed inset-0 z-[125]"
      onClick={() => {
        onCloseGapMenu();
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        onCloseGapMenu();
      }}
    >
      <div
        className="absolute w-max overflow-hidden rounded-lg border border-slate-700/60 bg-[#121212] shadow-[0_16px_40px_rgba(0,0,0,0.55)]"
        style={{ left: `${gapMenuPosition.left}px`, top: `${gapMenuPosition.top}px` }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className="w-full px-3 py-2 text-left text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
          onClick={() => {
            onRemoveGap(gapMenu.gapStart, gapMenu.gapEnd);
            onCloseGapMenu();
          }}
          onMouseEnter={() => setGapMenuHighlight(true)}
          onMouseLeave={() => setGapMenuHighlight(false)}
          type="button"
        >
          Remove Gap
        </button>
      </div>
    </div>
  );
}
