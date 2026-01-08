import type { Job, JobUiState } from "../types";

export function coerceJobUiState(value: unknown): JobUiState {
  if (!value || typeof value !== "object") return {};
  return value as JobUiState;
}

export function getJobUiState(job: Job | null | undefined): JobUiState {
  return coerceJobUiState(job?.uiState);
}
