import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject
} from "react";
import type { AppDispatch } from "../../../store";
import type { MediaItem } from "../../upload/components/UploadTab";
import type { ToastType } from "../../common/ToastHost";
import type { JobUiState, TranscriptSegment } from "../../../types";
import { useUpsertJobRecordMutation, useLazyGetJobRecordQuery } from "../../../api/jobsApi";
import { useEditSegmentMutation } from "../../../api/segmentsApi";
import { clamp } from "../../../lib/timeline";
import { updateJobDisplayName, updateJobUiState, updateSegmentText } from "../../jobs/jobsSlice";

type SubtitleMatch = { segment: TranscriptSegment; text: string } | null;

type SubtitleStateParams = {
  dispatch: AppDispatch;
  notify: (message: string, type?: ToastType) => void;
  selectedJobId: string | null;
  selectedJobUiStateRef: RefObject<JobUiState>;
  activeMedia: MediaItem | null;
  previewContainerRef: RefObject<HTMLDivElement>;
  getActiveMediaEl: () => HTMLMediaElement | null;
  currentSubtitle: string;
  currentSubtitleMatch: SubtitleMatch;
  isCompact: boolean;
  compactTab: "player" | "captions";
  isPlayerModalOpen: boolean;
};

export function useSubtitleState(params: SubtitleStateParams) {
  const {
    dispatch,
    notify,
    selectedJobId,
    selectedJobUiStateRef,
    activeMedia,
    previewContainerRef,
    getActiveMediaEl,
    currentSubtitle,
    currentSubtitleMatch,
    isCompact,
    compactTab,
    isPlayerModalOpen
  } = params;

  const [subtitleScale, setSubtitleScale] = useState(1.4);
  const [subtitleBaseFontSize, setSubtitleBaseFontSize] = useState(14);
  const [subtitleEditor, setSubtitleEditor] = useState<{ segmentId: number; text: string } | null>(null);
  const [subtitleDraft, setSubtitleDraft] = useState("");
  const [subtitlePosition, setSubtitlePosition] = useState({ x: 0.5, y: 0.85 });
  const [subtitleMaxWidth, setSubtitleMaxWidth] = useState(520);
  const [subtitleBoxSize, setSubtitleBoxSize] = useState({ width: 0, height: 0 });
  const [subtitleEditSize, setSubtitleEditSize] = useState<{ width: number; height: number } | null>(null);
  const [subtitleUserSized, setSubtitleUserSized] = useState(false);
  const [editSegment] = useEditSegmentMutation();
  const [upsertJobRecord] = useUpsertJobRecordMutation();
  const [getJobRecord] = useLazyGetJobRecordQuery();

  const subtitleUserSizedRef = useRef(false);
  const subtitleEditProgrammaticSizeRef = useRef<{ width: number; height: number } | null>(null);
  const subtitlePositionRef = useRef(subtitlePosition);
  const subtitleDragRafRef = useRef<number | null>(null);
  const pendingSubtitlePosRef = useRef<{ x: number; y: number } | null>(null);
  const subtitleBoxRef = useRef<HTMLDivElement | null>(null);
  const subtitleMeasureRef = useRef<HTMLSpanElement | null>(null);
  const subtitleUiSaveRef = useRef<number | null>(null);
  const subtitleUiLoadRef = useRef<string | null>(null);
  const subtitleEditOpenSizeRef = useRef<{ width: number; height: number } | null>(null);
  const subtitleEditAutosaveRef = useRef<number | null>(null);
  const subtitleEditLastSavedRef = useRef<{ segmentId: number; text: string } | null>(null);
  const subtitleDragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    originX: number;
    originY: number;
    moved: boolean;
    container: DOMRect;
    box: DOMRect;
    allowEdit: boolean;
  } | null>(null);

  useEffect(() => {
    subtitleUserSizedRef.current = subtitleUserSized;
  }, [subtitleUserSized]);

  useEffect(() => {
    subtitlePositionRef.current = subtitlePosition;
  }, [subtitlePosition]);

  useEffect(() => {
    return () => {
      if (subtitleDragRafRef.current !== null) {
        window.cancelAnimationFrame(subtitleDragRafRef.current);
      }
    };
  }, []);

  const subtitleFontSize = Math.max(10, subtitleBaseFontSize * subtitleScale);
  const subtitleTextStyle = useMemo(
    () => ({
      fontSize: `${subtitleFontSize}px`,
      lineHeight: "1.2",
      textShadow:
        "0 0 3px rgba(0,0,0,0.95), 0 0 6px rgba(0,0,0,0.9), 2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000, 0 2px 0 #000, 2px 0 0 #000, 0 -2px 0 #000, -2px 0 0 #000"
    }),
    [subtitleFontSize]
  );
  const subtitleDisplaySize = useMemo(() => {
    if (subtitleEditor || subtitleUserSized) {
      return subtitleEditSize ?? subtitleBoxSize;
    }
    return subtitleBoxSize;
  }, [subtitleBoxSize, subtitleEditSize, subtitleEditor, subtitleUserSized]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const container = previewContainerRef.current;
    if (!container) return;
    const updateFromRect = (rect: DOMRect) => {
      if (!rect.width) return;
      setSubtitleMaxWidth(Math.max(200, rect.width * 0.8));
      const nextFontSize = clamp(rect.width * 0.022, 12, 28);
      setSubtitleBaseFontSize(nextFontSize);
    };
    const updateMaxWidth = () => {
      const rect = container.getBoundingClientRect();
      if (rect) {
        updateFromRect(rect);
      }
    };
    updateMaxWidth();
    let observer: ResizeObserver | null = null;
    if (typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver((entries) => {
        const entry = entries[0];
        if (entry?.contentRect) {
          updateFromRect(entry.contentRect);
        } else {
          updateMaxWidth();
        }
      });
      observer.observe(container);
    }
    window.addEventListener("resize", updateMaxWidth);
    return () => {
      window.removeEventListener("resize", updateMaxWidth);
      observer?.disconnect();
    };
  }, [compactTab, isCompact, isPlayerModalOpen, previewContainerRef]);

  useLayoutEffect(() => {
    if (subtitleEditor && subtitleEditSize) return;
    const measureEl = subtitleMeasureRef.current;
    if (!measureEl) return;
    const text = (subtitleEditor ? subtitleDraft : currentSubtitle) || " ";
    measureEl.textContent = text;
    const rect = measureEl.getBoundingClientRect();
    const paddingX = 12;
    const paddingY = 4;
    const width = Math.min(subtitleMaxWidth, rect.width + paddingX * 2);
    const height = rect.height + paddingY * 2;
    setSubtitleBoxSize({ width, height });
  }, [currentSubtitle, subtitleDraft, subtitleEditor, subtitleEditSize, subtitleMaxWidth, subtitleFontSize]);

  const scheduleSubtitleUiSave = useCallback(() => {
    if (!selectedJobId) return;
    if (subtitleUiSaveRef.current) {
      window.clearTimeout(subtitleUiSaveRef.current);
    }
    const resolvedSize = subtitleEditSize ?? subtitleBoxSize;
    const shouldSaveSize =
      subtitleUserSizedRef.current && resolvedSize.width > 0 && resolvedSize.height > 0;
    const existingUiState = selectedJobUiStateRef.current || {};
    const nextSubtitleState: {
      position: typeof subtitlePosition;
      scale: number;
      size?: { width: number; height: number };
      userSized?: boolean;
    } = {
      position: subtitlePosition,
      scale: subtitleScale
    };
    if (shouldSaveSize) {
      nextSubtitleState.size = resolvedSize;
      nextSubtitleState.userSized = true;
    }
    const nextUiState = {
      ...existingUiState,
      subtitle: nextSubtitleState
    };
    dispatch(updateJobUiState({ jobId: selectedJobId, uiState: nextUiState }));
    subtitleUiSaveRef.current = window.setTimeout(() => {
      void upsertJobRecord({ job_id: selectedJobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
    }, 400);
  }, [
    dispatch,
    selectedJobId,
    subtitleBoxSize,
    subtitleEditSize,
    subtitlePosition,
    subtitleScale,
    selectedJobUiStateRef,
    upsertJobRecord
  ]);

  useEffect(() => {
    if (!subtitleEditor) return;
    const el = subtitleBoxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      const box = subtitleBoxRef.current?.getBoundingClientRect();
      if (!box) return;
      const nextSize = { width: box.width, height: box.height };
      const lastProgrammatic = subtitleEditProgrammaticSizeRef.current;
      const isProgrammatic =
        lastProgrammatic &&
        Math.abs(lastProgrammatic.width - nextSize.width) < 0.5 &&
        Math.abs(lastProgrammatic.height - nextSize.height) < 0.5;
      if (!isProgrammatic && !subtitleUserSizedRef.current) {
        subtitleUserSizedRef.current = true;
        setSubtitleUserSized(true);
      }
      subtitleEditProgrammaticSizeRef.current = nextSize;
      setSubtitleEditSize(nextSize);
      scheduleSubtitleUiSave();
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [scheduleSubtitleUiSave, subtitleEditor]);

  useEffect(() => {
    if (!subtitleEditor) {
      if (subtitleEditAutosaveRef.current) {
        window.clearTimeout(subtitleEditAutosaveRef.current);
        subtitleEditAutosaveRef.current = null;
      }
      subtitleEditLastSavedRef.current = null;
      return;
    }
    subtitleEditLastSavedRef.current = {
      segmentId: subtitleEditor.segmentId,
      text: subtitleEditor.text
    };
  }, [subtitleEditor]);

  useEffect(() => {
    if (!subtitleEditor) return;
    const jobId =
      selectedJobId ?? (activeMedia?.source === "job" && activeMedia.jobId ? activeMedia.jobId : null);
    if (!jobId) return;
    if (subtitleEditAutosaveRef.current) {
      window.clearTimeout(subtitleEditAutosaveRef.current);
    }
    const nextValue = subtitleDraft;
    const segmentId = subtitleEditor.segmentId;
    subtitleEditAutosaveRef.current = window.setTimeout(() => {
      const newText = nextValue.trim();
      if (!newText) return;
      const lastSaved = subtitleEditLastSavedRef.current;
      if (lastSaved && lastSaved.segmentId === segmentId && newText === lastSaved.text.trim()) {
        return;
      }
      void editSegment({ jobId, segmentId, newText })
        .unwrap()
        .then(() => {
          dispatch(updateSegmentText({ jobId, segmentId, newText }));
          subtitleEditLastSavedRef.current = { segmentId, text: newText };
        })
        .catch((error) => {
          const message = error instanceof Error ? error.message : String(error);
          notify(`Failed to save changes: ${message}`, "error");
        });
    }, 650);
    return () => {
      if (subtitleEditAutosaveRef.current) {
        window.clearTimeout(subtitleEditAutosaveRef.current);
      }
    };
  }, [
    activeMedia?.jobId,
    activeMedia?.source,
    dispatch,
    editSegment,
    notify,
    selectedJobId,
    subtitleDraft,
    subtitleEditor
  ]);

  useEffect(() => {
    const container = previewContainerRef.current?.getBoundingClientRect();
    const box = subtitleBoxRef.current?.getBoundingClientRect();
    if (!container || !box) return;
    const halfW = box.width / 2;
    const halfH = box.height / 2;
    const minX = halfW / container.width;
    const minY = halfH / container.height;
    const nextX = clamp(subtitlePosition.x, minX, 1 - minX);
    const nextY = clamp(subtitlePosition.y, minY, 1 - minY);
    if (nextX !== subtitlePosition.x || nextY !== subtitlePosition.y) {
      setSubtitlePosition({ x: nextX, y: nextY });
    }
  }, [subtitleDisplaySize.height, subtitleDisplaySize.width, subtitlePosition.x, subtitlePosition.y, previewContainerRef]);

  useEffect(() => {
    if (!selectedJobId) return;
    scheduleSubtitleUiSave();
  }, [scheduleSubtitleUiSave, selectedJobId, subtitleScale]);

  useEffect(() => {
    if (!selectedJobId) return;
    if (subtitleUiLoadRef.current === selectedJobId) return;
    subtitleUiLoadRef.current = selectedJobId;
    void getJobRecord(selectedJobId)
      .unwrap()
      .then((res) => {
        const record = res?.record;
        if (record?.display_name) {
          dispatch(updateJobDisplayName({ jobId: selectedJobId, displayName: String(record.display_name) }));
        }
        const uiState = record?.ui_state?.subtitle;
        if (!uiState) {
          setSubtitlePosition({ x: 0.5, y: 0.85 });
          subtitleEditProgrammaticSizeRef.current = null;
          setSubtitleEditSize(null);
          setSubtitleUserSized(false);
          subtitleUserSizedRef.current = false;
          setSubtitleScale(1.4);
          return;
        }
        const userSized = Boolean(uiState.userSized);
        let nextUserSized = userSized;
        let nextSize: { width: number; height: number } | null = null;
        if (uiState.position) {
          setSubtitlePosition({
            x: Number(uiState.position.x) || 0.5,
            y: Number(uiState.position.y) || 0.85
          });
        }
        if (userSized && uiState.size) {
          const width = Number(uiState.size.width) || 0;
          const height = Number(uiState.size.height) || 0;
          if (width && height) {
            nextSize = { width, height };
          }
        }
        if (nextUserSized && !nextSize) {
          nextUserSized = false;
        }
        if (!subtitleEditor) {
          subtitleEditProgrammaticSizeRef.current = nextSize;
          setSubtitleEditSize(nextSize);
        }
        setSubtitleUserSized(nextUserSized);
        subtitleUserSizedRef.current = nextUserSized;
        if (uiState.scale) {
          const nextScale = Number(uiState.scale);
          if (Number.isFinite(nextScale)) {
            setSubtitleScale(clamp(nextScale, 0.8, 2.4));
          }
        }
      })
      .catch(() => undefined);
  }, [dispatch, getJobRecord, selectedJobId, subtitleBoxSize.height, subtitleBoxSize.width, subtitleEditor]);

  useEffect(() => {
    if (!subtitleEditor) return;
    const requested = subtitleEditOpenSizeRef.current;
    if (!requested) return;
    subtitleEditOpenSizeRef.current = null;
    const raf = window.requestAnimationFrame(() => {
      subtitleEditProgrammaticSizeRef.current = requested;
      setSubtitleEditSize(requested);
    });
    return () => window.cancelAnimationFrame(raf);
  }, [subtitleEditor]);

  useEffect(() => {
    if (subtitleEditor) return;
    if (subtitleUserSizedRef.current) return;
    if (subtitleEditSize !== null) {
      subtitleEditProgrammaticSizeRef.current = null;
      setSubtitleEditSize(null);
    }
  }, [subtitleEditSize, subtitleEditor, subtitleUserSized]);

  const handleOpenSubtitleEditor = useCallback(() => {
    if (!currentSubtitleMatch || !currentSubtitleMatch.segment) return;
    const mediaEl = getActiveMediaEl();
    if (mediaEl && !mediaEl.paused) {
      try {
        mediaEl.pause();
      } catch {
        // Ignore.
      }
    }
    const baseText = currentSubtitleMatch.segment.originalText ?? currentSubtitleMatch.segment.text ?? "";
    const measureEl = subtitleMeasureRef.current;
    if (measureEl) {
      measureEl.textContent = baseText || " ";
      const rect = measureEl.getBoundingClientRect();
      const paddingX = 12;
      const paddingY = 4;
      const width = Math.min(subtitleMaxWidth, rect.width + paddingX * 2 + 5);
      const height = rect.height + paddingY * 2;
      const nextSize = { width, height };
      subtitleEditOpenSizeRef.current = nextSize;
      subtitleEditProgrammaticSizeRef.current = nextSize;
      setSubtitleEditSize(nextSize);
    } else {
      const boxRect = subtitleBoxRef.current?.getBoundingClientRect();
      if (boxRect) {
        const width = Math.min(subtitleMaxWidth, boxRect.width + 5);
        const height = boxRect.height;
        const nextSize = { width, height };
        subtitleEditOpenSizeRef.current = nextSize;
        subtitleEditProgrammaticSizeRef.current = nextSize;
        setSubtitleEditSize(nextSize);
      }
    }
    setSubtitleDraft(baseText);
    setSubtitleEditor({ segmentId: currentSubtitleMatch.segment.id, text: baseText });
  }, [currentSubtitleMatch, getActiveMediaEl, subtitleMaxWidth]);

  const handleSaveSubtitleEdit = useCallback(async () => {
    const jobId =
      selectedJobId ?? (activeMedia?.source === "job" && activeMedia.jobId ? activeMedia.jobId : null);
    if (!subtitleEditor || !jobId) {
      setSubtitleEditor(null);
      return;
    }
    const newText = subtitleDraft.trim();
    const lastSaved = subtitleEditLastSavedRef.current?.text ?? subtitleEditor.text;
    if (!newText || newText === lastSaved.trim()) {
      setSubtitleEditor(null);
      return;
    }
    try {
      await editSegment({ jobId, segmentId: subtitleEditor.segmentId, newText }).unwrap();
      dispatch(updateSegmentText({ jobId, segmentId: subtitleEditor.segmentId, newText }));
      subtitleEditLastSavedRef.current = { segmentId: subtitleEditor.segmentId, text: newText };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      notify(`Failed to save changes: ${message}`, "error");
    } finally {
      setSubtitleEditor(null);
    }
  }, [
    activeMedia?.jobId,
    activeMedia?.source,
    dispatch,
    editSegment,
    notify,
    selectedJobId,
    subtitleDraft,
    subtitleEditor
  ]);

  const applySubtitlePosition = useCallback((pos: { x: number; y: number }) => {
    const el = subtitleBoxRef.current;
    if (!el) return;
    el.style.left = `${pos.x * 100}%`;
    el.style.top = `${pos.y * 100}%`;
  }, []);

  const handleSubtitlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (!currentSubtitle && !subtitleEditor) return;
      if (event.button !== 0) return;
      if (event.target !== event.currentTarget) return;
      const container = previewContainerRef.current?.getBoundingClientRect();
      const box = subtitleBoxRef.current?.getBoundingClientRect();
      if (!container || !box) return;
      if (subtitleEditor) {
        const nearResizeHandle = box.right - event.clientX < 14 && box.bottom - event.clientY < 14;
        if (nearResizeHandle) return;
      }
      subtitleDragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        originX: subtitlePositionRef.current.x,
        originY: subtitlePositionRef.current.y,
        moved: false,
        container,
        box,
        allowEdit: !subtitleEditor
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      event.preventDefault();
    },
    [currentSubtitle, subtitleEditor, previewContainerRef]
  );

  const handleSubtitlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = subtitleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
        drag.moved = true;
      }
      const nextX = drag.originX + dx / drag.container.width;
      const nextY = drag.originY + dy / drag.container.height;
      const halfW = drag.box.width / 2 / drag.container.width;
      const halfH = drag.box.height / 2 / drag.container.height;
      const clampedX = clamp(nextX, halfW, 1 - halfW);
      const clampedY = clamp(nextY, halfH, 1 - halfH);
      pendingSubtitlePosRef.current = { x: clampedX, y: clampedY };
      if (subtitleDragRafRef.current !== null) return;
      subtitleDragRafRef.current = window.requestAnimationFrame(() => {
        subtitleDragRafRef.current = null;
        const next = pendingSubtitlePosRef.current;
        if (!next) return;
        subtitlePositionRef.current = next;
        applySubtitlePosition(next);
        setSubtitlePosition((prev) => {
          if (Math.abs(prev.x - next.x) < 0.001 && Math.abs(prev.y - next.y) < 0.001) {
            return prev;
          }
          return next;
        });
      });
    },
    [applySubtitlePosition]
  );

  const handleSubtitlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = subtitleDragRef.current;
      if (!drag || drag.pointerId !== event.pointerId) return;
      subtitleDragRef.current = null;
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Ignore.
      }
      if (subtitleDragRafRef.current !== null) {
        window.cancelAnimationFrame(subtitleDragRafRef.current);
        subtitleDragRafRef.current = null;
      }
      const next = pendingSubtitlePosRef.current;
      pendingSubtitlePosRef.current = null;
      if (next) {
        subtitlePositionRef.current = next;
        applySubtitlePosition(next);
        setSubtitlePosition(next);
      }
      if (drag.moved) {
        scheduleSubtitleUiSave();
      }
      if (drag.allowEdit && !drag.moved) {
        handleOpenSubtitleEditor();
      }
    },
    [applySubtitlePosition, handleOpenSubtitleEditor, scheduleSubtitleUiSave]
  );

  return {
    subtitleScale,
    setSubtitleScale,
    subtitleBaseFontSize,
    setSubtitleBaseFontSize,
    subtitleEditor,
    setSubtitleEditor,
    subtitleDraft,
    setSubtitleDraft,
    subtitlePosition,
    setSubtitlePosition,
    subtitleMaxWidth,
    subtitleBoxSize,
    subtitleEditSize,
    subtitleUserSized,
    subtitleUserSizedRef,
    subtitleEditProgrammaticSizeRef,
    subtitlePositionRef,
    subtitleDragRafRef,
    pendingSubtitlePosRef,
    subtitleBoxRef,
    subtitleMeasureRef,
    subtitleUiSaveRef,
    subtitleUiLoadRef,
    subtitleEditOpenSizeRef,
    subtitleEditAutosaveRef,
    subtitleEditLastSavedRef,
    subtitleDragRef,
    subtitleFontSize,
    subtitleTextStyle,
    subtitleDisplaySize,
    scheduleSubtitleUiSave,
    handleOpenSubtitleEditor,
    handleSaveSubtitleEdit,
    applySubtitlePosition,
    handleSubtitlePointerDown,
    handleSubtitlePointerMove,
    handleSubtitlePointerUp
  };
}
