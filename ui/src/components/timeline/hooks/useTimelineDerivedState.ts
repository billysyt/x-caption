import { useMemo } from "react";
import type { MediaItem } from "../../upload/components/UploadTab";
import { clamp, MIN_CLIP_DURATION_SEC } from "../../../lib/timeline";

export type TimelineClip = {
  id: string;
  media: MediaItem;
  startSec: number;
  baseDurationSec: number;
  durationSec: number;
  trimStartSec: number;
  trimEndSec: number;
};

export function useTimelineDerivedState(params: {
  timelineClips: TimelineClip[];
  activeClipId: string | null;
}) {
  const { timelineClips, activeClipId } = params;

  const orderedClips = useMemo(
    () => [...timelineClips].sort((a, b) => a.startSec - b.startSec),
    [timelineClips]
  );

  const clipTimeline = useMemo(
    () =>
      orderedClips.map((clip) => {
        const rawBase =
          Number.isFinite(clip.baseDurationSec) && clip.baseDurationSec > 0 ? clip.baseDurationSec : clip.durationSec;
        const safeBase = Math.max(MIN_CLIP_DURATION_SEC, Number(rawBase) || MIN_CLIP_DURATION_SEC);
        const trimStart = clamp(clip.trimStartSec, 0, Math.max(0, safeBase - MIN_CLIP_DURATION_SEC));
        const maxDuration = Math.max(MIN_CLIP_DURATION_SEC, safeBase - trimStart);
        const durationSec = clamp(clip.durationSec, MIN_CLIP_DURATION_SEC, maxDuration);
        const trimEnd = trimStart + durationSec;
        const startSec = Math.max(0, clip.startSec);
        return {
          ...clip,
          startSec,
          durationSec,
          trimStartSec: trimStart,
          trimEndSec: trimEnd,
          baseDurationSec: safeBase
        };
      }),
    [orderedClips]
  );

  const timelineDuration = clipTimeline.reduce((max, clip) => Math.max(max, clip.startSec + clip.durationSec), 0);

  const clipById = useMemo(() => {
    const map = new Map<string, (typeof clipTimeline)[number]>();
    clipTimeline.forEach((clip) => map.set(clip.id, clip));
    return map;
  }, [clipTimeline]);

  const nextClip = useMemo(() => {
    if (!activeClipId) return null;
    const index = clipTimeline.findIndex((clip) => clip.id === activeClipId);
    if (index < 0 || index >= clipTimeline.length - 1) return null;
    return clipTimeline[index + 1];
  }, [activeClipId, clipTimeline]);

  const timelineRanges = useMemo(() => {
    const ranges: Array<
      | { type: "clip"; startSec: number; durationSec: number; clipId: string }
      | { type: "gap"; startSec: number; durationSec: number }
    > = [];
    let cursor = 0;
    clipTimeline.forEach((clip) => {
      if (clip.startSec > cursor + 0.01) {
        ranges.push({ type: "gap", startSec: cursor, durationSec: clip.startSec - cursor });
      }
      ranges.push({
        type: "clip",
        startSec: clip.startSec,
        durationSec: clip.durationSec,
        clipId: clip.id
      });
      cursor = clip.startSec + clip.durationSec;
    });
    return ranges;
  }, [clipTimeline]);

  return {
    orderedClips,
    clipTimeline,
    timelineDuration,
    clipById,
    nextClip,
    timelineRanges
  };
}
