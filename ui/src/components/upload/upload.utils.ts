export const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "mkv", "avi", "webm", "flv", "mpg", "mpeg"]);
export const AUDIO_EXTENSIONS = new Set(["mp3", "wav", "flac", "m4a", "aac", "ogg", "opus"]);
export const CAPTION_EXTENSIONS = new Set(["srt"]);
export const MEDIA_EXTENSIONS = new Set([...VIDEO_EXTENSIONS, ...AUDIO_EXTENSIONS]);
export const ACCEPTED_MEDIA_TYPES = [...AUDIO_EXTENSIONS, ...VIDEO_EXTENSIONS].map((ext) => `.${ext}`).join(",");

export function getKind(filename?: string | null): "video" | "audio" | "caption" | "other" {
  const ext = filename?.split(".").pop()?.toLowerCase() ?? "";
  if (VIDEO_EXTENSIONS.has(ext)) return "video";
  if (AUDIO_EXTENSIONS.has(ext)) return "audio";
  if (CAPTION_EXTENSIONS.has(ext)) return "caption";
  return "other";
}

export function hashStableId(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16);
}

export function buildImportedJobId(path: string, size?: number | null): string {
  return `media-${hashStableId(`${path}::${size ?? ""}`)}`;
}

export function isYoutubeStreamExpired(streamUrl?: string | null): boolean {
  if (!streamUrl) return false;
  try {
    const url = new URL(streamUrl);

    // YouTube URLs can have expire in query params (?expire=...) or in path (/expire/1234567890/)
    let expireParam = url.searchParams.get("expire");

    // If not in query params, try to extract from path
    if (!expireParam) {
      const pathMatch = url.pathname.match(/\/expire\/(\d+)\//);
      if (pathMatch) {
        expireParam = pathMatch[1];
      }
    }

    if (!expireParam) return false;
    const expireSec = Number(expireParam);
    if (!Number.isFinite(expireSec)) return false;
    const nowSec = Math.floor(Date.now() / 1000);
    return expireSec <= nowSec + 30;
  } catch {
    return false;
  }
}

export function toFileUrl(localPath: string): string {
  if (localPath.startsWith("file://")) return localPath;
  return `file://${localPath}`;
}
