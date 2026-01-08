export function getEnvString(key: keyof ImportMetaEnv): string | null {
  const value = import.meta.env[key];
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function getEnvAppVersion(): string | null {
  return getEnvString("VITE_APP_VERSION");
}

export function getUpdateCheckUrl(): string | null {
  return getEnvString("VITE_UPDATE_CHECK_URL");
}

export function getUpdateProject(): string {
  return (
    getEnvString("VITE_UPDATE_PROJECT") ??
    getEnvString("VITE_UPDATE_PROJECT_NAME") ??
    "x-caption"
  );
}
