export function formatTime(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

export function formatBytes(value?: number | null) {
  if (!value || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let size = value;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  return `${size.toFixed(size >= 10 || idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export function baseFilename(value: string | null | undefined) {
  const raw = (value ?? "").trim();
  const stripped = raw ? raw.replace(/\.[^/.]+$/, "") : "transcript";
  const safe = stripped.replace(/[\\/:*?"<>|]+/g, "_").trim();
  return safe || "transcript";
}

export function formatTimestamp(value: string | null | undefined): string {
  if (!value) return "Unknown";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "Unknown";
  try {
    return parsed.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch {
    return parsed.toISOString();
  }
}

export function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

export function compareVersions(a: string, b: string) {
  const left = normalizeVersion(a).split(/[^0-9]+/).filter(Boolean).map(Number);
  const right = normalizeVersion(b).split(/[^0-9]+/).filter(Boolean).map(Number);
  const maxLen = Math.max(left.length, right.length);
  for (let i = 0; i < maxLen; i += 1) {
    const la = left[i] ?? 0;
    const lb = right[i] ?? 0;
    if (la > lb) return 1;
    if (la < lb) return -1;
  }
  return 0;
}
