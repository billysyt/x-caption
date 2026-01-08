import type { AppOverlaysProps } from "./AppOverlays.types";
import { DrawerOverlay } from "./DrawerOverlay";
import { PlayerModalOverlay } from "../player/components/PlayerModalOverlay";
import { CaptionMenuOverlay } from "../timeline/components/CaptionMenuOverlay";
import { GapMenuOverlay } from "../timeline/components/GapMenuOverlay";
import { GapAdjustModalOverlay } from "../timeline/components/GapAdjustModalOverlay";
import { AlertModalOverlay } from "../common/AlertModalOverlay";
import { ConfirmModalOverlay } from "../common/ConfirmModalOverlay";
import { OpenMediaModal } from "../mediaImport/components/OpenMediaModal";
import { YoutubeImportModal } from "../mediaImport/components/YoutubeImportModal";
import { UrlDownloadModal } from "../mediaImport/components/UrlDownloadModal";
import { UpdateModalOverlay } from "../updates/components/UpdateModalOverlay";
import { ExportModalOverlay } from "../export/components/ExportModalOverlay";
import { ModelDownloadModalOverlay } from "../model/components/ModelDownloadModalOverlay";
import { ImportPromptModal } from "../mediaImport/components/ImportPromptModal";
import { AboutModalOverlay } from "../about/components/AboutModalOverlay";

export function AppOverlays({
  isCompact,
  isLeftDrawerOpen,
  onCloseLeftDrawer,
  leftPanelContent,
  isPlayerModalVisible,
  isPlayerModalOpen,
  onClosePlayerModal,
  onPlayerModalTransitionEnd,
  getHeaderDragProps,
  playerPanel,
  captionSidebarContent,
  segmentsLength,
  isTranscriptEdit,
  onToggleTranscriptEdit,
  captionMenu,
  captionMenuPosition,
  captionMenuGapAfter,
  captionMenuGapHighlight,
  setCaptionMenuGapHighlight,
  onSplitCaption,
  onDeleteCaption,
  onOpenGapAdjust,
  onCloseCaptionMenu,
  gapMenu,
  gapMenuPosition,
  setGapMenuHighlight,
  onRemoveGap,
  onCloseGapMenu,
  gapAdjustModal,
  setGapAdjustModal,
  onAdjustGapAfter,
  alerts,
  confirm,
  mediaImport,
  updates,
  exporting,
  modelDownload,
  about
}: AppOverlaysProps) {
  const { notify, alertModal, setAlertModal } = alerts;
  const { confirmModal, setConfirmModal } = confirm;
  const {
    modals: {
      showOpenModal,
      setShowOpenModal,
      showYoutubeModal,
      setShowYoutubeModal,
      showUrlDownloadModal,
      setShowUrlDownloadModal,
      showImportModal,
      setShowImportModal
    },
    youtube: {
      importing: youtubeImporting,
      importTitle: youtubeImportTitle,
      url: youtubeUrl,
      setUrl: setYoutubeUrl,
      error: youtubeError,
      setError: setYoutubeError,
      isIndeterminate: isYoutubeIndeterminate,
      progressValue: youtubeProgressValue
    },
    urlDownload: {
      importing: urlDownloadImporting,
      importTitle: urlDownloadTitle,
      url: urlDownloadUrl,
      setUrl: setUrlDownloadUrl,
      savePath: urlDownloadSavePath,
      setSavePath: setUrlDownloadSavePath,
      error: urlDownloadError,
      setError: setUrlDownloadError,
      isIndeterminate: isUrlDownloadIndeterminate,
      progressValue: urlDownloadProgressValue,
      downloadedBytes: urlDownloadDownloadedBytes,
      totalBytes: urlDownloadTotalBytes,
      totalBytesEstimate: urlDownloadTotalBytesEstimate,
      fragmentIndex: urlDownloadFragmentIndex,
      fragmentCount: urlDownloadFragmentCount
    },
    actions: {
      openLocalFromModal: handleOpenLocalFromModal,
      openYoutubeModal: handleOpenYoutubeModal,
      importYoutube: handleImportYoutube,
      openUrlDownloadModal: handleOpenUrlDownloadModal,
      downloadUrl: handleDownloadUrl,
      cancelUrlDownload: handleCancelUrlDownload,
      openModal: handleOpenModal
    }
  } = mediaImport;

  const {
    updateModal,
    updateForceRequired,
    updateAvailable,
    updateCurrentVersion,
    updateLatestVersion,
    onOpenExternalUrl,
    onWindowAction,
    clearUpdateModal
  } = updates;

  const { showExportModal, setShowExportModal, isExporting, onExportSrt, onExportTranscript } = exporting;

  const {
    modelDownloadActive,
    modelDownload: modelDownloadState,
    modelDownloadTitle,
    modelProgressText,
    onClearModelDownload,
    onRetryModelDownload
  } = modelDownload;

  const { showAboutModal, setShowAboutModal, version } = about;

  return (
    <>
      <DrawerOverlay
        isCompact={isCompact}
        isLeftDrawerOpen={isLeftDrawerOpen}
        onCloseLeftDrawer={onCloseLeftDrawer}
        leftPanelContent={leftPanelContent}
      />

      <PlayerModalOverlay
        isPlayerModalVisible={isPlayerModalVisible}
        isPlayerModalOpen={isPlayerModalOpen}
        onClosePlayerModal={onClosePlayerModal}
        onPlayerModalTransitionEnd={onPlayerModalTransitionEnd}
        getHeaderDragProps={getHeaderDragProps}
        playerPanel={playerPanel}
        captionSidebarContent={captionSidebarContent}
        segmentsLength={segmentsLength}
        isTranscriptEdit={isTranscriptEdit}
        onToggleTranscriptEdit={onToggleTranscriptEdit}
      />

      <CaptionMenuOverlay
        captionMenu={captionMenu}
        captionMenuPosition={captionMenuPosition}
        captionMenuGapAfter={captionMenuGapAfter}
        captionMenuGapHighlight={captionMenuGapHighlight}
        setCaptionMenuGapHighlight={setCaptionMenuGapHighlight}
        onSplitCaption={onSplitCaption}
        onDeleteCaption={onDeleteCaption}
        onOpenGapAdjust={onOpenGapAdjust}
        onCloseCaptionMenu={onCloseCaptionMenu}
      />

      <GapMenuOverlay
        gapMenu={gapMenu}
        gapMenuPosition={gapMenuPosition}
        setGapMenuHighlight={setGapMenuHighlight}
        onRemoveGap={onRemoveGap}
        onCloseGapMenu={onCloseGapMenu}
      />

      <GapAdjustModalOverlay
        gapAdjustModal={gapAdjustModal}
        setGapAdjustModal={setGapAdjustModal}
        notify={notify}
        onAdjustGapAfter={onAdjustGapAfter}
      />

      <AlertModalOverlay alertModal={alertModal} setAlertModal={setAlertModal} />
      <ConfirmModalOverlay confirmModal={confirmModal} setConfirmModal={setConfirmModal} />

      <OpenMediaModal
        showOpenModal={showOpenModal}
        youtubeImporting={youtubeImporting}
        urlDownloadImporting={urlDownloadImporting}
        onOpenLocalFromModal={handleOpenLocalFromModal}
        onOpenYoutubeModal={handleOpenYoutubeModal}
        onOpenUrlDownloadModal={handleOpenUrlDownloadModal}
        setShowOpenModal={setShowOpenModal}
      />

      <YoutubeImportModal
        isOpen={showYoutubeModal || youtubeImporting}
        youtubeImporting={youtubeImporting}
        youtubeImportTitle={youtubeImportTitle}
        youtubeUrl={youtubeUrl}
        setYoutubeUrl={setYoutubeUrl}
        youtubeError={youtubeError}
        setYoutubeError={setYoutubeError}
        isYoutubeIndeterminate={isYoutubeIndeterminate}
        youtubeProgressValue={youtubeProgressValue}
        onImportYoutube={handleImportYoutube}
        setShowYoutubeModal={setShowYoutubeModal}
      />

      <UrlDownloadModal
        isOpen={showUrlDownloadModal || urlDownloadImporting}
        urlDownloadImporting={urlDownloadImporting}
        urlDownloadTitle={urlDownloadTitle}
        url={urlDownloadUrl}
        setUrl={setUrlDownloadUrl}
        savePath={urlDownloadSavePath}
        setSavePath={setUrlDownloadSavePath}
        urlDownloadError={urlDownloadError}
        setUrlDownloadError={setUrlDownloadError}
        isUrlDownloadIndeterminate={isUrlDownloadIndeterminate}
        urlDownloadProgressValue={urlDownloadProgressValue}
        downloadedBytes={urlDownloadDownloadedBytes}
        totalBytes={urlDownloadTotalBytes}
        totalBytesEstimate={urlDownloadTotalBytesEstimate}
        fragmentIndex={urlDownloadFragmentIndex}
        fragmentCount={urlDownloadFragmentCount}
        onDownloadUrl={handleDownloadUrl}
        onCancelUrlDownload={handleCancelUrlDownload}
        setShowUrlDownloadModal={setShowUrlDownloadModal}
      />

      <UpdateModalOverlay
        updateModal={updateModal}
        updateForceRequired={updateForceRequired}
        updateAvailable={updateAvailable}
        updateCurrentVersion={updateCurrentVersion}
        updateLatestVersion={updateLatestVersion}
        onOpenExternalUrl={onOpenExternalUrl}
        onWindowAction={onWindowAction}
        clearUpdateModal={clearUpdateModal}
      />

      <ExportModalOverlay
        showExportModal={showExportModal}
        setShowExportModal={setShowExportModal}
        isExporting={isExporting}
        onExportSrt={onExportSrt}
        onExportTranscript={onExportTranscript}
      />

      <ModelDownloadModalOverlay
        modelDownloadActive={modelDownloadActive}
        modelDownload={modelDownloadState}
        modelDownloadTitle={modelDownloadTitle}
        modelProgressText={modelProgressText}
        onClearModelDownload={onClearModelDownload}
        onRetryModelDownload={onRetryModelDownload}
      />

      <ImportPromptModal
        showImportModal={showImportModal}
        setShowImportModal={setShowImportModal}
        onOpenModal={handleOpenModal}
      />

      <AboutModalOverlay
        showAboutModal={showAboutModal}
        setShowAboutModal={setShowAboutModal}
        version={version}
      />
    </>
  );
}


export type {
  AppOverlaysProps,
  CaptionMenuState,
  GapMenuState,
  GapAdjustModalState,
  AlertOverlayProps,
  ConfirmOverlayProps,
  ConfirmModalState,
  MediaImportOverlayProps,
  UpdateOverlayProps,
  ExportOverlayProps,
  ModelDownloadOverlayProps,
  AboutOverlayProps
} from "./AppOverlays.types";
