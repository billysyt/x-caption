import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { arrayMove } from "@dnd-kit/sortable";
import type { DragEndEvent } from "@dnd-kit/core";
import { useAppDispatch, useAppSelector } from "../../../hooks";
import { addJob, bootstrapJobs, removeJob, setJobOrder, startTranscription, updateJobDisplayName, updateJobUiState } from "../../jobs/jobsSlice";
import { useRemoveJobMutation, useUpsertJobRecordMutation } from "../../../api/jobsApi";
import { useResolveYoutubeStreamMutation } from "../../../api/youtubeApi";
import { stripFileExtension } from "../../../lib/utils";
import { logger } from "../../../lib/logger";
import { getPywebviewApi } from "../../../lib/window";
import type { Job } from "../../../types";
import type { MediaItem, MediaSourceInfo, UploadTabProps, ContextMenuState, JobPreviewMeta } from "../upload.types";
import {
  getKind,
  buildImportedJobId,
  isYoutubeStreamExpired,
  MEDIA_EXTENSIONS,
  ACCEPTED_MEDIA_TYPES
} from "../upload.utils";

/** Check if a YouTube stream URL is usable (not expired or null) */
function isStreamUrlValid(streamUrl: string | null | undefined): boolean {
  if (!streamUrl) return false;
  return !isYoutubeStreamExpired(streamUrl);
}

function isUnsupportedYoutubeStreamUrl(streamUrl: string | null | undefined): boolean {
  if (!streamUrl) return false;
  const lowered = streamUrl.toLowerCase();
  return lowered.includes("manifest/hls_playlist") || lowered.includes(".m3u8");
}

export function useUploadTab(props: UploadTabProps) {
  const dispatch = useAppDispatch();
  const settings = useAppSelector((s) => s.settings);
  const exportLanguage = useAppSelector((s) => s.transcript.exportLanguage);
  const jobsById = useAppSelector((s) => s.jobs.jobsById);
  const jobOrder = useAppSelector((s) => s.jobs.order);
  const selectedJobId = useAppSelector((s) => s.jobs.selectedJobId);
  const [removeJobRequest] = useRemoveJobMutation();
  const [upsertJobRecord] = useUpsertJobRecordMutation();
  const [resolveYoutubeStreamRequest] = useResolveYoutubeStreamMutation();

  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [viewMode, setViewMode] = useState<"list-view" | "list">("list-view");
  const [filterMode, setFilterMode] = useState<"all" | "video" | "audio">("all");
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [filterMenuOpen, setFilterMenuOpen] = useState(false);
  const viewMenuRef = useRef<HTMLDivElement | null>(null);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const contextMenuRef = useRef<HTMLDivElement | null>(null);

  const [localMediaState, setLocalMediaState] = useState<MediaItem[]>([]);
  const localMedia = props.localMedia ?? localMediaState;
  const setLocalMedia = props.onLocalMediaChange ?? setLocalMediaState;
  const [jobPreviewMeta, setJobPreviewMeta] = useState<JobPreviewMeta>({});
  const jobThumbInFlight = useRef<Set<string>>(new Set());
  const youtubeThumbInFlight = useRef<Set<string>>(new Set());
  const thumbSaveInFlight = useRef<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mediaOrder, setMediaOrder] = useState<string[]>([]);
  const [pendingYoutubeActivation, setPendingYoutubeActivation] = useState<string | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  const selectedJobIdRef = useRef<string | null>(selectedJobId ?? null);
  const resolveTokenRef = useRef(0);

  const getPreviewKind = useCallback((item: MediaItem) => (item.streamUrl ? "video" : item.kind), []);

  const scheduleIdle = useCallback((task: () => void) => {
    if (typeof window === "undefined") {
      task();
      return;
    }
    const win = window as unknown as { requestIdleCallback?: (cb: () => void) => void };
    if (typeof win.requestIdleCallback === "function") {
      win.requestIdleCallback(() => task());
    } else {
      window.setTimeout(task, 0);
    }
  }, []);

  const areIdsEqual = useCallback((left: string[], right: string[]) => {
    if (left.length !== right.length) return false;
    for (let i = 0; i < left.length; i += 1) {
      if (left[i] !== right[i]) return false;
    }
    return true;
  }, []);

  const isDataUrl = useCallback((value?: string | null) => {
    if (!value) return false;
    return value.startsWith("data:image/");
  }, []);

  const resolveYoutubeThumbnailUrl = useCallback((item: MediaItem) => {
    const explicit = item.externalSource?.thumbnailUrl ?? null;
    if (explicit) return explicit;
    return null;
  }, []);

  const captureImageThumbnailFromUrl = useCallback(async (url: string) => {
    try {
      const response = await fetch(url, { cache: "force-cache" });
      if (!response.ok) return null;
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      try {
        const img = new Image();
        img.decoding = "async";
        img.src = objectUrl;
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject(new Error("Image load failed"));
        });
        const width = img.naturalWidth || img.width || 0;
        const height = img.naturalHeight || img.height || 0;
        if (!width || !height) return null;
        const targetHeight = 40;
        const targetWidth = 64;
        const canvas = document.createElement("canvas");
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        const scale = Math.max(targetWidth / width, targetHeight / height);
        const drawWidth = width * scale;
        const drawHeight = height * scale;
        const dx = (targetWidth - drawWidth) / 2;
        const dy = (targetHeight - drawHeight) / 2;
        ctx.drawImage(img, 0, 0, width, height, dx, dy, drawWidth, drawHeight);
        return canvas.toDataURL("image/jpeg", 0.6);
      } finally {
        URL.revokeObjectURL(objectUrl);
      }
    } catch {
      return null;
    }
  }, []);

  const persistThumbnail = useCallback(
    (jobId: string, thumbnail: string | null | undefined) => {
      if (!jobId || !thumbnail) return;
      if (thumbSaveInFlight.current.has(jobId)) return;
      const job = jobsById[jobId];
      const existingUiState =
        job?.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>) : {};
      if ((existingUiState?.thumbnail as { data?: string })?.data === thumbnail) return;
      const nextUiState = {
        ...existingUiState,
        thumbnail: { data: thumbnail, updatedAt: Date.now() }
      };
      dispatch(updateJobUiState({ jobId, uiState: nextUiState }));
      thumbSaveInFlight.current.add(jobId);
      void upsertJobRecord({ job_id: jobId, ui_state: nextUiState })
        .unwrap()
        .catch(() => undefined)
        .finally(() => {
          thumbSaveInFlight.current.delete(jobId);
        });
    },
    [dispatch, jobsById, upsertJobRecord]
  );

  const resolveYoutubeStreamForItem = useCallback(
    async (item: MediaItem): Promise<MediaItem | null> => {
      if (item.externalSource?.type !== "youtube") return item;
      const url = item.externalSource.url ?? null;
      if (!url) {
        props.notify("Missing YouTube URL for this item.", "error");
        return null;
      }
      const markStreamError = (message: string) => {
        const nextSource: MediaSourceInfo = {
          type: "youtube",
          url,
          streamUrl: null,
          title: item.externalSource?.title ?? null,
          id: item.externalSource?.id ?? null,
          thumbnailUrl: item.externalSource?.thumbnailUrl ?? null
        };
        const failedItem: MediaItem = {
          ...item,
          previewUrl: item.previewUrl ?? null,
          streamUrl: null,
          externalSource: nextSource,
          isResolvingStream: false,
          streamError: message
        };
        if (item.source === "local") {
          setLocalMedia((prev) => prev.map((entry) => (entry.id === item.id ? failedItem : entry)));
        }
        if (item.jobId) {
          const job = jobsById[item.jobId];
          const existingUiState =
            job?.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>) : {};
          const nextUiState = { ...existingUiState, mediaSource: nextSource, mediaSourceError: message };
          if (job) dispatch(updateJobUiState({ jobId: item.jobId, uiState: nextUiState }));
          void upsertJobRecord({ job_id: item.jobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
        }
        return failedItem;
      };
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        return markStreamError("You're offline. Connect to the internet to load the YouTube preview.");
      }
      try {
        const payload = await resolveYoutubeStreamRequest(url).unwrap();
        const streamUrl = typeof payload.stream_url === "string" ? payload.stream_url : null;
        const thumbnailUrl = typeof payload.thumbnail_url === "string" ? payload.thumbnail_url : null;
        if (!streamUrl) throw new Error("Failed to resolve YouTube stream.");
        if (isUnsupportedYoutubeStreamUrl(streamUrl)) {
          return markStreamError("YouTube preview uses an unsupported stream format. Playing audio instead.");
        }
        const nextSource: MediaSourceInfo = {
          type: "youtube",
          url,
          streamUrl,
          title: payload.source?.title ?? item.externalSource.title ?? null,
          id: payload.source?.id ?? item.externalSource.id ?? null,
          thumbnailUrl: thumbnailUrl ?? item.externalSource.thumbnailUrl ?? null
        };
        const updatedItem: MediaItem = {
          ...item,
          previewUrl: streamUrl,
          streamUrl,
          externalSource: nextSource,
          isResolvingStream: false,
          streamError: null
        };
        if (item.source === "local") {
          setLocalMedia((prev) => prev.map((entry) => (entry.id === item.id ? updatedItem : entry)));
        }
        if (item.jobId) {
          const job = jobsById[item.jobId];
          const existingUiState =
            job?.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>) : {};
          const nextUiState = { ...existingUiState, mediaSource: nextSource, mediaSourceError: null };
          if (job) dispatch(updateJobUiState({ jobId: item.jobId, uiState: nextUiState }));
          void upsertJobRecord({ job_id: item.jobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
        }
        return updatedItem;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        props.notify(message || "Failed to resolve YouTube stream.", "error");
        return markStreamError("Unable to reach YouTube right now. Please try again later.");
      }
    },
    [dispatch, jobsById, props, resolveYoutubeStreamRequest, setLocalMedia, upsertJobRecord]
  );

  const persistMediaOrder = useCallback(
    (order: string[]) => {
      order.forEach((id, index) => {
        const job = jobsById[id];
        if (!job) return;
        const existingUiState =
          job.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>) : {};
        if ((existingUiState as { media_order_index?: number }).media_order_index === index) return;
        const nextUiState = { ...existingUiState, media_order_index: index };
        dispatch(updateJobUiState({ jobId: id, uiState: nextUiState }));
        void upsertJobRecord({ job_id: id, ui_state: nextUiState }).unwrap().catch(() => undefined);
      });
    },
    [dispatch, jobsById, upsertJobRecord]
  );

  const formatTimestamp = useCallback((value?: number | null) => {
    if (!value || !Number.isFinite(value)) return "";
    return new Date(value).toLocaleString();
  }, []);

  const localToFileUrl = useCallback((path: string) => {
    if (!path) return "";
    return `/media?path=${encodeURIComponent(path)}`;
  }, []);

  // Click outside handler
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      if (viewMenuRef.current && !viewMenuRef.current.contains(target)) setViewMenuOpen(false);
      if (filterMenuRef.current && !filterMenuRef.current.contains(target)) setFilterMenuOpen(false);
      if (contextMenu) {
        if (contextMenuRef.current && contextMenuRef.current.contains(target)) return;
        setContextMenu(null);
      }
    }
    if (viewMenuOpen || filterMenuOpen || contextMenu) {
      window.addEventListener("click", handleClickOutside);
      return () => window.removeEventListener("click", handleClickOutside);
    }
  }, [contextMenu, filterMenuOpen, viewMenuOpen]);

  // Selection change callback
  useEffect(() => {
    props.onSelectionChange?.(Boolean(selectedFile), selectedFile?.name ?? null, selectedFile ?? null);
  }, [selectedFile, props]);

  useEffect(() => {
    selectedIdRef.current = selectedId;
  }, [selectedId]);

  useEffect(() => {
    selectedJobIdRef.current = selectedJobId ?? null;
  }, [selectedJobId]);

  useEffect(() => {
    selectedIdRef.current = selectedId ?? null;
  }, [selectedId]);

  function clearSelectedFile() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setSelectedFile(null);
  }

  function buildLocalItem(file: File): MediaItem {
    const id = `local-${file.name}-${file.lastModified}-${Math.random().toString(16).slice(2)}`;
    const previewUrl = URL.createObjectURL(file);
    return {
      id,
      name: file.name,
      displayName: stripFileExtension(file.name) || file.name,
      kind: getKind(file.name),
      source: "local",
      file,
      localPath: null,
      previewUrl,
      thumbnailUrl: null,
      createdAt: Date.now(),
      durationSec: null
    };
  }

  function buildLocalPathItem(args: {
    path: string;
    name: string;
    size?: number | null;
    mime?: string | null;
    displayName?: string | null;
    durationSec?: number | null;
    previewUrl?: string | null;
    streamUrl?: string | null;
    externalSource?: MediaSourceInfo | null;
    transcriptionKind?: "audio" | "video";
  }): MediaItem {
    const id = `local-path-${args.name}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const previewUrl = args.previewUrl ?? args.streamUrl ?? localToFileUrl(args.path);
    const externalThumb = args.externalSource?.thumbnailUrl ?? null;
    const jobId = buildImportedJobId(args.path, args.size);
    // For YouTube videos, always set kind to "video" regardless of file extension
    // (backend saves as .mp3 but it's still a video source)
    const kind = args.externalSource?.type === "youtube" ? "video" : getKind(args.name);
    return {
      id,
      name: args.name,
      displayName: args.displayName ?? (stripFileExtension(args.name) || args.name),
      kind,
      source: "local",
      transcriptionKind: args.transcriptionKind,
      jobId,
      file: undefined,
      localPath: args.path,
      previewUrl,
      streamUrl: args.streamUrl ?? args.previewUrl ?? null,
      externalSource: args.externalSource ?? null,
      thumbnailUrl: externalThumb,
      createdAt: Date.now(),
      durationSec: typeof args.durationSec === "number" ? args.durationSec : null
    };
  }

  async function captureVideoThumbnail(file: File) {
    const url = URL.createObjectURL(file);
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();

    const detach = (() => {
      if (typeof document === "undefined" || !document.body) return () => undefined;
      video.style.position = "fixed";
      video.style.left = "0";
      video.style.top = "0";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.zIndex = "-1";
      document.body.appendChild(video);
      return () => {
        if (video.parentNode) video.parentNode.removeChild(video);
      };
    })();

    const waitFor = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const onEvent = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("video load failed")); };
        const cleanup = () => {
          video.removeEventListener(event, onEvent);
          video.removeEventListener("error", onError);
        };
        video.addEventListener(event, onEvent, { once: true });
        video.addEventListener("error", onError, { once: true });
      });
    const waitForFrame = () =>
      new Promise<void>((resolve) => {
        const withCallback = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof withCallback.requestVideoFrameCallback === "function") {
          withCallback.requestVideoFrameCallback(() => resolve());
          return;
        }
        const onTimeUpdate = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          video.removeEventListener("timeupdate", onTimeUpdate);
        };
        video.addEventListener("timeupdate", onTimeUpdate, { once: true });
        window.setTimeout(() => {
          cleanup();
          resolve();
        }, 200);
      });

    try {
      await waitFor("loadeddata");
    } catch {
      try {
        await waitFor("loadedmetadata");
      } catch {
        detach();
        URL.revokeObjectURL(url);
        return { duration: 0, thumbnail: null as string | null };
      }
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!duration || !width || !height) {
      detach();
      URL.revokeObjectURL(url);
      return { duration, thumbnail: null as string | null };
    }

    const targetHeight = 40;
    const targetWidth = 64;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      detach();
      URL.revokeObjectURL(url);
      return { duration, thumbnail: null as string | null };
    }

    const seekTo = (time: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        video.addEventListener("seeked", onSeeked, { once: true });
        try { video.currentTime = time; } catch { video.removeEventListener("seeked", onSeeked); resolve(); }
      });

    const midpoint = Math.max(0, Math.min(duration / 2, Math.max(0, duration - 0.1)));
    await seekTo(midpoint);
    try {
      await video.play();
    } catch {
      // Ignore autoplay errors; we still try to capture a frame.
    }
    await waitForFrame();
    try {
      video.pause();
    } catch {
      // Ignore.
    }
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const dx = (targetWidth - drawWidth) / 2;
    const dy = (targetHeight - drawHeight) / 2;
    ctx.drawImage(video, 0, 0, width, height, dx, dy, drawWidth, drawHeight);

    let thumbnail: string | null = null;
    try {
      thumbnail = canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      thumbnail = null;
    }
    detach();
    URL.revokeObjectURL(url);
    return { duration, thumbnail };
  }

  async function captureVideoThumbnailFromUrl(url: string) {
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();

    const detach = (() => {
      if (typeof document === "undefined" || !document.body) return () => undefined;
      video.style.position = "fixed";
      video.style.left = "0";
      video.style.top = "0";
      video.style.width = "1px";
      video.style.height = "1px";
      video.style.opacity = "0";
      video.style.pointerEvents = "none";
      video.style.zIndex = "-1";
      document.body.appendChild(video);
      return () => {
        if (video.parentNode) video.parentNode.removeChild(video);
      };
    })();

    const waitFor = (event: string) =>
      new Promise<void>((resolve, reject) => {
        const onEvent = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error("video load failed")); };
        const cleanup = () => {
          video.removeEventListener(event, onEvent);
          video.removeEventListener("error", onError);
        };
        video.addEventListener(event, onEvent, { once: true });
        video.addEventListener("error", onError, { once: true });
      });
    const waitForFrame = () =>
      new Promise<void>((resolve) => {
        const withCallback = video as HTMLVideoElement & {
          requestVideoFrameCallback?: (cb: () => void) => number;
        };
        if (typeof withCallback.requestVideoFrameCallback === "function") {
          withCallback.requestVideoFrameCallback(() => resolve());
          return;
        }
        const onTimeUpdate = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          video.removeEventListener("timeupdate", onTimeUpdate);
        };
        video.addEventListener("timeupdate", onTimeUpdate, { once: true });
        window.setTimeout(() => {
          cleanup();
          resolve();
        }, 200);
      });

    try {
      await waitFor("loadeddata");
    } catch {
      try {
        await waitFor("loadedmetadata");
      } catch {
        detach();
        return { duration: 0, thumbnail: null as string | null };
      }
    }

    const duration = Number.isFinite(video.duration) ? video.duration : 0;
    const width = video.videoWidth || 0;
    const height = video.videoHeight || 0;
    if (!duration || !width || !height) {
      detach();
      return { duration, thumbnail: null as string | null };
    }

    const targetHeight = 40;
    const targetWidth = 64;
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      detach();
      return { duration, thumbnail: null as string | null };
    }

    const seekTo = (time: number) =>
      new Promise<void>((resolve) => {
        const onSeeked = () => { video.removeEventListener("seeked", onSeeked); resolve(); };
        video.addEventListener("seeked", onSeeked, { once: true });
        try { video.currentTime = time; } catch { video.removeEventListener("seeked", onSeeked); resolve(); }
      });

    const midpoint = Math.max(0, Math.min(duration / 2, Math.max(0, duration - 0.1)));
    await seekTo(midpoint);
    try {
      await video.play();
    } catch {
      // Ignore autoplay errors; we still try to capture a frame.
    }
    await waitForFrame();
    try {
      video.pause();
    } catch {
      // Ignore.
    }
    const scale = Math.max(targetWidth / width, targetHeight / height);
    const drawWidth = width * scale;
    const drawHeight = height * scale;
    const dx = (targetWidth - drawWidth) / 2;
    const dy = (targetHeight - drawHeight) / 2;
    ctx.drawImage(video, 0, 0, width, height, dx, dy, drawWidth, drawHeight);

    let thumbnail: string | null = null;
    try {
      thumbnail = canvas.toDataURL("image/jpeg", 0.6);
    } catch {
      thumbnail = null;
    }
    detach();
    return { duration, thumbnail };
  }

  async function captureAudioDurationFromUrl(url: string) {
    return new Promise<number>((resolve) => {
      const el = document.createElement("audio");
      el.preload = "metadata";
      el.src = url;
      el.onloadedmetadata = () => resolve(Number.isFinite(el.duration) ? el.duration : 0);
      el.onerror = () => resolve(0);
    });
  }

  function addLocalFiles(files: File[]) {
    if (!files.length) return;
    const supported = files.filter((file) => {
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
      return MEDIA_EXTENSIONS.has(ext);
    });
    const rejected = files.filter((file) => !supported.includes(file));
    if (rejected.length) {
      props.notify(
        `Skipped ${rejected.length} unsupported file${rejected.length > 1 ? "s" : ""}. Supported: video and audio files.`,
        "error"
      );
    }
    if (!supported.length) return;

    const preferred = supported.find((file) => getKind(file.name) !== "caption") ?? supported[0];
    const picked = preferred ? [preferred] : [];
    if (supported.length > 1) {
      props.notify("Only one media file can be processed at a time. Using the first selection.", "info");
    }
    if (!picked.length) return;

    const items = picked.map(buildLocalItem);
    setLocalMedia((prev) => [...items, ...prev]);
    setSelectedId(items[0]?.id ?? null);
    props.onAddToTimeline?.(items);
    const playable = picked.find((file) => getKind(file.name) !== "caption") ?? null;
    if (playable) setSelectedFile(playable);
    else clearSelectedFile();

    items.forEach((item) => {
      if (!item.file || item.kind === "caption") return;
      scheduleIdle(() => {
        void (async () => {
          const meta =
            item.kind === "video"
              ? await captureVideoThumbnail(item.file as File)
              : await new Promise<{ duration: number; thumbnail: string | null }>((resolve) => {
                  const url = URL.createObjectURL(item.file as File);
                  const el = document.createElement("audio");
                  el.preload = "metadata";
                  el.src = url;
                  el.onloadedmetadata = () => {
                    const dur = Number.isFinite(el.duration) ? el.duration : 0;
                    URL.revokeObjectURL(url);
                    resolve({ duration: dur, thumbnail: null });
                  };
                  el.onerror = () => { URL.revokeObjectURL(url); resolve({ duration: 0, thumbnail: null }); };
                });
          setLocalMedia((prev) =>
            prev.map((m) =>
              m.id === item.id
                ? { ...m, durationSec: meta.duration || m.durationSec, thumbnailUrl: meta.thumbnail ?? m.thumbnailUrl }
                : m
            )
          );
        })();
      });
    });
  }

  async function addLocalPathItem(args: {
    path: string;
    name: string;
    size?: number | null;
    mime?: string | null;
    displayName?: string | null;
    durationSec?: number | null;
    previewUrl?: string | null;
    streamUrl?: string | null;
    externalSource?: MediaSourceInfo | null;
    transcriptionKind?: "audio" | "video";
  }) {
    const item = buildLocalPathItem(args);

    // For YouTube: resolve stream first, save to DB, then reload from DB (same as restart)
    // This ensures the exact same code path as restart + click
    if (args.externalSource?.type === "youtube" && item.jobId && item.localPath) {
      const displayName = item.displayName ?? (stripFileExtension(args.name) || args.name);

      // Resolve YouTube stream URL BEFORE saving to database
      try {
        // Resolve the stream URL first
        const resolvedItem = await resolveYoutubeStreamForItem(item);
        if (!resolvedItem) {
          // Failed to resolve - add as local item with error
          setLocalMedia((prev) => [item, ...prev]);
          setSelectedId(item.id);
          props.onAddToTimeline?.([item]);
          clearSelectedFile();
          return;
        }

        // Now save to DB with the resolved streamUrl
        const uiState = {
          mediaSource: {
            type: "youtube",
            url: resolvedItem.externalSource?.url ?? args.externalSource.url ?? null,
            streamUrl: resolvedItem.streamUrl ?? null, // Save resolved stream URL
            title: resolvedItem.externalSource?.title ?? args.externalSource.title ?? null,
            id: resolvedItem.externalSource?.id ?? args.externalSource.id ?? null,
            thumbnailUrl: resolvedItem.externalSource?.thumbnailUrl ?? args.externalSource.thumbnailUrl ?? null
          }
        };

        await upsertJobRecord({
          job_id: item.jobId!,
          filename: args.name,
          display_name: displayName,
          media_path: item.localPath!,
          media_kind: item.kind, // Use the determined kind (will be "video" for YouTube)
          status: "imported",
          ui_state: uiState
        }).unwrap();

        // Reload jobs from DB (same as app restart)
        await dispatch(bootstrapJobs()).unwrap();

        // Wait for React to update with new jobs before activating
        await new Promise(resolve => setTimeout(resolve, 100));

        // Build and activate the job item directly (synchronous activation)
        let jobItem = buildJobItem(item.jobId!);
        if (!jobItem) {
          const jobId = item.jobId!;
          const fallbackJob: Job = {
            id: jobId,
            filename: args.name,
            displayName,
            status: "imported",
            message: "",
            progress: 0,
            startTime: Date.now(),
            audioFile: {
              name: args.name,
              size: typeof args.size === "number" ? args.size : null,
              path: item.localPath ?? null
            },
            result: null,
            partialResult: null,
            error: null,
            currentStage: null,
            uiState
          };
          dispatch(addJob(fallbackJob));
          jobItem = buildJobItem(jobId);
        }
        if (jobItem) {
          setSelectedId(jobItem.id);
          handleMediaItemActivate(jobItem);
        }
      } catch (e) {
        // Fallback: add as local item if DB save/resolve fails
        setLocalMedia((prev) => [item, ...prev]);
        setSelectedId(item.id);
        props.onAddToTimeline?.([item]);
      }

      clearSelectedFile();
      return;
    }

    // Non-YouTube items: normal flow
    setLocalMedia((prev) => [item, ...prev]);
    setSelectedId(item.id);
    clearSelectedFile();
    props.onAddToTimeline?.([item]);

    if (item.jobId && item.localPath) {
      const displayName = item.displayName ?? (stripFileExtension(args.name) || args.name);
      const uiState =
        args.externalSource?.type === "youtube"
          ? {
              mediaSource: {
                type: "youtube",
                url: args.externalSource.url ?? null,
                streamUrl: null, // Don't persist - will resolve fresh on activation
                title: args.externalSource.title ?? null,
                id: args.externalSource.id ?? null,
                thumbnailUrl: args.externalSource.thumbnailUrl ?? null
              }
            }
          : undefined;
      void upsertJobRecord({
        job_id: item.jobId,
        filename: args.name,
        display_name: displayName,
        media_path: item.localPath,
        media_kind: item.kind,
        status: "imported",
        ui_state: uiState
      }).unwrap().catch(() => undefined);
    }
    if (item.kind === "video" && item.previewUrl) {
      scheduleIdle(() => {
        void (async () => {
          const meta = await captureVideoThumbnailFromUrl(item.previewUrl as string);
          setLocalMedia((prev) =>
            prev.map((m) =>
              m.id === item.id
                ? { ...m, durationSec: meta.duration || m.durationSec, thumbnailUrl: meta.thumbnail ?? m.thumbnailUrl }
                : m
            )
          );
          if (item.jobId) persistThumbnail(item.jobId, meta.thumbnail);
        })();
      });
    }
    if (item.kind === "audio" && item.previewUrl && item.durationSec == null) {
      scheduleIdle(() => {
        void (async () => {
          const duration = await captureAudioDurationFromUrl(item.previewUrl as string);
          if (!duration) return;
          setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? { ...m, durationSec: duration || m.durationSec } : m)));
        })();
      });
    }
  }

  function removeLocalItem(item: MediaItem, options?: { preserveSelection?: boolean }) {
    const wasSelected = selectedIdRef.current === item.id || selectedId === item.id;
    const preserveSelection = Boolean(options?.preserveSelection);
    if (item.previewUrl && item.file) URL.revokeObjectURL(item.previewUrl);
    setLocalMedia((prev) => prev.filter((m) => m.id !== item.id));
    if (wasSelected && !preserveSelection) {
      setSelectedId(null);
      selectedIdRef.current = null;
    } else {
      setSelectedId((prev) => (prev === item.id ? null : prev));
    }
    if (selectedFile && item.file === selectedFile) clearSelectedFile();
    if (item.jobId) void removeJobRequest(item.jobId).unwrap().catch(() => undefined);
    if (wasSelected && !preserveSelection) {
      handleClearSelection();
    }
  }

  function buildJobItem(id: string): MediaItem | null {
    const job = jobsById[id];
    if (!job) return null;
    const jobDuration =
      (job.result as Record<string, unknown>)?.audio_duration ||
      (job.result as Record<string, unknown>)?.duration ||
      (job.partialResult as Record<string, unknown>)?.audio_duration ||
      (job.partialResult as Record<string, unknown>)?.duration ||
      null;
    const rawSource =
      job.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>).mediaSource : null;
    const isYoutubeJob = rawSource && typeof rawSource === "object" && (rawSource as { type?: string }).type === "youtube";
    // For YouTube videos, always use "video" kind regardless of file extension
    const kind = isYoutubeJob ? "video" : getKind(job.filename);
    if (kind === "caption") return null;
    const localMatch = localMedia.find((item) => item.name === job.filename && item.kind === "video");
    const meta = jobPreviewMeta[id];
    const mediaPath = job.audioFile?.path || (job.result as Record<string, unknown>)?.file_path || null;
    const sourceError =
      job.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>).mediaSourceError : null;

    // Extract raw stream URL from persisted source
    const rawStreamUrl =
      rawSource && typeof rawSource === "object" && typeof (rawSource as Record<string, unknown>).streamUrl === "string"
        ? (rawSource as Record<string, unknown>).streamUrl as string
        : null;

    // Check if stream URL is valid (not expired) - if expired, we'll need fresh resolution
    const streamUrlValid = isStreamUrlValid(rawStreamUrl) && !isUnsupportedYoutubeStreamUrl(rawStreamUrl);

    const externalSource =
      rawSource && typeof rawSource === "object" && (rawSource as { type?: string }).type === "youtube"
        ? {
            type: "youtube" as const,
            url: typeof (rawSource as Record<string, unknown>).url === "string" ? (rawSource as Record<string, unknown>).url as string : null,
            // Only use stream URL if it's still valid (not expired)
            streamUrl: streamUrlValid ? rawStreamUrl : null,
            title: typeof (rawSource as Record<string, unknown>).title === "string" ? (rawSource as Record<string, unknown>).title as string : null,
            id: typeof (rawSource as Record<string, unknown>).id === "string" ? (rawSource as Record<string, unknown>).id as string : null,
            thumbnailUrl: typeof (rawSource as Record<string, unknown>).thumbnailUrl === "string" ? (rawSource as Record<string, unknown>).thumbnailUrl as string : null
          }
        : null;

    // For YouTube: use valid stream URL, otherwise null (will resolve on activation)
    const streamUrl = externalSource?.type === "youtube"
      ? (streamUrlValid ? rawStreamUrl : null)
      : null;
    const previewUrl = streamUrl ?? (mediaPath ? localToFileUrl(mediaPath as string) : null);

    // If stream URL is invalid/expired, clear old error so fresh resolution can happen
    // Also clear error if there's no external source (shouldn't have external source-related errors)
    const effectiveStreamError =
      externalSource && streamUrl && typeof sourceError === "string"
        ? sourceError
        : null;

    const persistedThumbnail =
      job.uiState && typeof job.uiState === "object" && typeof ((job.uiState as Record<string, unknown>)?.thumbnail as { data?: string })?.data === "string"
        ? ((job.uiState as Record<string, unknown>).thumbnail as { data: string }).data
        : null;
    const hasCapturedThumb = Boolean(localMatch?.thumbnailUrl || meta?.thumbnailUrl);
    const hasRemoteThumb = Boolean(externalSource?.thumbnailUrl);
    const thumbnailSource = persistedThumbnail ? "saved" : hasCapturedThumb || hasRemoteThumb ? "captured" : "none";
    return {
      id,
      name: job.filename || id,
      displayName: job.displayName ?? job.filename ?? id,
      kind,
      source: "job",
      jobId: id,
      localPath: mediaPath as string | null,
      previewUrl,
      streamUrl,
      externalSource,
      createdAt: job.startTime || Date.now(),
      durationSec: typeof jobDuration === "number" ? jobDuration : meta?.durationSec ?? localMatch?.durationSec ?? null,
      thumbnailUrl: localMatch?.thumbnailUrl ?? meta?.thumbnailUrl ?? persistedThumbnail ?? externalSource?.thumbnailUrl ?? null,
      thumbnailSource,
      invalid: Boolean(job.mediaInvalid),
      streamError: effectiveStreamError
    };
  }

  const jobItems = useMemo(
    () => jobOrder.map((id) => buildJobItem(id)).filter(Boolean) as MediaItem[],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jobOrder, localMedia, jobsById, jobPreviewMeta]
  );

  const jobMediaPaths = useMemo(() => {
    const paths = new Set<string>();
    Object.values(jobsById).forEach((job) => {
      const mediaPath =
        job.audioFile?.path ||
        (job.result as Record<string, unknown>)?.file_path ||
        (job.partialResult as Record<string, unknown>)?.file_path ||
        null;
      if (typeof mediaPath === "string" && mediaPath.length) {
        paths.add(mediaPath);
      }
    });
    return paths;
  }, [jobsById]);

  const mediaItemMap = useMemo(() => {
    const map = new Map<string, MediaItem>();
    localMedia.forEach((item) => {
      const shadowedByJob =
        (item.jobId && jobsById[item.jobId]) ||
        (item.localPath && jobMediaPaths.has(item.localPath));
      if (shadowedByJob) return;
      map.set(item.id, item);
    });
    jobItems.forEach((item) => map.set(item.id, item));
    return map;
  }, [jobItems, jobMediaPaths, jobsById, localMedia]);

  const createdAtById = useMemo(() => {
    const map = new Map<string, number>();
    mediaItemMap.forEach((item, id) => {
      map.set(id, typeof item.createdAt === "number" ? item.createdAt : 0);
    });
    return map;
  }, [mediaItemMap]);

  const mediaItems = useMemo(() => {
    if (mediaItemMap.size === 0) return [];
    if (!mediaOrder.length) {
      return [...mediaItemMap.values()].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
    }
    const orderSet = new Set(mediaOrder);
    const ordered = mediaOrder.map((id) => mediaItemMap.get(id)).filter(Boolean) as MediaItem[];
    const missing = [...mediaItemMap.values()].filter((item) => !orderSet.has(item.id));
    if (missing.length) {
      missing.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
      return [...missing, ...ordered];
    }
    return ordered;
  }, [mediaItemMap, mediaOrder]);

  // Sync media order
  useEffect(() => {
    if (mediaItemMap.size === 0) {
      if (mediaOrder.length) setMediaOrder([]);
      return;
    }
    if (!mediaOrder.length) {
      const localIds = [...localMedia].sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0)).map((item) => item.id);
      const jobIds = jobOrder.filter((id) => mediaItemMap.has(id));
      const known = new Set([...localIds, ...jobIds]);
      const remaining = [...mediaItemMap.keys()].filter((id) => !known.has(id));
      remaining.sort((a, b) => (createdAtById.get(b) ?? 0) - (createdAtById.get(a) ?? 0));
      const next = [...localIds, ...jobIds, ...remaining];
      if (!areIdsEqual(next, mediaOrder)) setMediaOrder(next);
      return;
    }
    const localIdsInOrder = mediaOrder.filter((id) => !jobsById[id] && mediaItemMap.has(id));
    const jobIdsInOrder = mediaOrder.filter((id) => jobsById[id]);
    if (!areIdsEqual(jobIdsInOrder, jobOrder)) {
      const jobIds = jobOrder.filter((id) => mediaItemMap.has(id));
      const known = new Set([...localIdsInOrder, ...jobIds]);
      const remaining = [...mediaItemMap.keys()].filter((id) => !known.has(id));
      remaining.sort((a, b) => (createdAtById.get(b) ?? 0) - (createdAtById.get(a) ?? 0));
      const next = [...localIdsInOrder, ...jobIds, ...remaining];
      if (!areIdsEqual(next, mediaOrder)) setMediaOrder(next);
      return;
    }
    const orderSet = new Set(mediaOrder);
    const missing: string[] = [];
    mediaItemMap.forEach((_item, id) => {
      if (!orderSet.has(id)) missing.push(id);
    });
    const kept = mediaOrder.filter((id) => mediaItemMap.has(id));
    if (!mediaOrder.length || missing.length || kept.length !== mediaOrder.length) {
      missing.sort((a, b) => (createdAtById.get(b) ?? 0) - (createdAtById.get(a) ?? 0));
      const next = [...missing, ...kept];
      if (!areIdsEqual(next, mediaOrder)) setMediaOrder(next);
    }
  }, [areIdsEqual, createdAtById, jobOrder, jobsById, localMedia, mediaItemMap, mediaOrder]);

  // Clear selection if no longer exists
  useEffect(() => {
    if (selectedId && !mediaItems.some((item) => item.id === selectedId)) setSelectedId(null);
  }, [mediaItems, selectedId]);

  // Capture video thumbnails for job items
  useEffect(() => {
    const videoJobs = mediaItems.filter(
      (item) => item.source === "job" && item.kind === "video" && item.previewUrl && item.externalSource?.type !== "youtube"
    );
    videoJobs.forEach((item) => {
      if (item.thumbnailUrl || jobPreviewMeta[item.id] || jobThumbInFlight.current.has(item.id)) return;
      jobThumbInFlight.current.add(item.id);
      scheduleIdle(() => {
        void (async () => {
          try {
            const meta = await captureVideoThumbnailFromUrl(item.previewUrl as string);
            setJobPreviewMeta((prev) => ({
              ...prev,
              [item.id]: { thumbnailUrl: meta.thumbnail ?? null, durationSec: meta.duration || null }
            }));
            persistThumbnail(item.id, meta.thumbnail);
          } finally {
            jobThumbInFlight.current.delete(item.id);
          }
        })();
      });
    });
  }, [jobPreviewMeta, mediaItems, persistThumbnail, scheduleIdle]);

  // Capture YouTube thumbnails
  useEffect(() => {
    const youtubeItems = mediaItems.filter((item) => item.externalSource?.type === "youtube");
    youtubeItems.forEach((item) => {
      const cachedThumb = item.thumbnailUrl || jobPreviewMeta[item.id]?.thumbnailUrl;
      if (cachedThumb && isDataUrl(cachedThumb)) return;
      if (youtubeThumbInFlight.current.has(item.id)) return;
      const thumbnailUrl = resolveYoutubeThumbnailUrl(item);
      if (!thumbnailUrl) return;
      youtubeThumbInFlight.current.add(item.id);
      scheduleIdle(() => {
        void (async () => {
          try {
            const thumbnail = await captureImageThumbnailFromUrl(thumbnailUrl);
            if (!thumbnail) return;
            if (item.source === "local") {
              setLocalMedia((prev) => prev.map((m) => (m.id === item.id ? { ...m, thumbnailUrl: thumbnail } : m)));
            } else {
              setJobPreviewMeta((prev) => ({ ...prev, [item.id]: { ...prev[item.id], thumbnailUrl: thumbnail ?? null } }));
            }
            if (item.jobId) persistThumbnail(item.jobId, thumbnail);
          } finally {
            youtubeThumbInFlight.current.delete(item.id);
          }
        })();
      });
    });
  }, [captureImageThumbnailFromUrl, isDataUrl, jobPreviewMeta, mediaItems, persistThumbnail, resolveYoutubeThumbnailUrl, scheduleIdle, setLocalMedia]);

  const filteredMediaItems = useMemo(() => {
    let items = [...mediaItems];
    if (filterMode !== "all") items = items.filter((item) => getPreviewKind(item) === filterMode);
    return items;
  }, [filterMode, getPreviewKind, mediaItems]);

  const hasMediaItems = Boolean(filteredMediaItems.length);
  const canReorder = filterMode === "all";
  const sortableIds = useMemo(() => filteredMediaItems.map((item) => item.id), [filteredMediaItems]);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      if (!canReorder) return;
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) return;
      const fromIndex = mediaOrder.indexOf(activeId);
      const toIndex = mediaOrder.indexOf(overId);
      if (fromIndex < 0 || toIndex < 0) return;
      const nextOrder = arrayMove(mediaOrder, fromIndex, toIndex);
      setMediaOrder(nextOrder);
      const nextJobOrder = nextOrder.filter((id) => Boolean(jobsById[id]));
      if (!areIdsEqual(nextJobOrder, jobOrder)) dispatch(setJobOrder(nextJobOrder));
      const localMap = new Map(localMedia.map((item) => [item.id, item]));
      const nextLocal = nextOrder.filter((id) => localMap.has(id)).map((id) => localMap.get(id) as MediaItem);
      const currentLocalIds = localMedia.map((item) => item.id);
      const nextLocalIds = nextLocal.map((item) => item.id);
      if (!areIdsEqual(currentLocalIds, nextLocalIds)) setLocalMedia(nextLocal);
      persistMediaOrder(nextOrder);
    },
    [areIdsEqual, canReorder, dispatch, jobOrder, jobsById, localMedia, mediaOrder, persistMediaOrder, setLocalMedia]
  );

  const handleMediaItemActivate = useCallback(
    (item: MediaItem) => {
      if (item.invalid) {
        const shouldRemove = window.confirm("This media file has changed or is missing. Remove this job?");
        if (shouldRemove) {
          if (item.source === "local") removeLocalItem(item);
          else if (item.jobId) void handleRemoveJob(null, item.jobId);
        }
        return;
      }
      const isYoutube = item.externalSource?.type === "youtube";

      if (isYoutube) {
        const existingStreamUrl = item.streamUrl ?? item.externalSource?.streamUrl ?? null;
        const streamExpired = existingStreamUrl ? isYoutubeStreamExpired(existingStreamUrl) : false;
        const streamUnsupported = existingStreamUrl ? isUnsupportedYoutubeStreamUrl(existingStreamUrl) : false;
        const shouldUseExistingStream =
          Boolean(existingStreamUrl) && !streamExpired && !streamUnsupported && !item.streamError;
        logger.debug("[handleMediaItemActivate] YouTube item:", {
          itemId: item.id,
          itemName: item.name,
          itemStreamUrl: item.streamUrl,
          itemPreviewUrl: item.previewUrl,
          externalSourceStreamUrl: item.externalSource?.streamUrl,
          existingStreamUrl,
          streamExpired,
          streamUnsupported,
          itemStreamError: item.streamError,
          shouldUseExistingStream
        });
        if (shouldUseExistingStream) {
          const stableSource = item.externalSource ? { ...item.externalSource, streamUrl: existingStreamUrl } : item.externalSource;
          const stableItem: MediaItem = {
            ...item,
            previewUrl: item.previewUrl ?? existingStreamUrl,
            streamUrl: existingStreamUrl,
            externalSource: stableSource,
            isResolvingStream: false
          };
          logger.debug("[handleMediaItemActivate] Using existing stream, passing to timeline:", {
            id: stableItem.id,
            streamUrl: stableItem.streamUrl,
            previewUrl: stableItem.previewUrl
          });
          setSelectedId(stableItem.id);
          selectedIdRef.current = stableItem.id;
          props.onAddToTimeline?.([stableItem]);
          return;
        }
        logger.debug("[handleMediaItemActivate] No valid stream, resolving...");
        const fallbackPreviewUrl = item.localPath ? localToFileUrl(item.localPath) : item.previewUrl ?? null;
        const pendingSource = item.externalSource ? { ...item.externalSource, streamUrl: null } : item.externalSource;
        const pendingItem: MediaItem = {
          ...item,
          // Don't set previewUrl to MP3 during resolution - let player wait for YouTube URL
          previewUrl: null,
          streamUrl: null,
          externalSource: pendingSource,
          isResolvingStream: true,
          streamError: null
        };
        setSelectedId(pendingItem.id);
        selectedIdRef.current = pendingItem.id;
        props.onAddToTimeline?.([pendingItem]);
        const resolveToken = ++resolveTokenRef.current;
        const requestedId = pendingItem.id;
        const requestedJobId = item.source === "job" ? item.jobId ?? null : null;
        const resolveTarget: MediaItem = { ...item, previewUrl: fallbackPreviewUrl ?? null };
        void resolveYoutubeStreamForItem(resolveTarget).then((refreshed) => {
          if (!refreshed) return;
          if (resolveTokenRef.current !== resolveToken) return;
          if (selectedIdRef.current !== requestedId) return;
          if (requestedJobId && selectedJobIdRef.current !== requestedJobId) return;
          props.onAddToTimeline?.([refreshed]);
        });
        return;
      }

      setSelectedId(item.id);
      selectedIdRef.current = item.id;
      props.onAddToTimeline?.([item]);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [props.onAddToTimeline, resolveYoutubeStreamForItem]
  );

  // Effect to handle pending YouTube activation after bootstrapJobs completes
  // This ensures we use fresh callback references after the re-render
  useEffect(() => {
    if (!pendingYoutubeActivation) return;
    logger.debug("[YouTube Activation Effect] Triggered with jobId:", pendingYoutubeActivation);
    const jobItem = buildJobItem(pendingYoutubeActivation);
    logger.debug("[YouTube Activation Effect] Built jobItem:", {
      id: jobItem?.id,
      name: jobItem?.name,
      kind: jobItem?.kind,
      streamUrl: jobItem?.streamUrl,
      previewUrl: jobItem?.previewUrl,
      externalSource: jobItem?.externalSource,
      isResolvingStream: jobItem?.isResolvingStream,
      streamError: jobItem?.streamError
    });
    setPendingYoutubeActivation(null); // Clear to prevent re-trigger
    if (jobItem) {
      setSelectedId(jobItem.id);
      handleMediaItemActivate(jobItem);
    }
  }, [pendingYoutubeActivation, handleMediaItemActivate]);

  const handleMediaItemContextMenu = useCallback((e: React.MouseEvent, item: MediaItem) => {
    setSelectedId(item.id);
    selectedIdRef.current = item.id;
    setContextMenu({ x: e.clientX, y: e.clientY, item });
  }, []);

  async function handleRemoveJob(e: React.MouseEvent | null, id: string) {
    if (e) { e.preventDefault(); e.stopPropagation(); }
    const wasSelected =
      selectedIdRef.current === id ||
      selectedId === id ||
      selectedJobIdRef.current === id ||
      contextMenu?.item?.jobId === id ||
      contextMenu?.item?.id === id;
    try {
      await dispatch(removeJob({ jobId: id, skipConfirm: true, silent: true })).unwrap();
      if (wasSelected) {
        handleClearSelection();
      } else {
        setSelectedId((prev) => (prev === id ? null : prev));
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      props.notify(`Failed to remove media: ${message}`, "error");
    }
  }

  async function submitTranscription() {
    const selectedItem = selectedId ? mediaItems.find((item) => item.id === selectedId) : null;
    const selectedJob = selectedItem?.source === "job" && selectedItem.jobId ? jobsById[selectedItem.jobId] : null;
    const reuseJobId = selectedJob?.status === "imported" ? selectedJob.id : null;
    const importedJobId =
      !reuseJobId && selectedItem?.source === "job" && selectedItem.jobId && jobsById[selectedItem.jobId]?.status === "imported"
        ? selectedItem.jobId
        : null;
    const filePath = selectedItem?.localPath ?? null;
    const filename = selectedItem?.name || selectedFile?.name;
    if (!filename) { props.notify("Please select a file first", "info"); return; }
    if (!filePath) { props.notify("Please use Open to select a local media file.", "error"); return; }

    try {
      const displayName = selectedItem?.displayName ?? (stripFileExtension(filename) || filename);
      const transcriptionKind =
        selectedItem?.transcriptionKind ??
        (selectedItem?.kind === "audio" || selectedItem?.kind === "video" ? selectedItem.kind : undefined);
      const chineseStyleSetting = settings.chineseStyle;
      const shouldForceYue =
        chineseStyleSetting === "yue" && (settings.language === "auto" || settings.language === "yue");
      const languageForBackend = shouldForceYue ? "yue" : settings.language;
      const chineseStyle =
        chineseStyleSetting === "written" || chineseStyleSetting === "spoken" ? chineseStyleSetting : undefined;
      const { job } = await dispatch(
        startTranscription({
          jobId: reuseJobId,
          file: undefined,
          filePath,
          filename,
          displayName,
          mediaKind: transcriptionKind,
          language: languageForBackend,
          model: settings.model,
          chineseStyle,
          chineseScript: exportLanguage,
        })
      ).unwrap();

      if (selectedItem?.source === "local") {
        const index = mediaOrder.indexOf(selectedItem.id);
        if (index >= 0) {
          const nextOrder = [...mediaOrder];
          nextOrder[index] = job.id;
          setMediaOrder(nextOrder);
          const nextJobOrder = nextOrder.filter((id) => id === job.id || Boolean(jobsById[id]));
          dispatch(setJobOrder(nextJobOrder));
          persistMediaOrder(nextOrder);
        }
      }

      if (displayName) {
        dispatch(updateJobDisplayName({ jobId: job.id, displayName }));
        void upsertJobRecord({ job_id: job.id, filename, display_name: displayName }).unwrap().catch(() => undefined);
      }
      if (selectedItem?.externalSource?.type === "youtube") {
        const existingUiState = job.uiState && typeof job.uiState === "object" ? (job.uiState as Record<string, unknown>) : {};
        const nextUiState = {
          ...existingUiState,
          mediaSource: {
            type: "youtube",
            url: selectedItem.externalSource.url ?? null,
            streamUrl: selectedItem.externalSource.streamUrl ?? null,
            title: selectedItem.externalSource.title ?? null,
            id: selectedItem.externalSource.id ?? null,
            thumbnailUrl: selectedItem.externalSource.thumbnailUrl ?? null
          }
        };
        dispatch(updateJobUiState({ jobId: job.id, uiState: nextUiState }));
        void upsertJobRecord({ job_id: job.id, ui_state: nextUiState }).unwrap().catch(() => undefined);
      }

      if (selectedItem?.source === "local") removeLocalItem(selectedItem, { preserveSelection: true });
      if (importedJobId) {
        void dispatch(removeJob({ jobId: importedJobId, skipConfirm: true, silent: true })).unwrap().catch(() => undefined);
      }
      setSelectedId(job.id);
      clearSelectedFile();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      props.notify(`Upload failed: ${message}`, "error");
    }
  }

  const requestFilePicker = useCallback(() => {
    const open = () => {
      const api = getPywebviewApi();
      const openNative = api?.openMediaDialog || api?.open_media_dialog;
      if (typeof openNative === "function") {
        void (openNative as () => Promise<unknown>)()
          .then((result) => {
            const payload = result as {
              cancelled?: boolean;
              success?: boolean;
              error?: string;
              file?: { path?: string; name?: string; size?: number; mime?: string };
            };
            if (!payload || payload.cancelled) return;
            if (!payload.success) {
              const message =
                payload?.error === "unsupported_file"
                  ? "Unsupported file type. Please choose an audio or video file."
                  : payload?.error || "Failed to open media file.";
              props.notify(message, "error");
              return;
            }
            if (payload.file?.path) {
              const filePath = String(payload.file.path);
              const fileName = payload.file.name || filePath.split(/[\\/]/).pop() || "media";
              addLocalPathItem({
                path: filePath,
                name: fileName,
                size: typeof payload.file.size === "number" ? payload.file.size : null,
                mime: payload.file.mime || null
              });
            }
          })
          .catch((error: unknown) => {
            const message = error instanceof Error ? error.message : String(error);
            props.notify(message || "Failed to open media file.", "error");
          });
        return;
      }
      if (fileInputRef.current) {
        fileInputRef.current.accept = ACCEPTED_MEDIA_TYPES;
        fileInputRef.current.click();
      }
    };
    if (props.onRequestFilePicker) { props.onRequestFilePicker(open); return; }
    open();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.notify, props.onRequestFilePicker]);

  const handleClearSelection = useCallback(() => {
    setSelectedId(null);
    selectedIdRef.current = null;
    setContextMenu(null);
    props.onClearSelection?.();
  }, [props]);

  return {
    // State
    viewMode,
    setViewMode,
    filterMode,
    setFilterMode,
    viewMenuOpen,
    setViewMenuOpen,
    filterMenuOpen,
    setFilterMenuOpen,
    contextMenu,
    setContextMenu,
    selectedId,
    selectedFile,
    // Refs
    fileInputRef,
    viewMenuRef,
    filterMenuRef,
    contextMenuRef,
    // Derived data
    filteredMediaItems,
    hasMediaItems,
    canReorder,
    sortableIds,
    jobsById,
    // Callbacks
    getPreviewKind,
    formatTimestamp,
    handleDragEnd,
    handleMediaItemActivate,
    handleMediaItemContextMenu,
    handleRemoveJob,
    removeLocalItem,
    addLocalFiles,
    addLocalPathItem,
    submitTranscription,
    requestFilePicker,
    handleClearSelection,
    // For imperative handle
    hasSelection: () => Boolean(selectedFile || selectedId)
  };
}

export { ACCEPTED_MEDIA_TYPES };
