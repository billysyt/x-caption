import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";
import { callApiMethod } from "../../../lib/pywebview";
import { getPywebviewApi } from "../../../lib/window";

type UrlDownloadModalProps = {
  isOpen: boolean;
  urlDownloadImporting: boolean;
  urlDownloadTitle: string | null;
  url: string;
  setUrl: (value: string) => void;
  savePath: string;
  setSavePath: (value: string) => void;
  urlDownloadError: string | null;
  setUrlDownloadError: (value: string | null) => void;
  isUrlDownloadIndeterminate: boolean;
  urlDownloadProgressValue: number;
  downloadedBytes: number | null;
  totalBytes: number | null;
  totalBytesEstimate: number | null;
  fragmentIndex: number | null;
  fragmentCount: number | null;
  onDownloadUrl: () => void;
  onCancelUrlDownload: () => void;
  setShowUrlDownloadModal: (value: boolean) => void;
};

export function UrlDownloadModal({
  isOpen,
  urlDownloadImporting,
  urlDownloadTitle,
  url,
  setUrl,
  savePath,
  setSavePath,
  urlDownloadError,
  setUrlDownloadError,
  isUrlDownloadIndeterminate,
  urlDownloadProgressValue,
  downloadedBytes,
  totalBytes,
  totalBytesEstimate,
  fragmentIndex,
  fragmentCount,
  onDownloadUrl,
  onCancelUrlDownload,
  setShowUrlDownloadModal
}: UrlDownloadModalProps) {
  const formatBytes = (value: number | null | undefined) => {
    if (value === null || value === undefined || Number.isNaN(value)) return "--";
    if (value <= 0) return "0 B";
    const units = ["B", "KB", "MB", "GB", "TB"];
    let size = value;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex += 1;
    }
    return `${size.toFixed(size >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
  };
  const resolvedTotalBytes = totalBytes ?? totalBytesEstimate ?? null;
  const downloadedLabel = formatBytes(downloadedBytes);
  const totalLabel = formatBytes(resolvedTotalBytes);
  const fragmentLabel =
    resolvedTotalBytes || !fragmentCount
      ? ""
      : ` • Segments ${
          typeof fragmentIndex === "number" ? fragmentIndex + 1 : 0
        }/${fragmentCount}`;

  const handlePickFolder = () => {
    const api = getPywebviewApi();
    const result = callApiMethod(api, ["openDirectoryDialog", "open_directory_dialog"]);
    if (!result) {
      setUrlDownloadError("Folder picker is not available in this build.");
      return;
    }
    void Promise.resolve(result)
      .then((payload) => {
        const response = payload as {
          cancelled?: boolean;
          success?: boolean;
          error?: string;
          path?: string;
        };
        if (!response || response.cancelled) return;
        if (!response.success) {
          setUrlDownloadError(response.error || "Failed to open folder picker.");
          return;
        }
        if (response.path) {
          setSavePath(String(response.path));
          if (urlDownloadError) setUrlDownloadError(null);
        }
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        setUrlDownloadError(message || "Failed to open folder picker.");
      });
  };
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[135] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!urlDownloadImporting) {
          setShowUrlDownloadModal(false);
        }
      }}
    >
      <div
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <AppIcon name="cloudDownloadAlt" className="text-[20px] text-slate-200" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100 truncate">
                {urlDownloadTitle ? urlDownloadTitle : "Download media from URL"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Paste a media link and choose where to save it.
              </p>
            </div>
            {urlDownloadImporting ? (
              <button
                className="ml-auto mt-0.5 flex h-7 w-7 items-center justify-center rounded-full text-slate-400 transition hover:text-white"
                type="button"
                aria-label="Cancel download"
                title="Cancel download"
                onClick={onCancelUrlDownload}
              >
                <AppIcon name="times" className="text-[10px]" />
              </button>
            ) : null}
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={url}
                onChange={(event) => {
                  setUrl(event.target.value);
                  if (urlDownloadError) {
                    setUrlDownloadError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!urlDownloadImporting) {
                      onDownloadUrl();
                    }
                  }
                }}
                placeholder="Paste a media link"
                className={cn(
                  "w-full flex-1 rounded-xl bg-[#0b0b0b] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/60",
                  urlDownloadImporting && "cursor-not-allowed opacity-60"
                )}
                disabled={urlDownloadImporting}
              />
              {urlDownloadImporting ? (
                <div className="flex h-8 w-8 items-center justify-center">
                  <AppIcon name="spinner" className="text-[14px] text-slate-200" spin />
                </div>
              ) : (
                <button
                  className="rounded-md bg-white px-3 py-2 text-[11px] font-semibold text-[#0b0b0b] transition hover:brightness-95 disabled:opacity-60"
                  onClick={onDownloadUrl}
                  type="button"
                  disabled={!url.trim()}
                >
                  Download
                </button>
              )}
            </div>
            {!urlDownloadImporting ? (
              <div className="relative">
                <input
                  type="text"
                  value={savePath}
                  onChange={(event) => {
                    setSavePath(event.target.value);
                    if (urlDownloadError) {
                      setUrlDownloadError(null);
                    }
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      if (!urlDownloadImporting) {
                        onDownloadUrl();
                      }
                    }
                  }}
                  placeholder="Save to folder (e.g. ~/Downloads)"
                  className={cn(
                    "w-full rounded-xl bg-[#0b0b0b] px-3 py-2 pr-9 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/60",
                    urlDownloadImporting && "cursor-not-allowed opacity-60"
                  )}
                  disabled={urlDownloadImporting}
                />
                <button
                  className={cn(
                    "absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center text-slate-500 transition hover:text-white",
                    urlDownloadImporting && "cursor-not-allowed opacity-60"
                  )}
                  onClick={handlePickFolder}
                  type="button"
                  aria-label="Choose download folder"
                  title="Choose download folder"
                  disabled={urlDownloadImporting}
                >
                  <AppIcon name="folderOpen" className="text-[14px]" />
                </button>
              </div>
            ) : null}
            {urlDownloadError ? <p className="text-[11px] text-rose-400">{urlDownloadError}</p> : null}
            {urlDownloadImporting ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between text-[11px] text-slate-400">
                  <span>
                    Downloaded {downloadedLabel} / {totalLabel}
                    {fragmentLabel}
                  </span>
                  <span>{Math.max(0, Math.min(100, urlDownloadProgressValue))}%</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1b1b22]">
                  <div
                    className={cn(
                      "h-full rounded-full transition-all",
                      isUrlDownloadIndeterminate ? "youtube-progress-active" : "bg-white"
                    )}
                    style={{
                      width: `${Math.max(0, Math.min(100, urlDownloadProgressValue))}%`
                    }}
                  />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
