import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type MediaImportState = {
  modals: {
    open: boolean;
    youtube: boolean;
    urlDownload: boolean;
    import: boolean;
  };
  youtube: {
    url: string;
    importing: boolean;
    error: string | null;
    progress: number | null;
    importId: string | null;
    title: string | null;
    status: string | null;
  };
  urlDownload: {
    url: string;
    savePath: string;
    importing: boolean;
    error: string | null;
    progress: number | null;
    downloadedBytes: number | null;
    totalBytes: number | null;
    totalBytesEstimate: number | null;
    fragmentIndex: number | null;
    fragmentCount: number | null;
    importId: string | null;
    title: string | null;
    status: string | null;
  };
};

type MediaImportPatch = {
  modals?: Partial<MediaImportState["modals"]>;
  youtube?: Partial<MediaImportState["youtube"]>;
  urlDownload?: Partial<MediaImportState["urlDownload"]>;
};

const initialState: MediaImportState = {
  modals: {
    open: false,
    youtube: false,
    urlDownload: false,
    import: false
  },
  youtube: {
    url: "",
    importing: false,
    error: null,
    progress: null,
    importId: null,
    title: null,
    status: null
  },
  urlDownload: {
    url: "",
    savePath: "",
    importing: false,
    error: null,
    progress: null,
    downloadedBytes: null,
    totalBytes: null,
    totalBytesEstimate: null,
    fragmentIndex: null,
    fragmentCount: null,
    importId: null,
    title: null,
    status: null
  }
};

const slice = createSlice({
  name: "mediaImport",
  initialState,
  reducers: {
    patchMediaImport(state, action: PayloadAction<MediaImportPatch>) {
      const { modals, youtube, urlDownload } = action.payload;
      if (modals) {
        state.modals = { ...state.modals, ...modals };
      }
      if (youtube) {
        state.youtube = { ...state.youtube, ...youtube };
      }
      if (urlDownload) {
        state.urlDownload = { ...state.urlDownload, ...urlDownload };
      }
    },
    resetYoutubeRuntime(state) {
      state.youtube.importing = false;
      state.youtube.error = null;
      state.youtube.progress = null;
      state.youtube.importId = null;
      state.youtube.title = null;
      state.youtube.status = null;
    },
    resetMediaImport(state) {
      state.modals = { ...initialState.modals };
      state.youtube = { ...initialState.youtube };
      state.urlDownload = { ...initialState.urlDownload };
    }
  }
});

export const { patchMediaImport, resetYoutubeRuntime, resetMediaImport } = slice.actions;
export const mediaImportReducer = slice.reducer;
