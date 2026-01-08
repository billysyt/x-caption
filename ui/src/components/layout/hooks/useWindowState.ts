import { useCallback, useEffect, useRef, useState, type MouseEvent } from "react";
import { cn } from "../../../lib/cn";
import { callApiMethod } from "../../../lib/pywebview";
import { getAppWindow, getPywebviewApi } from "../../../lib/window";

export function useWindowState() {
  const appWindow = getAppWindow();
  const isWindows = appWindow
    ? /Win/i.test(appWindow.navigator.platform || "") || /Windows/i.test(appWindow.navigator.userAgent || "")
    : false;
  const isMac = appWindow
    ? /Mac/i.test(appWindow.navigator.platform || "") || /Macintosh/i.test(appWindow.navigator.userAgent || "")
    : false;
  const showCustomWindowControls = isMac;  // Only show custom controls on macOS
  const [useCustomDrag, setUseCustomDrag] = useState(false);

  // Custom drag for macOS using native window drag event to avoid cross-display drift.
  useEffect(() => {
    if (!appWindow) return undefined;
    if (!isMac) return undefined;
    const forceNativeRegion = Boolean(appWindow.__USE_NATIVE_DRAG__);
    let teardown: (() => void) | null = null;
    let enabled = false;

    const enableCustomDrag = () => {
      if (enabled) return;
      const api = getPywebviewApi();
      if (!api) return;
      if (forceNativeRegion) return;
      const startDrag =
        api.window_start_drag || api.windowStartDrag || api.window_startDrag || api.windowStartdrag;
      if (typeof startDrag !== "function") return;

      enabled = true;
      setUseCustomDrag(true);
      document.documentElement.classList.add("pywebview-custom-drag");

      let dragState: {
        pointerId: number;
        dragging: boolean;
        captureEl: Element | null;
      } | null = null;

      const endDrag = (event: PointerEvent) => {
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        if (dragState.captureEl && "releasePointerCapture" in dragState.captureEl) {
          try {
            dragState.captureEl.releasePointerCapture(event.pointerId);
          } catch {
            // ignore
          }
        }
        dragState = null;
      };

      const onPointerDown = (event: PointerEvent) => {
        if (event.button !== 0) return;
        const target = event.target as HTMLElement | null;
        if (!target) return;
        const region = target.closest(".stt-drag-region");
        if (!region) return;
        if (target.closest(".pywebview-no-drag")) return;
        if (target.closest("button, a, input, select, textarea, [role='button']")) return;

        dragState = {
          pointerId: event.pointerId,
          dragging: false,
          captureEl: region
        };
        try {
          startDrag();
        } catch {
          // ignore
        }
      };

      document.addEventListener("pointerdown", onPointerDown, true);
      document.addEventListener("pointerup", endDrag, true);
      document.addEventListener("pointercancel", endDrag, true);

      teardown = () => {
        setUseCustomDrag(false);
        document.documentElement.classList.remove("pywebview-custom-drag");
        document.removeEventListener("pointerdown", onPointerDown, true);
        document.removeEventListener("pointerup", endDrag, true);
        document.removeEventListener("pointercancel", endDrag, true);
      };
    };

    const onReady = () => enableCustomDrag();
    enableCustomDrag();
    appWindow.addEventListener("pywebviewready", onReady as EventListener);
    return () => {
      appWindow.removeEventListener("pywebviewready", onReady as EventListener);
      if (teardown) {
        teardown();
        teardown = null;
      }
    };
  }, [appWindow, isMac]);

  const dragRegionClass = useCustomDrag ? "stt-drag-region" : "pywebview-drag-region";

  const [isAltPressed, setIsAltPressed] = useState(false);
  const [isWindowFocused, setIsWindowFocused] = useState(() => {
    if (typeof document === "undefined") return true;
    return document.hasFocus();
  });

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setIsAltPressed(true);
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === "Alt") {
        setIsAltPressed(false);
      }
    };
    const handleBlur = () => {
      setIsAltPressed(false);
      setIsWindowFocused(false);
    };
    const handleFocus = () => setIsWindowFocused(true);

    if (!appWindow) return;
    appWindow.addEventListener("keydown", handleKeyDown);
    appWindow.addEventListener("keyup", handleKeyUp);
    appWindow.addEventListener("blur", handleBlur);
    appWindow.addEventListener("focus", handleFocus);
    return () => {
      appWindow.removeEventListener("keydown", handleKeyDown);
      appWindow.removeEventListener("keyup", handleKeyUp);
      appWindow.removeEventListener("blur", handleBlur);
      appWindow.removeEventListener("focus", handleFocus);
    };
  }, [appWindow]);

  const [isPinned, setIsPinned] = useState(false);
  useEffect(() => {
    const api = getPywebviewApi();
    const getter = api?.window_get_on_top || api?.windowGetOnTop || api?.window_getOnTop;
    if (typeof getter !== "function") return;
    Promise.resolve(getter())
      .then((result: unknown) => {
        if (!result || (result as { success?: boolean }).success === false) return;
        const onTop = (result as { onTop?: unknown }).onTop;
        if (typeof onTop !== "undefined") {
          setIsPinned(Boolean(onTop));
        }
      })
      .catch(() => undefined);
  }, []);

  const setWindowOnTop = useCallback((next: boolean) => {
    const api = getPywebviewApi();
    const setter = api?.window_set_on_top || api?.windowSetOnTop || api?.window_setOnTop;
    if (typeof setter === "function") {
      // Optimistically update UI immediately for better UX
      setIsPinned(next);
      return Promise.resolve(setter(next))
        .then((result: unknown) => {
          if (result && (result as { success?: boolean }).success === false) {
            // Revert on failure
            setIsPinned(!next);
            return;
          }
          // Confirm with server response if available
          if (result && typeof (result as { onTop?: unknown }).onTop === "boolean") {
            setIsPinned(Boolean((result as { onTop?: boolean }).onTop));
          }
        })
        .catch(() => {
          // Revert on error
          setIsPinned(!next);
        });
    }
    setIsPinned(next);
    return Promise.resolve();
  }, []);

  const handleTogglePinned = useCallback(() => {
    const next = !isPinned;
    void setWindowOnTop(next);
  }, [isPinned, setWindowOnTop]);

  const windowZoomStateRef = useRef<{
    active: boolean;
    width?: number;
    height?: number;
    x?: number;
    y?: number;
  } | null>(null);

  const [isMaximized, setIsMaximized] = useState(false);

  const handleWindowZoomToggle = useCallback(async () => {
    const api = getPywebviewApi();
    if (!api) return;

    const getSizeNames = ["window_get_size", "windowGetSize", "window_getSize"];
    const setSizeNames = ["window_set_size", "windowSetSize", "window_setSize"];
    const getPosNames = ["window_get_position", "windowGetPosition", "window_getPosition"];
    const moveNames = ["window_move", "windowMove", "window_moveWindow"];
    const restoreNames = ["window_restore", "windowRestore", "window_restoreWindow"];
    const zoomNames = ["window_zoom", "windowZoom"];
    const toggleMaxNames = ["window_toggle_maximize", "windowToggleMaximize"];
    const isOk = (result: unknown) =>
      result !== null &&
      (typeof result !== "object" || (result as { success?: boolean }).success !== false);

    const parseSize = (res: unknown) => {
      if (!res || (res as { success?: boolean }).success === false) return null;
      const value = res as {
        width?: unknown;
        height?: unknown;
        w?: unknown;
        h?: unknown;
        size?: { width?: unknown; height?: unknown };
      };
      const width = Number(value.width ?? value.w ?? value.size?.width);
      const height = Number(value.height ?? value.h ?? value.size?.height);
      if (!Number.isFinite(width) || !Number.isFinite(height)) return null;
      return { width, height };
    };

    const parsePos = (res: unknown) => {
      if (!res || (res as { success?: boolean }).success === false) return null;
      const value = res as { x?: unknown; y?: unknown };
      const x = Number(value.x);
      const y = Number(value.y);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
      return { x, y };
    };

    const callZoom = async () => Promise.resolve(callApiMethod(api, zoomNames));
    const callToggleMax = async () => Promise.resolve(callApiMethod(api, toggleMaxNames));
    const callRestore = async () => Promise.resolve(callApiMethod(api, restoreNames));

    const restoreSizeAndPosition = async (state: {
      width?: number;
      height?: number;
      x?: number;
      y?: number;
    }) => {
      if (typeof state.width === "number" && typeof state.height === "number") {
        await Promise.resolve(callApiMethod(api, setSizeNames, state.width, state.height));
      }
      if (typeof state.x === "number" && typeof state.y === "number") {
        await Promise.resolve(callApiMethod(api, moveNames, state.x, state.y));
      }
    };

    const current = windowZoomStateRef.current;
    if (!current || !current.active) {
      // Save current window size and position before maximizing
      const [sizeRes, posRes] = await Promise.all([
        Promise.resolve(callApiMethod(api, getSizeNames)),
        Promise.resolve(callApiMethod(api, getPosNames))
      ]);
      const size = parseSize(sizeRes);
      const pos = parsePos(posRes);
      const savedState = {
        width: size?.width,
        height: size?.height,
        x: pos?.x,
        y: pos?.y
      };
      // Maximize/zoom the window
      let toggled = false;
      if (isMac) {
        const zoomResult = await callZoom();
        if (isOk(zoomResult)) {
          toggled = true;
        } else {
          const toggleResult = await callToggleMax();
          toggled = isOk(toggleResult);
        }
      } else {
        const toggleResult = await callToggleMax();
        toggled = isOk(toggleResult);
      }
      if (toggled) {
        windowZoomStateRef.current = { active: true, ...savedState };
        setIsMaximized(true);
      }
      return;
    }

    // Restore to original size and position
    let restored = false;
    if (isMac) {
      const zoomResult = await callZoom();
      if (isOk(zoomResult)) {
        await restoreSizeAndPosition(current);
        restored = true;
      } else {
        const restoreResult = await callRestore();
        if (isOk(restoreResult)) {
          await restoreSizeAndPosition(current);
          restored = true;
        } else {
          const toggleResult = await callToggleMax();
          if (isOk(toggleResult)) {
            await restoreSizeAndPosition(current);
            restored = true;
          }
        }
      }
    } else {
      const restoreResult = await callRestore();
      if (isOk(restoreResult)) {
        await restoreSizeAndPosition(current);
        restored = true;
      } else {
        // Fallback: manually restore using toggle and then set size/position
        const toggleResult = await callToggleMax();
        if (isOk(toggleResult)) {
          await restoreSizeAndPosition(current);
          restored = true;
        }
      }
    }
    if (restored) {
      windowZoomStateRef.current = { ...current, active: false };
      setIsMaximized(false);
    }
  }, [isMac]);

  const handleWindowAction = useCallback(
    (action: "close" | "minimize" | "zoom" | "fullscreen") => {
      if (action === "zoom") {
        void handleWindowZoomToggle();
        return;
      }
      const api = getPywebviewApi();
      if (!api) return;
      const map: Record<typeof action, string[]> = {
        close: ["window_close", "windowClose", "closeWindow"],
        minimize: ["window_minimize", "windowMinimize", "minimizeWindow"],
        fullscreen: ["window_toggle_fullscreen", "windowToggleFullscreen", "toggleFullscreen"]
      };
      for (const method of map[action]) {
        if (typeof api[method] === "function") {
          void api[method]();
          break;
        }
      }
    },
    [handleWindowZoomToggle]
  );

  const handleHeaderDoubleClick = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (target.closest(".pywebview-no-drag")) return;
      if (target.closest("button, a, input, select, textarea, [role='button']")) return;
      handleWindowAction("zoom");
    },
    [handleWindowAction]
  );

  const getHeaderDragProps = useCallback(
    (baseClass: string) => ({
      className: cn(dragRegionClass, baseClass),
      onDoubleClick: handleHeaderDoubleClick
    }),
    [dragRegionClass, handleHeaderDoubleClick]
  );

  const [isHeaderMenuOpen, setIsHeaderMenuOpen] = useState(false);
  const headerMenuRef = useRef<HTMLDivElement | null>(null);
  const headerMenuButtonRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!isHeaderMenuOpen) return undefined;
    const close = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (headerMenuRef.current?.contains(target)) return;
      if (headerMenuButtonRef.current?.contains(target)) return;
      setIsHeaderMenuOpen(false);
    };
    if (!appWindow) return;
    appWindow.addEventListener("click", close);
    return () => appWindow.removeEventListener("click", close);
  }, [appWindow, isHeaderMenuOpen]);

  return {
    isWindows,
    isMac,
    showCustomWindowControls,
    useCustomDrag,
    dragRegionClass,
    isAltPressed,
    isWindowFocused,
    isPinned,
    setIsPinned,
    setWindowOnTop,
    handleTogglePinned,
    handleWindowZoomToggle,
    handleWindowAction,
    handleHeaderDoubleClick,
    getHeaderDragProps,
    isHeaderMenuOpen,
    setIsHeaderMenuOpen,
    headerMenuRef,
    headerMenuButtonRef,
    isMaximized
  };
}
