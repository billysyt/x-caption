import { createAsyncThunk, createSlice, type PayloadAction } from "@reduxjs/toolkit";
import { jobsApi } from "../../api/jobsApi";
import { mediaApi } from "../../api/mediaApi";
import type { Job, JobUiState, PollUpdate, TranscriptResult, TranscriptSegment } from "../../types";
import {
  convertHistoryEntry,
  deriveFilenameFromResult,
  normalizeJobStatus,
  sanitizeProgressValue,
  stripFileExtension
} from "../../lib/utils";
import { coerceJobUiState, getJobUiState } from "../../lib/jobUiState";
import type { AppDispatch, RootState } from "../../store";
import { logger } from "../../lib/logger";

type JobsState = {
  jobsById: Record<string, Job>;
  order: string[];
  selectedJobId: string | null;
  loading: boolean;
  lastRestoreError: string | null;
};

const initialState: JobsState = {
  jobsById: {},
  order: [],
  selectedJobId: null,
  loading: false,
  lastRestoreError: null
};

function sortOrder(jobsById: Record<string, Job>): string[] {
  return Object.keys(jobsById).sort((a, b) => {
    const jobA = jobsById[a];
    const jobB = jobsById[b];
    const uiStateA = getJobUiState(jobA);
    const uiStateB = getJobUiState(jobB);
    const indexA = typeof uiStateA.media_order_index === "number" ? uiStateA.media_order_index : null;
    const indexB = typeof uiStateB.media_order_index === "number" ? uiStateB.media_order_index : null;
    if (indexA !== null && indexB !== null) {
      return indexA - indexB;
    }
    if (indexA !== null && indexB === null) {
      return 1;
    }
    if (indexA === null && indexB !== null) {
      return -1;
    }
    return (jobB?.startTime ?? 0) - (jobA?.startTime ?? 0);
  });
}

function moveIdToFront(order: string[], jobId: string) {
  const existingIndex = order.indexOf(jobId);
  if (existingIndex >= 0) {
    order.splice(existingIndex, 1);
  }
  order.unshift(jobId);
}

function ensureIdInOrder(order: string[], jobId: string) {
  if (!order.includes(jobId)) {
    order.unshift(jobId);
  }
}

function removeIdFromOrder(order: string[], jobId: string) {
  const index = order.indexOf(jobId);
  if (index >= 0) {
    order.splice(index, 1);
  }
}

export const bootstrapJobs = createAsyncThunk<
  { jobsById: Record<string, Job>; order: string[] },
  void,
  { state: RootState; dispatch: AppDispatch }
>("jobs/bootstrap", async (_, { dispatch }) => {
  try {
    const history = await dispatch(
      jobsApi.endpoints.getHistory.initiate(undefined, { subscribe: false, forceRefetch: true })
    ).unwrap();
    const entries = Array.isArray(history.jobs) ? history.jobs : [];
    const jobs = entries
      .map(convertHistoryEntry)
      .filter(Boolean)
      .map((job) => {
        if (job.status === "queued" || job.status === "processing") {
          return {
            ...job,
            status: "imported",
            progress: 0,
            message: ""
          };
        }
        return job;
      }) as Job[];
    const jobsById: Record<string, Job> = {};
    jobs.forEach((job) => {
      jobsById[job.id] = job;
    });
    return { jobsById, order: sortOrder(jobsById) };
  } catch {
    return { jobsById: {}, order: [] };
  }
});

export const fetchJobDetails = createAsyncThunk<
  { jobId: string; result?: TranscriptResult; meta?: Record<string, unknown>; status?: string; error?: string },
  { jobId: string },
  { state: RootState; dispatch: AppDispatch }
>("jobs/fetchJobDetails", async ({ jobId }, { dispatch }) => {
  const jobData = await dispatch(
    jobsApi.endpoints.getJob.initiate(jobId, { subscribe: false })
  ).unwrap();
  return {
    jobId,
    result: jobData.result,
    meta: (jobData.meta ?? {}) as Record<string, unknown>,
    status: jobData.status,
    error: jobData.error
  };
});

export const pollJobUpdates = createAsyncThunk<
  { jobId: string; updates: PollUpdate[] },
  { jobId: string },
  { state: RootState; dispatch: AppDispatch }
>("jobs/poll", async ({ jobId }, { dispatch }) => {
  const payload = await dispatch(
    jobsApi.endpoints.pollJob.initiate(jobId, { subscribe: false, forceRefetch: true })
  ).unwrap();
  let updates = Array.isArray(payload.updates) ? payload.updates : [];
  if (updates.length === 0) {
    try {
      const statusPayload = await dispatch(
        jobsApi.endpoints.getJob.initiate(jobId, { subscribe: false, forceRefetch: true })
      ).unwrap();
      if (statusPayload) {
        const meta = (statusPayload.meta ?? {}) as Record<string, unknown>;
        updates = [{
          event: "job_update",
          timestamp: Date.now(),
          data: {
            job_id: jobId,
            status: statusPayload.status,
            progress: (meta as { progress?: number }).progress ?? 0,
            message: (meta as { message?: string }).message ?? "",
            ...meta,
            result: statusPayload.result,
            error: statusPayload.error
          }
        }];
      }
    } catch {
      // Ignore status refresh errors; UI will retry on next poll.
    }
  }
  return { jobId, updates };
});

export const removeJob = createAsyncThunk<
  { jobId: string; message: string },
  { jobId: string; skipConfirm?: boolean; silent?: boolean },
  { state: RootState; dispatch: AppDispatch }
>("jobs/remove", async ({ jobId, skipConfirm, silent }, { dispatch }) => {
  if (!skipConfirm) {
    const confirmed = confirm("Remove this job and delete all related files?");
    if (!confirmed) {
      throw new Error("cancelled");
    }
  }
  const response = await dispatch(jobsApi.endpoints.removeJob.initiate(jobId)).unwrap();
  if (!response.success) {
    throw new Error(response.error || response.message || "Failed to remove job");
  }
  if (Array.isArray(response.warnings) && response.warnings.length > 0) {
    logger.warn("Job removal warnings:", response.warnings);
  }
  if (!silent) {
    // Notification handled in UI.
  }
  return { jobId, message: response.message || "Job removed" };
});

export const startTranscription = createAsyncThunk<
  { job: Job },
  {
    jobId?: string | null;
    file?: File;
    filePath?: string | null;
    filename: string;
    displayName?: string | null;
    mediaKind?: "audio" | "video";
    language: string;
    model: string;
    chineseStyle?: "spoken" | "written";
    chineseScript?: "traditional" | "simplified";
  },
  { state: RootState; dispatch: AppDispatch }
>(
  "jobs/startTranscription",
  async ({
    jobId,
    file,
    filePath,
    filename,
    displayName,
    mediaKind,
    language,
    model,
    chineseStyle,
    chineseScript
  }, { dispatch }) => {
    const result = await dispatch(
      mediaApi.endpoints.transcribeAudio.initiate({
        jobId,
        file,
        filePath,
        filename,
        displayName,
        mediaKind,
        model,
        language,
        chineseStyle,
        chineseScript
      })
    ).unwrap();

    const mediaHash = result.media_hash ?? null;
    const mediaSize = typeof result.media_size === "number"
      ? result.media_size
      : (typeof result.audio_file?.size === "number" ? result.audio_file.size : null);
    const mediaMtime = typeof result.media_mtime === "number" ? result.media_mtime : null;

    const audioFile = result.audio_file
      ? {
          name: result.audio_file.name || filename,
          size: mediaSize,
          path: result.audio_file.path ?? null,
          wasTranscoded: Boolean(result.audio_file.was_transcoded),
          hash: mediaHash,
          mtime: mediaMtime
        }
      : {
          name: filename,
          size: mediaSize,
          path: null,
          wasTranscoded: false,
          hash: mediaHash,
          mtime: mediaMtime
        };

    const jobDisplayName = displayName || stripFileExtension(filename) || filename;
    const job: Job = {
      id: result.job_id,
      filename,
      displayName: jobDisplayName,
      status: "queued",
      progress: 0,
      startTime: Date.now(),
      message: result.message || "Job submitted successfully",
      audioFile,
      mediaHash,
      mediaSize,
      mediaMtime,
      mediaInvalid: false,
      result: null,
      partialResult: null,
      error: null,
      currentStage: null
    };

    return { job };
  }
);

type ApplyUpdatePayload = { jobId: string; data: unknown };

function mergeUpdatePayload(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== "object") return {};
  const raw = data as Record<string, unknown>;
  const nested = raw.data && typeof raw.data === "object" ? raw.data as Record<string, unknown> : null;
  return nested ? { ...raw, ...nested } : raw;
}

function applyCompletion(job: Job, result: TranscriptResult) {
  job.status = "completed";
  job.progress = 100;
  job.result = result;
  job.partialResult = null;
  job.message = "Transcription completed!";
  job.completedAt = Date.now();

  const playbackPath = result.normalized_audio_path || job.audioFile?.path || null;
  if (playbackPath) {
    job.audioFile = job.audioFile ?? { name: job.filename, size: null, path: null };
    job.audioFile.path = playbackPath;
    if (!job.audioFile.name) {
      const parts = playbackPath.split(/[\\/]/);
      job.audioFile.name = parts[parts.length - 1] || "audio.wav";
    }
  }
}

function applyStreamingSegment(job: Job, segment: TranscriptSegment, totalSegments?: unknown) {
  if (!job.streamingSegments) {
    job.streamingSegments = [];
  }

  if (!["completed", "failed", "cancelled"].includes(job.status)) {
    job.status = "processing";
  }

  const existingIndex = job.streamingSegments.findIndex((s) => s.id === segment.id);
  if (existingIndex >= 0) {
    const previous = job.streamingSegments[existingIndex];
    const originalText = previous?.originalText !== undefined ? previous.originalText : previous?.text || "";
    segment.originalText = segment.text !== undefined ? segment.text : originalText;
    job.streamingSegments[existingIndex] = segment;
  } else {
    segment.originalText = segment.text || "";
    job.streamingSegments.push(segment);
  }

  const numericTotal = Number(totalSegments);
  if (Number.isFinite(numericTotal) && numericTotal > 0) {
    job.expectedSegments = numericTotal;
  }

  if (job.expectedSegments) {
    job.progress = Math.min(45, Math.floor((job.streamingSegments.length / job.expectedSegments) * 45));
  }
}

const slice = createSlice({
  name: "jobs",
  initialState,
  reducers: {
    addJob(state, action: PayloadAction<Job>) {
      const nextJob = {
        ...action.payload,
        displayName:
          action.payload.displayName ??
          (stripFileExtension(action.payload.filename) || action.payload.filename)
      };
      state.jobsById[action.payload.id] = nextJob;
      moveIdToFront(state.order, action.payload.id);
      state.selectedJobId = action.payload.id;
    },
    updateJobDisplayName(state, action: PayloadAction<{ jobId: string; displayName: string }>) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      job.displayName = action.payload.displayName;
    },
    setJobOrder(state, action: PayloadAction<string[]>) {
      state.order = action.payload.filter((id) => Boolean(state.jobsById[id]));
    },
    selectJob(state, action: PayloadAction<string | null>) {
      state.selectedJobId = action.payload;
    },
    clearAllJobs(state) {
      state.jobsById = {};
      state.order = [];
      state.selectedJobId = null;
    },
    updateJobUiState(state, action: PayloadAction<{ jobId: string; uiState: JobUiState }>) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      const existing = coerceJobUiState(job.uiState);
      const incoming = coerceJobUiState(action.payload.uiState);
      job.uiState = { ...existing, ...incoming };
    },
    applyJobUpdate(state, action: PayloadAction<ApplyUpdatePayload>) {
      const { jobId, data } = action.payload;
      const merged = mergeUpdatePayload(data);
      const isNewJob = !state.jobsById[jobId];
      if (isNewJob) {
        state.jobsById[jobId] = {
          id: jobId,
          filename: "Unknown file",
          displayName: "Unknown file",
          status: "queued",
          progress: 0,
          startTime: Date.now() - 15 * 60 * 1000,
          message: "Restoring job from update",
          audioFile: null,
          result: null,
          partialResult: null,
          error: null,
          currentStage: null
        };
      }

      const job = state.jobsById[jobId];
      if (isNewJob) {
        ensureIdInOrder(state.order, jobId);
      }

      const normalizedStatus = merged.status ? normalizeJobStatus(merged.status) : undefined;

      if (merged.message) {
        job.message = String(merged.message);
      }

      const incomingAudioMeta = merged.audio_file || (merged.meta && merged.meta.audio_file);
      const existingAudio = job.audioFile ?? undefined;
      const existingHash = job.mediaHash ?? existingAudio?.hash ?? null;
      const existingMtime = job.mediaMtime ?? existingAudio?.mtime ?? null;
      const existingSize = job.mediaSize ?? existingAudio?.size ?? null;
      if (incomingAudioMeta) {
        job.audioFile = {
          name: incomingAudioMeta.name || job.filename || job.id,
          size: typeof incomingAudioMeta.size === "number" ? incomingAudioMeta.size : null,
          path: incomingAudioMeta.path || null,
          hash: existingHash,
          mtime: existingMtime
        };
        job.mediaHash = existingHash;
        job.mediaMtime = existingMtime;
        job.mediaSize = typeof incomingAudioMeta.size === "number" ? incomingAudioMeta.size : existingSize;
      }

      if (normalizedStatus) {
        job.status = normalizedStatus;
      }

      if (merged.progress !== undefined) {
        const numericProgress = Number(merged.progress);
        if (!Number.isNaN(numericProgress)) {
          const clampedProgress = Math.max(0, Math.min(100, numericProgress));
          job.progress = clampedProgress;
          if (clampedProgress > 0 && !["completed", "failed", "cancelled"].includes(job.status)) {
            job.status = "processing";
          }
        }
      } else if (!normalizedStatus && merged.message && !["completed", "failed", "cancelled"].includes(job.status)) {
        job.status = "processing";
      }

      if (merged.stage) {
        job.currentStage = String(merged.stage);
      }

      if (merged.original_filename && typeof merged.original_filename === "string") {
        job.filename = merged.original_filename;
        if (!job.displayName) {
          job.displayName = stripFileExtension(merged.original_filename) || merged.original_filename;
        }
      }

      if (merged.segment || merged.type === "streaming_segment") {
        applyStreamingSegment(job, merged.segment, merged.total_segments);
      }

      if (merged.partial_result) {
        applyCompletion(job, merged.partial_result as TranscriptResult);
      }

      if (merged.result) {
        applyCompletion(job, merged.result as TranscriptResult);
        if (!job.filename) {
          job.filename = deriveFilenameFromResult(job.result, job.id);
        }
      }

      if (normalizedStatus === "completed" && !job.result) {
        job.status = "completed";
        job.progress = 100;
        job.message = job.message || "Job completed successfully";
      }

      if (merged.error) {
        job.status = "failed";
        job.error = String(merged.error);
      }

      job.lastSyncedAt = Date.now();
    },
    updateSegmentText(state, action: PayloadAction<{ jobId: string; segmentId: number; newText: string }>) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;

      const segmentId = action.payload.segmentId;
      const apply = (result: TranscriptResult | null | undefined) => {
        const segments = result?.segments;
        if (!segments || !Array.isArray(segments)) return;
        const index = segments.findIndex((s) => s.id === segmentId);
        if (index < 0) return;
        segments[index] = {
          ...segments[index],
          text: action.payload.newText,
          originalText: action.payload.newText
        };
      };
      apply(job.result);
      apply(job.partialResult);
    },
    updateSegmentTiming(
      state,
      action: PayloadAction<{ jobId: string; segmentId: number; start: number; end: number }>
    ) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      const segmentId = action.payload.segmentId;
      const apply = (result: TranscriptResult | null | undefined) => {
        const segments = result?.segments;
        if (!segments || !Array.isArray(segments)) return;
        const index = segments.findIndex((s) => s.id === segmentId);
        if (index < 0) return;
        segments[index] = {
          ...segments[index],
          start: action.payload.start,
          end: action.payload.end
        };
      };
      apply(job.result);
      apply(job.partialResult);
      if (job.streamingSegments && Array.isArray(job.streamingSegments)) {
        const index = job.streamingSegments.findIndex((s) => s.id === segmentId);
        if (index >= 0) {
          job.streamingSegments[index] = {
            ...job.streamingSegments[index],
            start: action.payload.start,
            end: action.payload.end
          };
        }
      }
    },
    addSegment(
      state,
      action: PayloadAction<{ jobId: string; segment: TranscriptSegment }>
    ) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      const segment = action.payload.segment;
      if (!job.result || !Array.isArray(job.result.segments)) {
        job.result = { ...(job.result ?? {}), segments: [] };
      }
      if (job.status === "imported") {
        job.status = "completed";
        job.progress = 100;
        job.completedAt = Date.now();
        if (!job.message || job.message === "Media imported") {
          job.message = "Captions updated";
        }
      }
      const apply = (result: TranscriptResult | null | undefined) => {
        if (!result) return;
        const segments = Array.isArray(result.segments) ? [...result.segments] : [];
        segments.push(segment);
        segments.sort((a, b) => a.start - b.start);
        result.segments = segments;
      };
      apply(job.result);
      apply(job.partialResult);
      if (job.streamingSegments && Array.isArray(job.streamingSegments)) {
        const next = [...job.streamingSegments, segment].sort((a, b) => a.start - b.start);
        job.streamingSegments = next;
      }
    },
    removeSegment(state, action: PayloadAction<{ jobId: string; segmentId: number }>) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      const segmentId = action.payload.segmentId;
      const apply = (result: TranscriptResult | null | undefined) => {
        if (!result || !Array.isArray(result.segments)) return;
        result.segments = result.segments.filter((seg) => seg.id !== segmentId);
      };
      apply(job.result);
      apply(job.partialResult);
      if (job.streamingSegments && Array.isArray(job.streamingSegments)) {
        job.streamingSegments = job.streamingSegments.filter((seg) => seg.id !== segmentId);
      }
    },
    setJobSegments(state, action: PayloadAction<{ jobId: string; segments: TranscriptSegment[] }>) {
      const job = state.jobsById[action.payload.jobId];
      if (!job) return;
      const hasSegments = action.payload.segments.length > 0;
      job.status = hasSegments ? "completed" : "imported";
      job.progress = hasSegments ? 100 : 0;
      job.message = hasSegments ? job.message || "Captions loaded" : "Media imported";
      job.completedAt = hasSegments ? Date.now() : undefined;
      job.result = {
        ...(job.result ?? {}),
        segments: action.payload.segments
      };
      job.partialResult = null;
      job.streamingSegments = undefined;
      job.lastSyncedAt = Date.now();
    },
    moveJobOrder(
      state,
      action: PayloadAction<{ jobId: string; targetJobId: string; position?: "before" | "after" }>
    ) {
      const { jobId, targetJobId, position } = action.payload;
      if (jobId === targetJobId) return;
      const fromIndex = state.order.indexOf(jobId);
      let toIndex = state.order.indexOf(targetJobId);
      if (fromIndex < 0 || toIndex < 0) return;
      if (position === "after") {
        toIndex += 1;
      }
      state.order.splice(fromIndex, 1);
      if (fromIndex < toIndex) {
        toIndex -= 1;
      }
      state.order.splice(toIndex, 0, jobId);
    }
  },
  extraReducers(builder) {
    builder
      .addCase(bootstrapJobs.pending, (state) => {
        state.loading = true;
        state.lastRestoreError = null;
      })
      .addCase(bootstrapJobs.fulfilled, (state, action) => {
        state.loading = false;
        state.jobsById = action.payload.jobsById;
        state.order = action.payload.order;
      })
      .addCase(bootstrapJobs.rejected, (state, action) => {
        state.loading = false;
        state.lastRestoreError = action.error.message || "Failed to restore jobs";
      })
      .addCase(fetchJobDetails.fulfilled, (state, action) => {
        const job = state.jobsById[action.payload.jobId];
        if (!job) {
          return;
        }

        const normalizedStatus = action.payload.status ? normalizeJobStatus(action.payload.status) : job.status;
        job.status = normalizedStatus;

        const meta = action.payload.meta ?? {};
        const message = meta.message;
        if (typeof message === "string" && message) {
          job.message = message;
        }

        if (meta.progress !== undefined) {
          job.progress = sanitizeProgressValue(meta.progress);
        }

        if (meta.stage !== undefined) {
          job.currentStage = String(meta.stage);
        }

        if (meta.original_filename && typeof meta.original_filename === "string") {
          job.filename = meta.original_filename;
          if (!job.displayName) {
            job.displayName = stripFileExtension(meta.original_filename) || meta.original_filename;
          }
        }

        const audioFileMeta =
          meta.audio_file && typeof meta.audio_file === "object"
            ? (meta.audio_file as Record<string, unknown>)
            : null;
        if (audioFileMeta) {
          const existingAudio = job.audioFile ?? undefined;
          const existingHash = job.mediaHash ?? existingAudio?.hash ?? null;
          const existingMtime = job.mediaMtime ?? existingAudio?.mtime ?? null;
          const existingSize = job.mediaSize ?? existingAudio?.size ?? null;
          job.audioFile = {
            name: (audioFileMeta.name as string | undefined) || job.filename || job.id,
            size: typeof audioFileMeta.size === "number" ? audioFileMeta.size : null,
            path: (audioFileMeta.path as string | undefined) || null,
            hash: existingHash,
            mtime: existingMtime
          };
          job.mediaHash = existingHash;
          job.mediaMtime = existingMtime;
          job.mediaSize = typeof audioFileMeta.size === "number" ? audioFileMeta.size : existingSize;
        }

        if (action.payload.result) {
          job.result = action.payload.result;
          job.partialResult = null;
          job.error = null;
          if (!job.filename) {
            job.filename = deriveFilenameFromResult(job.result, job.id);
          }
        }

        if (normalizedStatus === "failed") {
          job.error = action.payload.error || (meta.error as string) || job.error;
        }

        job.lastSyncedAt = Date.now();
      })
      .addCase(pollJobUpdates.fulfilled, (state, action) => {
        const job = state.jobsById[action.payload.jobId];
        if (!job) {
          return;
        }
        action.payload.updates.forEach((update) => {
          if (update.event === "job_update") {
            slice.caseReducers.applyJobUpdate(state, {
              type: "jobs/applyJobUpdate",
              payload: { jobId: action.payload.jobId, data: update.data }
            });
          }
        });
      })
      .addCase(removeJob.fulfilled, (state, action) => {
        delete state.jobsById[action.payload.jobId];
        if (state.selectedJobId === action.payload.jobId) {
          state.selectedJobId = null;
        }
        removeIdFromOrder(state.order, action.payload.jobId);
      })
      .addCase(startTranscription.fulfilled, (state, action) => {
        state.jobsById[action.payload.job.id] = action.payload.job;
        if (!state.order.includes(action.payload.job.id)) {
          moveIdToFront(state.order, action.payload.job.id);
        }
        state.selectedJobId = action.payload.job.id;
      });
  }
});

export const {
  addJob,
  applyJobUpdate,
  addSegment,
  clearAllJobs,
  updateJobDisplayName,
  updateJobUiState,
  selectJob,
  setJobSegments,
  setJobOrder,
  moveJobOrder,
  updateSegmentText,
  updateSegmentTiming,
  removeSegment
} = slice.actions;
export const jobsReducer = slice.reducer;

export const selectJobsState = (state: RootState) => state.jobs;
export const selectJobById = (state: RootState, jobId: string | null) =>
  jobId ? state.jobs.jobsById[jobId] ?? null : null;
