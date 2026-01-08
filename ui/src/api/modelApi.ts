import { api } from "./baseApi";
import type { WhisperModelDownload, WhisperModelStatus } from "../types";

export const modelApi = api.injectEndpoints({
  endpoints: (build) => ({
    getWhisperModelStatus: build.query<WhisperModelStatus, void>({
      query: () => "/models/whisper/status"
    }),
    startWhisperModelDownload: build.mutation<WhisperModelDownload, void>({
      query: () => ({ url: "/models/whisper/download", method: "POST" })
    }),
    getWhisperModelDownload: build.query<WhisperModelDownload, string>({
      query: (downloadId) => `/models/whisper/download/${downloadId}`
    }),
  })
});

export const {
  useGetWhisperModelStatusQuery,
  useLazyGetWhisperModelStatusQuery,
  useStartWhisperModelDownloadMutation,
  useLazyGetWhisperModelDownloadQuery
} = modelApi;
