import { useCallback, useEffect, useMemo, useRef, useState, type RefObject, type Dispatch, type SetStateAction } from "react";
import type { Job } from "../../../types";
import type { MediaItem } from "../../upload/components/UploadTab";
import type { TimelineClip } from "../../timeline/hooks/useTimelineDerivedState";
import { clamp, MIN_CLIP_DURATION_SEC, normalizeClips } from "../../../lib/timeline";
import { logger } from "../../../lib/logger";

type TimelineRange =
  | { type: "clip"; startSec: number; durationSec: number; clipId: string }
  | { type: "gap"; startSec: number; durationSec: number };

type PlaybackStateParams = {
  dispatchSelectJob: (jobId: string | null) => void;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  activeMedia: MediaItem | null;
  setActiveMedia: Dispatch<SetStateAction<MediaItem | null>>;
  selectedJobId: string | null;
  timelineClips: TimelineClip[];
  setTimelineClips: Dispatch<SetStateAction<TimelineClip[]>>;
  activeClipId: string | null;
  setActiveClipId: Dispatch<SetStateAction<string | null>>;
  localMedia: MediaItem[];
  setLocalMedia: Dispatch<SetStateAction<MediaItem[]>>;
  clipTimeline: TimelineClip[];
  clipById: Map<string, TimelineClip>;
  timelineRanges: TimelineRange[];
  timelineDuration: number;
  nextClip: TimelineClip | null;
  getPreviewKind: (media?: MediaItem | null) => string | null;
  resolveYoutubeStreamForMedia: (media: MediaItem) => Promise<void>;
  isOnline: boolean;
  jobsById: Record<string, Job>;
};

export function usePlaybackState(params: PlaybackStateParams) {
  const {
    dispatchSelectJob,
    notify,
    activeMedia,
    setActiveMedia,
    selectedJobId,
    timelineClips,
    setTimelineClips,
    activeClipId,
    setActiveClipId,
    localMedia,
    setLocalMedia,
    clipTimeline,
    clipById,
    timelineRanges,
    timelineDuration,
    nextClip,
    getPreviewKind,
    resolveYoutubeStreamForMedia,
    isOnline,
    jobsById
  } = params;

  const audioRef = useRef<HTMLAudioElement>(null);
  const videoRefA = useRef<HTMLVideoElement>(null);
  const videoRefB = useRef<HTMLVideoElement>(null);
  const previewContainerRef = useRef<HTMLDivElement>(null);

  const [playback, setPlayback] = useState({ currentTime: 0, duration: 0, isPlaying: false });
  const [playbackRate, setPlaybackRate] = useState(1);
  const playbackRef = useRef(playback);
  const [previewPoster, setPreviewPoster] = useState<string | null>(null);
  const [activeVideoSlot, setActiveVideoSlot] = useState<0 | 1>(0);
  const previewPosterRef = useRef<string | null>(null);
  const previewPosterModeRef = useRef<"paused" | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [activePreviewUrl, setActivePreviewUrl] = useState<string | null>(null);

  const pendingPlayRef = useRef(false);
  const pendingPlayTargetRef = useRef<string | null>(null);
  const pendingSeekRef = useRef<number | null>(null);
  const scrubStateRef = useRef<{ pointerId: number; rect?: DOMRect } | null>(null);
  const playerScrubRef = useRef<{ wasPlaying: boolean } | null>(null);
  const scrubRafRef = useRef<number | null>(null);
  const pendingScrubRef = useRef<number | null>(null);
  const lastScrubValueRef = useRef<number | null>(null);
  const mediaRafActiveRef = useRef(false);
  const pendingPlayRafRef = useRef<number | null>(null);
  const pendingSwapRef = useRef<string | null>(null);
  const isGapPlaybackRef = useRef(false);
  const lastMediaElRef = useRef<HTMLMediaElement | null>(null);

  const activePreviewKind = getPreviewKind(activeMedia);

  useEffect(() => {
    playbackRef.current = playback;
  }, [playback]);

  useEffect(() => {
    previewPosterRef.current = previewPoster;
    if (!previewPoster) {
      previewPosterModeRef.current = null;
    }
  }, [previewPoster]);

  const applyPlaybackRate = useCallback(
    (mediaEl: HTMLMediaElement | null, rate: number = playbackRate) => {
      if (!mediaEl) return;
      try {
        mediaEl.playbackRate = rate;
      } catch {
        // Ignore.
      }
      const el = mediaEl as HTMLMediaElement & { preservesPitch?: boolean; webkitPreservesPitch?: boolean };
      if ("preservesPitch" in el) {
        el.preservesPitch = rate <= 2;
      }
      if ("webkitPreservesPitch" in el) {
        el.webkitPreservesPitch = rate <= 2;
      }
    },
    [playbackRate]
  );

  const safePlay = useCallback((mediaEl: HTMLMediaElement | null) => {
    if (!mediaEl) return Promise.resolve(false);
    let threw = false;
    const attempt = () => {
      try {
        return mediaEl.play();
      } catch {
        threw = true;
        return undefined;
      }
    };
    const initial = attempt();
    if (initial && typeof (initial as Promise<void>).then === "function") {
      return (initial as Promise<void>)
        .then(() => true)
        .catch(() => {
          try {
            mediaEl.load();
          } catch {
            // Ignore.
          }
          const retry = attempt();
          if (retry && typeof (retry as Promise<void>).then === "function") {
            return (retry as Promise<void>).then(() => true).catch(() => false);
          }
          return false;
        });
    }
    if (threw) {
      return Promise.resolve(false);
    }
    return new Promise((resolve) => {
      if (typeof window === "undefined") {
        resolve(!mediaEl.paused);
        return;
      }
      window.requestAnimationFrame(() => resolve(!mediaEl.paused));
    });
  }, []);

  const schedulePendingPlay = useCallback(
    (mediaEl: HTMLMediaElement | null) => {
      if (!mediaEl) return;
      if (pendingPlayRafRef.current !== null) return;
      const step = () => {
        pendingPlayRafRef.current = null;
        if (!pendingPlayRef.current) return;
        if (pendingPlayTargetRef.current && pendingPlayTargetRef.current !== activeMedia?.id) {
          pendingPlayRef.current = false;
          pendingPlayTargetRef.current = null;
          return;
        }
        if (mediaEl.readyState < 2) {
          if (typeof window !== "undefined") {
            pendingPlayRafRef.current = window.requestAnimationFrame(step);
          }
          return;
        }
        void safePlay(mediaEl).then((ok) => {
          pendingPlayRef.current = !ok;
          if (!ok && typeof window !== "undefined") {
            pendingPlayRafRef.current = window.requestAnimationFrame(step);
          }
        });
      };
      if (typeof window === "undefined") {
        step();
        return;
      }
      pendingPlayRafRef.current = window.requestAnimationFrame(step);
    },
    [activeMedia?.id, safePlay]
  );

  useEffect(() => {
    if (pendingPlayTargetRef.current && pendingPlayTargetRef.current !== activeMedia?.id) {
      pendingPlayRef.current = false;
      pendingPlayTargetRef.current = null;
      if (pendingPlayRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(pendingPlayRafRef.current);
        pendingPlayRafRef.current = null;
      }
    }
  }, [activeMedia?.id]);

  useEffect(() => {
    return () => {
      if (pendingPlayRafRef.current !== null && typeof window !== "undefined") {
        window.cancelAnimationFrame(pendingPlayRafRef.current);
        pendingPlayRafRef.current = null;
      }
    };
  }, []);

  const capturePreviewPoster = useCallback((mediaEl: HTMLMediaElement | null) => {
    if (!mediaEl) return;
    const videoEl = mediaEl as HTMLVideoElement;
    if (typeof videoEl.videoWidth !== "number" || typeof videoEl.videoHeight !== "number") return;
    if (videoEl.readyState < 2 || videoEl.videoWidth <= 0 || videoEl.videoHeight <= 0) return;
    try {
      const canvas = document.createElement("canvas");
      canvas.width = videoEl.videoWidth;
      canvas.height = videoEl.videoHeight;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      const dataUrl = canvas.toDataURL("image/png");
      if (dataUrl) {
        previewPosterModeRef.current = "paused";
        setPreviewPoster(dataUrl);
      }
    } catch {
      // Ignore capture failures (cross-origin or canvas errors).
    }
  }, []);

  const getActiveVideoEl = useCallback(() => {
    return activeVideoSlot === 0 ? videoRefA.current : videoRefB.current;
  }, [activeVideoSlot]);

  const getInactiveVideoEl = useCallback(() => {
    return activeVideoSlot === 0 ? videoRefB.current : videoRefA.current;
  }, [activeVideoSlot]);

  const getActiveMediaEl = useCallback(() => {
    return activePreviewKind === "video" ? getActiveVideoEl() : audioRef.current;
  }, [activePreviewKind, getActiveVideoEl]);

  const activeMediaElRefValue = getActiveMediaEl();

  const cyclePlaybackRate = useCallback(() => {
    setPlaybackRate((prev) => {
      const next = prev < 1.25 ? 1.5 : prev < 1.75 ? 2 : 1;
      applyPlaybackRate(getActiveMediaEl(), next);
      if (activePreviewKind === "video") {
        applyPlaybackRate(getInactiveVideoEl(), next);
      }
      return next;
    });
  }, [activePreviewKind, applyPlaybackRate, getActiveMediaEl, getInactiveVideoEl]);

  const transcriptMediaRef =
    activePreviewKind === "video"
      ? (activeVideoSlot === 0
        ? (videoRefA as RefObject<HTMLMediaElement>)
        : (videoRefB as RefObject<HTMLMediaElement>))
      : (audioRef as RefObject<HTMLMediaElement>);

  const advanceFromClip = useCallback(
    (clipEntry: (typeof clipTimeline)[number] | null, endTime: number) => {
      if (!clipEntry) {
        setPlayback((prev) => ({ ...prev, isPlaying: false }));
        return;
      }
      const nextClip = clipTimeline.find(
        (clip) => clip.startSec >= endTime - 0.01 && clip.startSec <= endTime + 0.05
      );
      if (nextClip) {
        const nextEntry = clipById.get(nextClip.id);
        if (nextEntry) {
          if (pendingSwapRef.current === nextEntry.id) {
            return;
          }
          const switchToNext = () => {
            setPreviewPoster(null);
            isGapPlaybackRef.current = false;
            setActiveClipId(nextEntry.id);
            setActiveMedia(nextEntry.media);
            pendingSeekRef.current = nextEntry.trimStartSec;
            pendingPlayRef.current = true;
            pendingSwapRef.current = null;
            setPlayback((prev) => ({ ...prev, isPlaying: true }));
          };
          const sameMedia = clipEntry.media.id === nextEntry.media.id;
          const canSwapVideo =
            !sameMedia &&
            getPreviewKind(nextEntry.media) === "video" &&
            Boolean(getInactiveVideoEl());
          if (canSwapVideo) {
            const nextVideo = getInactiveVideoEl();
            if (nextVideo && nextEntry.media.previewUrl && nextVideo.src === nextEntry.media.previewUrl) {
              pendingSwapRef.current = nextEntry.id;
              applyPlaybackRate(nextVideo);
              const desiredTime = Math.max(0, nextEntry.trimStartSec);
              if (!Number.isFinite(nextVideo.currentTime) || Math.abs(nextVideo.currentTime - desiredTime) > 0.05) {
                try {
                  nextVideo.currentTime = desiredTime;
                } catch {
                  // Ignore.
                }
              }
              nextVideo.muted = true;
              const swap = () => {
                nextVideo.muted = false;
                const currentVideo = getActiveVideoEl();
                if (currentVideo) {
                  currentVideo.muted = true;
                  try {
                    currentVideo.pause();
                  } catch {
                    // Ignore.
                  }
                }
                setPreviewPoster(null);
                setActiveVideoSlot((prev) => (prev === 0 ? 1 : 0));
                setActiveClipId(nextEntry.id);
                setActiveMedia(nextEntry.media);
                pendingSeekRef.current = null;
                pendingPlayRef.current = false;
                pendingSwapRef.current = null;
                setPlayback((prev) => ({ ...prev, isPlaying: true }));
              };
              const playAndSwap = () => {
                void safePlay(nextVideo);
                const anyVideo = nextVideo as HTMLVideoElement & {
                  requestVideoFrameCallback?: (cb: () => void) => void;
                };
                if (typeof anyVideo.requestVideoFrameCallback === "function") {
                  anyVideo.requestVideoFrameCallback(() => swap());
                } else {
                  // Fallback: swap on first canplay tick.
                  window.setTimeout(swap, 0);
                }
              };
              if (nextVideo.readyState >= 2) {
                playAndSwap();
                return;
              }
              const fallbackId = window.setTimeout(() => {
                nextVideo.removeEventListener("loadeddata", onReady);
                switchToNext();
              }, 300);
              const onReady = () => {
                nextVideo.removeEventListener("loadeddata", onReady);
                window.clearTimeout(fallbackId);
                playAndSwap();
              };
              nextVideo.addEventListener("loadeddata", onReady);
              return;
            }
            pendingSwapRef.current = null;
          }
          setPreviewPoster(null);
          const mediaEl = getActiveMediaEl();
          if (sameMedia && mediaEl) {
            const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
            if (currentTime >= nextEntry.trimStartSec - 0.03) {
              setActiveClipId(nextEntry.id);
              if (activeMedia?.id !== nextEntry.media.id) {
                setActiveMedia(nextEntry.media);
              }
              pendingSeekRef.current = null;
              pendingPlayRef.current = false;
              pendingSwapRef.current = null;
              setPlayback((prev) => ({ ...prev, isPlaying: true }));
              return;
            }
          }
          switchToNext();
          return;
        }
      }
      isGapPlaybackRef.current = true;
      const mediaEl = getActiveMediaEl();
      if (mediaEl && !mediaEl.paused) {
        try {
          mediaEl.pause();
        } catch {
          // Ignore.
        }
      }
      setActiveClipId(null);
      setActiveMedia(null);
      pendingSeekRef.current = null;
      pendingPlayRef.current = false;
      setPlayback((prev) => ({ ...prev, isPlaying: true }));
    },
    [
      activeMedia?.id,
      applyPlaybackRate,
      clipById,
      clipTimeline,
      getPreviewKind,
      getActiveMediaEl,
      getActiveVideoEl,
      getInactiveVideoEl,
      safePlay,
      setActiveClipId,
      setActiveMedia
    ]
  );

  useEffect(() => {
    const mediaEl = activeMediaElRefValue;
    if (!mediaEl) {
      setPlayback({ currentTime: 0, duration: 0, isPlaying: false });
      return;
    }

    const clearPosterIfReady = () => {
      if (previewPosterModeRef.current === "paused") return;
      if (!previewPosterRef.current || !activeClipId) return;
      const clipEntry = clipById.get(activeClipId);
      if (!clipEntry) return;
      const mediaTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
      if (mediaEl.readyState >= 2 && mediaTime >= clipEntry.trimStartSec + 0.02) {
        setPreviewPoster(null);
      }
    };

    const onLoaded = () => {
      if (!activeMedia) {
        return;
      }
      applyPlaybackRate(mediaEl);
      const mediaDuration = Number.isFinite(mediaEl.duration) ? mediaEl.duration : 0;
      if (mediaDuration > 0) {
        setPlayback((prev) => ({ ...prev, duration: mediaDuration }));
      }
      if (pendingSeekRef.current !== null) {
        try {
          mediaEl.currentTime = pendingSeekRef.current;
        } catch {
          // Ignore.
        }
        pendingSeekRef.current = null;
      }
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        void safePlay(mediaEl).then((ok) => {
          if (!ok) {
            pendingPlayRef.current = true;
            schedulePendingPlay(mediaEl);
          }
        });
      }
      clearPosterIfReady();
    };
    const onTime = () => {
      if (mediaRafActiveRef.current) {
        clearPosterIfReady();
        return;
      }
      const mediaTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
      if (!clipTimeline.length) {
        setPlayback((prev) => ({ ...prev, currentTime: mediaTime }));
        return;
      }
      if (!activeClipId) {
        return;
      }
      const clipEntry = clipTimeline.find((clip) => clip.id === activeClipId);
      if (!clipEntry) return;
      clearPosterIfReady();
      if (mediaTime >= clipEntry.trimEndSec - 0.02) {
        const endTime = clipEntry.startSec + clipEntry.durationSec;
        setPlayback((prev) => ({ ...prev, currentTime: endTime }));
        advanceFromClip(clipEntry, endTime);
        return;
      }
      const localTime = Math.max(0, mediaTime - clipEntry.trimStartSec);
      setPlayback((prev) => ({ ...prev, currentTime: clipEntry.startSec + localTime }));
    };
    const onPlay = () => {
      if (previewPosterModeRef.current === "paused") {
        setPreviewPoster(null);
      }
      setPlayback((prev) => ({ ...prev, isPlaying: true }));
    };
    const onPause = () => {
      if (isGapPlaybackRef.current) return;
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
      if (activePreviewKind === "video" && !playerScrubRef.current && !scrubStateRef.current) {
        capturePreviewPoster(mediaEl);
      }
    };
    const onEnded = () => {
      if (!clipTimeline.length || !activeClipId) {
        if (isGapPlaybackRef.current) {
          return;
        }
        setPlayback((prev) => ({ ...prev, isPlaying: false }));
        return;
      }
      const current = clipById.get(activeClipId);
      const endTime = current ? current.startSec + current.durationSec : playbackRef.current.currentTime;
      advanceFromClip(current ?? null, endTime);
    };

    mediaEl.addEventListener("loadedmetadata", onLoaded);
    mediaEl.addEventListener("loadeddata", clearPosterIfReady);
    mediaEl.addEventListener("seeked", clearPosterIfReady);
    mediaEl.addEventListener("timeupdate", onTime);
    mediaEl.addEventListener("play", onPlay);
    mediaEl.addEventListener("pause", onPause);
    mediaEl.addEventListener("ended", onEnded);
    return () => {
      mediaEl.removeEventListener("loadedmetadata", onLoaded);
      mediaEl.removeEventListener("loadeddata", clearPosterIfReady);
      mediaEl.removeEventListener("seeked", clearPosterIfReady);
      mediaEl.removeEventListener("timeupdate", onTime);
      mediaEl.removeEventListener("play", onPlay);
      mediaEl.removeEventListener("pause", onPause);
      mediaEl.removeEventListener("ended", onEnded);
    };
  }, [
    activeClipId,
    activeMedia,
    activeMediaElRefValue,
    activePreviewKind,
    advanceFromClip,
    applyPlaybackRate,
    capturePreviewPoster,
    clipById,
    clipTimeline,
    schedulePendingPlay,
    safePlay
  ]);

  useEffect(() => {
    const mediaEl = activeMediaElRefValue;
    if (!mediaEl) return;
    applyPlaybackRate(mediaEl);
  }, [activeMediaElRefValue, applyPlaybackRate, activeMedia?.id, activePreviewKind]);

  useEffect(() => {
    const mediaEl = activeMediaElRefValue;
    if (!mediaEl) {
      lastMediaElRef.current = null;
      return;
    }
    if (lastMediaElRef.current === mediaEl) return;
    lastMediaElRef.current = mediaEl;
    if (!activeMedia) return;
    const currentPlayback = playbackRef.current;
    let targetTime = Number.isFinite(currentPlayback.currentTime) ? currentPlayback.currentTime : 0;
    if (clipTimeline.length && activeClipId) {
      const clipEntry = clipById.get(activeClipId);
      if (clipEntry) {
        const offset = Math.max(0, targetTime - clipEntry.startSec);
        targetTime = clamp(
          clipEntry.trimStartSec + offset,
          clipEntry.trimStartSec,
          clipEntry.trimEndSec
        );
      }
    }
    if (Number.isFinite(targetTime)) {
      pendingSeekRef.current = targetTime;
      if (mediaEl.readyState >= 1) {
        try {
          mediaEl.currentTime = targetTime;
          pendingSeekRef.current = null;
        } catch {
          // Ignore.
        }
      }
    }
    if (currentPlayback.isPlaying) {
      pendingPlayRef.current = true;
      pendingPlayTargetRef.current = activeMedia.id;
      if (mediaEl.paused) {
        void safePlay(mediaEl).then((ok) => {
          pendingPlayRef.current = !ok;
          if (!ok) {
            schedulePendingPlay(mediaEl);
          }
        });
      }
    }
  }, [activeClipId, activeMedia, activeMediaElRefValue, clipById, clipTimeline.length, safePlay, schedulePendingPlay]);

  useEffect(() => {
    if (!playback.isPlaying) return;
    const mediaEl = activeMediaElRefValue;
    if (!mediaEl) return;
    if (!activeClipId) return;
    const clipEntry = clipById.get(activeClipId);
    if (!clipEntry) return;
    mediaRafActiveRef.current = true;
    let rafId: number | null = null;
    let lastUiUpdate = 0;
    const step = (now: number) => {
      if (!playbackRef.current.isPlaying) {
        mediaRafActiveRef.current = false;
        return;
      }
      const currentClip = clipById.get(activeClipId);
      if (!currentClip) {
        mediaRafActiveRef.current = false;
        return;
      }
      const mediaTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
      if (mediaTime >= currentClip.trimEndSec - 0.005) {
        const endTime = currentClip.startSec + currentClip.durationSec;
        setPlayback((prev) => ({ ...prev, currentTime: endTime }));
        mediaRafActiveRef.current = false;
        advanceFromClip(currentClip, endTime);
        return;
      }
      if (now - lastUiUpdate >= 33) {
        lastUiUpdate = now;
        const localTime = Math.max(0, mediaTime - currentClip.trimStartSec);
        setPlayback((prev) => ({ ...prev, currentTime: currentClip.startSec + localTime }));
      }
      rafId = requestAnimationFrame(step);
    };
    rafId = requestAnimationFrame(step);
    return () => {
      mediaRafActiveRef.current = false;
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
    };
  }, [activeClipId, advanceFromClip, clipById, activeMediaElRefValue, playback.isPlaying]);

  useEffect(() => {
    if (!activeMedia) {
      setActivePreviewUrl(null);
      return;
    }
    logger.debug("[activePreviewUrl Effect] activeMedia changed:", {
      id: activeMedia.id,
      previewUrl: activeMedia.previewUrl,
      streamUrl: activeMedia.streamUrl,
      localPath: activeMedia.localPath,
      externalSource: activeMedia.externalSource,
      isOnline
    });
    const toFileUrl = (path: string) => `/media?path=${encodeURIComponent(path)}`;
    const isExternalSource = activeMedia.externalSource?.type === "youtube";
    // For YouTube, prefer stream URL unless there's an error or offline
    const preferLocalFallback = Boolean(
      isExternalSource && (activeMedia.streamError || !isOnline)
    );
    logger.debug("[activePreviewUrl Effect] Checking condition:", {
      hasPreviewUrl: Boolean(activeMedia.previewUrl),
      previewUrl: activeMedia.previewUrl,
      isExternalSource,
      preferLocalFallback,
      streamError: activeMedia.streamError,
      isOnline,
      willEarlyReturn: Boolean(activeMedia.previewUrl && !preferLocalFallback)
    });

    if (activeMedia.previewUrl && !preferLocalFallback) {
      logger.debug("[activePreviewUrl Effect] Has previewUrl and not preferLocalFallback, setting null");
      setActivePreviewUrl(null);
      return;
    }
    // For external sources that are resolving, don't set local audio as preview
    // Wait for the stream URL to be resolved
    if (isExternalSource && activeMedia.isResolvingStream) {
      logger.debug("[activePreviewUrl Effect] External source resolving, setting null");
      setActivePreviewUrl(null);
      return;
    }
    if (isExternalSource) {
      logger.debug("[activePreviewUrl Effect] External source item, checking fallback paths");
      if (activeMedia.localPath) {
        const url = toFileUrl(activeMedia.localPath);
        logger.debug("[activePreviewUrl Effect] Setting local file URL:", url);
        setActivePreviewUrl(url);
        return;
      }
      if (activeMedia.source === "job" && activeMedia.jobId) {
        const url = `/audio/${activeMedia.jobId}?v=${Date.now()}`;
        logger.debug("[activePreviewUrl Effect] Setting job audio URL:", url);
        setActivePreviewUrl(url);
        return;
      }
    }
    if (activeMedia.source === "job" && activeMedia.jobId) {
      setActivePreviewUrl(`/audio/${activeMedia.jobId}?v=${Date.now()}`);
      return;
    }
    if (activeMedia.localPath) {
      setActivePreviewUrl(toFileUrl(activeMedia.localPath));
      return;
    }
    if (activeMedia.file) {
      const url = activeMedia.previewUrl ?? URL.createObjectURL(activeMedia.file);
      setActivePreviewUrl(url);
      if (!activeMedia.previewUrl) {
        return () => URL.revokeObjectURL(url);
      }
      return;
    }
    setActivePreviewUrl(null);
  }, [activeMedia, isOnline]);

  const localPreviewUrl = activeMedia?.localPath
    ? `/media?path=${encodeURIComponent(activeMedia.localPath)}`
    : null;
  const isExternalMediaSource = activeMedia?.externalSource?.type === "youtube";
  const resolvedPreviewUrl =
    isExternalMediaSource && (activeMedia.streamError || !isOnline)
      ? localPreviewUrl ?? activePreviewUrl ?? activeMedia?.previewUrl ?? null
      : activeMedia?.previewUrl ?? activePreviewUrl;

  useEffect(() => {
    if (!pendingPlayRef.current) return;
    const mediaEl = getActiveMediaEl();
    if (!mediaEl) return;
    schedulePendingPlay(mediaEl);
  }, [getActiveMediaEl, activeMedia?.id, activePreviewKind, resolvedPreviewUrl, schedulePendingPlay]);

  useEffect(() => {
    if (!activeMedia) return;
    const isExternalSource = activeMedia.externalSource?.type === "youtube";
    if (!isExternalSource) return;
    if (!isOnline) return;
    if (activeMedia.isResolvingStream) return;
    // Don't auto-resolve if there's already an error - video load failures (CORS, format)
    // will just keep failing. Let user trigger manual retry if needed.
    if (activeMedia.streamError) return;
    const existingStream = activeMedia.streamUrl ?? activeMedia.externalSource?.streamUrl ?? null;
    if (existingStream) return;
    void resolveYoutubeStreamForMedia(activeMedia);
  }, [
    activeMedia,
    activeMedia?.externalSource?.streamUrl,
    activeMedia?.externalSource?.type,
    activeMedia?.id,
    activeMedia?.isResolvingStream,
    activeMedia?.streamError,
    activeMedia?.streamUrl,
    isOnline,
    resolveYoutubeStreamForMedia
  ]);

  useEffect(() => {
    if (!activeMedia) {
      setPreviewLoading(false);
      setPreviewError(null);
      return;
    }
    if (activeMedia.isResolvingStream) {
      setPreviewLoading(true);
    }
  }, [activeMedia?.id, activeMedia?.isResolvingStream]);

  useEffect(() => {
    const mediaEl = getActiveMediaEl();
    if (!mediaEl) return;
    const handleStart = () => {
      setPreviewLoading(true);
      setPreviewError(null);
    };
    const handleReady = () => {
      setPreviewLoading(false);
      setPreviewError(null);
      if (pendingPlayRef.current) {
        schedulePendingPlay(mediaEl);
      }
    };
    const handleError = () => {
      setPreviewLoading(false);
      setPreviewError("Preview failed to load.");
      // Only set streamError if we DON'T have a valid previewUrl
      // During automatic activation, we have a fresh stream URL that should work
      // Don't mark it as failed just because of a transient loading error
      const isExternalSource = activeMedia?.externalSource?.type === "youtube";
      if (isExternalSource && !activeMedia.streamError && !activeMedia.previewUrl) {
        const errorMessage = "YouTube preview failed to load.";
        const nextMedia = { ...activeMedia, streamError: errorMessage };
        setActiveMedia(nextMedia);
        setTimelineClips((prev) =>
          prev.map((clip) => (clip.media.id === nextMedia.id ? { ...clip, media: nextMedia } : clip))
        );
        if (nextMedia.source === "local") {
          setLocalMedia((prev) => prev.map((item) => (item.id === nextMedia.id ? nextMedia : item)));
        }
      }
    };
    mediaEl.addEventListener("loadstart", handleStart);
    mediaEl.addEventListener("loadeddata", handleReady);
    mediaEl.addEventListener("canplay", handleReady);
    mediaEl.addEventListener("error", handleError);
    return () => {
      mediaEl.removeEventListener("loadstart", handleStart);
      mediaEl.removeEventListener("loadeddata", handleReady);
      mediaEl.removeEventListener("canplay", handleReady);
      mediaEl.removeEventListener("error", handleError);
    };
  }, [
    activeMedia,
    activePreviewKind,
    getActiveMediaEl,
    resolvedPreviewUrl,
    schedulePendingPlay,
    setLocalMedia,
    setTimelineClips,
    setActiveMedia
  ]);

  const activeVideoSrc = resolvedPreviewUrl && activePreviewKind === "video" ? resolvedPreviewUrl : null;
  const audioPreviewSrc = activePreviewKind === "audio" ? resolvedPreviewUrl : null;
  const showPreviewSpinner = previewLoading || Boolean(activeMedia?.isResolvingStream);

  // Check if audio fallback is available for external sources (YouTube)
  const hasAudioFallback =
    activeMedia?.externalSource?.type === "youtube" &&
    (activeMedia.localPath || (activeMedia.source === "job" && activeMedia.jobId));

  // Only show "preview unavailable" if there's NO audio fallback
  // When audio fallback exists, we gracefully show audio preview instead
  const externalSourceUnavailableReason =
    activeMedia?.externalSource?.type === "youtube" &&
    !activeMedia?.isResolvingStream &&
    !hasAudioFallback
      ? !isOnline
        ? "You're offline. Connect to the internet to load the video preview."
        : activeMedia.streamError || null
      : null;
  const showYoutubeUnavailable = Boolean(externalSourceUnavailableReason);

  useEffect(() => {
    const audioEl = audioRef.current;
    if (!audioEl) return;
    try {
      audioEl.pause();
    } catch {
      // Ignore.
    }
    try {
      audioEl.currentTime = 0;
    } catch {
      // Ignore.
    }
    try {
      audioEl.load();
    } catch {
      // Ignore.
    }
  }, [audioPreviewSrc]);

  useEffect(() => {
    if (!activeVideoSrc) return;
    const videoEl = getActiveVideoEl();
    if (!videoEl) return;
    setPreviewPoster(null);
    previewPosterModeRef.current = null;
    const handleLoaded = () => {
      if (playbackRef.current.isPlaying) return;
      try {
        videoEl.currentTime = 0;
      } catch {
        // Ignore.
      }
      capturePreviewPoster(videoEl);
    };
    videoEl.addEventListener("loadeddata", handleLoaded);
    try {
      videoEl.load();
    } catch {
      // Ignore.
    }
    return () => {
      videoEl.removeEventListener("loadeddata", handleLoaded);
    };
  }, [activeVideoSrc, capturePreviewPoster, getActiveVideoEl]);

  const shouldShowPreviewPoster = Boolean(previewPoster);
  const nextVideoTarget = useMemo(() => {
    if (!nextClip) return null;
    if (getPreviewKind(nextClip.media) !== "video") return null;
    if (activeMedia?.id === nextClip.media.id) return null;
    return {
      url: nextClip.media.previewUrl ?? null,
      trimStartSec: nextClip.trimStartSec
    };
  }, [activeMedia?.id, getPreviewKind, nextClip]);

  useEffect(() => {
    if (!nextVideoTarget?.url) return;
    const nextEl = getInactiveVideoEl();
    if (!nextEl) return;
    nextEl.preload = "auto";
    nextEl.muted = true;
    nextEl.playsInline = true;
    const onLoaded = () => {
      try {
        const desired = Math.max(0, nextVideoTarget.trimStartSec);
        if (!Number.isFinite(nextEl.currentTime) || Math.abs(nextEl.currentTime - desired) > 0.05) {
          nextEl.currentTime = desired;
        }
      } catch {
        // Ignore.
      }
    };
    nextEl.addEventListener("loadedmetadata", onLoaded);
    nextEl.load();
    return () => {
      nextEl.removeEventListener("loadedmetadata", onLoaded);
    };
  }, [getInactiveVideoEl, nextVideoTarget?.trimStartSec, nextVideoTarget?.url]);

  useEffect(() => {
    const target = pendingSeekRef.current;
    if (target === null) return;
    if (activeMedia?.isResolvingStream) return;
    const mediaEl = activeMediaElRefValue;
    if (!mediaEl) return;
    if (mediaEl.readyState >= 1) {
      try {
        mediaEl.currentTime = target;
        pendingSeekRef.current = null;
      } catch {
        // Ignore.
      }
      if (pendingPlayRef.current) {
        pendingPlayRef.current = false;
        if (mediaEl.paused) {
          void safePlay(mediaEl).then((ok) => {
            if (!ok) {
              pendingPlayRef.current = true;
              schedulePendingPlay(mediaEl);
            }
          });
        }
      }
    }
  }, [activeClipId, activeMedia, activeMediaElRefValue, safePlay, schedulePendingPlay]);

  useEffect(() => {
    if (activeClipId && !clipById.has(activeClipId)) {
      const next = clipTimeline[0];
      if (next) {
        setActiveClipId(next.id);
        setActiveMedia(next.media);
      } else {
        setActiveClipId(null);
        setActiveMedia(null);
      }
    }
  }, [activeClipId, clipById, clipTimeline, setActiveClipId, setActiveMedia]);

  useEffect(() => {
    if (clipTimeline.length) return;
    if (activeMedia || activeClipId) {
      setActiveClipId(null);
      setActiveMedia(null);
    }
    setPlayback((prev) => ({ ...prev, currentTime: 0, isPlaying: false }));
  }, [activeClipId, activeMedia, clipTimeline.length, setActiveClipId, setActiveMedia]);

  useEffect(() => {
    if (!activeMedia || activeClipId) return;
    const stillInTimeline = clipTimeline.some((clip) => clip.media.id === activeMedia.id);
    if (stillInTimeline) return;
    setActiveMedia(null);
  }, [activeClipId, activeMedia, clipTimeline, setActiveMedia]);

  useEffect(() => {
    if (!clipTimeline.length) return;
    const range = timelineRanges.find(
      (r) => playback.currentTime >= r.startSec && playback.currentTime < r.startSec + r.durationSec
    );
    if (!range || range.type === "gap") {
      if (activeMedia || activeClipId) {
        isGapPlaybackRef.current = true;
        setActiveClipId(null);
        setActiveMedia(null);
      }
      return;
    }
    if (activeClipId === range.clipId && activeMedia) return;
    const target = clipById.get(range.clipId);
    if (!target) return;
    const offset = Math.max(0, playback.currentTime - target.startSec);
    const newTime = Math.min(target.trimEndSec, target.trimStartSec + offset);
    const mediaEl = getActiveMediaEl();
    const sameMedia = activeMedia?.id === target.media.id;
    if (sameMedia && mediaEl) {
      const currentTime = Number.isFinite(mediaEl.currentTime) ? mediaEl.currentTime : 0;
      if (Math.abs(currentTime - newTime) <= 0.05) {
        isGapPlaybackRef.current = false;
        setActiveClipId(target.id);
        pendingSeekRef.current = null;
        pendingPlayRef.current = false;
        return;
      }
    }
    isGapPlaybackRef.current = false;
    setActiveClipId(target.id);
    setActiveMedia(target.media);
    pendingSeekRef.current = newTime;
    pendingPlayRef.current = playback.isPlaying;
  }, [
    activeClipId,
    activeMedia,
    clipById,
    clipTimeline.length,
    getActiveMediaEl,
    playback.currentTime,
    playback.isPlaying,
    setActiveClipId,
    setActiveMedia,
    timelineRanges
  ]);

  useEffect(() => {
    if (!localMedia.length) return;
    const mediaById = new Map(localMedia.map((item) => [item.id, item]));
    setTimelineClips((prev) => {
      let changed = false;
      const next = prev.map((clip) => {
        const updated = mediaById.get(clip.media.id);
        if (!updated || !Number.isFinite(updated.durationSec) || !updated.durationSec) {
          return clip;
        }
        const base = Math.max(MIN_CLIP_DURATION_SEC, updated.durationSec);
        if (Math.abs(base - clip.baseDurationSec) < 0.05 && updated.thumbnailUrl === clip.media.thumbnailUrl) {
          return clip;
        }
        const wasUntrimmed =
          clip.trimStartSec <= 0.01 && Math.abs(clip.durationSec - clip.baseDurationSec) < 0.05;
        const trimStartSec = wasUntrimmed
          ? 0
          : clamp(clip.trimStartSec, 0, Math.max(0, base - MIN_CLIP_DURATION_SEC));
        const maxDur = Math.max(MIN_CLIP_DURATION_SEC, base - trimStartSec);
        const durationSec = wasUntrimmed
          ? maxDur
          : clamp(clip.durationSec, MIN_CLIP_DURATION_SEC, maxDur);
        const trimEndSec = trimStartSec + durationSec;
        changed = true;
        return {
          ...clip,
          media: updated,
          baseDurationSec: base,
          trimStartSec,
          durationSec,
          trimEndSec
        };
      });
      return changed ? normalizeClips(next) : prev;
    });
  }, [localMedia, setTimelineClips]);

  useEffect(() => {
    if (!activeMedia || activeMedia.source !== "job") return;
    if (!Number.isFinite(playback.duration) || playback.duration <= 0) return;
    const base = Math.max(MIN_CLIP_DURATION_SEC, playback.duration);
    setTimelineClips((prev) => {
      let changed = false;
      const next = prev.map((clip) => {
        if (clip.media.id !== activeMedia.id) return clip;
        if (Math.abs(base - clip.baseDurationSec) < 0.05) return clip;
        const wasUntrimmed =
          clip.trimStartSec <= 0.01 && Math.abs(clip.durationSec - clip.baseDurationSec) < 0.05;
        const trimStartSec = wasUntrimmed
          ? 0
          : clamp(clip.trimStartSec, 0, Math.max(0, base - MIN_CLIP_DURATION_SEC));
        const maxDur = Math.max(MIN_CLIP_DURATION_SEC, base - trimStartSec);
        const durationSec = wasUntrimmed
          ? maxDur
          : clamp(clip.durationSec, MIN_CLIP_DURATION_SEC, maxDur);
        const trimEndSec = trimStartSec + durationSec;
        changed = true;
        return {
          ...clip,
          baseDurationSec: base,
          trimStartSec,
          durationSec,
          trimEndSec
        };
      });
      return changed ? normalizeClips(next) : prev;
    });
  }, [activeMedia, playback.duration, setTimelineClips]);

  useEffect(() => {
    if (activePreviewKind === "video" && audioRef.current) {
      try {
        audioRef.current.pause();
      } catch {
        // Ignore.
      }
    }
    if (activePreviewKind === "audio") {
      [videoRefA.current, videoRefB.current].forEach((video) => {
        if (!video) return;
        try {
          video.pause();
        } catch {
          // Ignore.
        }
      });
    }
  }, [activeMedia?.id, activePreviewKind]);

  useEffect(() => {
    if (!clipTimeline.length) return;
    if (!Number.isFinite(timelineDuration)) return;
    if (playback.currentTime <= timelineDuration) return;
    const mediaEl = getActiveMediaEl();
    if (mediaEl && !mediaEl.paused) {
      try {
        mediaEl.pause();
      } catch {
        // Ignore.
      }
    }
    setPlayback((prev) => ({ ...prev, currentTime: timelineDuration, isPlaying: false }));
  }, [clipTimeline.length, timelineDuration, playback.currentTime, getActiveMediaEl]);

  useEffect(() => {
    if (!activeMedia) return;
    if (activeMedia.source === "job" && activeMedia.jobId && !jobsById[activeMedia.jobId]) {
      pendingSeekRef.current = null;
      pendingPlayRef.current = false;
      setActiveClipId(null);
      setActiveMedia(null);
      setActivePreviewUrl(null);
      setPlayback((prev) => ({ ...prev, currentTime: 0, duration: 0, isPlaying: false }));
    }
  }, [activeMedia, jobsById, setActiveClipId, setActiveMedia]);

  useEffect(() => {
    if (!timelineClips.length) return;
    setTimelineClips((prev) => {
      const next = prev.filter((clip) => {
        if (clip.media.source !== "job") return true;
        if (!clip.media.jobId) return false;
        return Boolean(jobsById[clip.media.jobId]);
      });
      if (next.length === prev.length) return prev;
      return next;
    });
  }, [jobsById, timelineClips.length, setTimelineClips]);

  useEffect(() => {
    if (!activeMedia || activeMedia.source !== "job" || !activeMedia.jobId) return;
    if (selectedJobId && selectedJobId !== activeMedia.jobId) return;
    dispatchSelectJob(activeMedia.jobId);
  }, [activeMedia, dispatchSelectJob, selectedJobId]);

  useEffect(() => {
    if (!clipTimeline.length) return;
    if (activeMedia) return;
    if (!playback.isPlaying) return;
    if (!Number.isFinite(timelineDuration) || timelineDuration <= 0) return;
    let frameId: number | null = null;
    let lastTime = performance.now();
    const step = (now: number) => {
      const delta = Math.max(0, (now - lastTime) / 1000);
      lastTime = now;
      setPlayback((prev) => {
        if (!prev.isPlaying) return prev;
        const nextTime = Math.min(timelineDuration, prev.currentTime + delta);
        if (nextTime >= timelineDuration) {
          return { ...prev, currentTime: timelineDuration, isPlaying: false };
        }
        return { ...prev, currentTime: nextTime };
      });
      frameId = requestAnimationFrame(step);
    };
    frameId = requestAnimationFrame(step);
    return () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
      }
    };
  }, [activeMedia, clipTimeline.length, playback.isPlaying, timelineDuration]);

  const fallbackDuration =
    Number.isFinite(activeMedia?.durationSec) && activeMedia?.durationSec ? activeMedia.durationSec : 0;
  const duration = clipTimeline.length ? timelineDuration : (playback.duration || fallbackDuration || 0);
  const hasPreviewSource =
    Boolean(resolvedPreviewUrl) || clipTimeline.length > 0 || Boolean(activeMedia?.isResolvingStream);
  const previewDisabled = !hasPreviewSource;
  const activeMediaEl = getActiveMediaEl();
  const isMediaPlaying = activeMediaEl ? !activeMediaEl.paused : playback.isPlaying;

  const togglePlayback = () => {
    if (!clipTimeline.length && !activeMedia) {
      return;
    }
    // For external sources (YouTube): only resolve if there's no stream URL AND no error.
    // If there's an error (video failed to load), just play audio fallback instead of re-resolving.
    const hasExternalAudioFallback =
      activeMedia?.externalSource?.type === "youtube" &&
      (activeMedia.localPath || (activeMedia.source === "job" && activeMedia.jobId));
    const shouldResolveExternalStream =
      activeMedia?.externalSource?.type === "youtube" &&
      !resolvedPreviewUrl &&
      !activeMedia.streamError;
    if (shouldResolveExternalStream) {
      pendingPlayRef.current = true;
      pendingPlayTargetRef.current = activeMedia?.id ?? null;
      setPlayback((prev) => ({ ...prev, isPlaying: true }));
      void resolveYoutubeStreamForMedia(activeMedia);
      return;
    }
    // If external video failed but has audio fallback, just play the audio
    if (activeMedia?.externalSource?.type === "youtube" &&
        activeMedia.streamError &&
        hasExternalAudioFallback) {
      // Fall through to normal playback - will use audio
    }
    if (clipTimeline.length) {
      const range = timelineRanges.find(
        (r) => playback.currentTime >= r.startSec && playback.currentTime < r.startSec + r.durationSec
      );
      if (!range || range.type === "gap") {
        const mediaEl = getActiveMediaEl();
        if (mediaEl && !mediaEl.paused) {
          try {
            mediaEl.pause();
          } catch {
            // Ignore.
          }
        }
        isGapPlaybackRef.current = true;
        if (activeMedia || activeClipId) {
          setActiveClipId(null);
          setActiveMedia(null);
        }
        pendingSeekRef.current = null;
        setPlayback((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
        return;
      }
      const target = clipById.get(range.clipId);
      if (target && activeClipId !== target.id) {
        isGapPlaybackRef.current = false;
        if (playback.isPlaying) {
          const mediaEl = getActiveMediaEl();
          if (mediaEl && !mediaEl.paused) {
            try {
              mediaEl.pause();
            } catch {
              // Ignore.
            }
          }
        }
        setActiveClipId(target.id);
        setActiveMedia(target.media);
        const offset = Math.max(0, playback.currentTime - target.startSec);
        pendingSeekRef.current = Math.min(target.trimEndSec, target.trimStartSec + offset);
        pendingPlayRef.current = !playback.isPlaying;
        setPlayback((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
        return;
      }
    }
    const mediaEl = getActiveMediaEl();
    if (!mediaEl) {
      pendingPlayRef.current = !playback.isPlaying;
      pendingPlayTargetRef.current = activeMedia?.id ?? null;
      setPlayback((prev) => ({ ...prev, isPlaying: !prev.isPlaying }));
      return;
    }
    const activeClip = activeClipId ? clipById.get(activeClipId) : null;
    if (activeClip) {
      const offset = Math.max(0, playback.currentTime - activeClip.startSec);
      const desiredTime = clamp(
        activeClip.trimStartSec + offset,
        activeClip.trimStartSec,
        activeClip.trimEndSec
      );
      if (!Number.isFinite(mediaEl.currentTime) || Math.abs(mediaEl.currentTime - desiredTime) > 0.05) {
        try {
          mediaEl.currentTime = desiredTime;
          pendingSeekRef.current = null;
        } catch {
          // Ignore.
        }
      }
    }
    if (mediaEl.paused) {
      pendingPlayRef.current = true;
      pendingPlayTargetRef.current = activeMedia?.id ?? null;
      setPlayback((prev) => ({ ...prev, isPlaying: true }));
      void safePlay(mediaEl)
        .then((ok) => {
          pendingPlayRef.current = !ok;
          if (!ok) {
            schedulePendingPlay(mediaEl);
          }
          setPlayback((prev) => ({ ...prev, isPlaying: ok }));
        })
        .catch(() => {
          pendingPlayRef.current = true;
          schedulePendingPlay(mediaEl);
          setPlayback((prev) => ({ ...prev, isPlaying: false }));
        });
    } else {
      mediaEl.pause();
      pendingPlayRef.current = false;
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
    }
  };

  const handlePreviewClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    if (target.closest("button, input, textarea, select, [data-no-toggle]")) return;
    togglePlayback();
  };

  const applyScrub = useCallback(
    (value: number) => {
      if (!Number.isFinite(duration) || duration <= 0) return;
      const currentPlayback = playbackRef.current;
      const scrubState = playerScrubRef.current;
      const wasPlaying = scrubState?.wasPlaying ?? currentPlayback.isPlaying;
      const shouldResume = scrubState ? false : wasPlaying;
      if (clipTimeline.length) {
        const range = timelineRanges.find(
          (r) => value >= r.startSec && value < r.startSec + r.durationSec
        );
        if (!range || range.type === "gap") {
          const mediaEl = getActiveMediaEl();
          if (mediaEl && !mediaEl.paused) {
            try {
              mediaEl.pause();
            } catch {
              // Ignore.
            }
          }
          isGapPlaybackRef.current = true;
          if (activeClipId !== null) {
            setActiveClipId(null);
          }
          if (activeMedia !== null) {
            setActiveMedia(null);
          }
          pendingSeekRef.current = null;
          pendingPlayRef.current = shouldResume;
          setPlayback((prev) => {
            if (Math.abs(prev.currentTime - value) < 0.002 && prev.isPlaying === shouldResume) {
              return prev;
            }
            return { ...prev, currentTime: value, isPlaying: shouldResume };
          });
          return;
        }
        const target = clipById.get(range.clipId);
        if (!target) return;
        const offset = Math.max(0, value - target.startSec);
        const newTime = Math.min(target.trimEndSec, target.trimStartSec + offset);
        if (activeClipId !== target.id) {
          isGapPlaybackRef.current = false;
          pendingSeekRef.current = newTime;
          pendingPlayRef.current = shouldResume;
          setActiveClipId(target.id);
          setActiveMedia(target.media);
        } else {
          const mediaEl = getActiveMediaEl();
          if (mediaEl) {
            try {
              mediaEl.currentTime = newTime;
              pendingSeekRef.current = null;
              if (shouldResume && mediaEl.paused) {
                void safePlay(mediaEl);
              }
            } catch {
              // Ignore.
            }
            pendingPlayRef.current = shouldResume;
          } else {
            pendingSeekRef.current = newTime;
            pendingPlayRef.current = shouldResume;
          }
        }
        setPlayback((prev) => {
          if (Math.abs(prev.currentTime - value) < 0.002) {
            return prev;
          }
          return { ...prev, currentTime: value, isPlaying: prev.isPlaying };
        });
        return;
      }

      const mediaEl = getActiveMediaEl();
      if (!mediaEl) return;
      mediaEl.currentTime = value;
      setPlayback((prev) => {
        if (Math.abs(prev.currentTime - value) < 0.002) {
          return prev;
        }
        return { ...prev, currentTime: value, isPlaying: prev.isPlaying };
      });
    },
    [
      activeMedia,
      activeClipId,
      clipTimeline.length,
      clipById,
      duration,
      getActiveMediaEl,
      safePlay,
      setActiveClipId,
      setActiveMedia,
      timelineRanges
    ]
  );

  const scheduleScrub = useCallback(
    (value: number) => {
      if (!Number.isFinite(value)) return;
      pendingScrubRef.current = value;
      if (scrubRafRef.current !== null) return;
      scrubRafRef.current = window.requestAnimationFrame(() => {
        scrubRafRef.current = null;
        const nextValue = pendingScrubRef.current;
        pendingScrubRef.current = null;
        if (nextValue === null) return;
        const lastValue = lastScrubValueRef.current;
        if (lastValue !== null && Math.abs(nextValue - lastValue) < 0.0025) {
          return;
        }
        lastScrubValueRef.current = nextValue;
        applyScrub(nextValue);
      });
    },
    [applyScrub]
  );

  useEffect(() => {
    return () => {
      if (scrubRafRef.current !== null) {
        window.cancelAnimationFrame(scrubRafRef.current);
      }
    };
  }, []);

  const startPlayerScrub = () => {
    const wasPlaying = playback.isPlaying;
    playerScrubRef.current = { wasPlaying };
    if (wasPlaying) {
      const mediaEl = getActiveMediaEl();
      if (mediaEl) {
        try {
          mediaEl.pause();
        } catch {
          // Ignore.
        }
      }
      setPlayback((prev) => ({ ...prev, isPlaying: false }));
    }
  };

  const endPlayerScrub = () => {
    const state = playerScrubRef.current;
    if (!state) return;
    playerScrubRef.current = null;
    if (state.wasPlaying) {
      const mediaEl = getActiveMediaEl();
      if (mediaEl && mediaEl.readyState >= 1) {
        try {
          void safePlay(mediaEl);
          pendingPlayRef.current = true;
        } catch {
          // Ignore.
        }
      } else {
        pendingPlayRef.current = false;
      }
      setPlayback((prev) => ({ ...prev, isPlaying: true }));
    }
  };

  const handleClearSelection = useCallback(() => {
    dispatchSelectJob(null);
    setActiveMedia(null);
    setActiveClipId(null);
    setTimelineClips([]);
    setActivePreviewUrl(null);
    setPreviewPoster(null);
    pendingSeekRef.current = null;
    pendingPlayRef.current = false;
    setPlayback({ currentTime: 0, duration: 0, isPlaying: false });
  }, [dispatchSelectJob, setActiveClipId, setActiveMedia, setTimelineClips]);

  const handleAddToTimeline = useCallback(
    (items: MediaItem[]) => {
      if (!items.length) return;
      const supportedItems = items.filter((item) => item.kind !== "caption");
      if (!supportedItems.length) {
        notify("Caption files cannot be added to the timeline yet.", "info");
        return;
      }
      if (supportedItems.length !== items.length) {
        notify("Skipped caption files. Only audio/video clips can be added to the timeline.", "info");
      }
      const item = supportedItems[0];
      logger.debug("[handleAddToTimeline] Received item:", {
        id: item.id,
        kind: item.kind,
        streamUrl: item.streamUrl,
        previewUrl: item.previewUrl,
        externalSource: item.externalSource
      });

      if (activeMedia && activeMedia.id === item.id && activeMedia.isResolvingStream && !item.isResolvingStream) {
        if (pendingPlayRef.current || playbackRef.current.isPlaying) {
          pendingPlayRef.current = true;
          pendingPlayTargetRef.current = item.id;
        }
        setActiveMedia(item);
        setTimelineClips((prev) =>
          prev.map((clip) => (clip.media.id === item.id ? { ...clip, media: item } : clip))
        );
        return;
      }

      const base = Number.isFinite(item.durationSec) && item.durationSec ? item.durationSec : 60;
      const clipId = `${item.id}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      setTimelineClips(
        normalizeClips([
          {
            id: clipId,
            media: item,
            startSec: 0,
            baseDurationSec: base,
            durationSec: base,
            trimStartSec: 0,
            trimEndSec: base
          }
        ])
      );
      setActiveMedia(item);
      setActiveClipId(clipId);
      pendingSeekRef.current = 0;
      pendingPlayRef.current = false;
      setPlayback((prev) => ({ ...prev, currentTime: 0, isPlaying: false }));
      if (item.source === "job" && item.jobId) {
        dispatchSelectJob(item.jobId);
      } else {
        dispatchSelectJob(null);
      }
    },
    [activeMedia, dispatchSelectJob, notify, setActiveClipId, setActiveMedia, setTimelineClips]
  );

  return {
    audioRef,
    videoRefA,
    videoRefB,
    previewContainerRef,
    playback,
    setPlayback,
    playbackRate,
    setPlaybackRate,
    playbackRef,
    previewPoster,
    setPreviewPoster,
    previewPosterModeRef,
    previewPosterRef,
    activeVideoSlot,
    setActiveVideoSlot,
    previewLoading,
    previewError,
    activePreviewUrl,
    setActivePreviewUrl,
    pendingPlayRef,
    pendingPlayTargetRef,
    pendingSeekRef,
    scrubStateRef,
    playerScrubRef,
    scrubRafRef,
    pendingScrubRef,
    lastScrubValueRef,
    mediaRafActiveRef,
    pendingPlayRafRef,
    pendingSwapRef,
    isGapPlaybackRef,
    activePreviewKind,
    applyPlaybackRate,
    safePlay,
    schedulePendingPlay,
    capturePreviewPoster,
    getActiveVideoEl,
    getInactiveVideoEl,
    getActiveMediaEl,
    cyclePlaybackRate,
    transcriptMediaRef,
    localPreviewUrl,
    resolvedPreviewUrl,
    activeVideoSrc,
    audioPreviewSrc,
    showPreviewSpinner,
    externalSourceUnavailableReason,
    showYoutubeUnavailable,
    shouldShowPreviewPoster,
    nextVideoTarget,
    duration,
    previewDisabled,
    activeMediaEl,
    isMediaPlaying,
    togglePlayback,
    handlePreviewClick,
    applyScrub,
    scheduleScrub,
    startPlayerScrub,
    endPlayerScrub,
    handleClearSelection,
    handleAddToTimeline
  };
}
