import { useCallback, useEffect } from "react";
import {
  setAlertModal as setAlertModalAction,
  setIsLeftDrawerOpen as setIsLeftDrawerOpenAction,
  setIsPlayerModalOpen as setIsPlayerModalOpenAction,
  setIsPlayerModalVisible as setIsPlayerModalVisibleAction,
  setIsTranscriptEdit as setIsTranscriptEditAction,
  setShowExportModal as setShowExportModalAction,
  setShowAboutModal as setShowAboutModalAction
} from "../../components/layout/uiSlice";
import type { ToastType } from "../../components/common/ToastHost";
import type { AppDispatch } from "../../store";

type EditorUiActionsParams = {
  dispatch: AppDispatch;
  isTranscriptEdit: boolean;
  isPlayerModalOpen: boolean;
};

export function useEditorUiActions(params: EditorUiActionsParams) {
  const { dispatch, isTranscriptEdit, isPlayerModalOpen } = params;

  const setAlertModal = useCallback(
    (value: { title: string; message: string; tone: ToastType } | null) => {
      dispatch(setAlertModalAction(value));
    },
    [dispatch]
  );

  const notify = useCallback(
    (message: string, type: ToastType = "info") => {
      const title =
        type === "error" ? "Something went wrong" : type === "success" ? "Done" : "Notice";
      setAlertModal({ title, message, tone: type });
    },
    [setAlertModal]
  );

  const setShowExportModal = useCallback(
    (value: boolean) => {
      dispatch(setShowExportModalAction(value));
    },
    [dispatch]
  );

  const setShowAboutModal = useCallback(
    (value: boolean) => {
      dispatch(setShowAboutModalAction(value));
    },
    [dispatch]
  );

  const setIsPlayerModalOpen = useCallback(
    (value: boolean) => {
      dispatch(setIsPlayerModalOpenAction(value));
    },
    [dispatch]
  );

  const setIsPlayerModalVisible = useCallback(
    (value: boolean) => {
      dispatch(setIsPlayerModalVisibleAction(value));
    },
    [dispatch]
  );

  const setIsLeftDrawerOpen = useCallback(
    (value: boolean) => {
      dispatch(setIsLeftDrawerOpenAction(value));
    },
    [dispatch]
  );

  const setIsTranscriptEdit = useCallback(
    (value: boolean | ((prev: boolean) => boolean)) => {
      const next = typeof value === "function" ? value(isTranscriptEdit) : value;
      dispatch(setIsTranscriptEditAction(next));
    },
    [dispatch, isTranscriptEdit]
  );

  useEffect(() => {
    if (!isPlayerModalOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsPlayerModalOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlayerModalOpen, setIsPlayerModalOpen]);

  useEffect(() => {
    if (isPlayerModalOpen) {
      setIsPlayerModalVisible(true);
    }
  }, [isPlayerModalOpen, setIsPlayerModalVisible]);

  return {
    setAlertModal,
    notify,
    setShowExportModal,
    setShowAboutModal,
    setIsPlayerModalOpen,
    setIsPlayerModalVisible,
    setIsLeftDrawerOpen,
    setIsTranscriptEdit
  };
}
