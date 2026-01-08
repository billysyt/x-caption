import { useEditorModel } from "./useEditorModel";

export function useEditorState() {
  const editor = useEditorModel();

  return {
    layoutClass: editor.layoutClass,
    isCompact: editor.isCompact,
    dragRegionClass: editor.dragRegionClass,
    setIsLeftDrawerOpen: editor.setIsLeftDrawerOpen,
    compactTab: editor.compactTab,
    setCompactTab: editor.setCompactTab,
    segments: editor.segments,
    isTranscriptEdit: editor.isTranscriptEdit,
    setIsTranscriptEdit: editor.setIsTranscriptEdit,
    playerPanel: editor.playerPanel,
    leftPanelContent: editor.leftPanelContent,
    captionSidebarContent: editor.captionSidebarContent,
    timelinePanelProps: editor.timelinePanelProps,
    isPlayerModalVisible: editor.isPlayerModalVisible,
    headerBarProps: editor.headerBarProps,
    overlaysProps: editor.overlaysProps,
    srtInputRef: editor.srtInputRef,
    handleSrtSelected: editor.handleSrtSelected,
    audioRef: editor.audioRef,
    audioPreviewSrc: editor.audioPreviewSrc
  };
}

export type EditorState = ReturnType<typeof useEditorState>;
