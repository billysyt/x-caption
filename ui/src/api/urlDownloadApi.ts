import { api } from "./baseApi";
import type { UrlDownloadStatus } from "../types";

export const urlDownloadApi = api.injectEndpoints({
  endpoints: (build) => ({
    getUrlDownloadDefaults: build.query<{ download_dir?: string | null }, void>({
      query: () => "/import/url/defaults"
    }),
    startUrlDownload: build.mutation<
      UrlDownloadStatus,
      { url: string; downloadDir?: string | null }
    >({
      query: ({ url, downloadDir }) => ({
        url: "/import/url/start",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: { url, download_dir: downloadDir }
      })
    }),
    getUrlDownload: build.query<UrlDownloadStatus, string>({
      query: (downloadId) => `/import/url/${downloadId}`
    }),
    cancelUrlDownload: build.mutation<UrlDownloadStatus, string>({
      query: (downloadId) => ({
        url: `/import/url/${downloadId}/cancel`,
        method: "POST"
      })
    })
  })
});

export const {
  useGetUrlDownloadDefaultsQuery,
  useStartUrlDownloadMutation,
  useLazyGetUrlDownloadQuery,
  useCancelUrlDownloadMutation
} = urlDownloadApi;
