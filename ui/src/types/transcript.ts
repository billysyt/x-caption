export type TranscriptSegment = {
  id: number;
  start: number;
  end: number;
  text: string;
  originalText?: string;
};

export type TranscriptResult = {
  job_id?: string;
  file_path?: string;
  segments?: TranscriptSegment[];
  text?: string;
  language?: string;
  device?: string;
  model?: string;
  transcription_time?: number;
  total_processing_time?: number;
  normalized_audio_path?: string;
  original_audio_path?: string;
};
