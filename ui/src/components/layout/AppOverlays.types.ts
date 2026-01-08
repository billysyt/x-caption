import type { MouseEvent, ReactNode } from "react";
import type { ToastType } from "../common/ToastHost";
import type { TranscriptSegment } from "../../types";

export type CaptionMenuState = {
  x: number;
  y: number;
  segment: TranscriptSegment;
};

export type GapMenuState = {
  x: number;
  y: number;
  gapStart: number;
  gapEnd: number;
};

export type GapAdjustModalState = {
  segment: TranscriptSegment;
  mode: "insert" | "remove";
  ms: string;
  maxRemoveMs: number;
  hasGap: boolean;
};

export type AlertOverlayProps = {
  notify: (message: string, type?: ToastType) => void;
  alertModal: { title: string; message: string; tone: ToastType } | null;
  setAlertModal: (value: { title: string; message: string; tone: ToastType } | null) => void;
};

export type ConfirmModalState = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  tone?: ToastType;
  onConfirm: () => void;
  onCancel?: () => void;
};

export type ConfirmOverlayProps = {
  confirmModal: ConfirmModalState | null;
  setConfirmModal: (value: ConfirmModalState | null) => void;
};

export type MediaImportOverlayProps = {
  modals: {
    showOpenModal: boolean;
    setShowOpenModal: (value: boolean) => void;
    showYoutubeModal: boolean;
    setShowYoutubeModal: (value: boolean) => void;
    showUrlDownloadModal: boolean;
    setShowUrlDownloadModal: (value: boolean) => void;
    showImportModal: boolean;
    setShowImportModal: (value: boolean) => void;
  };
  youtube: {
    importing: boolean;
    importTitle: string | null;
    url: string;
    setUrl: (value: string) => void;
    error: string | null;
    setError: (value: string | null) => void;
    isIndeterminate: boolean;
    progressValue: number;
  };
  urlDownload: {
    importing: boolean;
    importTitle: string | null;
    url: string;
    setUrl: (value: string) => void;
    savePath: string;
    setSavePath: (value: string) => void;
    error: string | null;
    setError: (value: string | null) => void;
    isIndeterminate: boolean;
    progressValue: number;
    downloadedBytes: number | null;
    totalBytes: number | null;
    totalBytesEstimate: number | null;
    fragmentIndex: number | null;
    fragmentCount: number | null;
  };
  actions: {
    openLocalFromModal: () => void;
    openYoutubeModal: () => void;
    openUrlDownloadModal: () => void;
    importYoutube: () => void;
    downloadUrl: () => void;
    cancelUrlDownload: () => void;
    openModal: () => void;
  };
};

export type UpdateOverlayProps = {
  updateModal: {
    downloadUrl: string | null;
    publishedAt: string | null;
  } | null;
  updateForceRequired: boolean;
  updateAvailable: boolean;
  updateCurrentVersion: string | null;
  updateLatestVersion: string | null;
  onOpenExternalUrl: (url: string) => void;
  onWindowAction: (action: "close" | "minimize" | "zoom" | "fullscreen") => void;
  clearUpdateModal: () => void;
};

export type ExportOverlayProps = {
  showExportModal: boolean;
  setShowExportModal: (value: boolean) => void;
  isExporting: boolean;
  onExportSrt: () => void;
  onExportTranscript: () => void;
};

export type ModelDownloadOverlayProps = {
  modelDownloadActive: boolean;
  modelDownload: {
    status: "idle" | "checking" | "downloading" | "error";
    progress: number | null;
    message: string;
    detail?: string | null;
    expectedPath?: string | null;
    downloadUrl?: string | null;
  };
  modelDownloadTitle: string;
  modelProgressText: string | null;
  onClearModelDownload: () => void;
  onRetryModelDownload: () => void;
};

export type AboutOverlayProps = {
  showAboutModal: boolean;
  setShowAboutModal: (value: boolean) => void;
  version: string;
};

export type AppOverlaysProps = {
  isCompact: boolean;
  isLeftDrawerOpen: boolean;
  onCloseLeftDrawer: () => void;
  leftPanelContent: ReactNode;
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
  captionMenu: CaptionMenuState | null;
  captionMenuPosition: { left: number; top: number } | null;
  captionMenuGapAfter: {
    hasNext: boolean;
    hasGap: boolean;
    gapStart: number;
    gapEnd: number;
  } | null;
  captionMenuGapHighlight: boolean;
  setCaptionMenuGapHighlight: (value: boolean) => void;
  onSplitCaption: (segment: TranscriptSegment) => void;
  onDeleteCaption: (segment: TranscriptSegment) => void;
  onOpenGapAdjust: (segment: TranscriptSegment, maxRemoveMs: number, hasGap: boolean) => void;
  onCloseCaptionMenu: () => void;
  gapMenu: GapMenuState | null;
  gapMenuPosition: { left: number; top: number } | null;
  gapMenuHighlight: boolean;
  setGapMenuHighlight: (value: boolean) => void;
  onRemoveGap: (gapStart: number, gapEnd: number) => void;
  onCloseGapMenu: () => void;
  gapAdjustModal: GapAdjustModalState | null;
  setGapAdjustModal: (value: GapAdjustModalState | null) => void;
  onAdjustGapAfter: (segment: TranscriptSegment, mode: "insert" | "remove", ms: number, maxRemoveMs: number) => void;
  alerts: AlertOverlayProps;
  confirm: ConfirmOverlayProps;
  mediaImport: MediaImportOverlayProps;
  updates: UpdateOverlayProps;
  exporting: ExportOverlayProps;
  modelDownload: ModelDownloadOverlayProps;
  about: AboutOverlayProps;
};
