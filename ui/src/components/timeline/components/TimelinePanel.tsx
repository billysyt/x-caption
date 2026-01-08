import type { MouseEvent, MutableRefObject, PointerEvent, ReactNode, RefObject, UIEvent, WheelEvent } from "react";
import { AppIcon } from "../../../components/common/AppIcon";
import { cn } from "../../../lib/cn";
import { formatTime } from "../../../lib/format";
import { TIMELINE_RIGHT_PADDING_PX } from "../../../lib/timeline";
import type { TranscriptSegment } from "../../../types";

export type TimelinePanelProps = {
  isCompact: boolean;
  segmentsLength: number;
  exportLanguage: "traditional" | "simplified" | "original" | string;
  onClearCaptions: () => void;
  onLoadSrt: () => void;
  onToggleChineseVariant: () => void;
  onSubtitleScaleDecrease: () => void;
  onSubtitleScaleIncrease: () => void;
  onSplitCaption: (segment: TranscriptSegment | null) => void;
  activeSubtitleSegment: TranscriptSegment | null;
  timelineZoom: number;
  onTimelineZoomChange: (value: number) => void;
  timelineScrollRef: RefObject<HTMLDivElement>;
  timelineTrackRef: RefObject<HTMLDivElement>;
  onTimelineScroll: (event: UIEvent<HTMLDivElement>) => void;
  onTimelineWheel: (event: WheelEvent<HTMLDivElement>) => void;
  timelineScrollWidth: number;
  timelineWidth: number;
  playheadLeftPx: number;
  ticks: number[];
  pxPerSec: number;
  onTrackPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onTrackPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onTrackPointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  timelineSegmentEls: ReactNode;
  gapMenu: { gapStart: number; gapEnd: number } | null;
  gapMenuHighlight: boolean;
  captionMenuGapAfter: { gapStart: number; gapEnd: number; hasGap: boolean } | null;
  captionMenuGapHighlight: boolean;
  captionHover: { start: number; end: number } | null;
  gapMenuOpenRef: MutableRefObject<boolean>;
  onCaptionHoverMove: (event: MouseEvent<HTMLDivElement>) => void;
  onClearCaptionHover: () => void;
  onAddCaption: (start: number, end: number) => void;
  onGapContextMenu: (event: MouseEvent<HTMLDivElement>) => void;
};

export function TimelinePanel({
  isCompact,
  segmentsLength,
  exportLanguage,
  onClearCaptions,
  onLoadSrt,
  onToggleChineseVariant,
  onSubtitleScaleDecrease,
  onSubtitleScaleIncrease,
  onSplitCaption,
  activeSubtitleSegment,
  timelineZoom,
  onTimelineZoomChange,
  timelineScrollRef,
  timelineTrackRef,
  onTimelineScroll,
  onTimelineWheel,
  timelineScrollWidth,
  timelineWidth,
  playheadLeftPx,
  ticks,
  pxPerSec,
  onTrackPointerDown,
  onTrackPointerMove,
  onTrackPointerUp,
  timelineSegmentEls,
  gapMenu,
  gapMenuHighlight,
  captionMenuGapAfter,
  captionMenuGapHighlight,
  captionHover,
  gapMenuOpenRef,
  onCaptionHoverMove,
  onClearCaptionHover,
  onAddCaption,
  onGapContextMenu
}: TimelinePanelProps) {
  return (
    <section
      className={cn(
        "col-span-1 row-start-2 row-end-3 flex flex-col bg-[#0b0b0b]",
        isCompact ? "col-span-1" : "col-span-3"
      )}
    >
      <div className="flex items-center justify-between px-4 py-2 text-xs text-slate-400">
        <div className="flex items-center gap-2">
          {segmentsLength > 0 ? (
            <button
              className={cn(
                isCompact
                  ? "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10"
                  : "inline-flex h-7 items-center gap-1.5 rounded-md bg-[#1b1b22] px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
              )}
              onClick={onClearCaptions}
              type="button"
              aria-label="Clear captions"
              title="Clear captions"
            >
              <AppIcon name="trashAlt" className={cn("text-[10px]", isCompact && "text-[12px]")} />
              {isCompact ? null : "Clear captions"}
            </button>
          ) : (
            <button
              className={cn(
                isCompact
                  ? "inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10"
                  : "inline-flex h-7 items-center gap-1.5 rounded-md bg-[#1b1b22] px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
              )}
              onClick={onLoadSrt}
              type="button"
              aria-label="Load Caption File"
              title="Load Caption File"
            >
              <AppIcon name="fileImport" className={cn("text-[10px]", isCompact && "text-[12px]")} />
              {isCompact ? null : "Load Caption File"}
            </button>
          )}
          <button
            className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[14px] font-bold text-slate-200 transition hover:bg-white/10"
            onClick={onToggleChineseVariant}
            type="button"
            aria-label="Chinese variant"
            title="Chinese variant"
          >
            {exportLanguage === "traditional" ? "繁" : "簡"}
          </button>
          <div className="flex items-center gap-1">
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-bold text-slate-200 transition hover:bg-white/10"
              onClick={onSubtitleScaleDecrease}
              type="button"
              aria-label="Decrease subtitle size"
              title="Decrease subtitle size"
            >
              T-
            </button>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[12px] font-bold text-slate-200 transition hover:bg-white/10"
              onClick={onSubtitleScaleIncrease}
              type="button"
              aria-label="Increase subtitle size"
              title="Increase subtitle size"
            >
              T+
            </button>
            <button
              className={cn(
                "inline-flex h-8 w-8 items-center justify-center rounded-md text-[12px] text-slate-200 transition hover:bg-white/10",
                !activeSubtitleSegment && "cursor-not-allowed opacity-50 hover:bg-transparent"
              )}
              onClick={() => onSplitCaption(activeSubtitleSegment)}
              type="button"
              aria-label="Split caption"
              title="Split caption"
              disabled={!activeSubtitleSegment}
            >
              <AppIcon name="cut" className="text-[13px]" />
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {!isCompact ? (
            <span className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Zoom</span>
          ) : null}
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.1}
            value={timelineZoom}
            onChange={(event) => onTimelineZoomChange(Number(event.target.value))}
            className="h-1 w-28"
          />
        </div>
      </div>

      <div className="flex overflow-hidden">
        <div className="flex w-full min-h-0 gap-2 pl-2">
          <div className="flex w-8 flex-shrink-0 flex-col text-[11px] text-slate-400">
            <div className="flex h-10 items-center justify-center text-[10px] uppercase tracking-[0.2em] text-slate-500">
              ▦
            </div>
            <div className="mt-2 flex h-10 items-center justify-center">
              <AppIcon name="captions" className="text-[12px] text-slate-200" />
            </div>
          </div>
          <div
            className="flex min-h-0 flex-1 overflow-x-scroll overflow-y-hidden stt-scrollbar"
            ref={timelineScrollRef}
            onScroll={onTimelineScroll}
            style={{
              scrollbarGutter: "stable both-edges",
              paddingRight: `${TIMELINE_RIGHT_PADDING_PX}px`
            }}
            onWheel={onTimelineWheel}
          >
            <div className="min-w-full pb-3" style={{ width: `${timelineScrollWidth}px` }}>
              <div className="relative">
                <div
                  className="pointer-events-none absolute top-0 bottom-0 z-20 w-px bg-primary"
                  style={{ left: `${playheadLeftPx}px` }}
                >
                  <div className="absolute left-1/2 top-1 h-0 w-0 -translate-x-1/2 border-x-[4px] border-t-[6px] border-transparent border-t-primary" />
                </div>
                <div
                  className="relative z-10 h-10 bg-[#0b0b0b] text-[10px] text-slate-500"
                  style={{ width: `${timelineWidth}px` }}
                  onPointerDown={onTrackPointerDown}
                  onPointerMove={onTrackPointerMove}
                  onPointerUp={onTrackPointerUp}
                >
                  {ticks.map((tick, idx) => {
                    const left = Math.max(0, tick * pxPerSec);
                    const isFirst = idx === 0;
                    const isLast = idx === ticks.length - 1;
                    const translateClass = isFirst
                      ? "translate-x-0"
                      : isLast
                        ? "-translate-x-full"
                        : "-translate-x-1/2";
                    return (
                      <span
                        key={`tick-${idx}`}
                        className={cn("absolute top-1 cursor-ew-resize", translateClass)}
                        style={{ left: `${left}px` }}
                      >
                        {formatTime(Math.max(0, tick))}
                      </span>
                    );
                  })}
                </div>
                <div className="relative mt-2 space-y-1 pb-1" style={{ width: `${timelineWidth}px` }}>
                  <div
                    className="absolute -top-3 left-0 right-0 h-5 cursor-ew-resize"
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={onTrackPointerUp}
                  />

                  <div
                    ref={timelineTrackRef}
                    className="relative h-10 overflow-visible rounded-md bg-transparent"
                    style={{ width: `${timelineWidth}px` }}
                    onPointerDown={onTrackPointerDown}
                    onPointerMove={onTrackPointerMove}
                    onPointerUp={onTrackPointerUp}
                    onMouseMove={onCaptionHoverMove}
                    onMouseLeave={() => {
                      if (gapMenuOpenRef.current) return;
                      onClearCaptionHover();
                    }}
                    onContextMenu={onGapContextMenu}
                  >
                    {timelineSegmentEls}
                    {gapMenu && gapMenuHighlight ? (
                      <div
                        className="pointer-events-none absolute top-0 z-[5] flex h-full items-center justify-center rounded-lg border border-primary/60 bg-primary/10 text-[10px] text-slate-100"
                        style={{
                          left: `${Math.max(0, gapMenu.gapStart * pxPerSec)}px`,
                          width: `${Math.max(2, (gapMenu.gapEnd - gapMenu.gapStart) * pxPerSec)}px`
                        }}
                      />
                    ) : null}
                    {captionMenuGapAfter &&
                    captionMenuGapHighlight &&
                    captionMenuGapAfter.hasGap &&
                    typeof captionMenuGapAfter.gapStart === "number" &&
                    typeof captionMenuGapAfter.gapEnd === "number" ? (
                      <div
                        className="pointer-events-none absolute top-0 z-[5] flex h-full items-center justify-center rounded-lg border border-primary/60 bg-primary/10 text-[10px] text-slate-100"
                        style={{
                          left: `${Math.max(0, captionMenuGapAfter.gapStart * pxPerSec)}px`,
                          width: `${Math.max(2, (captionMenuGapAfter.gapEnd - captionMenuGapAfter.gapStart) * pxPerSec)}px`
                        }}
                      />
                    ) : null}
                    {captionHover ? (
                      <div
                        className="pointer-events-auto absolute top-0 z-10 flex h-full cursor-pointer items-center justify-center rounded-lg border border-dashed border-slate-500/40 bg-white/5 text-[10px] text-slate-200 overflow-visible"
                        style={{
                          left: `${Math.max(0, captionHover.start * pxPerSec)}px`,
                          width: `${Math.max(2, (captionHover.end - captionHover.start) * pxPerSec)}px`
                        }}
                        onPointerDown={(event) => {
                          event.stopPropagation();
                        }}
                        onMouseMove={onCaptionHoverMove}
                        onClick={(event) => {
                          event.stopPropagation();
                          onAddCaption(captionHover.start, captionHover.end);
                          onClearCaptionHover();
                        }}
                      >
                        <span className="pointer-events-none text-[12px] font-semibold text-white/90">+</span>
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
