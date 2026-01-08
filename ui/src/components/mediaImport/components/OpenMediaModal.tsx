import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";

type OpenMediaModalProps = {
  showOpenModal: boolean;
  youtubeImporting: boolean;
  urlDownloadImporting: boolean;
  onOpenLocalFromModal: () => void;
  onOpenYoutubeModal: () => void;
  onOpenUrlDownloadModal: () => void;
  setShowOpenModal: (value: boolean) => void;
};

export function OpenMediaModal({
  showOpenModal,
  youtubeImporting,
  urlDownloadImporting,
  onOpenLocalFromModal,
  onOpenYoutubeModal,
  onOpenUrlDownloadModal,
  setShowOpenModal
}: OpenMediaModalProps) {
  const isImporting = youtubeImporting || urlDownloadImporting;
  if (!showOpenModal) return null;
  return (
    <div className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div>
            <div className="text-sm font-semibold text-slate-100">Open</div>
            <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
              Import a local file, stream from YouTube, or download from a URL.
            </p>
          </div>
          <div className="mt-4 space-y-3">
            <button
              className={cn(
                "group w-full rounded-xl px-4 py-3 text-left transition",
                isImporting ? "cursor-not-allowed opacity-50" : "hover:bg-[#151515]"
              )}
              onClick={onOpenLocalFromModal}
              type="button"
              disabled={isImporting}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center text-white">
                  <AppIcon name="video" className="text-[16px]" />
                </div>
                <div>
                  <div className="text-[12px] font-semibold text-slate-100">Import video / audio</div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Choose a local media file to continue.
                  </p>
                </div>
              </div>
            </button>
            <button
              className={cn(
                "group w-full rounded-xl px-4 py-3 text-left transition",
                isImporting ? "cursor-not-allowed opacity-50" : "hover:bg-[#151515]"
              )}
              onClick={onOpenYoutubeModal}
              type="button"
              disabled={isImporting}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center text-[#ff0000]">
                  <AppIcon name="youtube" className="text-[18px]" />
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-slate-100">Stream from YouTube</div>
                  <p className="mt-1 text-[11px] text-slate-400">Load from YouTube media.</p>
                </div>
              </div>
            </button>
            <button
              className={cn(
                "group w-full rounded-xl px-4 py-3 text-left transition",
                isImporting ? "cursor-not-allowed opacity-50" : "hover:bg-[#151515]"
              )}
              onClick={onOpenUrlDownloadModal}
              type="button"
              disabled={isImporting}
            >
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 items-center justify-center text-slate-200">
                  <AppIcon name="cloudDownloadAlt" className="text-[18px]" />
                </div>
                <div className="flex-1">
                  <div className="text-[12px] font-semibold text-slate-100">Download from URL</div>
                  <p className="mt-1 text-[11px] text-slate-400">
                    Download media from any source and save locally.
                  </p>
                </div>
              </div>
            </button>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="rounded-md bg-transparent px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
              onClick={() => setShowOpenModal(false)}
              type="button"
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
