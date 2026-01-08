import { createSlice, type PayloadAction } from "@reduxjs/toolkit";

export type SettingsState = {
  language: string;
  model: "whisper";
  chineseStyle: "spoken" | "written" | "yue";
};

const initialState: SettingsState = {
  language: "auto",
  model: "whisper",
  chineseStyle: "written"
};

const slice = createSlice({
  name: "settings",
  initialState,
  reducers: {
    setLanguage(state, action: PayloadAction<SettingsState["language"]>) {
      state.language = action.payload;
      if (state.chineseStyle === "yue" && !["auto", "yue"].includes(String(action.payload))) {
        state.chineseStyle = "written";
      }
    },
    setModel(state, action: PayloadAction<SettingsState["model"]>) {
      state.model = action.payload;
    },
    setChineseStyle(state, action: PayloadAction<SettingsState["chineseStyle"]>) {
      state.chineseStyle = action.payload;
    }
  }
});

export const { setLanguage, setModel, setChineseStyle } = slice.actions;
export const settingsReducer = slice.reducer;
