export type WhisperModelStatus = {
  ready: boolean;
  model_path?: string | null;
  expected_path?: string;
  download_url?: string;
  filename?: string;
  size_bytes?: number | null;
};

export type WhisperModelDownload = {
  download_id?: string;
  status: string;
  progress?: number | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  message?: string | null;
  error?: string | null;
  error_type?: string | null;
  expected_path?: string;
  download_url?: string;
};
