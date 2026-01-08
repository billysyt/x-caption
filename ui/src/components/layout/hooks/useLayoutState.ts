import { useEffect, useState } from "react";

export function useLayoutState(params: {
  setIsLeftDrawerOpen: (value: boolean) => void;
  setIsHeaderMenuOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
}) {
  const { setIsLeftDrawerOpen, setIsHeaderMenuOpen } = params;
  const [isCompact, setIsCompact] = useState(false);
  const [isHeaderCompact, setIsHeaderCompact] = useState(false);
  const [compactTab, setCompactTab] = useState<"player" | "captions">("player");

  useEffect(() => {
    if (!isHeaderCompact) {
      setIsHeaderMenuOpen(false);
    }
  }, [isHeaderCompact, setIsHeaderMenuOpen]);

  useEffect(() => {
    const update = () => {
      const compact = window.innerWidth < 1100;
      const headerCompact = window.innerWidth < 500;
      setIsCompact(compact);
      setIsHeaderCompact(headerCompact);
      if (!compact) {
        setIsLeftDrawerOpen(false);
        setCompactTab("player");
      }
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [setIsLeftDrawerOpen]);

  return {
    isCompact,
    isHeaderCompact,
    compactTab,
    setCompactTab
  };
}
