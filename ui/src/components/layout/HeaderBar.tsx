import type { MouseEvent, RefObject } from "react";
import { AppIcon } from "../common/AppIcon";
import { cn } from "../../lib/cn";

type WindowAction = "close" | "minimize" | "zoom" | "fullscreen";

type MacWindowControlsProps = {
  isWindowFocused: boolean;
  isAltPressed: boolean;
  onWindowAction: (action: WindowAction) => void;
};

function MacWindowControls({ isWindowFocused, isAltPressed, onWindowAction }: MacWindowControlsProps) {
  return (
    <div className="group ml-1 mr-3 flex items-center gap-2">
      <button
        className={cn(
          "pywebview-no-drag relative flex h-3 w-3 cursor-default items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition",
          isWindowFocused ? "bg-[#ff5f57] group-hover:brightness-95" : "bg-[#525252]"
        )}
        onClick={() => onWindowAction("close")}
        type="button"
        aria-label="Close"
      >
        <svg
          viewBox="0 0 8 8"
          className={cn(
            "h-2 w-2 stroke-black/60 transition",
            isWindowFocused ? "opacity-0 group-hover:opacity-80" : "opacity-0"
          )}
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <line x1="1.5" y1="1.5" x2="6.5" y2="6.5" />
          <line x1="6.5" y1="1.5" x2="1.5" y2="6.5" />
        </svg>
      </button>
      <button
        className={cn(
          "pywebview-no-drag relative flex h-3 w-3 cursor-default items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition",
          isWindowFocused ? "bg-[#febc2e] group-hover:brightness-95" : "bg-[#525252]"
        )}
        onClick={() => onWindowAction("minimize")}
        type="button"
        aria-label="Minimize"
      >
        <svg
          viewBox="0 0 8 8"
          className={cn(
            "h-2 w-2 stroke-black/60 transition",
            isWindowFocused ? "opacity-0 group-hover:opacity-80" : "opacity-0"
          )}
          strokeWidth="1.2"
          strokeLinecap="round"
        >
          <line x1="1.5" y1="4" x2="6.5" y2="4" />
        </svg>
      </button>
      <button
        className={cn(
          "pywebview-no-drag relative flex h-3 w-3 cursor-default items-center justify-center rounded-full shadow-[inset_0_0_0_1px_rgba(0,0,0,0.12)] transition",
          isWindowFocused ? "bg-[#28c840] group-hover:brightness-95" : "bg-[#525252]"
        )}
        onClick={() => onWindowAction(isAltPressed ? "zoom" : "fullscreen")}
        type="button"
        aria-label="Zoom"
      >
        {isAltPressed ? (
          <svg
            viewBox="0 0 8 8"
            className={cn(
              "h-2 w-2 stroke-black/70 transition",
              isWindowFocused ? "opacity-0 group-hover:opacity-90" : "opacity-0"
            )}
            strokeWidth="1.5"
            strokeLinecap="round"
          >
            <line x1="1.5" y1="4" x2="6.5" y2="4" />
            <line x1="4" y1="1.5" x2="4" y2="6.5" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 8 8"
            className={cn(
              "h-2 w-2 rotate-90 stroke-black/70 transition",
              isWindowFocused ? "opacity-0 group-hover:opacity-90" : "opacity-0"
            )}
            strokeWidth="1.6"
            strokeLinecap="round"
          >
            <path d="M4.7 2.1 H6.3 V3.3" />
            <path d="M3.3 5.9 H1.7 V4.7" />
          </svg>
        )}
      </button>
    </div>
  );
}

type WindowsWindowControlsProps = {
  isMaximized: boolean;
  onWindowAction: (action: WindowAction) => void;
};

function WindowsWindowControls({ isMaximized, onWindowAction }: WindowsWindowControlsProps) {
  return (
    <div className="ml-2 flex items-center gap-1 pl-2">
      <button
        className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
        onClick={() => onWindowAction("minimize")}
        type="button"
        aria-label="Minimize"
        title="Minimize"
      >
        <AppIcon name="windowMinimize" className="text-[10px]" />
      </button>
      <button
        className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
        onClick={() => onWindowAction("zoom")}
        type="button"
        aria-label={isMaximized ? "Restore" : "Maximize"}
        title={isMaximized ? "Restore" : "Maximize"}
      >
        <AppIcon name={isMaximized ? "windowRestore" : "windowMaximize"} className="text-[9px]" />
      </button>
      <button
        className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[10px] text-slate-300 transition-colors hover:bg-slate-700/50 hover:text-white"
        onClick={() => onWindowAction("close")}
        type="button"
        aria-label="Close"
        title="Close"
      >
        <AppIcon name="times" className="text-[10px]" />
      </button>
    </div>
  );
}

type HeaderMenuProps = {
  isExporting: boolean;
  isPinned: boolean;
  isMac: boolean;
  showCustomWindowControls: boolean;
  appVersion: string | null;
  menuRef: RefObject<HTMLDivElement>;
  onCloseHeaderMenu: () => void;
  onOpenModal: () => void;
  onOpenExport: () => void;
  onOpenSupport: () => void;
  onTogglePinned: () => void;
  onWindowAction: (action: WindowAction) => void;
};

function HeaderMenu({
  isExporting,
  isPinned,
  isMac,
  showCustomWindowControls,
  menuRef,
  onCloseHeaderMenu,
  onOpenModal,
  onOpenExport,
  onOpenSupport,
  onTogglePinned,
  onWindowAction
}: HeaderMenuProps) {
  const versionLabel = `Version ${appVersion || "Unknown"}`;
  return (
    <div
      ref={menuRef}
      className="pywebview-no-drag absolute right-3 top-10 z-[130] min-w-[190px] overflow-hidden rounded-lg border border-slate-800/40 bg-[#151515] text-[11px] text-slate-200 shadow-xl"
    >
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
        onClick={() => {
          onCloseHeaderMenu();
          onOpenModal();
        }}
        type="button"
      >
        <AppIcon name="folderOpen" />
        Open
      </button>
      <button
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          isExporting ? "cursor-not-allowed opacity-50" : "hover:bg-[#1b1b22]"
        )}
        onClick={() => {
          if (isExporting) return;
          onCloseHeaderMenu();
          onOpenExport();
        }}
        disabled={isExporting}
        type="button"
      >
        <AppIcon name="download" />
        Export
      </button>
      <button
        className={cn(
          "flex w-full items-center gap-2 px-3 py-2 text-left",
          "hover:bg-[#1b1b22]"
        )}
        onClick={() => {
          onCloseHeaderMenu();
          onOpenSupport();
        }}
        type="button"
      >
        <AppIcon name="github" />
        {versionLabel}
      </button>
      <button
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
        onClick={() => {
          onCloseHeaderMenu();
          onTogglePinned();
        }}
        type="button"
      >
        <AppIcon name={isPinned ? "pin" : "pinOff"} className={cn(!isPinned && "rotate-45 opacity-70")} />
        {isPinned ? "Unpin Window" : "Pin Window"}
      </button>
      {showCustomWindowControls && !isMac ? (
        <>
          <div className="h-px bg-slate-800/60" />
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
            onClick={() => {
              onCloseHeaderMenu();
              onWindowAction("minimize");
            }}
            type="button"
          >
            <AppIcon name="windowMinimize" />
            Minimize
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
            onClick={() => {
              onCloseHeaderMenu();
              onWindowAction("zoom");
            }}
            type="button"
          >
            <AppIcon name="windowMaximize" />
            Zoom
          </button>
          <button
            className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
            onClick={() => {
              onCloseHeaderMenu();
              onWindowAction("close");
            }}
            type="button"
          >
            <AppIcon name="times" />
            Close
          </button>
        </>
      ) : null}
    </div>
  );
}

export type HeaderBarProps = {
  isMac: boolean;
  isWindowFocused: boolean;
  isAltPressed: boolean;
  isHeaderCompact: boolean;
  isHeaderMenuOpen: boolean;
  showCustomWindowControls: boolean;
  isPinned: boolean;
  isExporting: boolean;
  isMaximized: boolean;
  appVersion: string | null;
  headerMenuRef: RefObject<HTMLDivElement>;
  headerMenuButtonRef: RefObject<HTMLButtonElement>;
  getHeaderDragProps: (baseClass: string) => {
    className: string;
    onDoubleClick: (event: MouseEvent<HTMLElement>) => void;
  };
  onOpenModal: () => void;
  onTogglePinned: () => void;
  onOpenExport: () => void;
  onOpenSupport: () => void;
  onWindowAction: (action: WindowAction) => void;
  onToggleHeaderMenu: () => void;
  onCloseHeaderMenu: () => void;
};

export function HeaderBar({
  isMac,
  isWindowFocused,
  isAltPressed,
  isHeaderCompact,
  isHeaderMenuOpen,
  showCustomWindowControls,
  isPinned,
  isExporting,
  isMaximized,
  appVersion,
  headerMenuRef,
  headerMenuButtonRef,
  getHeaderDragProps,
  onOpenModal,
  onTogglePinned,
  onOpenExport,
  onOpenSupport,
  onWindowAction,
  onToggleHeaderMenu,
  onCloseHeaderMenu
}: HeaderBarProps) {
  const versionLabel = `Version ${appVersion || "Unknown"}`;
  return (
    <div
      {...getHeaderDragProps(
        "relative grid h-10 select-none grid-cols-[1fr_auto_1fr] items-center bg-[#0b0b0b] px-3 text-xs text-slate-300"
      )}
    >
      <div className="flex min-w-0 items-center gap-2">
        {isMac ? (
          <MacWindowControls
            isWindowFocused={isWindowFocused}
            isAltPressed={isAltPressed}
            onWindowAction={onWindowAction}
          />
        ) : null}
        {!isHeaderCompact ? (
          <button
            className="pywebview-no-drag inline-flex h-7 items-center gap-1.5 rounded-md bg-[#1b1b22] px-2 text-[11px] font-semibold text-slate-200 transition hover:bg-[#26262f]"
            onClick={onOpenModal}
            type="button"
            aria-label="Open"
            title="Open"
          >
            <AppIcon name="folderOpen" className="text-[11px]" />
            Open
          </button>
        ) : null}
      </div>
      <div className="flex items-center justify-center gap-2">
        {isMac ? <span className="text-[11px] font-semibold text-slate-200">X-Caption</span> : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        {isHeaderCompact ? (
          <button
            ref={headerMenuButtonRef}
            className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md bg-slate-800/40 text-[11px] text-slate-300 transition-colors hover:bg-slate-700/60 hover:text-slate-100"
            onClick={(event) => {
              event.stopPropagation();
              onToggleHeaderMenu();
            }}
            type="button"
            aria-label="Menu"
            title="Menu"
          >
            <AppIcon name="bars" className="text-[12px]" />
          </button>
        ) : (
          <>
            <button
              className="pywebview-no-drag inline-flex h-7 w-7 items-center justify-center rounded-md text-[11px] text-slate-200/80 transition hover:bg-white/5 hover:text-white"
              onClick={onTogglePinned}
              type="button"
              aria-label={isPinned ? "Unpin window" : "Pin window"}
              title={isPinned ? "Unpin window" : "Pin window"}
            >
              <AppIcon
                name={isPinned ? "pin" : "pinOff"}
                className={cn("text-[11px]", !isPinned && "rotate-45 opacity-70")}
              />
            </button>
            <button
              className={cn(
                "pywebview-no-drag inline-flex h-7 items-center justify-center gap-1.5 rounded-md bg-[#1b1b22] px-2 text-[11px] font-semibold text-slate-200 transition",
                isExporting ? "cursor-not-allowed opacity-50" : "hover:bg-[#26262f]"
              )}
              onClick={onOpenExport}
              disabled={isExporting}
              type="button"
            >
              <AppIcon name="download" className="text-[10px]" />
              Export
            </button>
            <button
              className={cn(
                "pywebview-no-drag inline-flex h-7 items-center justify-center gap-1.5 rounded-md px-2 text-[11px] font-semibold transition",
                "bg-[#1b1b22] text-slate-200 hover:bg-[#26262f] hover:text-white"
              )}
              onClick={onOpenSupport}
              type="button"
            >
              <AppIcon name="github" className="text-[12px]" />
              {versionLabel}
            </button>
            {showCustomWindowControls && !isMac ? (
              <WindowsWindowControls isMaximized={isMaximized} onWindowAction={onWindowAction} />
            ) : null}
          </>
        )}
      </div>
      {isHeaderCompact && isHeaderMenuOpen ? (
        <HeaderMenu
          menuRef={headerMenuRef}
          isExporting={isExporting}
          isPinned={isPinned}
          isMac={isMac}
          showCustomWindowControls={showCustomWindowControls}
          appVersion={appVersion}
          onCloseHeaderMenu={onCloseHeaderMenu}
          onOpenModal={onOpenModal}
          onOpenExport={onOpenExport}
          onOpenSupport={onOpenSupport}
          onTogglePinned={onTogglePinned}
          onWindowAction={onWindowAction}
        />
      ) : null}
    </div>
  );
}
