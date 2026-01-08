import { cn } from "../../../lib/cn";
import type { UpdateOverlayProps } from "../../layout/AppOverlays.types";

type UpdateModalOverlayProps = UpdateOverlayProps;

export function UpdateModalOverlay({
  updateModal,
  updateForceRequired,
  updateAvailable,
  updateCurrentVersion,
  updateLatestVersion,
  onOpenExternalUrl,
  onWindowAction,
  clearUpdateModal
}: UpdateModalOverlayProps) {
  if (!updateModal) return null;
  return (
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center text-white">
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M20 16.5a4.5 4.5 0 0 0-2-8.5h-0.6A7 7 0 1 0 5 16.2" />
                <path d="M12 12v7" />
                <path d="m8.5 15.5 3.5 3.5 3.5-3.5" />
              </svg>
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">
                {updateForceRequired ? "Update required" : "Update available"}
              </div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">Latest version is available.</p>
            </div>
          </div>
          <div className="mt-4 grid gap-2 text-[11px] text-slate-300">
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Current version</span>
              <span>{updateCurrentVersion ?? "Unknown"}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-slate-500">Latest version</span>
              <span>{updateLatestVersion ?? "Unknown"}</span>
            </div>
            {updateModal.publishedAt ? (
              <div className="flex items-center justify-between">
                <span className="text-slate-500">Published</span>
                <span>{updateModal.publishedAt}</span>
              </div>
            ) : null}
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="rounded-md bg-transparent px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
              onClick={() => {
                if (updateForceRequired) {
                  onWindowAction("close");
                  return;
                }
                clearUpdateModal();
              }}
              type="button"
            >
              {updateForceRequired ? "Exit" : "Later"}
            </button>
            {updateAvailable ? (
              <button
                className={cn(
                  "rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0b0b0b] transition hover:brightness-95",
                  !updateModal.downloadUrl && "cursor-not-allowed opacity-60"
                )}
                onClick={() => {
                  if (updateModal.downloadUrl) {
                    onOpenExternalUrl(updateModal.downloadUrl);
                    onWindowAction("close");
                  }
                }}
                type="button"
                disabled={!updateModal.downloadUrl}
              >
                {updateForceRequired ? "Update now" : "Update"}
              </button>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}
