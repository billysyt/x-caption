import { useOverlayState } from "../../components/layout/hooks/useOverlayState";
import { useTranscriptActions } from "../../components/transcript/hooks/useTranscriptActions";
import { useState, type RefObject } from "react";
import type { UploadTabHandle } from "../../components/upload/components/UploadTab";
import type { AppDispatch } from "../../store";
import type { Job } from "../../types";
import type { MediaItem } from "../../components/upload/components/UploadTab";
import type { ConfirmModalState } from "../../components/layout/AppOverlays.types";

export function useEditorImportState(params: {
  dispatch: AppDispatch;
  appVersion: string | null;
  isOnline: boolean;
  isCompact: boolean;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  uploadRef: RefObject<UploadTabHandle>;
  onOpenLocalPicker: () => void;
  onOpenLeftDrawer: () => void;
  activeJob: Job | null;
  activeMedia: MediaItem | null;
  selectedJob: Job | null;
  srtInputRef: RefObject<HTMLInputElement | null>;
  handleRequestFilePicker: (open: () => void) => void;
  ensureWhisperModelReady: () => Promise<boolean>;
  timelineClipCount: number;
}) {
  const {
    dispatch,
    appVersion,
    isOnline,
    isCompact,
    notify,
    uploadRef,
    onOpenLocalPicker,
    onOpenLeftDrawer,
    activeJob,
    activeMedia,
    selectedJob,
    srtInputRef,
    handleRequestFilePicker,
    ensureWhisperModelReady,
    timelineClipCount
  } = params;

  const [confirmModal, setConfirmModal] = useState<ConfirmModalState | null>(null);

  const overlayState = useOverlayState({
    appVersion,
    isOnline,
    notify,
    isCompact,
    uploadRef,
    onOpenLocalPicker,
    onOpenLeftDrawer
  });

  const transcriptActions = useTranscriptActions({
    dispatch,
    notify,
    activeJob,
    activeMedia,
    selectedJob,
    srtInputRef,
    uploadRef,
    handleRequestFilePicker,
    ensureWhisperModelReady,
    setShowImportModal: overlayState.mediaImport.modals.setShowImportModal,
    timelineClipCount
  });

  return { overlayState, transcriptActions, confirmModal, setConfirmModal };
}
