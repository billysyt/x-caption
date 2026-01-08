import { createSlice, type PayloadAction } from "@reduxjs/toolkit";
import type { AppTab } from "../../types";
import type { UpdateModalInfo } from "../../lib/update";
import type { ToastType } from "../../components/common/ToastHost";

type AppState = {
  activeTab: AppTab;
  version: string | null;
  showExportModal: boolean;
  showAboutModal: boolean;
  updateModal: UpdateModalInfo | null;
  alertModal: { title: string; message: string; tone: ToastType } | null;
  isPlayerModalOpen: boolean;
  isPlayerModalVisible: boolean;
  isLeftDrawerOpen: boolean;
  isTranscriptEdit: boolean;
};

const initialState: AppState = {
  activeTab: "media",
  version: null,
  showExportModal: false,
  showAboutModal: false,
  updateModal: null,
  alertModal: null,
  isPlayerModalOpen: false,
  isPlayerModalVisible: false,
  isLeftDrawerOpen: false,
  isTranscriptEdit: false
};

const slice = createSlice({
  name: "app",
  initialState,
  reducers: {
    setActiveTab(state, action: PayloadAction<AppTab>) {
      state.activeTab = action.payload;
    },
    setVersion(state, action: PayloadAction<string>) {
      state.version = action.payload;
    },
    setShowExportModal(state, action: PayloadAction<boolean>) {
      state.showExportModal = action.payload;
    },
    setShowAboutModal(state, action: PayloadAction<boolean>) {
      state.showAboutModal = action.payload;
    },
    setUpdateModal(state, action: PayloadAction<UpdateModalInfo | null>) {
      state.updateModal = action.payload;
    },
    setAlertModal(state, action: PayloadAction<{ title: string; message: string; tone: ToastType } | null>) {
      state.alertModal = action.payload;
    },
    setIsPlayerModalOpen(state, action: PayloadAction<boolean>) {
      state.isPlayerModalOpen = action.payload;
    },
    setIsPlayerModalVisible(state, action: PayloadAction<boolean>) {
      state.isPlayerModalVisible = action.payload;
    },
    setIsLeftDrawerOpen(state, action: PayloadAction<boolean>) {
      state.isLeftDrawerOpen = action.payload;
    },
    setIsTranscriptEdit(state, action: PayloadAction<boolean>) {
      state.isTranscriptEdit = action.payload;
    }
  }
});

export const {
  setActiveTab,
  setVersion,
  setShowExportModal,
  setShowAboutModal,
  setUpdateModal,
  setAlertModal,
  setIsPlayerModalOpen,
  setIsPlayerModalVisible,
  setIsLeftDrawerOpen,
  setIsTranscriptEdit
} = slice.actions;
export const uiReducer = slice.reducer;
