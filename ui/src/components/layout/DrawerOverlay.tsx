import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

type DrawerOverlayProps = {
  isCompact: boolean;
  isLeftDrawerOpen: boolean;
  onCloseLeftDrawer: () => void;
  leftPanelContent: ReactNode;
};

export function DrawerOverlay({
  isCompact,
  isLeftDrawerOpen,
  onCloseLeftDrawer,
  leftPanelContent
}: DrawerOverlayProps) {
  if (!isCompact) return null;
  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-[110] bg-black/60 transition-opacity",
          isLeftDrawerOpen ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onCloseLeftDrawer}
      />
      <div
        className={cn(
          "fixed left-0 top-0 z-[111] flex h-full w-[280px] flex-col bg-[#0b0b0b] shadow-2xl transition-transform",
          isLeftDrawerOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {leftPanelContent}
      </div>
    </>
  );
}
