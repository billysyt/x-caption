import { useCallback } from "react";

type SubtitleScaleSetter = (updater: (value: number) => number) => void;

export function useSubtitleScaleActions(setSubtitleScale: SubtitleScaleSetter) {
  const handleSubtitleScaleDecrease = useCallback(() => {
    setSubtitleScale((value) => Math.max(0.8, Number((value - 0.15).toFixed(2))));
  }, [setSubtitleScale]);

  const handleSubtitleScaleIncrease = useCallback(() => {
    setSubtitleScale((value) => Math.min(2.4, Number((value + 0.15).toFixed(2))));
  }, [setSubtitleScale]);

  return { handleSubtitleScaleDecrease, handleSubtitleScaleIncrease };
}
