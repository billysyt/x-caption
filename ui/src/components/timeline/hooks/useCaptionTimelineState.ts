import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type SetStateAction,
  type RefObject,
  type PointerEvent as ReactPointerEvent,
  type MouseEvent as ReactMouseEvent
} from "react";
import type { AppDispatch } from "../../../store";
import type { MediaItem } from "../../upload/components/UploadTab";
import type { TranscriptSegment, Job } from "../../../types";
import { addJob, addSegment, removeSegment, selectJob, setJobSegments, updateSegmentTiming } from "../../jobs/jobsSlice";
import {
  useAddSegmentMutation,
  useDeleteSegmentMutation,
  useUpdateSegmentTimingMutation
} from "../../../api/segmentsApi";
import { useUpsertJobRecordMutation } from "../../../api/jobsApi";
import { clamp } from "../../../lib/timeline";
import { isBlankAudioText } from "../../../lib/transcript";
import { stripFileExtension } from "../../../lib/utils";

export type CaptionMenuState = {
  x: number;
  y: number;
  segment: TranscriptSegment;
};

export type GapMenuState = {
  x: number;
  y: number;
  gapStart: number;
  gapEnd: number;
};

export type GapAdjustModalState = {
  segment: TranscriptSegment;
  mode: "insert" | "remove";
  ms: string;
  maxRemoveMs: number;
  hasGap: boolean;
};

type CaptionTimelineParams = {
  dispatch: AppDispatch;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  activeJob: Job | null;
  activeMedia: MediaItem | null;
  jobsById: Record<string, Job>;
  sortedSegments: TranscriptSegment[];
  sortedDisplaySegments: TranscriptSegment[];
  displaySegmentById: Map<number, TranscriptSegment>;
  duration: number;
  pxPerSec: number;
  minCaptionDuration: number;
  playback: { currentTime: number; isPlaying: boolean };
  setPlayback: Dispatch<SetStateAction<{ currentTime: number; duration: number; isPlaying: boolean }>>;
  scheduleScrub: (value: number) => void;
  timelineTrackRef: RefObject<HTMLDivElement>;
  scrubStateRef: RefObject<{ pointerId: number; rect?: DOMRect } | null>;
  playerScrubRef: RefObject<{ wasPlaying: boolean } | null>;
  getActiveMediaEl: () => HTMLMediaElement | null;
  safePlay: (mediaEl: HTMLMediaElement | null) => Promise<boolean>;
};

export function useCaptionTimelineState(params: CaptionTimelineParams) {
  const {
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
    playback,
    setPlayback,
    scheduleScrub,
    timelineTrackRef,
    scrubStateRef,
    playerScrubRef,
    getActiveMediaEl,
    safePlay
  } = params;

  const [addSegmentMutation] = useAddSegmentMutation();
  const [deleteSegmentMutation] = useDeleteSegmentMutation();
  const [updateSegmentTimingMutation] = useUpdateSegmentTimingMutation();
  const [upsertJobRecord] = useUpsertJobRecordMutation();

  const captionDragRef = useRef<{
    pointerId: number;
    jobId: string;
    segmentId: number;
    start: number;
    end: number;
    startX: number;
    mode: "move" | "start" | "end";
  } | null>(null);
  const [captionHover, setCaptionHover] = useState<{
    start: number;
    end: number;
    gapStart: number;
    gapEnd: number;
  } | null>(null);
  const [forcedCaptionId, setForcedCaptionId] = useState<number | null>(null);
  const [captionMenu, setCaptionMenu] = useState<CaptionMenuState | null>(null);
  const [captionMenuGapHighlight, setCaptionMenuGapHighlight] = useState(false);
  const [gapMenu, setGapMenu] = useState<GapMenuState | null>(null);
  const [gapMenuHighlight, setGapMenuHighlight] = useState(false);
  const [gapAdjustModal, setGapAdjustModal] = useState<GapAdjustModalState | null>(null);
  const gapMenuOpenRef = useRef(false);
  const captionTimingAutosaveRef = useRef<number | null>(null);
  const captionTimingAutosavePayloadRef = useRef<{
    jobId: string;
    segmentId: number;
    start: number;
    end: number;
  } | null>(null);

  useEffect(() => {
    if (!captionMenu) {
      setCaptionMenuGapHighlight(false);
    }
  }, [captionMenu]);

  useEffect(() => {
    setForcedCaptionId(null);
  }, [activeJob?.id]);

  useEffect(() => {
    if (forcedCaptionId === null) return;
    const forced = displaySegmentById.get(Number(forcedCaptionId)) ?? null;
    if (!forced) {
      setForcedCaptionId(null);
      return;
    }
    const start = Number(forced.start ?? 0);
    const end = Number(forced.end ?? 0);
    if (playback.currentTime >= start && playback.currentTime < end) {
      setForcedCaptionId(null);
      return;
    }
    const timer = window.setTimeout(() => {
      setForcedCaptionId((current) => (current === forcedCaptionId ? null : current));
    }, 1500);
    return () => window.clearTimeout(timer);
  }, [displaySegmentById, forcedCaptionId, playback.currentTime]);

  useEffect(() => {
    return () => {
      if (captionTimingAutosaveRef.current) {
        window.clearTimeout(captionTimingAutosaveRef.current);
        captionTimingAutosaveRef.current = null;
      }
    };
  }, []);

  const captionMenuPosition = useMemo(() => {
    if (!captionMenu || typeof window === "undefined") return null;
    const width = 180;
    const height = 140;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.min(captionMenu.x, maxLeft),
      top: Math.min(captionMenu.y, maxTop)
    };
  }, [captionMenu]);

  const gapMenuPosition = useMemo(() => {
    if (!gapMenu || typeof window === "undefined") return null;
    const width = 180;
    const height = 44;
    const maxLeft = Math.max(8, window.innerWidth - width - 8);
    const maxTop = Math.max(8, window.innerHeight - height - 8);
    return {
      left: Math.min(gapMenu.x, maxLeft),
      top: Math.min(gapMenu.y, maxTop)
    };
  }, [gapMenu]);

  const captionMenuGapAfter = useMemo(() => {
    if (!captionMenu) return null;
    const segId = Number(captionMenu.segment.id);
    const idx = sortedDisplaySegments.findIndex((seg) => Number(seg.id) === segId);
    if (idx < 0) return null;
    const current = sortedDisplaySegments[idx];
    const next = sortedDisplaySegments[idx + 1] ?? null;
    if (!next) {
      return { hasNext: false, hasGap: false };
    }
    const gapStart = Number(current.end) || 0;
    const gapEnd = Number(next.start) || 0;
    const gap = gapEnd - gapStart;
    return { hasNext: true, hasGap: gap > minCaptionDuration, gapStart, gapEnd };
  }, [captionMenu, minCaptionDuration, sortedDisplaySegments]);

  const closeGapMenu = useCallback(() => {
    gapMenuOpenRef.current = false;
    setGapMenu(null);
    setGapMenuHighlight(false);
  }, []);

  const closeCaptionMenu = useCallback(() => {
    setCaptionMenu(null);
    setCaptionMenuGapHighlight(false);
  }, []);

  const handleOpenGapAdjust = useCallback(
    (segment: TranscriptSegment, maxRemoveMs: number, hasGap: boolean) => {
      setGapAdjustModal({
        segment,
        mode: "insert",
        ms: "1000",
        maxRemoveMs,
        hasGap
      });
    },
    []
  );

  const handleCloseGapMenu = useCallback(() => {
    closeGapMenu();
    setCaptionHover(null);
  }, [closeGapMenu]);

  const computeCaptionTiming = useCallback(
    (drag: NonNullable<typeof captionDragRef.current>, deltaSec: number) => {
      let start = drag.start;
      let end = drag.end;
      const currentIndex = sortedDisplaySegments.findIndex((seg) => seg.id === drag.segmentId);
      const prevSeg = currentIndex > 0 ? sortedDisplaySegments[currentIndex - 1] : null;
      const nextSeg =
        currentIndex >= 0 && currentIndex < sortedDisplaySegments.length - 1
          ? sortedDisplaySegments[currentIndex + 1]
          : null;
      const prevEnd = prevSeg ? prevSeg.end : 0;
      const nextStart = nextSeg ? nextSeg.start : (duration > 0 ? duration : Number.POSITIVE_INFINITY);
      const span = Math.max(minCaptionDuration, drag.end - drag.start);
      if (drag.mode === "move") {
        start = drag.start + deltaSec;
        end = start + span;
        if (duration > 0) {
          if (start < 0) {
            start = 0;
            end = start + span;
          }
          if (end > duration) {
            end = duration;
            start = end - span;
          }
        }
        if (Number.isFinite(prevEnd)) {
          start = Math.max(start, prevEnd);
          end = start + span;
        }
        if (Number.isFinite(nextStart)) {
          if (end > nextStart) {
            end = nextStart;
            start = end - span;
          }
        }
      } else if (drag.mode === "start") {
        start = drag.start + deltaSec;
        start = Math.min(start, drag.end - minCaptionDuration);
        start = Math.max(start, prevEnd);
        start = Math.max(0, start);
      } else {
        end = drag.end + deltaSec;
        end = Math.max(end, drag.start + minCaptionDuration);
        end = Math.min(end, nextStart);
        if (duration > 0) {
          end = Math.min(end, duration);
        }
      }
      return { start, end };
    },
    [duration, minCaptionDuration, sortedDisplaySegments]
  );

  const handleCaptionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>, segment: TranscriptSegment) => {
      if (event.button !== 0) return;
      if (!activeJob?.id && !activeMedia) return;
      event.stopPropagation();
      const target = event.target as HTMLElement;
      const handle = target.closest("[data-handle]") as HTMLElement | null;
      const handleType = handle?.dataset.handle;
      const mode: "move" | "start" | "end" =
        handleType === "start" ? "start" : handleType === "end" ? "end" : "move";
      captionDragRef.current = {
        pointerId: event.pointerId,
        jobId: activeJob.id,
        segmentId: segment.id,
        start: Number(segment.start) || 0,
        end: Number(segment.end) || 0,
        startX: event.clientX,
        mode
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      const startSec = Number(segment.start) || 0;
      const endSec = Number(segment.end) || 0;
      const span = Math.max(0, endSec - startSec);
      let focusTime = startSec;
      if (span > 0) {
        const pad = Math.min(0.02, span * 0.1);
        const candidate = startSec + Math.max(0.001, pad);
        focusTime = candidate < endSec ? candidate : startSec + span * 0.5;
      }
      scheduleScrub(focusTime);
      setPlayback((prev) => ({ ...prev, currentTime: focusTime }));
      setForcedCaptionId(Number(segment.id));
      if (playback.isPlaying) {
        const mediaEl = getActiveMediaEl();
        if (mediaEl && mediaEl.paused) {
          void safePlay(mediaEl);
        }
      }
    },
    [activeJob?.id, activeMedia, getActiveMediaEl, playback, safePlay, scheduleScrub, setPlayback]
  );

  const handleCaptionPointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = captionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      event.stopPropagation();
      const dx = event.clientX - drag.startX;
      const deltaSec = dx / Math.max(pxPerSec, 0.001);
      const next = computeCaptionTiming(drag, deltaSec);
      dispatch(updateSegmentTiming({ jobId: drag.jobId, segmentId: drag.segmentId, start: next.start, end: next.end }));
      captionTimingAutosavePayloadRef.current = {
        jobId: drag.jobId,
        segmentId: drag.segmentId,
        start: next.start,
        end: next.end
      };
      if (!captionTimingAutosaveRef.current) {
        captionTimingAutosaveRef.current = window.setTimeout(() => {
          const payload = captionTimingAutosavePayloadRef.current;
          captionTimingAutosaveRef.current = null;
          if (!payload) return;
          void updateSegmentTimingMutation(payload).unwrap().catch(() => undefined);
        }, 500);
      }
    },
    [computeCaptionTiming, dispatch, pxPerSec, updateSegmentTimingMutation]
  );

  const handleCaptionPointerUp = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      const drag = captionDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      captionDragRef.current = null;
      event.stopPropagation();
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore.
      }
      if (captionTimingAutosaveRef.current) {
        window.clearTimeout(captionTimingAutosaveRef.current);
        captionTimingAutosaveRef.current = null;
      }
      const dx = event.clientX - drag.startX;
      const deltaSec = dx / Math.max(pxPerSec, 0.001);
      const next = computeCaptionTiming(drag, deltaSec);
      dispatch(updateSegmentTiming({ jobId: drag.jobId, segmentId: drag.segmentId, start: next.start, end: next.end }));
      void updateSegmentTimingMutation({
        jobId: drag.jobId,
        segmentId: drag.segmentId,
        start: next.start,
        end: next.end
      }).unwrap().catch(() => undefined);
    },
    [computeCaptionTiming, dispatch, pxPerSec, updateSegmentTimingMutation]
  );

  const ensureCaptionJobId = useCallback(() => {
    if (activeJob?.id) return activeJob.id;
    if (!activeMedia) {
      notify("Please select a media file to add captions.", "info");
      return null;
    }
    const preferredJobId =
      activeMedia.jobId ||
      (activeMedia.source === "job" ? activeMedia.jobId ?? null : null);
    const jobId = preferredJobId ?? `manual-${activeMedia.id}`;
    const existing = jobsById[jobId];
    if (existing) {
      dispatch(selectJob(jobId));
      return jobId;
    }
    const filename = activeMedia.name || "media";
    const displayName = stripFileExtension(filename) || filename;
    const audioFile = activeMedia.file
      ? {
          name: activeMedia.file.name,
          size: activeMedia.file.size,
          path: null
        }
      : { name: filename, size: null, path: activeMedia.localPath ?? null };
    const newJob: Job = {
      id: jobId,
      filename,
      displayName,
      status: "imported",
      message: "",
      progress: 0,
      startTime: Date.now(),
      audioFile,
      result: null,
      partialResult: null,
      error: null,
      currentStage: null
    };
    dispatch(addJob(newJob));
    void upsertJobRecord({
      job_id: jobId,
      filename,
      display_name: displayName,
      media_path: activeMedia?.localPath ?? null,
      media_kind: activeMedia?.kind ?? null,
      status: "imported",
      transcript_json: { job_id: jobId, segments: [], text: "" },
      transcript_text: "",
      segment_count: 0
    }).unwrap().catch(() => undefined);
    return jobId;
  }, [activeJob?.id, activeMedia, dispatch, jobsById, notify, upsertJobRecord]);

  const handleAddCaption = useCallback(
    (start: number, end: number) => {
      const jobId = ensureCaptionJobId();
      if (!jobId) return;
      const maxId = sortedSegments.reduce((max, seg) => Math.max(max, Number(seg.id) || 0), 0);
      const nextId = maxId + 1;
      const text = "New Caption";
      const segment: TranscriptSegment = {
        id: nextId,
        start,
        end,
        text,
        originalText: text
      };
      dispatch(addSegment({ jobId, segment }));
      void addSegmentMutation({ jobId, segmentId: nextId, start, end, text }).unwrap().catch(() => undefined);
    },
    [addSegmentMutation, dispatch, ensureCaptionJobId, sortedSegments]
  );

  const applyTimelineShift = useCallback(
    (thresholdSec: number, deltaSec: number) => {
      if (!activeJob?.id) return;
      if (!Number.isFinite(deltaSec) || Math.abs(deltaSec) < 0.0001) return;
      const jobId = activeJob.id;
      const updates: Array<{ segmentId: number; start: number; end: number }> = [];
      const nextSegments = sortedSegments.map((seg) => {
        const start = Number(seg.start) || 0;
        const end = Number(seg.end) || 0;
        if (start < thresholdSec - 0.0001) return seg;
        const nextStart = start + deltaSec;
        const nextEnd = end + deltaSec;
        updates.push({ segmentId: Number(seg.id), start: nextStart, end: nextEnd });
        return { ...seg, start: nextStart, end: nextEnd };
      });
      if (!updates.length) return;
      dispatch(setJobSegments({ jobId, segments: nextSegments }));
      updates.forEach((payload) => {
        void updateSegmentTimingMutation({ jobId, ...payload }).unwrap().catch(() => undefined);
      });
      const mergedText = nextSegments
        .map((seg) => String(seg.originalText ?? seg.text ?? "").trim())
        .filter((text) => !isBlankAudioText(text))
        .join(" ")
        .trim();
      void upsertJobRecord({
        job_id: jobId,
        transcript_json: { job_id: jobId, segments: nextSegments, text: mergedText },
        transcript_text: mergedText,
        segment_count: nextSegments.length
      }).unwrap().catch(() => undefined);
    },
    [activeJob?.id, dispatch, sortedSegments, updateSegmentTimingMutation, upsertJobRecord]
  );

  const handleRemoveGap = useCallback(
    (gapStart: number, gapEnd: number) => {
      const delta = gapEnd - gapStart;
      if (!Number.isFinite(delta) || delta <= minCaptionDuration) return;
      applyTimelineShift(gapEnd, -delta);
    },
    [applyTimelineShift, minCaptionDuration]
  );

  const handleAdjustGapAfter = useCallback(
    (segment: TranscriptSegment, mode: "insert" | "remove", msValue: number, maxRemoveMs: number) => {
      const segId = Number(segment.id);
      const idx = sortedDisplaySegments.findIndex((seg) => Number(seg.id) === segId);
      if (idx < 0) return;
      const current = sortedDisplaySegments[idx];
      const next = sortedDisplaySegments[idx + 1];
      if (!next) return;
      const gapStart = Number(current.end) || 0;
      const gapEnd = Number(next.start) || 0;
      if (mode === "remove") {
        const maxMs = Math.max(0, maxRemoveMs);
        const ms = Math.min(Math.max(0, msValue), maxMs);
        if (ms <= 0) return;
        applyTimelineShift(gapEnd, -(ms / 1000));
        return;
      }
      const ms = Math.max(0, msValue);
      if (ms <= 0) return;
      applyTimelineShift(gapStart, ms / 1000);
    },
    [applyTimelineShift, sortedDisplaySegments]
  );

  const handleDeleteCaption = useCallback(
    (segment: TranscriptSegment) => {
      if (!activeJob?.id) return;
      const jobId = activeJob.id;
      dispatch(removeSegment({ jobId, segmentId: Number(segment.id) }));
      void deleteSegmentMutation({ jobId, segmentId: Number(segment.id) }).unwrap().catch(() => undefined);
    },
    [activeJob?.id, deleteSegmentMutation, dispatch]
  );

  const handleSplitCaption = useCallback(
    (segment: TranscriptSegment | null) => {
      if (!segment || !activeJob?.id) return;
      const jobId = activeJob.id;
      const start = Number(segment.start) || 0;
      const end = Number(segment.end) || 0;
      if (end - start <= minCaptionDuration * 2) {
        notify("Caption is too short to split.", "info");
        return;
      }
      let cutAt = playback.currentTime;
      if (cutAt <= start + minCaptionDuration || cutAt >= end - minCaptionDuration) {
        cutAt = (start + end) / 2;
      }
      cutAt = clamp(cutAt, start + minCaptionDuration, end - minCaptionDuration);
      const maxId = sortedSegments.reduce((max, seg) => Math.max(max, Number(seg.id) || 0), 0);
      const nextId = maxId + 1;
      const rawText = String(segment.originalText ?? segment.text ?? "");
      const nextSegment: TranscriptSegment = {
        id: nextId,
        start: cutAt,
        end,
        text: rawText,
        originalText: rawText
      };
      dispatch(updateSegmentTiming({ jobId, segmentId: Number(segment.id), start, end: cutAt }));
      dispatch(addSegment({ jobId, segment: nextSegment }));
      void updateSegmentTimingMutation({
        jobId,
        segmentId: Number(segment.id),
        start,
        end: cutAt
      }).unwrap().catch(() => undefined);
      void addSegmentMutation({ jobId, segmentId: nextId, start: cutAt, end, text: rawText }).unwrap().catch(() => undefined);
    },
    [
      activeJob?.id,
      addSegmentMutation,
      dispatch,
      minCaptionDuration,
      notify,
      playback.currentTime,
      sortedSegments,
      updateSegmentTimingMutation
    ]
  );

  const handleCaptionHoverMove = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (captionDragRef.current) return;
      if (scrubStateRef.current || playerScrubRef.current) return;
      if (duration <= 0) return;
      if (!activeMedia) return;
      const track = timelineTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = clamp(event.clientX - rect.left, 0, rect.width);
      const time = clamp(x / Math.max(pxPerSec, 0.001), 0, duration);
      for (const seg of sortedDisplaySegments) {
        if (time >= seg.start && time <= seg.end) {
          setCaptionHover(null);
          return;
        }
      }
      if (captionHover) {
        const hoverLeft = Math.max(0, captionHover.start * pxPerSec);
        const hoverWidth = Math.max(2, (captionHover.end - captionHover.start) * pxPerSec);
        const inset = 3;
        if (x < hoverLeft + inset || x > hoverLeft + hoverWidth - inset) {
          return;
        }
      }
      let gapStart = 0;
      let gapEnd = duration;
      for (const seg of sortedDisplaySegments) {
        if (time < seg.start) {
          gapEnd = seg.start;
          break;
        }
        gapStart = Math.max(gapStart, seg.end);
      }
      if (gapEnd - gapStart <= minCaptionDuration) {
        setCaptionHover(null);
        return;
      }
      const desired = Math.min(5, gapEnd - gapStart);
      const start = clamp(time - desired * 0.5, gapStart, gapEnd - desired);
      const end = start + desired;
      setCaptionHover({ start, end, gapStart, gapEnd });
    },
    [
      activeJob?.id,
      activeMedia,
      captionHover,
      duration,
      minCaptionDuration,
      pxPerSec,
      sortedDisplaySegments,
      timelineTrackRef,
      scrubStateRef,
      playerScrubRef
    ]
  );

  const handleGapContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      if (!captionHover) return;
      const track = timelineTrackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const left = Math.max(0, captionHover.start * pxPerSec);
      const width = Math.max(2, (captionHover.end - captionHover.start) * pxPerSec);
      if (x < left || x > left + width) return;
      event.preventDefault();
      event.stopPropagation();
      setCaptionMenu(null);
      gapMenuOpenRef.current = true;
      setGapMenu({
        x: event.clientX,
        y: event.clientY,
        gapStart: captionHover.gapStart,
        gapEnd: captionHover.gapEnd
      });
      setCaptionHover(captionHover);
    },
    [captionHover, pxPerSec, timelineTrackRef]
  );

  return {
    captionHover,
    setCaptionHover,
    forcedCaptionId,
    setForcedCaptionId,
    captionMenu,
    setCaptionMenu,
    captionMenuGapHighlight,
    setCaptionMenuGapHighlight,
    gapMenu,
    setGapMenu,
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
  };
}
