import type { MouseEvent, ReactNode } from "react";
import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";

type PlayerModalOverlayProps = {
  isPlayerModalVisible: boolean;
  isPlayerModalOpen: boolean;
  onClosePlayerModal: () => void;
  onPlayerModalTransitionEnd: () => void;
  getHeaderDragProps: (baseClass: string) => {
    className: string;
    onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  };
  playerPanel: ReactNode;
  captionSidebarContent: ReactNode;
  segmentsLength: number;
  isTranscriptEdit: boolean;
  onToggleTranscriptEdit: () => void;
};

export function PlayerModalOverlay({
  isPlayerModalVisible,
  isPlayerModalOpen,
  onClosePlayerModal,
  onPlayerModalTransitionEnd,
  getHeaderDragProps,
  playerPanel,
  captionSidebarContent,
  segmentsLength,
  isTranscriptEdit,
  onToggleTranscriptEdit
}: PlayerModalOverlayProps) {
  if (!isPlayerModalVisible) return null;
  return (
    <div
      className={cn(
        "fixed inset-0 z-[140] flex flex-col bg-[#0b0b0b] transform-gpu transition-[opacity,transform] duration-200 ease-out",
        isPlayerModalOpen ? "opacity-100 scale-100" : "pointer-events-none opacity-0 scale-[0.98]"
      )}
      onTransitionEnd={(event) => {
        if (event.currentTarget !== event.target) return;
        if (!isPlayerModalOpen) {
          onPlayerModalTransitionEnd();
        }
      }}
      aria-hidden={!isPlayerModalOpen}
    >
      <div {...getHeaderDragProps("flex items-center justify-between border-b border-slate-800/60 px-4 py-3") }>
        <div className="text-xs font-semibold text-slate-200">Player Focus</div>
        <button
          className="pywebview-no-drag inline-flex h-7 items-center gap-1.5 rounded-md bg-[#1b1b22] px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
          onClick={onClosePlayerModal}
          type="button"
        >
          <AppIcon name="times" className="text-[10px]" />
          Close
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex min-h-0 flex-1">{playerPanel}</div>
        <aside className="flex min-h-0 w-full flex-col border-t border-slate-800/60 bg-[#0b0b0b] lg:w-[380px] lg:border-l lg:border-t-0">
          <div className="flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-200">
            <span>Caption Setting</span>
            {segmentsLength > 0 ? (
              <button
                className={cn(
                  "pywebview-no-drag inline-flex items-center gap-2 text-[10px] font-medium transition",
                  isTranscriptEdit ? "text-slate-200" : "text-slate-500"
                )}
                onClick={onToggleTranscriptEdit}
                type="button"
              >
                <AppIcon name="edit" className="text-[11px]" />
                Edit
                <span
                  className={cn(
                    "relative inline-flex h-4 w-7 items-center rounded-full border transition",
                    isTranscriptEdit ? "border-slate-500 bg-[#1b1b22]" : "border-slate-700 bg-[#151515]"
                  )}
                >
                  <span
                    className={cn(
                      "absolute h-3 w-3 rounded-full bg-white transition",
                      isTranscriptEdit ? "translate-x-3" : "translate-x-1"
                    )}
                  />
                </span>
              </button>
            ) : null}
          </div>
          <div className="min-h-0 flex-1 px-3 py-3">{captionSidebarContent}</div>
        </aside>
      </div>
    </div>
  );
}
