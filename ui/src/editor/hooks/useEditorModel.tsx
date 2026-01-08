import { useRef } from "react";
import { useAppDispatch } from "../../hooks";
import type { UploadTabHandle } from "../../components/upload/components/UploadTab";
import { useAppBootstrap } from "../../hooks/useAppBootstrap";
import { useJobPolling } from "../../components/jobs/hooks/useJobPolling";
import { useOnlineStatus } from "../../hooks/useOnlineStatus";
import { useWindowState } from "../../components/layout/hooks/useWindowState";
import { useLayoutState } from "../../components/layout/hooks/useLayoutState";
import { useModelDownload } from "../../components/model/hooks/useModelDownload";
import { useExportHandlers } from "../../components/export/hooks/useExportHandlers";
import { useSegmentsState } from "../../components/transcript/hooks/useSegmentsState";
import { useActiveJobState } from "../../components/jobs/hooks/useActiveJobState";
import { useMediaState } from "../../components/upload/hooks/useMediaState";
import { useSubtitleState } from "../../components/player/hooks/useSubtitleState";
import { useCurrentSubtitle } from "../../components/transcript/hooks/useCurrentSubtitle";
import { useSubtitleScaleActions } from "../../components/player/hooks/useSubtitleScaleActions";
import { useEditorPanels } from "./useEditorPanels";
import { useEditorUiActions } from "./useEditorUiActions";
import { useEditorUiState } from "./useEditorUiState";
import { useEditorSelectors } from "./useEditorSelectors";
import { useEditorSettingsActions } from "./useEditorSettingsActions";
import { useEditorImportState } from "./useEditorImportState";
import { useEditorPlaybackPipeline } from "./useEditorPlaybackPipeline";

export function useEditorModel() {
  const {
    settings,
    exportLanguage,
    appVersion,
    showExportModal,
    showAboutModal,
    isPlayerModalOpen,
    isPlayerModalVisible,
    isLeftDrawerOpen,
    isTranscriptEdit,
    alertModal,
    jobsById,
    jobOrder,
    selectedJobId,
    isTranscribing,
    selectedJob
  } = useEditorSelectors();

  const dispatch = useAppDispatch();
  const uploadRef = useRef<UploadTabHandle>(null);
  const srtInputRef = useRef<HTMLInputElement | null>(null);
  const isOnline = useOnlineStatus();

  useAppBootstrap(dispatch);
  useJobPolling(dispatch, jobOrder, jobsById);

  const windowState = useWindowState();
  const uiActions = useEditorUiActions({ dispatch, isTranscriptEdit, isPlayerModalOpen });

  const layoutState = useLayoutState({
    setIsLeftDrawerOpen: uiActions.setIsLeftDrawerOpen,
    setIsHeaderMenuOpen: windowState.setIsHeaderMenuOpen
  });
  const { isCompact, isHeaderCompact, compactTab, setCompactTab } = layoutState;

  const {
    modelDownload,
    ensureWhisperModelReady,
    clearModelDownload,
    handleRetryModelDownload,
    modelDownloadActive,
    modelDownloadTitle
  } = useModelDownload(uiActions.notify);

  const mediaState = useMediaState({ dispatch, notify: uiActions.notify, jobsById, isOnline });
  const activeJobState = useActiveJobState({
    selectedJob,
    activeMedia: mediaState.activeMedia,
    jobsById,
    isTranscribing
  });
  const segmentsState = useSegmentsState({ activeJob: activeJobState.activeJob, exportLanguage });

  const exportHandlers = useExportHandlers({
    exportLanguage,
    exportSegments: segmentsState.exportSegments,
    notify: uiActions.notify,
    filename: selectedJob?.filename,
    onExportComplete: () => uiActions.setShowExportModal(false),
    displayName: selectedJob?.displayName ?? null
  });

  const { playbackState, timelineViewState } = useEditorPlaybackPipeline({
    dispatch,
    notify: uiActions.notify,
    activeJob: activeJobState.activeJob,
    selectedJobId,
    jobsById,
    mediaState,
    segmentsState,
    isOnline
  });

  const uiState = useEditorUiState({
    isCompact,
    isPinned: windowState.isPinned,
    uploadRef,
    setWindowOnTop: windowState.setWindowOnTop,
    isPlayerModalOpen,
    setIsPlayerModalOpen: uiActions.setIsPlayerModalOpen,
    setIsPlayerModalVisible: uiActions.setIsPlayerModalVisible,
    setIsLeftDrawerOpen: uiActions.setIsLeftDrawerOpen,
    settings,
    isTranscribing,
    modelDownload,
    isActiveJobProcessing: activeJobState.isActiveJobProcessing,
    isAnotherJobProcessing: activeJobState.isAnotherJobProcessing
  });

  const { overlayState, transcriptActions, confirmModal, setConfirmModal } = useEditorImportState({
    dispatch,
    appVersion,
    isOnline,
    isCompact,
    notify: uiActions.notify,
    uploadRef,
    onOpenLocalPicker: uiState.handleOpenFiles,
    onOpenLeftDrawer: () => uiActions.setIsLeftDrawerOpen(true),
    activeJob: activeJobState.activeJob,
    activeMedia: mediaState.activeMedia,
    selectedJob,
    srtInputRef,
    handleRequestFilePicker: uiState.handleRequestFilePicker,
    ensureWhisperModelReady,
    timelineClipCount: mediaState.timelineClips.length
  });

  const { currentSubtitleMatch, currentSubtitle } = useCurrentSubtitle({
    activeSubtitleSegment: timelineViewState.activeSubtitleSegment,
    openCcConverter: segmentsState.openCcConverter
  });

  const subtitleState = useSubtitleState({
    dispatch,
    notify: uiActions.notify,
    selectedJobId,
    selectedJobUiStateRef: activeJobState.selectedJobUiStateRef,
    activeMedia: mediaState.activeMedia,
    previewContainerRef: playbackState.previewContainerRef,
    getActiveMediaEl: playbackState.getActiveMediaEl,
    currentSubtitle,
    currentSubtitleMatch,
    isCompact,
    compactTab,
    isPlayerModalOpen
  });

  const subtitleScaleActions = useSubtitleScaleActions(subtitleState.setSubtitleScale);
  const { handleToggleChineseVariant, onLanguageChange, onChineseStyleChange } =
    useEditorSettingsActions({ dispatch, exportLanguage });

  const panels = useEditorPanels({
    settings,
    exportLanguage,
    layout: {
      isCompact,
      isHeaderCompact,
      compactTab,
      dragRegionClass: windowState.dragRegionClass
    },
    ui: {
      notify: uiActions.notify,
      alertModal,
      setAlertModal: uiActions.setAlertModal,
      isTranscriptEdit,
      setIsTranscriptEdit: uiActions.setIsTranscriptEdit,
      isLeftDrawerOpen,
      setIsLeftDrawerOpen: uiActions.setIsLeftDrawerOpen,
      isPlayerModalOpen,
      setIsPlayerModalOpen: uiActions.setIsPlayerModalOpen,
      isPlayerModalVisible,
      setIsPlayerModalVisible: uiActions.setIsPlayerModalVisible,
      showExportModal,
      setShowExportModal: uiActions.setShowExportModal,
      showAboutModal,
      setShowAboutModal: uiActions.setShowAboutModal,
      currentSubtitle,
      captionControlsDisabled: uiState.captionControlsDisabled,
      isCantoneseLanguage: uiState.isCantoneseLanguage,
      onLanguageChange,
      onChineseStyleChange,
      generateCaptionLabel: uiState.generateCaptionLabel,
      isGenerateDisabled: uiState.isGenerateDisabled,
      handleToggleChineseVariant,
      handleSubtitleScaleDecrease: subtitleScaleActions.handleSubtitleScaleDecrease,
      handleSubtitleScaleIncrease: subtitleScaleActions.handleSubtitleScaleIncrease,
      toggleFullscreen: uiState.toggleFullscreen,
      modelDownload,
      modelDownloadActive,
      modelDownloadTitle,
      modelProgressText: uiState.modelProgressText,
      clearModelDownload,
      handleRetryModelDownload,
      openExternalUrl: uiState.openExternalUrl,
      handleRequestFilePicker: uiState.handleRequestFilePicker,
      appVersion
    },
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
  });

  return {
    settings,
    exportLanguage,
    appVersion,
    showExportModal,
    showAboutModal,
    isPlayerModalOpen,
    isPlayerModalVisible,
    isLeftDrawerOpen,
    isTranscriptEdit,
    alertModal,
    jobsById,
    jobOrder,
    selectedJobId,
    selectedJob,
    isTranscribing,
    uploadRef,
    srtInputRef,
    isOnline,
    layoutClass: uiState.layoutClass,
    modelProgressText: uiState.modelProgressText,
    captionControlsDisabled: uiState.captionControlsDisabled,
    isCantoneseLanguage: uiState.isCantoneseLanguage,
    generateCaptionLabel: uiState.generateCaptionLabel,
    isGenerateDisabled: uiState.isGenerateDisabled,
    handleOpenFiles: uiState.handleOpenFiles,
    handleRequestFilePicker: uiState.handleRequestFilePicker,
    toggleFullscreen: uiState.toggleFullscreen,
    handleToggleChineseVariant,
    handleSubtitleScaleDecrease: subtitleScaleActions.handleSubtitleScaleDecrease,
    handleSubtitleScaleIncrease: subtitleScaleActions.handleSubtitleScaleIncrease,
    currentSubtitleMatch,
    currentSubtitle,
    modelDownload,
    modelDownloadActive,
    modelDownloadTitle,
    ensureWhisperModelReady,
    clearModelDownload,
    handleRetryModelDownload,
    setShowExportModal: uiActions.setShowExportModal,
    setShowAboutModal: uiActions.setShowAboutModal,
    setIsPlayerModalOpen: uiActions.setIsPlayerModalOpen,
    setIsPlayerModalVisible: uiActions.setIsPlayerModalVisible,
    setIsLeftDrawerOpen: uiActions.setIsLeftDrawerOpen,
    setIsTranscriptEdit: uiActions.setIsTranscriptEdit,
    ...panels,
    ...windowState,
    ...mediaState,
    ...activeJobState,
    ...segmentsState,
    ...exportHandlers,
    ...playbackState,
    ...timelineViewState,
    ...subtitleState,
    ...transcriptActions,
    ...layoutState
  };
}

export type EditorModel = ReturnType<typeof useEditorModel>;
