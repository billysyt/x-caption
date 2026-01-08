import type { PywebviewApi, PywebviewWindow } from "../types";
import { getEnvAppVersion } from "./env";

export function getAppWindow(): PywebviewWindow | null {
  if (typeof window === "undefined") return null;
  return window as PywebviewWindow;
}

export function getPywebviewApi(): PywebviewApi | null {
  return getAppWindow()?.pywebview?.api ?? null;
}

export function getAppVersion(): string | null {
  const winVersion = getAppWindow()?.__APP_VERSION__;
  if (typeof winVersion === "string" && winVersion.trim()) {
    return winVersion.trim();
  }
  return getEnvAppVersion();
}

export function getOpenCc(): PywebviewWindow["OpenCC"] | null {
  return getAppWindow()?.OpenCC ?? null;
}
