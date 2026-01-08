import { useMemo, type CSSProperties, type PointerEvent, type ReactNode, type RefObject } from "react";
import { AppIcon } from "../../../components/common/AppIcon";
import { cn } from "../../../lib/cn";
import { formatTime } from "../../../lib/format";
import type { MediaItem } from "../../upload/components/UploadTab";

export type PlayerPanelProps = {
  isModal: boolean;
  isCompact: boolean;
  compactTab: "player" | "captions";
  compactCaptionsPanel: ReactNode;
  previewContainerRef: RefObject<HTMLDivElement>;
  handlePreviewClick: () => void;
  activeMedia: MediaItem | null;
  isDisplayNameEditing: boolean;
  displayNameDraft: string;
  setDisplayNameDraft: (value: string) => void;
  setIsDisplayNameEditing: (value: boolean) => void;
  activeMediaDisplayName: string;
  commitDisplayName: () => void | Promise<void>;
  cancelDisplayNameEdit: () => void;
  showYoutubeUnavailable: boolean;
  externalSourceUnavailableReason: string;
  activeVideoSrc: string | null;
  activeVideoSlot: 0 | 1;
  nextVideoTarget: { url?: string | null } | null;
  videoRefA: RefObject<HTMLVideoElement>;
  videoRefB: RefObject<HTMLVideoElement>;
  previewPoster: string | null;
  previewPosterModeRef: RefObject<"paused" | null>;
  setPreviewPoster: (value: string | null) => void;
  shouldShowPreviewPoster: boolean;
  activePreviewKind: string | null;
  resolvedPreviewUrl: string | null;
  showActiveJobOverlay: boolean;
  activeJobLabel: string;
  activeJobProgress: number | null;
  showPreviewSpinner: boolean;
  subtitleEditor: { segmentId: number; text: string } | null;
  currentSubtitle: string;
  subtitleBoxRef: RefObject<HTMLDivElement>;
  subtitlePosition: { x: number; y: number };
  subtitleDisplaySize: { width: number; height: number };
  subtitleMaxWidth: number;
  handleSubtitlePointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  handleSubtitlePointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  handleSubtitlePointerUp: (event: PointerEvent<HTMLDivElement>) => void;
  subtitleTextStyle: CSSProperties;
  subtitleDraft: string;
  setSubtitleDraft: (value: string) => void;
  handleSaveSubtitleEdit: () => void | Promise<void>;
  setSubtitleEditor: (value: { segmentId: number; text: string } | null) => void;
  subtitleMeasureRef: RefObject<HTMLSpanElement>;
  subtitleFontSize: number;
  togglePlayback: () => void;
  previewDisabled: boolean;
  isMediaPlaying: boolean;
  cyclePlaybackRate: () => void;
  playbackRate: number;
  playback: { currentTime: number; duration: number; isPlaying: boolean };
  playheadPct: number;
  duration: number;
  scheduleScrub: (value: number) => void;
  startPlayerScrub: () => void;
  endPlayerScrub: () => void;
  toggleFullscreen: () => void;
};

export function PlayerPanel({
  isModal,
  isCompact,
  compactTab,
  compactCaptionsPanel,
  previewContainerRef,
  handlePreviewClick,
  activeMedia,
  isDisplayNameEditing,
  displayNameDraft,
  setDisplayNameDraft,
  setIsDisplayNameEditing,
  activeMediaDisplayName,
  commitDisplayName,
  cancelDisplayNameEdit,
  showYoutubeUnavailable,
  externalSourceUnavailableReason,
  activeVideoSrc,
  activeVideoSlot,
  nextVideoTarget,
  videoRefA,
  videoRefB,
  previewPoster,
  previewPosterModeRef,
  setPreviewPoster,
  shouldShowPreviewPoster,
  activePreviewKind,
  resolvedPreviewUrl,
  showActiveJobOverlay,
  activeJobLabel,
  activeJobProgress,
  showPreviewSpinner,
  subtitleEditor,
  currentSubtitle,
  subtitleBoxRef,
  subtitlePosition,
  subtitleDisplaySize,
  subtitleMaxWidth,
  handleSubtitlePointerDown,
  handleSubtitlePointerMove,
  handleSubtitlePointerUp,
  subtitleTextStyle,
  subtitleDraft,
  setSubtitleDraft,
  handleSaveSubtitleEdit,
  setSubtitleEditor,
  subtitleMeasureRef,
  subtitleFontSize,
  togglePlayback,
  previewDisabled,
  isMediaPlaying,
  cyclePlaybackRate,
  playbackRate,
  playback,
  playheadPct,
  duration,
  scheduleScrub,
  startPlayerScrub,
  endPlayerScrub,
  toggleFullscreen
}: PlayerPanelProps) {
  const showCompactCaptions = useMemo(
    () => !isModal && isCompact && compactTab === "captions",
    [compactTab, isCompact, isModal]
  );

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col items-center justify-center gap-2",
        isModal ? "p-4" : "p-2"
      )}
    >
      {showCompactCaptions ? (
        <div className="flex min-h-0 w-full flex-1">{compactCaptionsPanel}</div>
      ) : (
        <>
          <div
            className="relative flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden"
            ref={previewContainerRef}
          >
            <div
              className="stt-video-frame relative h-full w-full overflow-hidden rounded-xl bg-black"
              onClick={handlePreviewClick}
            >
              {activeMedia ? (
                <div
                  className="pointer-events-auto absolute left-1/2 top-3 z-20 -translate-x-1/2"
                  data-no-toggle
                >
                  {isDisplayNameEditing ? (
                    <input
                      className="w-[min(70vw,420px)] rounded-md border border-white/15 bg-black/70 px-3 py-1 text-center text-[12px] font-medium text-white outline-none focus:border-primary/70"
                      value={displayNameDraft}
                      placeholder={activeMediaDisplayName || activeMedia.displayName || activeMedia.name || "Display name"}
                      onChange={(e) => setDisplayNameDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") {
                          e.preventDefault();
                          void commitDisplayName();
                        } else if (e.key === "Escape") {
                          e.preventDefault();
                          cancelDisplayNameEdit();
                        }
                      }}
                      onBlur={() => void commitDisplayName()}
                      autoFocus
                      aria-label="Edit display name"
                    />
                  ) : (
                    <button
                      type="button"
                      className="inline-flex max-w-[min(70vw,420px)] items-center rounded-md border border-white/10 bg-black/60 px-3 py-1 text-[12px] font-medium text-white/90 shadow hover:border-white/25"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsDisplayNameEditing(true);
                      }}
                      title="Click to rename"
                    >
                      <span className="truncate">{activeMediaDisplayName}</span>
                    </button>
                  )}
                </div>
              ) : null}
              {showYoutubeUnavailable ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-4 px-6 text-center text-slate-300">
                  <div className="flex h-20 w-20 items-center justify-center">
                    <svg
                      viewBox="0 0 120 120"
                      className="h-14 w-14 text-slate-200/80"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="3"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <rect x="18" y="26" width="84" height="52" rx="12" />
                      <path d="M50 44l22 12-22 12z" fill="currentColor" opacity="0.15" />
                      <path d="M32 94h56" />
                      <path d="M30 34l60 52" />
                    </svg>
                  </div>
                  <div className="text-[15px] font-semibold text-slate-100">Video preview unavailable</div>
                  <div className="max-w-[360px] text-[12px] text-slate-400">{externalSourceUnavailableReason}</div>
                </div>
              ) : activeVideoSrc ? (
                <>
                  <video
                    src={activeVideoSlot === 0 ? activeVideoSrc : nextVideoTarget?.url ?? undefined}
                    ref={videoRefA}
                    playsInline
                    preload="auto"
                    muted={activeVideoSlot !== 0}
                    poster={activeVideoSlot === 0 ? previewPoster ?? undefined : undefined}
                    onLoadedData={() => {
                      if (previewPosterModeRef.current !== "paused") {
                        setPreviewPoster(null);
                      }
                    }}
                    className={cn(
                      "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity",
                      activeVideoSlot === 0 ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <video
                    src={activeVideoSlot === 1 ? activeVideoSrc : nextVideoTarget?.url ?? undefined}
                    ref={videoRefB}
                    playsInline
                    preload="auto"
                    muted={activeVideoSlot !== 1}
                    poster={activeVideoSlot === 1 ? previewPoster ?? undefined : undefined}
                    onLoadedData={() => {
                      if (previewPosterModeRef.current !== "paused") {
                        setPreviewPoster(null);
                      }
                    }}
                    className={cn(
                      "pointer-events-none absolute inset-0 h-full w-full object-contain transition-opacity",
                      activeVideoSlot === 1 ? "opacity-100" : "opacity-0"
                    )}
                  />
                  {shouldShowPreviewPoster ? (
                    <img
                      src={previewPoster ?? undefined}
                      alt=""
                      className="pointer-events-none absolute inset-0 h-full w-full object-contain"
                    />
                  ) : null}
                </>
              ) : activePreviewKind === "audio" && resolvedPreviewUrl ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-6 text-xs text-slate-500">
                  <AppIcon name="volume" className="text-2xl" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">Audio Preview</span>
                </div>
              ) : activeMedia ? (
                <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-xs text-slate-500">
                  <AppIcon name={activePreviewKind === "audio" ? "volume" : "video"} className="text-2xl" />
                  <span className="text-[11px] uppercase tracking-[0.2em] text-slate-500">
                    {activePreviewKind === "audio" ? "Audio Preview" : "Preview"}
                  </span>
                  {activeMedia.source === "job" && activeMedia.kind === "video" ? (
                    <span className="text-[10px] text-slate-500">Video preview not available yet</span>
                  ) : null}
                </div>
              ) : (
                <div className="h-full w-full bg-black" />
              )}
              {showActiveJobOverlay ? (
                <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center p-4">
                  <div className="w-full max-w-[360px] rounded-2xl border border-white/10 bg-black/65 p-6 text-center shadow-[0_24px_60px_rgba(0,0,0,0.55)] backdrop-blur-md">
                    <div className="mx-auto flex items-center justify-center">
                      <div className="processing-spinner" aria-hidden>
                        <span className="processing-bar processing-bar-1" />
                        <span className="processing-bar processing-bar-2" />
                        <span className="processing-bar processing-bar-3" />
                        <span className="processing-bar processing-bar-4" />
                      </div>
                    </div>
                    <div className="mt-4 text-sm font-semibold text-slate-100">{activeJobLabel}</div>
                    <div className="mt-4">
                      <div className="h-2 w-full overflow-hidden rounded-full bg-white/15">
                        <div
                          className={cn(
                            "h-full rounded-full bg-white transition-[width] duration-200",
                            activeJobProgress === null && "animate-pulse"
                          )}
                          style={{
                            width: `${Math.max(4, Math.min(100, activeJobProgress ?? 18))}%`
                          }}
                        />
                      </div>
                      <div className="mt-2 text-[11px] font-semibold text-white/90">
                        {activeJobProgress !== null ? `${activeJobProgress}%` : "Preparing..."}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
              {showPreviewSpinner ? (
                <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/35 backdrop-blur-[1px]">
                  <AppIcon name="spinner" spin className="text-[20px] text-white/80" />
                </div>
              ) : null}
              {subtitleEditor || currentSubtitle ? (
                <div
                  ref={subtitleBoxRef}
                  className={cn(
                    "absolute z-10 rounded-md px-3 py-1",
                    subtitleEditor ? "cursor-move border border-white/35 resize overflow-hidden" : "cursor-move"
                  )}
                  data-no-toggle
                  style={{
                    left: `${subtitlePosition.x * 100}%`,
                    top: `${subtitlePosition.y * 100}%`,
                    transform: "translate(-50%, -50%)",
                    width: subtitleDisplaySize.width ? `${subtitleDisplaySize.width}px` : undefined,
                    height: subtitleDisplaySize.height ? `${subtitleDisplaySize.height}px` : undefined,
                    maxWidth: `${subtitleMaxWidth}px`,
                    minWidth: "140px",
                    minHeight: "36px"
                  }}
                  onPointerDown={handleSubtitlePointerDown}
                  onPointerMove={handleSubtitlePointerMove}
                  onPointerUp={handleSubtitlePointerUp}
                  onPointerCancel={handleSubtitlePointerUp}
                >
                  {subtitleEditor ? (
                    <textarea
                      className="h-full w-full resize-none bg-transparent text-center text-[13px] font-medium text-white outline-none cursor-text"
                      style={subtitleTextStyle}
                      value={subtitleDraft}
                      onChange={(e) => setSubtitleDraft(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Escape") {
                          e.preventDefault();
                          setSubtitleEditor(null);
                        } else if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
                          e.preventDefault();
                          void handleSaveSubtitleEdit();
                        }
                      }}
                      onBlur={() => void handleSaveSubtitleEdit()}
                      autoFocus
                      aria-label="Edit subtitle"
                    />
                  ) : (
                    <div
                      className="whitespace-normal break-words text-[13px] font-medium text-white pointer-events-none text-center"
                      style={subtitleTextStyle}
                    >
                      {currentSubtitle}
                    </div>
                  )}
                </div>
              ) : null}
              <span
                ref={subtitleMeasureRef}
                className="pointer-events-none absolute -z-10 opacity-0 whitespace-normal break-words"
                style={{
                  fontSize: `${subtitleFontSize}px`,
                  fontWeight: 500,
                  lineHeight: "1.2",
                  maxWidth: `${subtitleMaxWidth}px`
                }}
              />
            </div>
          </div>
          <div className="flex w-full shrink-0 items-center gap-3 px-2 py-1">
            <button
              className={cn(
                "flex h-8 w-8 items-center justify-center rounded-md text-slate-200 transition",
                previewDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-white/10"
              )}
              onClick={togglePlayback}
              disabled={previewDisabled}
              type="button"
            >
              <AppIcon name={isMediaPlaying ? "pause" : "play"} className="text-[12px]" />
            </button>
            <button
              className={cn(
                "flex h-8 w-12 items-center justify-center rounded-md px-2 text-[11px] font-semibold tabular-nums text-slate-200 transition",
                previewDisabled ? "cursor-not-allowed opacity-50" : "hover:bg-white/10"
              )}
              onClick={cyclePlaybackRate}
              disabled={previewDisabled}
              type="button"
              aria-label="Playback speed"
              title="Playback speed"
            >
              {`${playbackRate}X`}
            </button>
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <span className="text-[11px] text-slate-400 tabular-nums">{formatTime(playback.currentTime)}</span>
              <div className="relative flex-1">
                <div className="h-1 rounded-full bg-[#2a2a30]">
                  <div className="h-full rounded-full bg-primary" style={{ width: `${playheadPct}%` }} />
                </div>
                <input
                  type="range"
                  min={0}
                  max={Math.max(0, duration)}
                  value={Math.min(playback.currentTime, duration || 0)}
                  onChange={(event) => scheduleScrub(Number(event.target.value))}
                  onPointerDown={startPlayerScrub}
                  onPointerUp={endPlayerScrub}
                  onPointerCancel={endPlayerScrub}
                  onPointerLeave={endPlayerScrub}
                  className="absolute inset-0 h-4 w-full cursor-pointer opacity-0"
                  disabled={previewDisabled}
                />
              </div>
              <span className="text-[11px] text-slate-400 tabular-nums">{formatTime(duration)}</span>
            </div>
            <button
              className="flex h-8 w-8 items-center justify-center rounded-md text-slate-200 transition hover:bg-white/10"
              onClick={toggleFullscreen}
              type="button"
              aria-label={isModal ? "縮小" : "Zoom"}
              title={isModal ? "縮小" : "Zoom"}
            >
              <AppIcon name={isModal ? "compress" : "expand"} className="text-[12px]" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}
