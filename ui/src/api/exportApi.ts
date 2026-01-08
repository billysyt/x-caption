import { api } from "./baseApi";
import type { ConvertChineseResponse, ExportResponse, ExportSegmentPayload, ExportLanguage } from "../types";

export const exportApi = api.injectEndpoints({
  endpoints: (build) => ({
    convertChinese: build.mutation<ConvertChineseResponse, { text: string; target: "traditional" | "simplified" }>({
      query: (args) => ({
        url: "/convert_chinese",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: args
      })
    }),
    exportTranscript: build.mutation<ExportResponse, { segments: ExportSegmentPayload[]; exportLanguage: ExportLanguage | string }>({
      query: (args) => ({
        url: "/export/transcript",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          segments: args.segments,
          export_language: args.exportLanguage
        }
      })
    }),
    exportSrt: build.mutation<ExportResponse, { segments: ExportSegmentPayload[]; exportLanguage: ExportLanguage | string }>({
      query: (args) => ({
        url: "/export/srt",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          segments: args.segments,
          export_language: args.exportLanguage
        }
      })
    })
  })
});

export const { useConvertChineseMutation, useExportTranscriptMutation, useExportSrtMutation } = exportApi;
