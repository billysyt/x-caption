export type UrlDownloadResponse = {
  file?: {
    name?: string;
    path?: string;
    size?: number | null;
    mime?: string | null;
  };
  source?: {
    url?: string | null;
    title?: string | null;
    id?: string | null;
  };
  duration_sec?: number | null;
  download_dir?: string | null;
  downloaded_bytes?: number | null;
  total_bytes?: number | null;
  total_bytes_estimate?: number | null;
  fragment_index?: number | null;
  fragment_count?: number | null;
  error?: string;
};

export type UrlDownloadStatus = UrlDownloadResponse & {
  download_id?: string;
  status?: string;
  progress?: number | null;
  message?: string | null;
  error?: string | null;
};
