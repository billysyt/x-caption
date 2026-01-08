import type { AudioFileInfo, HistoryEntry, Job, JobStatus, TranscriptResult } from "../types";

export function normalizeJobStatus(status: unknown): JobStatus {
  if (!status) return "queued";
  const normalized = String(status).toLowerCase();
  switch (normalized) {
    case "finished":
    case "complete":
    case "completed":
      return "completed";
    case "started":
    case "processing":
    case "progress":
    case "running":
    case "active":
      return "processing";
    case "queued":
    case "pending":
    case "deferred":
      return "queued";
    case "failed":
      return "failed";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "imported":
    case "open":
    case "opened":
    case "ready":
      return "imported";
    default:
      return normalized as JobStatus;
  }
}

export function sanitizeProgressValue(value: unknown): number | null {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return null;
  }
  return Math.max(0, Math.min(100, numeric));
}

export function getJobProgressValue(job: Job | null | undefined): number | null {
  if (!job) return null;
  const baseProgress = sanitizeProgressValue(job.progress);
  return baseProgress;
}

export function formatElapsedTime(startTimeMs?: number): string {
  if (!startTimeMs) return "";
  const elapsedMs = Date.now() - startTimeMs;
  if (elapsedMs < 0) return "";

  const seconds = Math.floor(elapsedMs / 1000);
  if (seconds < 60) {
    return `${seconds}s ago`;
  }
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m ${seconds % 60}s ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m ago`;
}

export function formatFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
  if (bytes < k) return `${bytes} Bytes`;
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
}

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const minutes = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${minutes}:${secs.toString().padStart(2, "0")}`;
}

export function getMimeTypeHint(pathOrName: string | null | undefined): string {
  const ref = pathOrName ?? "";
  const dot = ref.lastIndexOf(".");
  const extension = dot >= 0 ? ref.substring(dot + 1).toLowerCase() : "";
  if (extension === "mp3") return "audio/mpeg";
  if (["m4a", "mp4", "m4v", "aac"].includes(extension)) return "audio/mp4";
  if (["ogg", "oga"].includes(extension)) return "audio/ogg";
  if (["opus", "weba", "webm"].includes(extension)) return "audio/webm";
  if (extension === "flac") return "audio/flac";
  return "audio/wav";
}

export function convertHistoryEntry(entry: HistoryEntry): Job | null {
  if (!entry || !entry.job_id) {
    return null;
  }

  const status = normalizeJobStatus(entry.status ?? "completed");
  const isCompleted = status === "completed";
  const createdAt = entry.created_at ? Date.parse(entry.created_at) : Date.now();
  const completedAt = entry.completed_at ? Date.parse(entry.completed_at) : undefined;

  const audioMeta = entry.audio_file ?? {};
  const mediaSize = typeof entry.media_size === "number"
    ? entry.media_size
    : (typeof audioMeta.size === "number" ? audioMeta.size : null);
  const mediaHash = entry.media_hash ?? audioMeta.hash ?? null;
  const mediaMtime = typeof entry.media_mtime === "number"
    ? entry.media_mtime
    : (typeof audioMeta.mtime === "number" ? audioMeta.mtime : null);
  const audioFile: AudioFileInfo = {
    name: audioMeta.name ?? entry.original_filename ?? entry.job_id,
    size: mediaSize,
    path: audioMeta.path ?? entry.media_path ?? null,
    originalPath: audioMeta.original_path ?? null,
    hash: mediaHash,
    mtime: mediaMtime
  };

  const displayName =
    entry.display_name ??
    entry.ui_state?.display_name ??
    ((stripFileExtension(entry.original_filename ?? "") || entry.original_filename) ?? entry.job_id);

  return {
    id: entry.job_id,
    filename: entry.original_filename ?? entry.job_id,
    displayName,
    status,
    message: entry.message ?? (isCompleted ? "Completed" : ""),
    progress: isCompleted ? 100 : (entry.progress ?? (status === "failed" ? -1 : 0)),
    startTime: Number.isNaN(createdAt) ? Date.now() : createdAt,
    completedAt: completedAt && !Number.isNaN(completedAt) ? completedAt : undefined,
    language: entry.language ?? "auto",
    device: entry.device ?? "cpu",
    summary: entry.summary ?? "",
    outputFile: entry.output_file ?? null,
    textFile: entry.text_file ?? null,
    formattedTextFile: entry.formatted_text_file ?? null,
    audioFile,
    result: entry.result_preview ?? null,
    partialResult: null,
    error: null,
    currentStage: null,
    lastSyncedAt: undefined,
    mediaHash,
    mediaSize,
    mediaMtime,
    mediaInvalid: Boolean(entry.media_invalid),
    uiState: entry.ui_state ?? undefined
  };
}

export function jobNeedsServerResult(job: Job | null | undefined): boolean {
  if (!job) return false;
  if (job.status !== "completed") return false;
  if (job.lastSyncedAt) return false;
  if (!job.result || !Array.isArray(job.result.segments) || job.result.segments.length === 0) {
    return true;
  }
  return false;
}

export function deriveFilenameFromResult(result: TranscriptResult | null | undefined, fallback: string): string {
  if (!result) return fallback;
  const filePath = result.file_path ?? "";
  if (!filePath) return fallback;
  const parts = filePath.split(/[\\/]/);
  return parts[parts.length - 1] || fallback;
}

export function stripFileExtension(name: string | null | undefined): string {
  if (!name) return "";
  const base = name.split(/[\\/]/).pop() || name;
  const dot = base.lastIndexOf(".");
  if (dot <= 0) return base;
  return base.slice(0, dot);
}
