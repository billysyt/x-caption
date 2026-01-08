import type { Job, TranscriptSegment } from "../types";

export function isBlankAudioText(value: string) {
  const cleaned = value.trim().toUpperCase();
  return !cleaned || cleaned === "[BLANK_AUDIO]";
}

export function deriveJobSegments(job: Job | null): TranscriptSegment[] {
  if (!job) return [];
  if (job.streamingSegments && job.streamingSegments.length > 0) return job.streamingSegments;
  if (job.result && job.result.segments) return job.result.segments;
  if (job.partialResult && job.partialResult.segments) return job.partialResult.segments;
  return [];
}

export function findSegmentAtTime<T extends { start: number; end: number }>(segments: T[], time: number): T | null {
  if (!segments.length || !Number.isFinite(time)) return null;
  let lo = 0;
  let hi = segments.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (segments[mid].start <= time) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx < 0) return null;
  const segment = segments[idx];
  if (time >= segment.start && time < segment.end) return segment;
  return null;
}
