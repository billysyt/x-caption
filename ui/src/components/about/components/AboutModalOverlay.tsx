import type { AboutOverlayProps } from "../../layout/AppOverlays.types";
import logoImage from "../../../assets/logo.png";

type AboutModalOverlayProps = Pick<AboutOverlayProps, "showAboutModal" | "setShowAboutModal" | "version">;

export function AboutModalOverlay({ showAboutModal, setShowAboutModal, version }: AboutModalOverlayProps) {
  if (!showAboutModal) return null;

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={() => setShowAboutModal(false)}
    >
      <div
        className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-slate-700/40 bg-[#0f0f10] shadow-[0_24px_60px_rgba(0,0,0,0.55)]"
        role="dialog"
        aria-modal="true"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col items-center p-8">
          {/* App Icon */}
          <div className="mb-6">
            <img
              src={logoImage}
              alt="X-Caption"
              className="h-16 w-16 rounded-lg shadow-lg"
            />
          </div>

          {/* Title - X-Caption {version} */}
          <div className="text-base font-semibold text-slate-200">
            X-Caption {version}
          </div>

          {/* Powered by */}
          <div className="mt-3 text-xs text-slate-500">
            Powered by billysyt
          </div>

          {/* URL */}
          <div className="mt-1 text-xs text-slate-500">
            https://github.com/billysyt/x-caption
          </div>

          {/* Close Button */}
          <button
            className="mt-6 inline-flex h-8 items-center justify-center rounded-full px-5 text-xs font-semibold text-slate-300 transition hover:bg-white/10 hover:text-white"
            onClick={() => setShowAboutModal(false)}
            type="button"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
