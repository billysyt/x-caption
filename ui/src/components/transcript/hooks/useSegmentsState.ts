import { useMemo } from "react";
import type { ExportLanguage, Job, TranscriptSegment } from "../../../types";
import { deriveJobSegments, isBlankAudioText } from "../../../lib/transcript";
import { safeOpenCcConverter } from "../../../lib/opencc";

export function useSegmentsState(params: { activeJob: Job | null; exportLanguage: ExportLanguage }) {
  const { activeJob, exportLanguage } = params;

  const segments =
    activeJob?.result?.segments ||
    activeJob?.partialResult?.segments ||
    activeJob?.streamingSegments ||
    [];

  const showCaptionSetup = segments.length === 0;

  const sortedSegments = useMemo(
    () =>
      [...segments]
        .map((seg) => ({
          ...seg,
          start: Number(seg.start) || 0,
          end: Number(seg.end) || 0
        }))
        .sort((a, b) => a.start - b.start),
    [segments]
  );

  const displaySegments = useMemo(
    () =>
      segments.filter((segment) => {
        const rawText = String(segment.originalText ?? segment.text ?? "");
        return !isBlankAudioText(rawText);
      }),
    [segments]
  );

  const sortedDisplaySegments = useMemo(
    () =>
      [...displaySegments]
        .map((seg) => ({
          ...seg,
          start: Number.isFinite(Number(seg.start)) ? Number(seg.start) : 0,
          end: Number.isFinite(Number(seg.end)) ? Number(seg.end) : 0
        }))
        .sort((a, b) => a.start - b.start),
    [displaySegments]
  );

  const displaySegmentById = useMemo(() => {
    const map = new Map<number, TranscriptSegment>();
    sortedDisplaySegments.forEach((segment) => {
      map.set(Number(segment.id), segment);
    });
    return map;
  }, [sortedDisplaySegments]);

  const exportSegments = useMemo(
    () =>
      deriveJobSegments(activeJob ?? undefined).filter((segment) => {
        const rawText = String(segment?.originalText ?? segment?.text ?? "");
        return !isBlankAudioText(rawText);
      }),
    [activeJob]
  );

  const openCcConverter = useMemo(() => safeOpenCcConverter(exportLanguage), [exportLanguage]);

  return {
    segments,
    showCaptionSetup,
    sortedSegments,
    displaySegments,
    sortedDisplaySegments,
    displaySegmentById,
    exportSegments,
    openCcConverter
  };
}
