import { useMemo } from "react";
import type { TranscriptSegment } from "../../../types";

type SubtitleMatch = { segment: TranscriptSegment; text: string } | null;

type CurrentSubtitleParams = {
  activeSubtitleSegment: TranscriptSegment | null;
  openCcConverter: ((input: string) => string) | null;
};

export function useCurrentSubtitle(params: CurrentSubtitleParams) {
  const { activeSubtitleSegment, openCcConverter } = params;

  const currentSubtitleMatch: SubtitleMatch = useMemo(() => {
    if (!activeSubtitleSegment) return null;
    const rawText = activeSubtitleSegment.originalText ?? activeSubtitleSegment.text ?? "";
    let text = rawText;
    if (openCcConverter) {
      try {
        text = openCcConverter(rawText);
      } catch {
        text = rawText;
      }
    }
    return { segment: activeSubtitleSegment, text: text.trim() };
  }, [activeSubtitleSegment, openCcConverter]);

  return {
    currentSubtitleMatch,
    currentSubtitle: currentSubtitleMatch?.text ?? ""
  };
}
