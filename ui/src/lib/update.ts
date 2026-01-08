import { compareVersions } from "./format";

export type UpdateModalInfo = {
  project: string;
  currentVersion: string | null;
  latestVersion: string | null;
  updateAvailable: boolean | null;
  forceUpdate: boolean;
  minSupportedVersion: string | null;
  downloadUrl: string | null;
  releaseNotes: string | null;
  publishedAt: string | null;
};

type UpdatePayload = Record<string, unknown>;

function pickString(payload: UpdatePayload, keys: string[]): string | null {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) return trimmed;
    }
  }
  return null;
}

export function buildUpdateModalInfo(
  payload: unknown,
  fallbackVersion: string | null,
  defaultProject: string
): UpdateModalInfo | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as UpdatePayload;
  const latestVersion = pickString(record, ["latestVersion", "latest_version", "latest", "version"]);
  if (!latestVersion) return null;
  const currentVersion = fallbackVersion ?? pickString(record, ["currentVersion", "current_version"]);
  const minSupportedVersion = pickString(record, ["minSupportedVersion", "min_supported", "minimum_supported"]);
  const updateAvailable =
    typeof currentVersion === "string" && typeof latestVersion === "string"
      ? compareVersions(latestVersion, currentVersion) > 0
      : typeof record.updateAvailable === "boolean"
        ? record.updateAvailable
        : null;
  const forceUpdateRaw = record.forceUpdate ?? record.force_update;
  let forceUpdate = typeof forceUpdateRaw === "boolean" ? forceUpdateRaw : false;
  if (typeof currentVersion === "string" && typeof minSupportedVersion === "string") {
    forceUpdate = forceUpdate || compareVersions(currentVersion, minSupportedVersion) < 0;
  }
  if (!forceUpdate && updateAvailable !== true) {
    return null;
  }
  const downloadUrl = pickString(record, ["downloadUrl", "url", "link", "download_url"]);
  const releaseNotes = pickString(record, ["releaseNotes", "notes"]);
  const publishedAt = pickString(record, ["publishedAt", "released_at"]);

  return {
    project: String(record.project ?? defaultProject ?? "x-caption"),
    currentVersion: typeof currentVersion === "string" ? currentVersion : null,
    latestVersion,
    updateAvailable,
    forceUpdate,
    minSupportedVersion: typeof minSupportedVersion === "string" ? minSupportedVersion : null,
    downloadUrl,
    releaseNotes,
    publishedAt
  };
}
