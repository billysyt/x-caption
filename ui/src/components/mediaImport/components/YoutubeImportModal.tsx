import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";

type YoutubeImportModalProps = {
  isOpen: boolean;
  youtubeImporting: boolean;
  youtubeImportTitle: string | null;
  youtubeUrl: string;
  setYoutubeUrl: (value: string) => void;
  youtubeError: string | null;
  setYoutubeError: (value: string | null) => void;
  isYoutubeIndeterminate: boolean;
  youtubeProgressValue: number;
  onImportYoutube: () => void;
  setShowYoutubeModal: (value: boolean) => void;
};

export function YoutubeImportModal({
  isOpen,
  youtubeImporting,
  youtubeImportTitle,
  youtubeUrl,
  setYoutubeUrl,
  youtubeError,
  setYoutubeError,
  isYoutubeIndeterminate,
  youtubeProgressValue,
  onImportYoutube,
  setShowYoutubeModal
}: YoutubeImportModalProps) {
  if (!isOpen) return null;
  return (
    <div
      className="fixed inset-0 z-[135] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => {
        if (!youtubeImporting) {
          setShowYoutubeModal(false);
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
            <AppIcon name="youtube" className="text-[22px] text-[#ff0000]" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-100 truncate">
                {youtubeImportTitle ? youtubeImportTitle : "Load YouTube media"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Paste a YouTube link to import media.
              </p>
            </div>
          </div>
          <div className="mt-4 space-y-3">
            <div className="flex items-center gap-2">
              <input
                type="url"
                value={youtubeUrl}
                onChange={(event) => {
                  setYoutubeUrl(event.target.value);
                  if (youtubeError) {
                    setYoutubeError(null);
                  }
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    if (!youtubeImporting) {
                      onImportYoutube();
                    }
                  }
                }}
                placeholder="Paste a YouTube link"
                className={cn(
                  "w-full flex-1 rounded-xl bg-[#0b0b0b] px-3 py-2 text-[11px] text-slate-200 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-[#3b82f6]/60",
                  youtubeImporting && "cursor-not-allowed opacity-60"
                )}
                disabled={youtubeImporting}
              />
              {youtubeImporting ? (
                <div className="flex h-8 w-8 items-center justify-center">
                  <AppIcon name="spinner" className="text-[14px] text-slate-200" spin />
                </div>
              ) : (
                <button
                  className="rounded-md bg-white px-3 py-2 text-[11px] font-semibold text-[#0b0b0b] transition hover:brightness-95 disabled:opacity-60"
                  onClick={onImportYoutube}
                  type="button"
                  disabled={!youtubeUrl.trim()}
                >
                  Import
                </button>
              )}
            </div>
            {youtubeError ? <p className="text-[11px] text-rose-400">{youtubeError}</p> : null}
            {youtubeImporting ? (
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-[#1b1b22]">
                <div
                  className={cn(
                    "h-full rounded-full transition-all",
                    isYoutubeIndeterminate ? "youtube-progress-active" : "bg-white"
                  )}
                  style={{
                    width: `${Math.max(0, Math.min(100, youtubeProgressValue))}%`
                  }}
                />
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
