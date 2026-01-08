import type { AudioFileInfo } from "./media";
import type { TranscriptResult, TranscriptSegment } from "./transcript";

export type JobStatus = "queued" | "processing" | "completed" | "failed" | "cancelled" | "imported";

export type SubtitleUiState = {
  position?: { x?: number; y?: number };
  scale?: number;
  size?: { width?: number; height?: number };
  userSized?: boolean;
};

export type JobUiState = {
  display_name?: string;
  media_order_index?: number;
  subtitle?: SubtitleUiState;
  mediaSource?: {
    type?: string;
    url?: string | null;
    streamUrl?: string | null;
    title?: string | null;
    id?: string | null;
    thumbnailUrl?: string | null;
  } | null;
  mediaSourceError?: string | null;
  thumbnail?: { data?: string };
  [key: string]: unknown;
};

export type Job = {
  id: string;
  filename: string;
  displayName?: string;
  status: JobStatus;
  message: string;
  progress: number | null;
  startTime: number;
  completedAt?: number;
  language?: string;
  device?: string;
  summary?: string;
  outputFile?: string | null;
  textFile?: string | null;
  formattedTextFile?: string | null;
  audioFile?: AudioFileInfo | null;
  result?: TranscriptResult | null;
  partialResult?: TranscriptResult | null;
  error?: string | null;
  currentStage?: string | null;
  lastSyncedAt?: number;
  streamingSegments?: TranscriptSegment[];
  expectedSegments?: number;
  mediaHash?: string | null;
  mediaSize?: number | null;
  mediaMtime?: number | null;
  mediaInvalid?: boolean;
  uiState?: JobUiState;
};

export type HistoryEntry = {
  job_id: string;
  status?: string;
  message?: string;
  created_at?: string;
  completed_at?: string;
  language?: string;
  device?: string;
  output_file?: string;
  text_file?: string;
  formatted_text_file?: string;
  summary?: string;
  progress?: number;
  original_filename?: string;
  display_name?: string;
  media_path?: string;
  media_kind?: string;
  media_hash?: string;
  media_size?: number;
  media_mtime?: number;
  media_invalid?: boolean;
  ui_state?: JobUiState;
  audio_file?: {
    name?: string;
    size?: number;
    path?: string;
    original_path?: string;
    hash?: string;
    mtime?: number;
  };
  result_preview?: TranscriptResult | null;
};

export type JobRecord = {
  ui_state?: JobUiState;
  [key: string]: unknown;
};

export type HistoryResponse = {
  jobs?: HistoryEntry[];
};

export type JobStatusResponse = {
  job_id: string;
  status: string;
  created_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  meta?: Record<string, unknown>;
  result?: TranscriptResult;
  error?: string;
};

export type PollUpdate = {
  event: string;
  data: unknown;
  timestamp: number;
};

export type PollResponse = {
  success?: boolean;
  updates?: PollUpdate[];
  error?: string;
};

export type RemoveJobResponse = {
  success?: boolean;
  message?: string;
  error?: string;
  warnings?: string[];
};
