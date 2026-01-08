import { useCallback, useEffect, useRef, type RefObject } from "react";
import type { UploadTabHandle } from "../../upload/components/UploadTab";
import { useLazyGetYoutubeImportQuery, useStartYoutubeImportMutation } from "../../../api/youtubeApi";
import {
  useCancelUrlDownloadMutation,
  useGetUrlDownloadDefaultsQuery,
  useLazyGetUrlDownloadQuery,
  useStartUrlDownloadMutation
} from "../../../api/urlDownloadApi";
import { useAppDispatch, useAppSelector } from "../../../hooks";
import { patchMediaImport } from "../mediaImportSlice";

export function useMediaImport(params: {
  isCompact: boolean;
  uploadRef: RefObject<UploadTabHandle>;
  onOpenLocalPicker: () => void;
  onOpenLeftDrawer: () => void;
}) {
  const { isCompact, uploadRef, onOpenLocalPicker, onOpenLeftDrawer } = params;

  const dispatch = useAppDispatch();
  const modals = useAppSelector((state) => state.mediaImport.modals);
  const youtube = useAppSelector((state) => state.mediaImport.youtube);
  const urlDownload = useAppSelector((state) => state.mediaImport.urlDownload);
  const youtubeProgressTimerRef = useRef<number | null>(null);
  const urlDownloadProgressTimerRef = useRef<number | null>(null);
  const [startYoutubeImport] = useStartYoutubeImportMutation();
  const [getYoutubeImport] = useLazyGetYoutubeImportQuery();
  const [startUrlDownload] = useStartUrlDownloadMutation();
  const [cancelUrlDownload] = useCancelUrlDownloadMutation();
  const [getUrlDownload] = useLazyGetUrlDownloadQuery();
  const { data: urlDefaults } = useGetUrlDownloadDefaultsQuery();

  const setShowOpenModal = useCallback(
    (value: boolean) => {
      dispatch(patchMediaImport({ modals: { open: value } }));
    },
    [dispatch]
  );

  const setShowYoutubeModal = useCallback(
    (value: boolean) => {
      dispatch(patchMediaImport({ modals: { youtube: value } }));
    },
    [dispatch]
  );

  const setShowUrlDownloadModal = useCallback(
    (value: boolean) => {
      dispatch(patchMediaImport({ modals: { urlDownload: value } }));
    },
    [dispatch]
  );

  const setShowImportModal = useCallback(
    (value: boolean) => {
      dispatch(patchMediaImport({ modals: { import: value } }));
    },
    [dispatch]
  );

  useEffect(() => {
    if (urlDefaults?.download_dir && !urlDownload.savePath) {
      dispatch(patchMediaImport({ urlDownload: { savePath: urlDefaults.download_dir } }));
    }
  }, [dispatch, urlDefaults, urlDownload.savePath]);

  const setYoutubeUrl = useCallback(
    (value: string) => {
      dispatch(patchMediaImport({ youtube: { url: value } }));
    },
    [dispatch]
  );

  const setUrlDownloadUrl = useCallback(
    (value: string) => {
      dispatch(patchMediaImport({ urlDownload: { url: value } }));
    },
    [dispatch]
  );

  const setUrlDownloadSavePath = useCallback(
    (value: string) => {
      dispatch(patchMediaImport({ urlDownload: { savePath: value } }));
    },
    [dispatch]
  );

  const setYoutubeError = useCallback(
    (value: string | null) => {
      dispatch(patchMediaImport({ youtube: { error: value } }));
    },
    [dispatch]
  );

  const setUrlDownloadError = useCallback(
    (value: string | null) => {
      dispatch(patchMediaImport({ urlDownload: { error: value } }));
    },
    [dispatch]
  );

  const handleOpenModal = useCallback(() => {
    dispatch(
      patchMediaImport({
        modals: { open: true, youtube: false, urlDownload: false },
        youtube: {
          importing: false,
          error: null,
          progress: null,
          importId: null,
          title: null,
          status: null
        },
        urlDownload: {
          url: "",
          importing: false,
          error: null,
          progress: null,
          downloadedBytes: null,
          totalBytes: null,
          totalBytesEstimate: null,
          fragmentIndex: null,
          fragmentCount: null,
          importId: null,
          title: null,
          status: null
        }
      })
    );
  }, [dispatch]);

  const handleOpenLocalFromModal = useCallback(() => {
    setShowOpenModal(false);
    onOpenLocalPicker();
  }, [onOpenLocalPicker]);

  const handleOpenYoutubeModal = useCallback(() => {
    dispatch(
      patchMediaImport({
        modals: { open: false, youtube: true, urlDownload: false },
        youtube: { error: null }
      })
    );
  }, [dispatch]);

  const handleOpenUrlDownloadModal = useCallback(() => {
    dispatch(
      patchMediaImport({
        modals: { open: false, youtube: false, urlDownload: true },
        urlDownload: { error: null }
      })
    );
  }, [dispatch]);

  const handleImportYoutube = useCallback(async () => {
    const url = youtube.url.trim();
    if (!url) {
      setYoutubeError("Paste a YouTube link to continue.");
      return;
    }
    dispatch(
      patchMediaImport({
        modals: { youtube: true },
        youtube: {
          error: null,
          importing: true,
          title: null,
          status: null
        }
      })
    );
    try {
      const startPayload = await startYoutubeImport(url).unwrap();
      const downloadId = startPayload?.download_id;
      if (!downloadId) {
        throw new Error("Failed to start YouTube import.");
      }
      dispatch(
        patchMediaImport({
          youtube: {
            progress: typeof startPayload.progress === "number" ? Math.round(startPayload.progress) : null,
            status: startPayload.status ?? null,
            importId: downloadId
          }
        })
      );
      if (startPayload.status === "completed") {
        const file = startPayload?.file;
        if (!file?.path || !file?.name) {
          throw new Error("Download failed. Please try again.");
        }
        const addLocalPathItem = uploadRef.current?.addLocalPathItem;
        if (!addLocalPathItem) {
          throw new Error("Upload panel is not ready yet.");
        }
        if (isCompact) {
          onOpenLeftDrawer();
        }
        const displayName = startPayload?.source?.title?.trim() || undefined;
        // Don't use backend's stream_url - it may be rate-limited/stale.
        // Let frontend auto-resolve to get a fresh working URL.
        await addLocalPathItem({
          path: file.path,
          name: file.name,
          size: typeof file.size === "number" ? file.size : null,
          mime: file.mime ?? null,
          displayName,
          durationSec: typeof startPayload?.duration_sec === "number" ? startPayload.duration_sec : null,
          previewUrl: null,
          streamUrl: null,
          externalSource: {
            type: "youtube",
            url: startPayload?.source?.url ?? url,
            streamUrl: null,
            title: startPayload?.source?.title ?? null,
            id: startPayload?.source?.id ?? null,
            thumbnailUrl: startPayload?.thumbnail_url ?? null
          },
          transcriptionKind: "audio"
        });
        dispatch(
          patchMediaImport({
            modals: { youtube: false },
            youtube: {
              url: "",
              importing: false,
              progress: null,
              importId: null,
              title: null,
              status: null
            }
          })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(
        patchMediaImport({
          modals: { youtube: true },
          youtube: {
            error: message || "Failed to load YouTube media.",
            importing: false,
            importId: null,
            progress: null,
            title: null,
            status: null
          }
        })
      );
    } finally {
      // Polling effect handles the in-progress state.
    }
  }, [dispatch, isCompact, onOpenLeftDrawer, setYoutubeError, startYoutubeImport, uploadRef, youtube.url]);

  const handleDownloadUrl = useCallback(async () => {
    const url = urlDownload.url.trim();
    if (!url) {
      setUrlDownloadError("Paste a URL to continue.");
      return;
    }
    const savePath = urlDownload.savePath.trim() || undefined;
    dispatch(
      patchMediaImport({
        modals: { urlDownload: true },
        urlDownload: {
          error: null,
          importing: true,
          downloadedBytes: null,
          totalBytes: null,
          totalBytesEstimate: null,
          fragmentIndex: null,
          fragmentCount: null,
          title: null,
          status: null
        }
      })
    );
    try {
      const startPayload = await startUrlDownload({ url, downloadDir: savePath }).unwrap();
      const downloadId = startPayload?.download_id;
      if (!downloadId) {
        throw new Error("Failed to start download.");
      }
      dispatch(
        patchMediaImport({
          urlDownload: {
            progress: typeof startPayload.progress === "number" ? Math.round(startPayload.progress) : null,
            status: startPayload.status ?? null,
            importId: downloadId,
            title: startPayload?.source?.title ?? null,
            downloadedBytes:
              typeof startPayload.downloaded_bytes === "number" ? startPayload.downloaded_bytes : null,
            totalBytes: typeof startPayload.total_bytes === "number" ? startPayload.total_bytes : null,
            totalBytesEstimate:
              typeof startPayload.total_bytes_estimate === "number" ? startPayload.total_bytes_estimate : null,
            fragmentIndex: typeof startPayload.fragment_index === "number" ? startPayload.fragment_index : null,
            fragmentCount: typeof startPayload.fragment_count === "number" ? startPayload.fragment_count : null
          }
        })
      );
      if (startPayload.status === "completed") {
        const file = startPayload?.file;
        if (!file?.path || !file?.name) {
          throw new Error("Download failed. Please try again.");
        }
        const addLocalPathItem = uploadRef.current?.addLocalPathItem;
        if (!addLocalPathItem) {
          throw new Error("Upload panel is not ready yet.");
        }
        if (isCompact) {
          onOpenLeftDrawer();
        }
        const displayName = startPayload?.source?.title?.trim() || undefined;
        await addLocalPathItem({
          path: file.path,
          name: file.name,
          size: typeof file.size === "number" ? file.size : null,
          mime: file.mime ?? null,
          displayName,
          durationSec: typeof startPayload?.duration_sec === "number" ? startPayload.duration_sec : null,
          previewUrl: null,
          streamUrl: null
        });
        dispatch(
          patchMediaImport({
            modals: { urlDownload: false },
          urlDownload: {
            url: "",
            importing: false,
            progress: null,
            downloadedBytes: null,
            totalBytes: null,
            totalBytesEstimate: null,
            fragmentIndex: null,
            fragmentCount: null,
            importId: null,
            title: null,
            status: null
          }
        })
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      dispatch(
        patchMediaImport({
          modals: { urlDownload: true },
          urlDownload: {
            error: message || "Failed to download media.",
            importing: false,
            importId: null,
            progress: null,
            downloadedBytes: null,
            totalBytes: null,
            totalBytesEstimate: null,
            fragmentIndex: null,
            fragmentCount: null,
            title: null,
            status: null
          }
        })
      );
    } finally {
      // Polling effect handles the in-progress state.
    }
  }, [
    dispatch,
    isCompact,
    onOpenLeftDrawer,
    setUrlDownloadError,
    startUrlDownload,
    uploadRef,
    urlDownload.savePath,
    urlDownload.url
  ]);

  const handleCancelUrlDownload = useCallback(async () => {
    const downloadId = urlDownload.importId;
    if (downloadId) {
      try {
        await cancelUrlDownload(downloadId).unwrap();
      } catch {
        // Ignore cancel errors; we'll reset local state regardless.
      }
    }
    dispatch(
      patchMediaImport({
        modals: { urlDownload: false },
        urlDownload: {
          url: "",
          importing: false,
          error: null,
          progress: null,
          downloadedBytes: null,
          totalBytes: null,
          totalBytesEstimate: null,
          fragmentIndex: null,
          fragmentCount: null,
          importId: null,
          title: null,
          status: null
        }
      })
    );
  }, [cancelUrlDownload, dispatch, urlDownload.importId]);

  useEffect(() => {
    if (!modals.import) return undefined;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setShowImportModal(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [modals.import, setShowImportModal]);

  useEffect(() => {
    if (!youtube.importing || !youtube.importId) return undefined;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await getYoutubeImport(youtube.importId).unwrap();
        if (cancelled) return;
        dispatch(
          patchMediaImport({
            youtube: {
              progress: typeof status.progress === "number" ? Math.round(status.progress) : null,
              status: status.status ?? null,
              title: status?.source?.title ?? youtube.title
            }
          })
        );
        if (status.status === "completed") {
          const file = status.file;
          if (!file?.path || !file?.name) {
            throw new Error("Download failed. Please try again.");
          }
          const addLocalPathItem = uploadRef.current?.addLocalPathItem;
          if (!addLocalPathItem) {
            throw new Error("Upload panel is not ready yet.");
          }
          if (isCompact) {
            onOpenLeftDrawer();
          }
          const displayName = status?.source?.title?.trim() || undefined;
          // Don't use backend's stream_url - it may be rate-limited/stale.
          // Let frontend auto-resolve to get a fresh working URL.
          await addLocalPathItem({
            path: file.path,
            name: file.name,
            size: typeof file.size === "number" ? file.size : null,
            mime: file.mime ?? null,
            displayName,
            durationSec: typeof status?.duration_sec === "number" ? status.duration_sec : null,
            previewUrl: null,
            streamUrl: null,
            externalSource: {
              type: "youtube",
              url: status?.source?.url ?? youtube.url.trim(),
              streamUrl: null,
              title: status?.source?.title ?? null,
              id: status?.source?.id ?? null,
              thumbnailUrl: status?.thumbnail_url ?? null
            },
            transcriptionKind: "audio"
          });
          dispatch(
            patchMediaImport({
              modals: { youtube: false },
              youtube: {
                url: "",
                importing: false,
                progress: null,
                importId: null,
                title: null,
                status: null
              }
            })
          );
        } else if (status.status === "failed") {
          throw new Error(status.error || "Failed to load YouTube media.");
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        dispatch(
          patchMediaImport({
            modals: { youtube: true },
            youtube: {
              error: message || "Failed to load YouTube media.",
              importing: false,
              importId: null,
              progress: null,
              title: null,
              status: null
            }
          })
        );
      } finally {
        inFlight = false;
      }
    };

    poll();
    youtubeProgressTimerRef.current = window.setInterval(poll, 300);
    return () => {
      cancelled = true;
      if (youtubeProgressTimerRef.current) {
        window.clearInterval(youtubeProgressTimerRef.current);
        youtubeProgressTimerRef.current = null;
      }
    };
  }, [
    dispatch,
    getYoutubeImport,
    isCompact,
    onOpenLeftDrawer,
    uploadRef,
    youtube.importId,
    youtube.importing,
    youtube.title,
    youtube.url
  ]);

  useEffect(() => {
    if (!urlDownload.importing || !urlDownload.importId) return undefined;
    let cancelled = false;
    let inFlight = false;

    const poll = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const status = await getUrlDownload(urlDownload.importId).unwrap();
        if (cancelled) return;
        dispatch(
          patchMediaImport({
            urlDownload: {
              progress: typeof status.progress === "number" ? Math.round(status.progress) : null,
              status: status.status ?? null,
              title: status?.source?.title ?? urlDownload.title,
              downloadedBytes: typeof status.downloaded_bytes === "number" ? status.downloaded_bytes : null,
              totalBytes: typeof status.total_bytes === "number" ? status.total_bytes : null,
              totalBytesEstimate:
                typeof status.total_bytes_estimate === "number" ? status.total_bytes_estimate : null,
              fragmentIndex: typeof status.fragment_index === "number" ? status.fragment_index : null,
              fragmentCount: typeof status.fragment_count === "number" ? status.fragment_count : null
            }
          })
        );
        if (status.status === "completed") {
          const file = status.file;
          if (!file?.path || !file?.name) {
            throw new Error("Download failed. Please try again.");
          }
          const addLocalPathItem = uploadRef.current?.addLocalPathItem;
          if (!addLocalPathItem) {
            throw new Error("Upload panel is not ready yet.");
          }
          if (isCompact) {
            onOpenLeftDrawer();
          }
          const displayName = status?.source?.title?.trim() || undefined;
          await addLocalPathItem({
            path: file.path,
            name: file.name,
            size: typeof file.size === "number" ? file.size : null,
            mime: file.mime ?? null,
            displayName,
            durationSec: typeof status?.duration_sec === "number" ? status.duration_sec : null,
            previewUrl: null,
            streamUrl: null
          });
          dispatch(
            patchMediaImport({
              modals: { urlDownload: false },
              urlDownload: {
                url: "",
                importing: false,
                progress: null,
                downloadedBytes: null,
                totalBytes: null,
                totalBytesEstimate: null,
                fragmentIndex: null,
                fragmentCount: null,
                importId: null,
                title: null,
                status: null
              }
            })
          );
        } else if (status.status === "failed") {
          throw new Error(status.error || "Failed to download media.");
        } else if (status.status === "cancelled") {
          throw new Error("Download cancelled.");
        }
      } catch (error) {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : String(error);
        dispatch(
          patchMediaImport({
            modals: { urlDownload: true },
            urlDownload: {
              error: message || "Failed to download media.",
              importing: false,
              importId: null,
              progress: null,
              downloadedBytes: null,
              totalBytes: null,
              totalBytesEstimate: null,
              fragmentIndex: null,
              fragmentCount: null,
              title: null,
              status: null
            }
          })
        );
      } finally {
        inFlight = false;
      }
    };

    poll();
    urlDownloadProgressTimerRef.current = window.setInterval(poll, 300);
    return () => {
      cancelled = true;
      if (urlDownloadProgressTimerRef.current) {
        window.clearInterval(urlDownloadProgressTimerRef.current);
        urlDownloadProgressTimerRef.current = null;
      }
    };
  }, [
    dispatch,
    getUrlDownload,
    isCompact,
    onOpenLeftDrawer,
    uploadRef,
    urlDownload.importId,
    urlDownload.importing,
    urlDownload.title
  ]);

  const isYoutubeIndeterminate =
    youtube.status === "processing" || youtube.status === "queued" || youtube.progress === null;
  const youtubeProgressValue =
    typeof youtube.progress === "number"
      ? Math.max(
          0,
          Math.min(youtube.status && youtube.status !== "completed" ? 99 : 100, youtube.progress)
        )
      : 0;

  const isUrlDownloadIndeterminate =
    urlDownload.status === "processing" || urlDownload.status === "queued" || urlDownload.progress === null;
  const urlDownloadProgressValue =
    typeof urlDownload.progress === "number"
      ? Math.max(
          0,
          Math.min(urlDownload.status && urlDownload.status !== "completed" ? 99 : 100, urlDownload.progress)
        )
      : 0;

  return {
    modals: {
      showOpenModal: modals.open,
      setShowOpenModal,
      showYoutubeModal: modals.youtube,
      setShowYoutubeModal,
      showUrlDownloadModal: modals.urlDownload,
      setShowUrlDownloadModal,
      showImportModal: modals.import,
      setShowImportModal
    },
    youtube: {
      url: youtube.url,
      setUrl: setYoutubeUrl,
      importing: youtube.importing,
      error: youtube.error,
      setError: setYoutubeError,
      progress: youtube.progress,
      importId: youtube.importId,
      importTitle: youtube.title,
      importStatus: youtube.status,
      isIndeterminate: isYoutubeIndeterminate,
      progressValue: youtubeProgressValue
    },
    urlDownload: {
      url: urlDownload.url,
      setUrl: setUrlDownloadUrl,
      savePath: urlDownload.savePath,
      setSavePath: setUrlDownloadSavePath,
      importing: urlDownload.importing,
      error: urlDownload.error,
      setError: setUrlDownloadError,
      progress: urlDownload.progress,
      downloadedBytes: urlDownload.downloadedBytes,
      totalBytes: urlDownload.totalBytes,
      totalBytesEstimate: urlDownload.totalBytesEstimate,
      fragmentIndex: urlDownload.fragmentIndex,
      fragmentCount: urlDownload.fragmentCount,
      importId: urlDownload.importId,
      importTitle: urlDownload.title,
      importStatus: urlDownload.status,
      isIndeterminate: isUrlDownloadIndeterminate,
      progressValue: urlDownloadProgressValue
    },
    actions: {
      openModal: handleOpenModal,
      openLocalFromModal: handleOpenLocalFromModal,
      openYoutubeModal: handleOpenYoutubeModal,
      openUrlDownloadModal: handleOpenUrlDownloadModal,
      importYoutube: handleImportYoutube,
      downloadUrl: handleDownloadUrl,
      cancelUrlDownload: handleCancelUrlDownload
    }
  };
}

export type MediaImportResult = ReturnType<typeof useMediaImport>;
