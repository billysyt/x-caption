export type AudioFileInfo = {
  name: string;
  size: number | null;
  path: string | null;
  wasTranscoded?: boolean;
  originalPath?: string | null;
  hash?: string | null;
  mtime?: number | null;
};

export type PreprocessResponse = {
  preprocess_id: string;
  playback_url: string;
  audio_file?: {
    name?: string;
    path?: string;
    size?: number;
    was_transcoded?: boolean;
  };
  original_file?: {
    path?: string;
    size?: number;
  };
};

export type TranscribeResponse = {
  job_id: string;
  status: string;
  message?: string;
  filename?: string;
  websocket_channel?: string;
  media_hash?: string | null;
  media_size?: number | null;
  media_mtime?: number | null;
  audio_file?: {
    name?: string;
    path?: string;
    size?: number;
    was_transcoded?: boolean;
  };
};
