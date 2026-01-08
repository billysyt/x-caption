export const BASE_PX_PER_SEC = 20;
export const MIN_CLIP_DURATION_SEC = 0.5;
export const DEFAULT_TIMELINE_ZOOM = 1.75;
export const TIMELINE_LEFT_PADDING_PX = 0;
export const TIMELINE_RIGHT_PADDING_PX = 8;

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const normalizeClips = <T extends { startSec: number; durationSec: number }>(clips: T[]) => {
  const withIndex = clips.map((clip, index) => ({ clip, index }));
  withIndex.sort((a, b) => a.clip.startSec - b.clip.startSec || a.index - b.index);
  return withIndex.map(({ clip }) => ({
    ...clip,
    durationSec: Math.max(MIN_CLIP_DURATION_SEC, clip.durationSec)
  }));
};
