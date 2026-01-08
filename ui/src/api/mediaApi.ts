import { api } from "./baseApi";
import type { PreprocessResponse, TranscribeResponse } from "../types";

export type TranscribeArgs = {
  jobId?: string | null;
  file?: File;
  filePath?: string | null;
  filename?: string | null;
  displayName?: string | null;
  mediaKind?: "audio" | "video" | null;
  model: string;
  language: string;
  chineseStyle?: "spoken" | "written";
  chineseScript?: "traditional" | "simplified";
};

export const mediaApi = api.injectEndpoints({
  endpoints: (build) => ({
    preprocessAudio: build.mutation<PreprocessResponse, File>({
      query: (file) => {
        const formData = new FormData();
        formData.append("file", file);
        return { url: "/preprocess_audio", method: "POST", body: formData };
      }
    }),
    transcribeAudio: build.mutation<TranscribeResponse, TranscribeArgs>({
      query: (args) => {
        const formData = new FormData();
        if (args.jobId) {
          formData.append("job_id", args.jobId);
        }
        if (args.file) {
          formData.append("file", args.file);
        }
        if (args.filePath) {
          formData.append("file_path", args.filePath);
        }
        if (args.filename) {
          formData.append("filename", args.filename);
        }
        if (args.mediaKind) {
          formData.append("media_kind", args.mediaKind);
        }
        if (args.displayName) {
          formData.append("display_name", args.displayName);
        }
        formData.append("model", args.model || "whisper");
        formData.append("language", args.language);
        formData.append("device", "auto");
        if (args.chineseStyle) {
          formData.append("chinese_style", args.chineseStyle);
        }
        if (args.chineseScript) {
          formData.append("chinese_script", args.chineseScript);
        }
        return { url: "/transcribe", method: "POST", body: formData };
      }
    })
  })
});

export const { usePreprocessAudioMutation, useTranscribeAudioMutation } = mediaApi;
