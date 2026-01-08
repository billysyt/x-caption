import type { Dispatch, SetStateAction } from "react";
import type { ToastType } from "../common/ToastHost";

export type MediaSourceInfo = {
  type: "youtube";
  url?: string | null;
  streamUrl?: string | null;
  title?: string | null;
  id?: string | null;
  thumbnailUrl?: string | null;
};

export type MediaItem = {
  id: string;
  name: string;
  displayName?: string;
  kind: "video" | "audio" | "caption" | "other";
  source: "job" | "local";
  transcriptionKind?: "video" | "audio";
  jobId?: string;
  file?: File;
  localPath?: string | null;
  previewUrl?: string | null;
  streamUrl?: string | null;
  externalSource?: MediaSourceInfo | null;
  isResolvingStream?: boolean;
  thumbnailUrl?: string | null;
  thumbnailSource?: "saved" | "captured" | "none";
  createdAt?: number;
  durationSec?: number | null;
  invalid?: boolean;
  streamError?: string | null;
};

export type UploadTabHandle = {
  submitTranscription: () => Promise<void>;
  hasSelection: () => boolean;
  openFilePicker: () => void;
  addLocalPathItem: (args: {
    path: string;
    name: string;
    size?: number | null;
    mime?: string | null;
    displayName?: string | null;
    durationSec?: number | null;
    previewUrl?: string | null;
    streamUrl?: string | null;
    externalSource?: MediaSourceInfo | null;
    transcriptionKind?: "audio" | "video";
  }) => Promise<void>;
};

export type UploadTabProps = {
  notify: (message: string, type?: ToastType) => void;
  onSelectionChange?: (hasFile: boolean, filename?: string | null, file?: File | null) => void;
  onAddToTimeline?: (items: MediaItem[]) => void;
  onClearSelection?: () => void;
  localMedia?: MediaItem[];
  onLocalMediaChange?: Dispatch<SetStateAction<MediaItem[]>>;
  onRequestFilePicker?: (open: () => void) => void;
};

export type SortableMediaRowProps = {
  item: MediaItem;
  updatedAt: number | null;
  isSelected: boolean;
  isProcessingJob: boolean;
  canReorder: boolean;
  viewMode: "list-view" | "list";
  getPreviewKind: (item: MediaItem) => string;
  onActivate: (item: MediaItem) => void;
  onContextMenu: (e: React.MouseEvent, item: MediaItem) => void;
  formatTimestamp: (ts: number) => string;
};

export type ContextMenuState = {
  x: number;
  y: number;
  item: MediaItem;
} | null;

export type JobPreviewMeta = Record<string, { thumbnailUrl?: string | null; durationSec?: number | null }>;
