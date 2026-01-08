export type YoutubeImportResponse = {
  file?: {
    name?: string;
    path?: string;
    size?: number | null;
    mime?: string | null;
  };
  thumbnail_url?: string | null;
  source?: {
    url?: string | null;
    title?: string | null;
    id?: string | null;
  };
  stream_url?: string | null;
  duration_sec?: number | null;
  error?: string;
};

export type YoutubeResolveResponse = {
  stream_url?: string | null;
  thumbnail_url?: string | null;
  source?: {
    url?: string | null;
    title?: string | null;
    id?: string | null;
  };
  duration_sec?: number | null;
  error?: string;
};

export type YoutubeImportStatus = YoutubeImportResponse & {
  download_id?: string;
  status?: string;
  progress?: number | null;
  message?: string | null;
  error?: string | null;
};
