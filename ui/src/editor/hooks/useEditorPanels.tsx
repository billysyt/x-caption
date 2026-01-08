import type { RefObject } from "react";
import type { UploadTabHandle } from "../../components/upload/components/UploadTab";
import type { ToastType } from "../../components/common/ToastHost";
import type { SettingsState } from "../../components/settings/settingsSlice";
import { MediaSidebar } from "../../components/upload/components/MediaSidebar";
import { useCaptionState } from "../../components/transcript/hooks/useCaptionState";
import { usePlayerState } from "../../components/player/hooks/usePlayerState";
import { useTimelineState } from "../../components/timeline/hooks/useTimelineState";
import { useActiveJobState } from "../../components/jobs/hooks/useActiveJobState";
import { useExportHandlers } from "../../components/export/hooks/useExportHandlers";
import { useMediaState } from "../../components/upload/hooks/useMediaState";
import { useOverlayState } from "../../components/layout/hooks/useOverlayState";
import { usePlaybackState } from "../../components/player/hooks/usePlaybackState";
import { useSegmentsState } from "../../components/transcript/hooks/useSegmentsState";
import { useSubtitleState } from "../../components/player/hooks/useSubtitleState";
import { useTimelineViewState } from "../../components/timeline/hooks/useTimelineViewState";
import { useTranscriptActions } from "../../components/transcript/hooks/useTranscriptActions";
import { useWindowState } from "../../components/layout/hooks/useWindowState";
import type { ConfirmModalState } from "../../components/layout/AppOverlays.types";
import type { ModelDownloadState } from "../../components/model/hooks/useModelDownload";

type EditorPanelsLayout = {
  isCompact: boolean;
  isHeaderCompact: boolean;
  compactTab: "player" | "captions";
  dragRegionClass: string;
};

type EditorPanelsUi = {
  notify: (message: string, type?: ToastType) => void;
  alertModal: { title: string; message: string; tone: ToastType } | null;
  setAlertModal: (value: { title: string; message: string; tone: ToastType } | null) => void;
  isTranscriptEdit: boolean;
  setIsTranscriptEdit: (value: boolean | ((prev: boolean) => boolean)) => void;
  isLeftDrawerOpen: boolean;
  setIsLeftDrawerOpen: (value: boolean) => void;
  isPlayerModalOpen: boolean;
  setIsPlayerModalOpen: (value: boolean) => void;
  isPlayerModalVisible: boolean;
  setIsPlayerModalVisible: (value: boolean) => void;
  showExportModal: boolean;
  setShowExportModal: (value: boolean) => void;
  showAboutModal: boolean;
  setShowAboutModal: (value: boolean) => void;
  currentSubtitle: string;
  captionControlsDisabled: boolean;
  isCantoneseLanguage: boolean;
  onLanguageChange: (value: SettingsState["language"]) => void;
  onChineseStyleChange: (value: SettingsState["chineseStyle"]) => void;
  generateCaptionLabel: string;
  isGenerateDisabled: boolean;
  handleToggleChineseVariant: () => void;
  handleSubtitleScaleDecrease: () => void;
  handleSubtitleScaleIncrease: () => void;
  toggleFullscreen: () => void;
  modelDownload: ModelDownloadState;
  modelDownloadActive: boolean;
  modelDownloadTitle: string;
  modelProgressText: string | null;
  clearModelDownload: () => void;
  handleRetryModelDownload: () => void;
  openExternalUrl: (url: string) => void;
  handleRequestFilePicker: (open: () => void) => void;
  appVersion: string | null;
};

type EditorPanelsParams = {
  settings: SettingsState;
  exportLanguage: string;
  layout: EditorPanelsLayout;
  ui: EditorPanelsUi;
  uploadRef: RefObject<UploadTabHandle>;
  windowState: ReturnType<typeof useWindowState>;
  overlayState: ReturnType<typeof useOverlayState>;
  confirmModal: ConfirmModalState | null;
  setConfirmModal: (value: ConfirmModalState | null) => void;
  mediaState: ReturnType<typeof useMediaState>;
  playbackState: ReturnType<typeof usePlaybackState>;
  timelineViewState: ReturnType<typeof useTimelineViewState>;
  subtitleState: ReturnType<typeof useSubtitleState>;
  activeJobState: ReturnType<typeof useActiveJobState>;
  segmentsState: ReturnType<typeof useSegmentsState>;
  exportHandlers: ReturnType<typeof useExportHandlers>;
  transcriptActions: ReturnType<typeof useTranscriptActions>;
};

export function useEditorPanels(params: EditorPanelsParams) {
  const {
    settings,
    exportLanguage,
    layout,
    ui,
    uploadRef,
    windowState,
    overlayState,
    confirmModal,
    setConfirmModal,
    mediaState,
    playbackState,
    timelineViewState,
    subtitleState,
    activeJobState,
    segmentsState,
    exportHandlers,
    transcriptActions
  } = params;

  const {
    isCompact,
    isHeaderCompact,
    compactTab,
    dragRegionClass
  } = layout;

  const {
    notify,
    alertModal,
    setAlertModal,
    isTranscriptEdit,
    setIsTranscriptEdit,
    isLeftDrawerOpen,
    setIsLeftDrawerOpen,
    isPlayerModalOpen,
    setIsPlayerModalOpen,
    isPlayerModalVisible,
    setIsPlayerModalVisible,
    showExportModal,
    setShowExportModal,
    showAboutModal,
    setShowAboutModal,
    currentSubtitle,
    captionControlsDisabled,
    isCantoneseLanguage,
    onLanguageChange,
    onChineseStyleChange,
    generateCaptionLabel,
    isGenerateDisabled,
    handleToggleChineseVariant,
    handleSubtitleScaleDecrease,
    handleSubtitleScaleIncrease,
    toggleFullscreen,
    modelDownload,
    modelDownloadActive,
    modelDownloadTitle,
    modelProgressText,
    clearModelDownload,
    handleRetryModelDownload,
    openExternalUrl,
    handleRequestFilePicker,
    appVersion
  } = ui;

  const { updateState, mediaImport } = overlayState;

  const {
    captionSetupPanel,
    compactCaptionsPanel,
    captionSidebarContent,
    captionSidebarModalContent
  } = useCaptionState({
    settings,
    captionControlsDisabled,
    isCantoneseLanguage,
    onLanguageChange,
    onChineseStyleChange,
    generateCaptionLabel,
    onGenerateCaptions: transcriptActions.handleGenerateCaptions,
    isGenerateDisabled,
    showCaptionSetup: segmentsState.showCaptionSetup,
    transcriptMediaRef: playbackState.transcriptMediaRef,
    notify,
    editEnabled: isTranscriptEdit
  });

  const { playerPanelProps, playerPanel, playerModalPanel } = usePlayerState({
    isCompact,
    compactTab,
    compactCaptionsPanel,
    previewContainerRef: playbackState.previewContainerRef,
    handlePreviewClick: playbackState.handlePreviewClick,
    activeMedia: mediaState.activeMedia,
    isDisplayNameEditing: mediaState.isDisplayNameEditing,
    displayNameDraft: mediaState.displayNameDraft,
    setDisplayNameDraft: mediaState.setDisplayNameDraft,
    setIsDisplayNameEditing: mediaState.setIsDisplayNameEditing,
    activeMediaDisplayName: mediaState.activeMediaDisplayName,
    commitDisplayName: mediaState.commitDisplayName,
    cancelDisplayNameEdit: mediaState.cancelDisplayNameEdit,
    showYoutubeUnavailable: playbackState.showYoutubeUnavailable,
    externalSourceUnavailableReason: playbackState.externalSourceUnavailableReason || "",
    activeVideoSrc: playbackState.activeVideoSrc,
    activeVideoSlot: playbackState.activeVideoSlot,
    nextVideoTarget: playbackState.nextVideoTarget,
    videoRefA: playbackState.videoRefA,
    videoRefB: playbackState.videoRefB,
    previewPoster: playbackState.previewPoster,
    previewPosterModeRef: playbackState.previewPosterModeRef,
    setPreviewPoster: playbackState.setPreviewPoster,
    shouldShowPreviewPoster: playbackState.shouldShowPreviewPoster,
    activePreviewKind: playbackState.activePreviewKind,
    resolvedPreviewUrl: playbackState.resolvedPreviewUrl,
    showActiveJobOverlay: activeJobState.showActiveJobOverlay,
    activeJobLabel: activeJobState.activeJobLabel,
    activeJobProgress: activeJobState.activeJobProgress,
    showPreviewSpinner: playbackState.showPreviewSpinner,
    subtitleEditor: subtitleState.subtitleEditor,
    currentSubtitle,
    subtitleBoxRef: subtitleState.subtitleBoxRef,
    subtitlePosition: subtitleState.subtitlePosition,
    subtitleDisplaySize: subtitleState.subtitleDisplaySize,
    subtitleMaxWidth: subtitleState.subtitleMaxWidth,
    handleSubtitlePointerDown: subtitleState.handleSubtitlePointerDown,
    handleSubtitlePointerMove: subtitleState.handleSubtitlePointerMove,
    handleSubtitlePointerUp: subtitleState.handleSubtitlePointerUp,
    subtitleTextStyle: subtitleState.subtitleTextStyle,
    subtitleDraft: subtitleState.subtitleDraft,
    setSubtitleDraft: subtitleState.setSubtitleDraft,
    handleSaveSubtitleEdit: subtitleState.handleSaveSubtitleEdit,
    setSubtitleEditor: subtitleState.setSubtitleEditor,
    subtitleMeasureRef: subtitleState.subtitleMeasureRef,
    subtitleFontSize: subtitleState.subtitleFontSize,
    togglePlayback: playbackState.togglePlayback,
    previewDisabled: playbackState.previewDisabled,
    isMediaPlaying: playbackState.isMediaPlaying,
    cyclePlaybackRate: playbackState.cyclePlaybackRate,
    playbackRate: playbackState.playbackRate,
    playback: playbackState.playback,
    playheadPct: timelineViewState.playheadPct,
    duration: playbackState.duration,
    scheduleScrub: playbackState.scheduleScrub,
    startPlayerScrub: playbackState.startPlayerScrub,
    endPlayerScrub: playbackState.endPlayerScrub,
    toggleFullscreen
  });

  const { timelinePanelProps } = useTimelineState({
    isCompact,
    segmentsLength: segmentsState.segments.length,
    exportLanguage,
    onClearCaptions: transcriptActions.handleClearCaptions,
    onLoadSrt: transcriptActions.handleLoadSrt,
    onToggleChineseVariant: handleToggleChineseVariant,
    onSubtitleScaleDecrease: handleSubtitleScaleDecrease,
    onSubtitleScaleIncrease: handleSubtitleScaleIncrease,
    onSplitCaption: timelineViewState.handleSplitCaption,
    activeSubtitleSegment: timelineViewState.activeSubtitleSegment,
    timelineZoom: timelineViewState.timelineZoom,
    onTimelineZoomChange: timelineViewState.setTimelineZoom,
    timelineScrollRef: timelineViewState.timelineScrollRef,
    timelineTrackRef: timelineViewState.timelineTrackRef,
    onTimelineScroll: timelineViewState.handleTimelineScroll,
    onTimelineWheel: timelineViewState.handleTimelineWheel,
    timelineScrollWidth: timelineViewState.timelineScrollWidth,
    timelineWidth: timelineViewState.timelineWidth,
    playheadLeftPx: timelineViewState.playheadLeftPx,
    ticks: timelineViewState.ticks,
    pxPerSec: timelineViewState.pxPerSec,
    onTrackPointerDown: timelineViewState.onTrackPointerDown,
    onTrackPointerMove: timelineViewState.onTrackPointerMove,
    onTrackPointerUp: timelineViewState.onTrackPointerUp,
    timelineSegmentEls: timelineViewState.timelineSegmentEls,
    gapMenu: timelineViewState.gapMenu,
    gapMenuHighlight: timelineViewState.gapMenuHighlight,
    captionMenuGapAfter: timelineViewState.captionMenuGapAfter,
    captionMenuGapHighlight: timelineViewState.captionMenuGapHighlight,
    captionHover: timelineViewState.captionHover,
    gapMenuOpenRef: timelineViewState.gapMenuOpenRef,
    onCaptionHoverMove: timelineViewState.handleCaptionHoverMove,
    onClearCaptionHover: () => timelineViewState.setCaptionHover(null),
    onAddCaption: timelineViewState.handleAddCaption,
    onGapContextMenu: timelineViewState.handleGapContextMenu
  });

  const leftPanelContent = (
    <MediaSidebar
      isCompact={isCompact}
      dragRegionClass={dragRegionClass}
      onClose={() => setIsLeftDrawerOpen(false)}
      uploadRef={uploadRef}
      notify={notify}
      localMedia={mediaState.localMedia}
      onLocalMediaChange={mediaState.setLocalMedia}
      onAddToTimeline={playbackState.handleAddToTimeline}
      onClearSelection={playbackState.handleClearSelection}
      onRequestFilePicker={handleRequestFilePicker}
    />
  );

  const headerBarProps = {
    isMac: windowState.isMac,
    isWindowFocused: windowState.isWindowFocused,
    isAltPressed: windowState.isAltPressed,
    isHeaderCompact,
    isHeaderMenuOpen: windowState.isHeaderMenuOpen,
    showCustomWindowControls: windowState.showCustomWindowControls,
    isPinned: windowState.isPinned,
    isExporting: exportHandlers.isExporting,
    isMaximized: windowState.isMaximized,
    appVersion: ui.appVersion,
    headerMenuRef: windowState.headerMenuRef,
    headerMenuButtonRef: windowState.headerMenuButtonRef,
    getHeaderDragProps: windowState.getHeaderDragProps,
    onOpenModal: mediaImport.actions.openModal,
    onTogglePinned: windowState.handleTogglePinned,
    onOpenExport: () => setShowExportModal(true),
    onOpenSupport: () => openExternalUrl("https://github.com/billysyt/x-caption"),
    onWindowAction: windowState.handleWindowAction,
    onToggleHeaderMenu: () => windowState.setIsHeaderMenuOpen((prev) => !prev),
    onCloseHeaderMenu: () => windowState.setIsHeaderMenuOpen(false)
  };

  const overlaysProps = {
    isCompact,
    isLeftDrawerOpen,
    onCloseLeftDrawer: () => setIsLeftDrawerOpen(false),
    leftPanelContent,
    isPlayerModalVisible,
    isPlayerModalOpen,
    onClosePlayerModal: () => setIsPlayerModalOpen(false),
    onPlayerModalTransitionEnd: () => setIsPlayerModalVisible(false),
    getHeaderDragProps: windowState.getHeaderDragProps,
    playerPanel: playerModalPanel,
    captionSidebarContent: captionSidebarModalContent,
    segmentsLength: segmentsState.segments.length,
    isTranscriptEdit,
    onToggleTranscriptEdit: () => setIsTranscriptEdit((prev) => !prev),
    captionMenu: timelineViewState.captionMenu,
    captionMenuPosition: timelineViewState.captionMenuPosition,
    captionMenuGapAfter: timelineViewState.captionMenuGapAfter,
    captionMenuGapHighlight: timelineViewState.captionMenuGapHighlight,
    setCaptionMenuGapHighlight: timelineViewState.setCaptionMenuGapHighlight,
    onSplitCaption: timelineViewState.handleSplitCaption,
    onDeleteCaption: timelineViewState.handleDeleteCaption,
    onOpenGapAdjust: timelineViewState.handleOpenGapAdjust,
    onCloseCaptionMenu: timelineViewState.closeCaptionMenu,
    gapMenu: timelineViewState.gapMenu,
    gapMenuPosition: timelineViewState.gapMenuPosition,
    gapMenuHighlight: timelineViewState.gapMenuHighlight,
    setGapMenuHighlight: timelineViewState.setGapMenuHighlight,
    onRemoveGap: timelineViewState.handleRemoveGap,
    onCloseGapMenu: timelineViewState.handleCloseGapMenu,
    gapAdjustModal: timelineViewState.gapAdjustModal,
    setGapAdjustModal: timelineViewState.setGapAdjustModal,
    onAdjustGapAfter: timelineViewState.handleAdjustGapAfter,
    alerts: {
      notify,
      alertModal,
      setAlertModal
    },
    confirm: {
      confirmModal,
      setConfirmModal
    },
    mediaImport,
    updates: {
      updateModal: updateState.updateModal,
      updateForceRequired: updateState.updateForceRequired,
      updateAvailable: updateState.updateAvailable,
      updateCurrentVersion: updateState.updateCurrentVersion,
      updateLatestVersion: updateState.updateLatestVersion,
      onOpenExternalUrl: openExternalUrl,
      onWindowAction: windowState.handleWindowAction,
      clearUpdateModal: () => updateState.setUpdateModal(null)
    },
    exporting: {
      showExportModal,
      setShowExportModal,
      isExporting: exportHandlers.isExporting,
      onExportSrt: exportHandlers.handleExportSrt,
      onExportTranscript: exportHandlers.handleExportTranscript
    },
    modelDownload: {
      modelDownloadActive,
      modelDownload,
      modelDownloadTitle,
      modelProgressText,
      onClearModelDownload: clearModelDownload,
      onRetryModelDownload: handleRetryModelDownload
    },
    about: {
      showAboutModal,
      setShowAboutModal,
      version: appVersion || "Unknown"
    }
  };

  return {
    captionSetupPanel,
    compactCaptionsPanel,
    captionSidebarContent,
    captionSidebarModalContent,
    playerPanelProps,
    playerPanel,
    playerModalPanel,
    timelinePanelProps,
    leftPanelContent,
    headerBarProps,
    overlaysProps
  };
}
