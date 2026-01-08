import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { ExportLanguage } from "../../types";

export type TranscriptState = {
  exportLanguage: ExportLanguage;
  timestampOffsetSeconds: number;
};

const initialState: TranscriptState = {
  exportLanguage: "traditional",
  timestampOffsetSeconds: 0
};

const slice = createSlice({
  name: "transcript",
  initialState,
  reducers: {
    setExportLanguage(state, action: PayloadAction<ExportLanguage>) {
      state.exportLanguage = action.payload;
    },
    setTimestampOffsetSeconds(state, action: PayloadAction<number>) {
      const value = Number(action.payload);
      state.timestampOffsetSeconds = Number.isFinite(value) ? Math.max(-30, Math.min(30, value)) : 0;
    }
  }
});

export const { setExportLanguage, setTimestampOffsetSeconds } = slice.actions;
export const transcriptReducer = slice.reducer;
