import { useCallback, useState } from "react";
import type { WhisperModelDownload, WhisperModelStatus } from "../../../types";
import {
  useLazyGetWhisperModelStatusQuery,
  useStartWhisperModelDownloadMutation,
  useLazyGetWhisperModelDownloadQuery
} from "../../../api/modelApi";

export type ModelDownloadState = {
  status: "idle" | "checking" | "downloading" | "error";
  progress: number | null;
  message: string;
  detail?: string | null;
  expectedPath?: string | null;
  downloadUrl?: string | null;
  downloadId?: string | null;
  downloadedBytes?: number | null;
  totalBytes?: number | null;
};

export function useModelDownload(notify: (message: string, type?: "info" | "success" | "error") => void) {
  const [modelDownload, setModelDownload] = useState<ModelDownloadState>({
    status: "idle",
    progress: null,
    message: "",
    downloadedBytes: null,
    totalBytes: null
  });
  const [getWhisperModelStatus] = useLazyGetWhisperModelStatusQuery();
  const [startWhisperModelDownload] = useStartWhisperModelDownloadMutation();
  const [getWhisperModelDownload] = useLazyGetWhisperModelDownloadQuery();

  const ensureWhisperModelReady = useCallback(async () => {
    if (modelDownload.status === "checking" || modelDownload.status === "downloading") {
      return false;
    }

    let statusPayload: WhisperModelStatus | null = null;
    let expectedPath: string | null = null;
    let downloadUrl: string | null = null;
    try {
      setModelDownload({
        status: "checking",
        progress: null,
        message: "Checking model...",
        downloadedBytes: null,
        totalBytes: null
      });

      statusPayload = await getWhisperModelStatus(undefined).unwrap();
      if (statusPayload.ready) {
        setModelDownload({
          status: "idle",
          progress: null,
          message: "",
          downloadedBytes: null,
          totalBytes: null
        });
        return true;
      }

      const startPayload = await startWhisperModelDownload().unwrap();
      if (startPayload.status === "ready") {
        setModelDownload({
          status: "idle",
          progress: null,
          message: "",
          downloadedBytes: null,
          totalBytes: null
        });
        return true;
      }
      const downloadId = startPayload.download_id;
      if (!downloadId) {
        throw new Error("Failed to start model download.");
      }
      expectedPath = startPayload.expected_path ?? statusPayload.expected_path ?? null;
      downloadUrl = startPayload.download_url ?? statusPayload.download_url ?? null;

      const initialProgress =
        typeof startPayload.progress === "number" ? Math.round(startPayload.progress) : null;

      setModelDownload({
        status: "downloading",
        progress: initialProgress,
        message: "Downloading model...",
        expectedPath,
        downloadUrl,
        downloadId,
        downloadedBytes: startPayload.downloaded_bytes ?? null,
        totalBytes: startPayload.total_bytes ?? null
      });

      let current: WhisperModelDownload = startPayload;
      while (current.status !== "completed") {
        if (current.status === "failed") {
          throw new Error(current.error || "Model download failed.");
        }
        await new Promise((resolve) => setTimeout(resolve, 500));
        current = await getWhisperModelDownload(downloadId).unwrap();
        const nextProgress = typeof current.progress === "number" ? Math.round(current.progress) : null;
        setModelDownload((prev) => ({
          status: "downloading",
          progress: nextProgress,
          message: prev.message || "Downloading model...",
          expectedPath: current.expected_path ?? prev.expectedPath ?? null,
          downloadUrl: current.download_url ?? prev.downloadUrl ?? null,
          downloadId,
          downloadedBytes: current.downloaded_bytes ?? prev.downloadedBytes ?? null,
          totalBytes: current.total_bytes ?? prev.totalBytes ?? null
        }));
      }

      setModelDownload({ status: "idle", progress: null, message: "", downloadedBytes: null, totalBytes: null });
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelDownload((prev) => ({
        status: "error",
        progress: prev.progress ?? null,
        message: "Model download failed.",
        detail: message,
        expectedPath: prev.expectedPath ?? expectedPath ?? null,
        downloadUrl: prev.downloadUrl ?? downloadUrl ?? null,
        downloadId: prev.downloadId ?? null,
        downloadedBytes: prev.downloadedBytes ?? null,
        totalBytes: prev.totalBytes ?? null
      }));
      notify("Model download failed. Please retry.", "error");
      return false;
    }
  }, [getWhisperModelDownload, getWhisperModelStatus, modelDownload.status, notify, startWhisperModelDownload]);

  const clearModelDownload = useCallback(() => {
    setModelDownload({ status: "idle", progress: null, message: "", downloadedBytes: null, totalBytes: null });
  }, []);

  const handleRetryModelDownload = useCallback(() => {
    void ensureWhisperModelReady();
  }, [ensureWhisperModelReady]);

  const modelDownloadActive = modelDownload.status !== "idle";
  const label = "model";
  const modelDownloadTitle =
    modelDownload.status === "checking"
      ? `Checking ${label}`
      : modelDownload.status === "downloading"
        ? `Downloading ${label}`
        : `${label} download failed`;

  return {
    modelDownload,
    setModelDownload,
    ensureWhisperModelReady,
    clearModelDownload,
    handleRetryModelDownload,
    modelDownloadActive,
    modelDownloadTitle
  };
}
