import { api } from "./baseApi";
import type {
  HistoryResponse,
  JobRecord,
  JobStatusResponse,
  JobUiState,
  PollResponse,
  RemoveJobResponse
} from "../types";

export type UpsertJobRecordPayload = {
  job_id: string;
  filename?: string | null;
  display_name?: string | null;
  media_path?: string | null;
  media_kind?: string | null;
  media_hash?: string | null;
  media_size?: number | null;
  media_mtime?: number | null;
  status?: string | null;
  language?: string | null;
  device?: string | null;
  summary?: string | null;
  transcript_json?: unknown;
  transcript_text?: string | null;
  segment_count?: number | null;
  duration?: number | null;
  ui_state?: JobUiState;
};

export type JobRecordResponse = { success?: boolean; record?: JobRecord; error?: string };

export const jobsApi = api.injectEndpoints({
  endpoints: (build) => ({
    getHistory: build.query<HistoryResponse, void>({
      query: () => "/history"
    }),
    getJob: build.query<JobStatusResponse, string>({
      query: (jobId) => `/job/${jobId}`
    }),
    pollJob: build.query<PollResponse, string>({
      query: (jobId) => `/job/${jobId}/poll`
    }),
    removeJob: build.mutation<RemoveJobResponse, string>({
      query: (jobId) => ({ url: `/job/${jobId}`, method: "DELETE" })
    }),
    upsertJobRecord: build.mutation<{ success?: boolean; error?: string }, UpsertJobRecordPayload>({
      query: (payload) => ({
        url: "/api/job/record",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: payload
      })
    }),
    getJobRecord: build.query<JobRecordResponse, string>({
      query: (jobId) => `/api/job/record/${jobId}`
    })
  })
});

export const {
  useGetHistoryQuery,
  useLazyGetHistoryQuery,
  useGetJobQuery,
  useLazyGetJobQuery,
  usePollJobQuery,
  useLazyPollJobQuery,
  useRemoveJobMutation,
  useUpsertJobRecordMutation,
  useLazyGetJobRecordQuery
} = jobsApi;
