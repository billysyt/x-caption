import type { AppState } from "../../hooks/useAppState";
import { HeaderBar } from "./HeaderBar";
import { TimelinePanel } from "../timeline/components/TimelinePanel";
import { AppOverlays } from "./AppOverlays";
import { AppIcon } from "../common/AppIcon";
import { cn } from "../../lib/cn";

export function AppShell(props: AppState) {
  const {
    layoutClass,
    isCompact,
    dragRegionClass,
    setIsLeftDrawerOpen,
    compactTab,
    setCompactTab,
    segments,
    isTranscriptEdit,
    setIsTranscriptEdit,
    playerPanel,
    leftPanelContent,
    captionSidebarContent,
    timelinePanelProps,
    isPlayerModalVisible,
    headerBarProps,
    overlaysProps,
    srtInputRef,
    handleSrtSelected,
    audioRef,
    audioPreviewSrc
  } = props;

  return (
    <>
      <div className="flex h-full w-full flex-col bg-[#0b0b0b] text-slate-100">
        <HeaderBar {...headerBarProps} />
        <div className={cn(layoutClass, "flex-1")}>
          {!isCompact ? (
            <aside className="relative z-10 row-start-1 row-end-2 flex min-h-0 min-w-0 flex-col bg-[#0b0b0b]">
              {leftPanelContent}
            </aside>
          ) : null}

          <section className="relative z-0 row-start-1 row-end-2 flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#0b0b0b]">
            <div
              className={cn(
                dragRegionClass,
                "flex shrink-0 items-center justify-between px-4 py-2 text-xs text-slate-400"
              )}
            >
              <div className="flex items-center gap-2">
                {isCompact ? (
                  <button
                    className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#1b1b22] text-[10px] text-slate-200 transition hover:bg-[#26262f]"
                    onClick={() => setIsLeftDrawerOpen(true)}
                    type="button"
                    aria-label="Menu"
                    title="Menu"
                  >
                    <AppIcon name="bars" />
                  </button>
                ) : null}
              </div>
              {isCompact ? (
                <div className="flex flex-col items-end gap-1">
                  <div className="flex items-center gap-1">
                    <button
                      className={cn(
                        "pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] transition",
                        compactTab === "player"
                          ? "bg-primary text-white"
                          : "bg-[#1b1b22] text-slate-300 hover:bg-[#26262f]"
                      )}
                      onClick={() => setCompactTab("player")}
                      type="button"
                      aria-label="Video"
                      title="Video"
                    >
                      <AppIcon name="video" />
                    </button>
                    <button
                      className={cn(
                        "pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] transition",
                        compactTab === "captions"
                          ? "bg-primary text-white"
                          : "bg-[#1b1b22] text-slate-300 hover:bg-[#26262f]"
                      )}
                      onClick={() => setCompactTab("captions")}
                      type="button"
                      aria-label="Captions"
                      title="Captions"
                    >
                      <AppIcon name="captions" />
                    </button>
                  </div>
                  {compactTab === "captions" && segments.length > 0 ? (
                    <button
                      className={cn(
                        "pywebview-no-drag inline-flex items-center gap-2 text-[10px] font-medium transition",
                        isTranscriptEdit ? "text-slate-200" : "text-slate-500"
                      )}
                      onClick={() => setIsTranscriptEdit((prev) => !prev)}
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
              ) : null}
            </div>
            {isPlayerModalVisible ? null : playerPanel}
          </section>

          {!isCompact ? (
            <aside className="relative z-10 row-start-1 row-end-2 flex min-h-0 flex-col overflow-hidden bg-[#0b0b0b]">
              <div
                className={cn(
                  dragRegionClass,
                  "flex items-center justify-between px-4 py-3 text-xs font-semibold text-slate-200"
                )}
              >
                <span>Caption Setting</span>
                {segments.length > 0 ? (
                  <button
                    className={cn(
                      "pywebview-no-drag inline-flex items-center gap-2 text-[10px] font-medium transition",
                      isTranscriptEdit ? "text-slate-200" : "text-slate-500"
                    )}
                    onClick={() => setIsTranscriptEdit((prev) => !prev)}
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
          ) : null}

          <TimelinePanel
            {...timelinePanelProps}
          />
        </div>
      </div>

      <AppOverlays {...overlaysProps} />

      <input
        ref={srtInputRef}
        type="file"
        accept=".srt,application/x-subrip,text/plain"
        className="hidden"
        onChange={() => {
          const file = srtInputRef.current?.files?.[0];
          if (file) {
            void handleSrtSelected(file);
          }
          if (srtInputRef.current) {
            srtInputRef.current.value = "";
          }
        }}
      />
      <audio ref={audioRef} preload="auto" src={audioPreviewSrc || undefined} className="sr-only" />
    </>
  );
}
