import { api } from "./baseApi";
import type { YoutubeImportResponse, YoutubeImportStatus, YoutubeResolveResponse } from "../types";

export const youtubeApi = api.injectEndpoints({
  endpoints: (build) => ({
    importYoutube: build.mutation<YoutubeImportResponse, string>({
      query: (url) => ({
        url: "/import/youtube",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { url }
      })
    }),
    startYoutubeImport: build.mutation<YoutubeImportStatus, string>({
      query: (url) => ({
        url: "/import/youtube/start",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { url }
      })
    }),
    getYoutubeImport: build.query<YoutubeImportStatus, string>({
      query: (downloadId) => `/import/youtube/${downloadId}`
    }),
    resolveYoutubeStream: build.mutation<YoutubeResolveResponse, string>({
      query: (url) => ({
        url: "/import/youtube/resolve",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { url }
      })
    })
  })
});

export const {
  useImportYoutubeMutation,
  useStartYoutubeImportMutation,
  useLazyGetYoutubeImportQuery,
  useResolveYoutubeStreamMutation
} = youtubeApi;
