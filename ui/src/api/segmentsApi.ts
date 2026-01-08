import { api } from "./baseApi";
import type { TranscriptSegment } from "../types";

export type EditSegmentArgs = { jobId: string; segmentId: number; newText: string };
export type UpdateSegmentTimingArgs = { jobId: string; segmentId: number; start: number; end: number };
export type AddSegmentArgs = { jobId: string; start: number; end: number; text: string; segmentId?: number };
export type DeleteSegmentArgs = { jobId: string; segmentId: number };

export const segmentsApi = api.injectEndpoints({
  endpoints: (build) => ({
    editSegment: build.mutation<{ success?: boolean; message?: string }, EditSegmentArgs>({
      query: (args) => ({
        url: "/api/segment/edit",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          job_id: args.jobId,
          segment_id: args.segmentId,
          new_text: args.newText
        }
      })
    }),
    updateSegmentTiming: build.mutation<{ success?: boolean; message?: string }, UpdateSegmentTimingArgs>({
      query: (args) => ({
        url: "/api/segment/timing",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          job_id: args.jobId,
          segment_id: args.segmentId,
          start: args.start,
          end: args.end
        }
      })
    }),
    addSegment: build.mutation<{ success?: boolean; message?: string; segment?: TranscriptSegment }, AddSegmentArgs>({
      query: (args) => ({
        url: "/api/segment/add",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          job_id: args.jobId,
          segment_id: args.segmentId,
          start: args.start,
          end: args.end,
          text: args.text
        }
      })
    }),
    deleteSegment: build.mutation<{ success?: boolean; message?: string }, DeleteSegmentArgs>({
      query: (args) => ({
        url: "/api/segment/delete",
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: {
          job_id: args.jobId,
          segment_id: args.segmentId
        }
      })
    })
  })
});

export const {
  useEditSegmentMutation,
  useUpdateSegmentTimingMutation,
  useAddSegmentMutation,
  useDeleteSegmentMutation
} = segmentsApi;
