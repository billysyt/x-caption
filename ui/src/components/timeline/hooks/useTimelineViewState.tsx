import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type MutableRefObject,
  type PointerEvent,
  type UIEvent,
  type WheelEvent
} from "react";
import type { AppDispatch } from "../../../store";
import type { TranscriptSegment, Job } from "../../../types";
import type { MediaItem } from "../../upload/components/UploadTab";
import { useCaptionTimelineState } from "./useCaptionTimelineState";
import {
  BASE_PX_PER_SEC,
  DEFAULT_TIMELINE_ZOOM,
  clamp,
  MIN_CLIP_DURATION_SEC,
  TIMELINE_LEFT_PADDING_PX,
  TIMELINE_RIGHT_PADDING_PX
} from "../../../lib/timeline";
import { cn } from "../../../lib/cn";
import { findSegmentAtTime } from "../../../lib/transcript";

type TimelineViewParams = {
  dispatch: AppDispatch;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  activeJob: Job | null;
  activeMedia: MediaItem | null;
  jobsById: Record<string, Job>;
  sortedSegments: TranscriptSegment[];
  sortedDisplaySegments: TranscriptSegment[];
  displaySegmentById: Map<number, TranscriptSegment>;
  openCcConverter: ((text: string) => string) | null;
  duration: number;
  playback: { currentTime: number; isPlaying: boolean };
  setPlayback: Dispatch<SetStateAction<{ currentTime: number; duration: number; isPlaying: boolean }>>;
  scheduleScrub: (value: number) => void;
  scrubStateRef: MutableRefObject<{ pointerId: number; rect?: DOMRect } | null>;
  playerScrubRef: MutableRefObject<{ wasPlaying: boolean } | null>;
  startPlayerScrub: () => void;
  endPlayerScrub: () => void;
  getActiveMediaEl: () => HTMLMediaElement | null;
  safePlay: (mediaEl: HTMLMediaElement | null) => Promise<boolean>;
};

export function useTimelineViewState(params: TimelineViewParams) {
  const {
    dispatch,
    notify,
    activeJob,
    activeMedia,
    jobsById,
    sortedSegments,
    sortedDisplaySegments,
    displaySegmentById,
    openCcConverter,
    duration,
    playback,
    setPlayback,
    scheduleScrub,
    scrubStateRef,
    playerScrubRef,
    startPlayerScrub,
    endPlayerScrub,
    getActiveMediaEl,
    safePlay
  } = params;

  const [timelineZoom, setTimelineZoom] = useState(DEFAULT_TIMELINE_ZOOM);
  const [timelineScrollLeft, setTimelineScrollLeft] = useState(0);
  const [timelineViewportWidth, setTimelineViewportWidth] = useState(0);
  const timelineScrollIdleRef = useRef<number | null>(null);
  const timelineUserScrollingRef = useRef(false);
  const timelineScrollRef = useRef<HTMLDivElement | null>(null);
  const timelineTrackRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const update = () => {
      const width = (el.clientWidth || 0) - TIMELINE_LEFT_PADDING_PX - TIMELINE_RIGHT_PADDING_PX;
      setTimelineViewportWidth(Math.max(0, width));
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const tickCount = 7;
  const minZoom = 0.5;
  const maxZoom = 3;
  const minCaptionDuration = 0.05;
  const minVisibleDurationSec = 10;
  const maxVisibleDurationSec = 600;
  const midVisibleDurationSec = 60;
  const zoomT = clamp((timelineZoom - minZoom) / Math.max(0.001, maxZoom - minZoom), 0, 1);
  const visibleDuration =
    zoomT <= 0.5
      ? maxVisibleDurationSec * Math.pow(midVisibleDurationSec / maxVisibleDurationSec, zoomT / 0.5)
      : midVisibleDurationSec * Math.pow(minVisibleDurationSec / midVisibleDurationSec, (zoomT - 0.5) / 0.5);
  const segmentSec = visibleDuration / (tickCount - 1);
  const pxPerSec =
    timelineViewportWidth > 0
      ? timelineViewportWidth / Math.max(visibleDuration, MIN_CLIP_DURATION_SEC)
      : BASE_PX_PER_SEC * timelineZoom;
  const timelineWidth = Math.max(timelineViewportWidth, duration * pxPerSec);
  const timelineScrollWidth = timelineWidth;
  const playheadLeftPx = duration > 0 ? Math.min(timelineWidth, playback.currentTime * pxPerSec) : 0;
  const playheadPct = duration > 0 ? Math.min(100, (playback.currentTime / duration) * 100) : 0;
  const rulerDuration = duration > 0 ? duration : visibleDuration;
  const ticks = useMemo(() => {
    const baseTickCount = rulerDuration > 0 && segmentSec > 0 ? Math.floor(rulerDuration / segmentSec) + 1 : 0;
    const nextTicks = baseTickCount ? Array.from({ length: baseTickCount }, (_, idx) => idx * segmentSec) : [];
    if (rulerDuration > 0 && nextTicks.length && nextTicks[nextTicks.length - 1] < rulerDuration) {
      nextTicks.push(rulerDuration);
    }
    return nextTicks;
  }, [rulerDuration, segmentSec]);

  const captionTimeline = useCaptionTimelineState({
    dispatch,
    notify,
    activeJob,
    activeMedia,
    jobsById,
    sortedSegments,
    sortedDisplaySegments,
    displaySegmentById,
    duration,
    pxPerSec,
    minCaptionDuration,
    playback: { currentTime: playback.currentTime, isPlaying: playback.isPlaying },
    setPlayback,
    scheduleScrub,
    timelineTrackRef,
    scrubStateRef,
    playerScrubRef,
    getActiveMediaEl,
    safePlay
  });

  const {
    captionHover,
    setCaptionHover,
    forcedCaptionId,
    setForcedCaptionId,
    captionMenu,
    setCaptionMenu,
    captionMenuGapHighlight,
    setCaptionMenuGapHighlight,
    gapMenu,
    gapMenuHighlight,
    setGapMenuHighlight,
    gapAdjustModal,
    setGapAdjustModal,
    gapMenuOpenRef,
    captionMenuPosition,
    gapMenuPosition,
    captionMenuGapAfter,
    closeGapMenu,
    closeCaptionMenu,
    handleOpenGapAdjust,
    handleCloseGapMenu,
    handleCaptionPointerDown,
    handleCaptionPointerMove,
    handleCaptionPointerUp,
    handleAddCaption,
    handleRemoveGap,
    handleAdjustGapAfter,
    handleDeleteCaption,
    handleSplitCaption,
    handleCaptionHoverMove,
    handleGapContextMenu
  } = captionTimeline;

  const activeSubtitleSegment = useMemo(() => {
    if (!sortedDisplaySegments.length) return null;
    if (forcedCaptionId !== null) {
      return displaySegmentById.get(Number(forcedCaptionId)) ?? null;
    }
    return findSegmentAtTime(sortedDisplaySegments, playback.currentTime);
  }, [displaySegmentById, forcedCaptionId, playback.currentTime, sortedDisplaySegments]);
  const activeTimelineSegmentId = activeSubtitleSegment ? Number(activeSubtitleSegment.id) : null;

  const segmentPx = segmentSec * pxPerSec;
  const faintGridStyle = useMemo(
    () => ({
      backgroundImage: "linear-gradient(to right, rgba(15,23,42,0.3) 1px, transparent 1px)",
      backgroundSize: `${segmentPx}px 100%`
    }),
    [segmentPx]
  );

  const seekFromPointer = useCallback(
    (event: PointerEvent<HTMLDivElement>, rectOverride?: DOMRect) => {
      if (duration <= 0) return;
      const rect = rectOverride ?? event.currentTarget.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const time = clamp(x / Math.max(pxPerSec, 0.001), 0, duration);
      scheduleScrub(time);
    },
    [duration, pxPerSec, scheduleScrub]
  );

  useEffect(() => {
    const scroller = timelineScrollRef.current;
    if (!scroller) return;
    if (timelineUserScrollingRef.current) return;
    if (scrubStateRef.current || playerScrubRef.current) return;
    if (!Number.isFinite(playback.currentTime)) return;
    const viewport = scroller.clientWidth || 0;
    if (!viewport) return;
    const margin = Math.max(24, viewport * 0.2);
    const leftBound = scroller.scrollLeft + margin;
    const rightBound = scroller.scrollLeft + viewport - margin;
    if (playheadLeftPx < leftBound || playheadLeftPx > rightBound) {
      const nextLeft = clamp(playheadLeftPx - viewport * 0.4, 0, Math.max(0, timelineWidth - viewport));
      scroller.scrollLeft = nextLeft;
      setTimelineScrollLeft(nextLeft);
    }
  }, [playback.currentTime, playheadLeftPx, timelineWidth, scrubStateRef, playerScrubRef]);

  const onTrackPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const target = event.target as HTMLElement;
    if (target.closest("[data-clip-id]")) return;
    scrubStateRef.current = {
      pointerId: event.pointerId,
      rect: event.currentTarget.getBoundingClientRect()
    };
    event.currentTarget.setPointerCapture(event.pointerId);
    startPlayerScrub();
    seekFromPointer(event, scrubStateRef.current.rect);
  };

  const onTrackPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const scrub = scrubStateRef.current;
    if (!scrub) return;
    seekFromPointer(event, scrub.rect);
  };

  const onTrackPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    if (!scrubStateRef.current) return;
    scrubStateRef.current = null;
    event.currentTarget.releasePointerCapture(event.pointerId);
    endPlayerScrub();
  };

  const handleTimelineScroll = useCallback((event: UIEvent<HTMLDivElement>) => {
    setTimelineScrollLeft(event.currentTarget.scrollLeft);
    timelineUserScrollingRef.current = true;
    if (timelineScrollIdleRef.current) {
      window.clearTimeout(timelineScrollIdleRef.current);
    }
    timelineScrollIdleRef.current = window.setTimeout(() => {
      timelineUserScrollingRef.current = false;
    }, 1200);
  }, []);

  useEffect(() => {
    const el = timelineScrollRef.current;
    if (!el) return;
    const maxScroll = Math.max(0, timelineWidth - el.clientWidth);
    if (el.scrollLeft > maxScroll) {
      el.scrollLeft = maxScroll;
      setTimelineScrollLeft(maxScroll);
    }
  }, [timelineWidth, timelineViewportWidth]);

  const handleTimelineWheel = useCallback((event: WheelEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      const maxScroll = Math.max(0, el.scrollWidth - el.clientWidth);
      if (maxScroll <= 0) return;
      const next = clamp(el.scrollLeft + event.deltaY, 0, maxScroll);
      el.scrollLeft = next;
      setTimelineScrollLeft(next);
    }
  }, []);

  const timelineSegments = useMemo(
    () =>
      sortedDisplaySegments.map((segment) => {
        const start = Number.isFinite(Number(segment.start)) ? Number(segment.start) : 0;
        const end = Number.isFinite(Number(segment.end)) ? Number(segment.end) : 0;
        const rawText = segment.originalText ?? segment.text ?? "";
        let text = rawText;
        if (openCcConverter) {
          try {
            text = openCcConverter(rawText);
          } catch {
            text = rawText;
          }
        }
        return {
          segment,
          start,
          end,
          left: Math.max(0, start * pxPerSec),
          width: Math.max(2, (end - start) * pxPerSec),
          text
        };
      }),
    [openCcConverter, pxPerSec, sortedDisplaySegments]
  );

  const timelineSegmentEls = useMemo(
    () =>
      timelineSegments.map((item) => {
        const isActive = activeTimelineSegmentId !== null && Number(item.segment.id) === activeTimelineSegmentId;
        return (
          <div
            key={`timeline-${item.segment.id}`}
            className={cn(
              "absolute top-0 flex h-full cursor-grab items-center rounded-lg px-2 text-[10px] transition active:cursor-grabbing",
              isActive ? "bg-[#dbeafe] text-[#0b0b0b]" : "bg-[#151515] text-slate-200"
            )}
            style={{ left: `${item.left}px`, width: `${item.width}px` }}
            onPointerDown={(event) => handleCaptionPointerDown(event, item.segment)}
            onPointerMove={handleCaptionPointerMove}
            onPointerUp={handleCaptionPointerUp}
            onPointerCancel={handleCaptionPointerUp}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
              closeGapMenu();
              setCaptionMenuGapHighlight(false);
              setCaptionMenu({
                x: event.clientX,
                y: event.clientY,
                segment: item.segment
              });
            }}
          >
            <span className="block truncate leading-6">{item.text}</span>
            <span data-handle="start" className="absolute left-0 top-0 h-full w-1.5 cursor-ew-resize" />
            <span data-handle="end" className="absolute right-0 top-0 h-full w-1.5 cursor-ew-resize" />
          </div>
        );
      }),
    [
      activeTimelineSegmentId,
      handleCaptionPointerDown,
      handleCaptionPointerMove,
      handleCaptionPointerUp,
      setCaptionMenu,
      closeGapMenu,
      setCaptionMenuGapHighlight,
      timelineSegments
    ]
  );

  return {
    activeSubtitleSegment,
    activeTimelineSegmentId,
    timelineZoom,
    setTimelineZoom,
    timelineScrollRef,
    timelineTrackRef,
    timelineScrollLeft,
    setTimelineScrollLeft,
    timelineViewportWidth,
    setTimelineViewportWidth,
    timelineScrollIdleRef,
    timelineUserScrollingRef,
    tickCount,
    minZoom,
    maxZoom,
    minCaptionDuration,
    minVisibleDurationSec,
    maxVisibleDurationSec,
    midVisibleDurationSec,
    zoomT,
    visibleDuration,
    segmentSec,
    pxPerSec,
    timelineWidth,
    timelineScrollWidth,
    playheadLeftPx,
    playheadPct,
    rulerDuration,
    ticks,
    segmentPx,
    faintGridStyle,
    onTrackPointerDown,
    onTrackPointerMove,
    onTrackPointerUp,
    handleTimelineScroll,
    handleTimelineWheel,
    timelineSegments,
    timelineSegmentEls,
    seekFromPointer,
    captionHover,
    setCaptionHover,
    forcedCaptionId,
    setForcedCaptionId,
    captionMenu,
    setCaptionMenu,
    captionMenuGapHighlight,
    setCaptionMenuGapHighlight,
    gapMenu,
    gapMenuHighlight,
    setGapMenuHighlight,
    gapAdjustModal,
    setGapAdjustModal,
    gapMenuOpenRef,
    captionMenuPosition,
    gapMenuPosition,
    captionMenuGapAfter,
    closeGapMenu,
    closeCaptionMenu,
    handleOpenGapAdjust,
    handleCloseGapMenu,
    handleAddCaption,
    handleRemoveGap,
    handleAdjustGapAfter,
    handleDeleteCaption,
    handleSplitCaption,
    handleCaptionHoverMove,
    handleGapContextMenu
  };
}
