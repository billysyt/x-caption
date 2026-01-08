import { useCallback, useEffect, useRef, useState } from "react";
import type { AppDispatch } from "../../../store";
import type { Job } from "../../../types";
import type { MediaItem } from "../components/UploadTab";
import type { TimelineClip } from "../../timeline/hooks/useTimelineDerivedState";
import { useUpsertJobRecordMutation } from "../../../api/jobsApi";
import { useResolveYoutubeStreamMutation } from "../../../api/youtubeApi";
import { updateJobDisplayName, updateJobUiState } from "../../jobs/jobsSlice";
import { stripFileExtension } from "../../../lib/utils";
import { getJobUiState } from "../../../lib/jobUiState";

type MediaStateParams = {
  dispatch: AppDispatch;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  jobsById: Record<string, Job>;
  isOnline: boolean;
};

export function useMediaState(params: MediaStateParams) {
  const { dispatch, notify, jobsById, isOnline } = params;

  const [localMedia, setLocalMedia] = useState<MediaItem[]>([]);
  const [timelineClips, setTimelineClips] = useState<TimelineClip[]>([]);
  const [activeMedia, setActiveMedia] = useState<MediaItem | null>(null);
  const [activeClipId, setActiveClipId] = useState<string | null>(null);
  const [isDisplayNameEditing, setIsDisplayNameEditing] = useState(false);
  const [displayNameDraft, setDisplayNameDraft] = useState("");
  const youtubeResolveAttemptRef = useRef<Record<string, number>>({});
  const [resolveYoutubeStream] = useResolveYoutubeStreamMutation();
  const [upsertJobRecord] = useUpsertJobRecordMutation();

  const isUnsupportedYoutubeStreamUrl = useCallback((streamUrl?: string | null) => {
    if (!streamUrl) return false;
    const lowered = streamUrl.toLowerCase();
    return lowered.includes("manifest/hls_playlist") || lowered.includes(".m3u8");
  }, []);

  const getPreviewKind = useCallback(
    (media?: MediaItem | null) => {
      if (!media) return null;
      // During YouTube stream resolution, return "video" so video element is rendered
      // and ready to load when resolution completes
      if (media.externalSource?.type === "youtube" && media.isResolvingStream) {
        return "video";
      }
      if (media.externalSource?.type === "youtube" && (media.streamError || !isOnline)) {
        return media.kind;
      }
      return media.streamUrl ? "video" : media.kind;
    },
    [isOnline]
  );

  const applyMediaUpdate = useCallback(
    (next: MediaItem) => {
      setActiveMedia(next);
      setTimelineClips((prev) =>
        prev.map((clip) => (clip.media.id === next.id ? { ...clip, media: next } : clip))
      );
      if (next.source === "local") {
        setLocalMedia((prev) => prev.map((item) => (item.id === next.id ? next : item)));
      }
    },
    [setLocalMedia, setTimelineClips]
  );

  const resolveYoutubeStreamForMedia = useCallback(
    async (media: MediaItem) => {
      if (!media || media.externalSource?.type !== "youtube") return;
      const url = media.externalSource.url ?? null;
      if (!url) {
        const failed: MediaItem = {
          ...media,
          streamUrl: null,
          isResolvingStream: false,
          streamError: "Missing YouTube URL for this item."
        };
        applyMediaUpdate(failed);
        return;
      }
      const now = Date.now();
      const lastAttempt = youtubeResolveAttemptRef.current[media.id] ?? 0;
      if (now - lastAttempt < 4000) return;
      youtubeResolveAttemptRef.current[media.id] = now;

      const fallbackPreviewUrl = media.localPath
        ? `/media?path=${encodeURIComponent(media.localPath)}`
        : media.previewUrl ?? null;

      const pending: MediaItem = {
        ...media,
        previewUrl: fallbackPreviewUrl,
        streamUrl: null,
        isResolvingStream: true,
        streamError: null
      };
      applyMediaUpdate(pending);

      try {
        const payload = await resolveYoutubeStream(url).unwrap();
        const streamUrl = typeof payload.stream_url === "string" ? payload.stream_url : null;
        if (!streamUrl) {
          throw new Error("Failed to resolve YouTube stream.");
        }
        if (isUnsupportedYoutubeStreamUrl(streamUrl)) {
          const nextSource = {
            type: "youtube" as const,
            url,
            streamUrl: null,
            title: payload.source?.title ?? media.externalSource?.title ?? null,
            id: payload.source?.id ?? media.externalSource?.id ?? null,
            thumbnailUrl:
              typeof payload.thumbnail_url === "string"
                ? payload.thumbnail_url
                : media.externalSource?.thumbnailUrl ?? null
          };
          const failed: MediaItem = {
            ...media,
            previewUrl: fallbackPreviewUrl,
            streamUrl: null,
            externalSource: nextSource,
            isResolvingStream: false,
            streamError: "YouTube preview uses an unsupported stream format. Playing audio instead."
          };
          applyMediaUpdate(failed);
          if (failed.source === "job" && failed.jobId) {
            const job = jobsById[failed.jobId];
            const existingUiState = getJobUiState(job);
            const nextUiState = {
              ...existingUiState,
              mediaSource: nextSource,
              mediaSourceError: failed.streamError
            };
            dispatch(updateJobUiState({ jobId: failed.jobId, uiState: nextUiState }));
            void upsertJobRecord({ job_id: failed.jobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
          }
          return;
        }
        const nextSource = {
          type: "youtube" as const,
          url,
          streamUrl,
          title: payload.source?.title ?? media.externalSource?.title ?? null,
          id: payload.source?.id ?? media.externalSource?.id ?? null,
          thumbnailUrl:
            typeof payload.thumbnail_url === "string"
              ? payload.thumbnail_url
              : media.externalSource?.thumbnailUrl ?? null
        };
        const resolved: MediaItem = {
          ...media,
          previewUrl: streamUrl,
          streamUrl,
          externalSource: nextSource,
          isResolvingStream: false,
          streamError: null
        };
        applyMediaUpdate(resolved);
        if (resolved.source === "job" && resolved.jobId) {
          const job = jobsById[resolved.jobId];
          const existingUiState = getJobUiState(job);
          const nextUiState = {
            ...existingUiState,
            mediaSource: nextSource,
            mediaSourceError: null
          };
          dispatch(updateJobUiState({ jobId: resolved.jobId, uiState: nextUiState }));
          void upsertJobRecord({ job_id: resolved.jobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextSource = {
          type: "youtube" as const,
          url,
          streamUrl: null,
          title: media.externalSource?.title ?? null,
          id: media.externalSource?.id ?? null,
          thumbnailUrl: media.externalSource?.thumbnailUrl ?? null
        };
        const failed: MediaItem = {
          ...media,
          previewUrl: fallbackPreviewUrl,
          streamUrl: null,
          externalSource: nextSource,
          isResolvingStream: false,
          streamError: message || "Unable to reach YouTube right now. Please try again later."
        };
        applyMediaUpdate(failed);
        if (failed.source === "job" && failed.jobId) {
          const job = jobsById[failed.jobId];
          const existingUiState = getJobUiState(job);
          const nextUiState = {
            ...existingUiState,
            mediaSource: nextSource,
            mediaSourceError: failed.streamError
          };
          dispatch(updateJobUiState({ jobId: failed.jobId, uiState: nextUiState }));
          void upsertJobRecord({ job_id: failed.jobId, ui_state: nextUiState }).unwrap().catch(() => undefined);
        }
      }
    },
    [applyMediaUpdate, dispatch, isUnsupportedYoutubeStreamUrl, jobsById, resolveYoutubeStream, upsertJobRecord]
  );

  const activeMediaDisplayName = activeMedia
    ? activeMedia.source === "job" && activeMedia.jobId
      ? jobsById[activeMedia.jobId]?.displayName ??
        jobsById[activeMedia.jobId]?.filename ??
        activeMedia.displayName ??
        activeMedia.name ??
        ""
      : activeMedia.displayName ?? activeMedia.name ?? ""
    : "";

  useEffect(() => {
    setIsDisplayNameEditing(false);
  }, [activeMedia?.id]);

  useEffect(() => {
    if (!activeMedia) {
      setIsDisplayNameEditing(false);
      setDisplayNameDraft("");
      return;
    }
    if (!isDisplayNameEditing) {
      setDisplayNameDraft(activeMediaDisplayName || activeMedia.displayName || activeMedia.name || "");
    }
  }, [activeMedia?.id, activeMediaDisplayName, isDisplayNameEditing]);

  const commitDisplayName = useCallback(async () => {
    if (!activeMedia) return;
    const trimmed = displayNameDraft.trim();
    const nextName = trimmed || activeMediaDisplayName || activeMedia.name || "";
    setIsDisplayNameEditing(false);
    setDisplayNameDraft(nextName);

    if (!nextName || nextName === activeMediaDisplayName) {
      return;
    }

    setActiveMedia((prev) =>
      prev && prev.id === activeMedia.id ? { ...prev, displayName: nextName } : prev
    );
    setTimelineClips((prev) =>
      prev.map((clip) =>
        clip.media.id === activeMedia.id ? { ...clip, media: { ...clip.media, displayName: nextName } } : clip
      )
    );

    if (activeMedia.source === "local") {
      setLocalMedia((prev) =>
        prev.map((item) => (item.id === activeMedia.id ? { ...item, displayName: nextName } : item))
      );
      if (activeMedia.jobId && activeMedia.localPath) {
        try {
          await upsertJobRecord({
            job_id: activeMedia.jobId,
            filename: activeMedia.name,
            display_name: nextName,
            media_path: activeMedia.localPath,
            media_kind: activeMedia.kind,
            status: "imported"
          }).unwrap();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          notify(`Failed to save display name: ${message}`, "error");
        }
      }
      return;
    }

    if (activeMedia.source === "job" && activeMedia.jobId) {
      dispatch(updateJobDisplayName({ jobId: activeMedia.jobId, displayName: nextName }));
      try {
        const filename = jobsById[activeMedia.jobId]?.filename ?? activeMedia.name ?? null;
        await upsertJobRecord({ job_id: activeMedia.jobId, filename, display_name: nextName }).unwrap();
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        notify(`Failed to save display name: ${message}`, "error");
      }
    }
  }, [
    activeMedia,
    activeMediaDisplayName,
    displayNameDraft,
    dispatch,
    jobsById,
    notify,
    upsertJobRecord,
    setLocalMedia,
    setTimelineClips
  ]);

  const cancelDisplayNameEdit = useCallback(() => {
    setIsDisplayNameEditing(false);
    setDisplayNameDraft(activeMediaDisplayName || activeMedia?.displayName || activeMedia?.name || "");
  }, [activeMedia?.displayName, activeMedia?.name, activeMediaDisplayName]);

  return {
    localMedia,
    setLocalMedia,
    timelineClips,
    setTimelineClips,
    activeMedia,
    setActiveMedia,
    activeClipId,
    setActiveClipId,
    activeMediaDisplayName,
    isDisplayNameEditing,
    setIsDisplayNameEditing,
    displayNameDraft,
    setDisplayNameDraft,
    youtubeResolveAttemptRef,
    getPreviewKind,
    applyMediaUpdate,
    resolveYoutubeStreamForMedia,
    commitDisplayName,
    cancelDisplayNameEdit
  };
}
