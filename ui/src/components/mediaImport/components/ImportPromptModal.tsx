import { AppIcon } from "../../common/AppIcon";

type ImportPromptModalProps = {
  showImportModal: boolean;
  setShowImportModal: (value: boolean) => void;
  onOpenModal: () => void;
};

export function ImportPromptModal({
  showImportModal,
  setShowImportModal,
  onOpenModal
}: ImportPromptModalProps) {
  if (!showImportModal) return null;
  return (
    <div
      className="fixed inset-0 z-[130] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => setShowImportModal(false)}
    >
      <div
        className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="p-5">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-[#111827] text-[#60a5fa]">
              <AppIcon name="exclamationTriangle" className="text-[16px]" />
            </div>
            <div>
              <div className="text-sm font-semibold text-slate-100">Open media to generate captions</div>
              <p className="mt-1 text-[11px] leading-relaxed text-slate-400">
                Open a video or audio file first, then run AI captions.
              </p>
            </div>
          </div>
          <div className="mt-5 flex items-center justify-end gap-2">
            <button
              className="rounded-md bg-transparent px-3 py-1.5 text-[11px] font-semibold text-slate-200 transition hover:bg-[#1b1b22]"
              onClick={() => setShowImportModal(false)}
              type="button"
            >
              Cancel
            </button>
            <button
              className="rounded-md bg-white px-3 py-1.5 text-[11px] font-semibold text-[#0b0b0b] transition hover:brightness-95"
              onClick={() => {
                setShowImportModal(false);
                onOpenModal();
              }}
              type="button"
            >
              Open Media
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
