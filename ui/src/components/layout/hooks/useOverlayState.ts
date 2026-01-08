import { useMediaImport } from "../../mediaImport/hooks/useMediaImport";
import { useUpdateCheck } from "../../updates/hooks/useUpdateCheck";
import type { UploadTabHandle } from "../../upload/components/UploadTab";
import type { RefObject } from "react";

export function useOverlayState(params: {
  appVersion: string | null;
  isOnline: boolean;
  notify: (message: string, type?: "info" | "success" | "error") => void;
  isCompact: boolean;
  uploadRef: RefObject<UploadTabHandle>;
  onOpenLocalPicker: () => void;
  onOpenLeftDrawer: () => void;
}) {
  const { appVersion, isOnline, notify, isCompact, uploadRef, onOpenLocalPicker, onOpenLeftDrawer } = params;

  const updateState = useUpdateCheck(appVersion);
  const mediaImport = useMediaImport({
    isCompact,
    uploadRef,
    onOpenLocalPicker,
    onOpenLeftDrawer
  });

  return {
    updateState,
    mediaImport
  };
}
