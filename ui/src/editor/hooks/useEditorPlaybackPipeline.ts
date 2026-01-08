import { useTimelineDerivedState } from "../../components/timeline/hooks/useTimelineDerivedState";
import { usePlaybackState } from "../../components/player/hooks/usePlaybackState";
import { useTimelineViewState } from "../../components/timeline/hooks/useTimelineViewState";
import { selectJob } from "../../components/jobs/jobsSlice";
import type { AppDispatch } from "../../store";
import type { Job } from "../../types";
import type { useMediaState } from "../../components/upload/hooks/useMediaState";
import type { useSegmentsState } from "../../components/transcript/hooks/useSegmentsState";

export function useEditorPlaybackPipeline(params: {
  dispatch: AppDispatch;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  activeJob: Job | null;
  selectedJobId: string | null;
  jobsById: Record<string, Job>;
  mediaState: ReturnType<typeof useMediaState>;
  segmentsState: ReturnType<typeof useSegmentsState>;
  isOnline: boolean;
}) {
  const { dispatch, notify, activeJob, selectedJobId, jobsById, mediaState, segmentsState, isOnline } = params;

  const timelineDerived = useTimelineDerivedState({
    timelineClips: mediaState.timelineClips,
    activeClipId: mediaState.activeClipId
  });

  const playbackState = usePlaybackState({
    dispatchSelectJob: (jobId: string | null) => dispatch(selectJob(jobId)),
    notify,
    activeMedia: mediaState.activeMedia,
    setActiveMedia: mediaState.setActiveMedia,
    selectedJobId,
    timelineClips: mediaState.timelineClips,
    setTimelineClips: mediaState.setTimelineClips,
    activeClipId: mediaState.activeClipId,
    setActiveClipId: mediaState.setActiveClipId,
    localMedia: mediaState.localMedia,
    setLocalMedia: mediaState.setLocalMedia,
    clipTimeline: timelineDerived.clipTimeline,
    clipById: timelineDerived.clipById,
    timelineRanges: timelineDerived.timelineRanges,
    timelineDuration: timelineDerived.timelineDuration,
    nextClip: timelineDerived.nextClip,
    getPreviewKind: mediaState.getPreviewKind,
    resolveYoutubeStreamForMedia: mediaState.resolveYoutubeStreamForMedia,
    isOnline,
    jobsById
  });

  const timelineViewState = useTimelineViewState({
    dispatch,
    notify,
    activeJob,
    activeMedia: mediaState.activeMedia,
    jobsById,
    sortedSegments: segmentsState.sortedSegments,
    sortedDisplaySegments: segmentsState.sortedDisplaySegments,
    displaySegmentById: segmentsState.displaySegmentById,
    openCcConverter: segmentsState.openCcConverter,
    duration: playbackState.duration,
    playback: {
      currentTime: playbackState.playback.currentTime,
      isPlaying: playbackState.playback.isPlaying
    },
    setPlayback: playbackState.setPlayback,
    scheduleScrub: playbackState.scheduleScrub,
    scrubStateRef: playbackState.scrubStateRef,
    playerScrubRef: playbackState.playerScrubRef,
    startPlayerScrub: playbackState.startPlayerScrub,
    endPlayerScrub: playbackState.endPlayerScrub,
    getActiveMediaEl: playbackState.getActiveMediaEl,
    safePlay: playbackState.safePlay
  });

  return { playbackState, timelineViewState };
}
