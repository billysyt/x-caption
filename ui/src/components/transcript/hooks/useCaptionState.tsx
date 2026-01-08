import type { RefObject } from "react";
import { CaptionSetupPanel } from "../components/CaptionSetupPanel";
import { CaptionPanelBody } from "../components/CaptionPanelBody";
import type { SettingsState } from "../../settings/settingsSlice";
import type { ToastType } from "../../../components/common/ToastHost";

export function useCaptionState(params: {
  settings: SettingsState;
  captionControlsDisabled: boolean;
  isCantoneseLanguage: boolean;
  onLanguageChange: (value: SettingsState["language"]) => void;
  onChineseStyleChange: (value: SettingsState["chineseStyle"]) => void;
  generateCaptionLabel: string;
  onGenerateCaptions: () => void | Promise<void>;
  isGenerateDisabled: boolean;
  showCaptionSetup: boolean;
  transcriptMediaRef: RefObject<HTMLMediaElement>;
  notify: (message: string, type?: ToastType) => void;
  editEnabled: boolean;
}) {
  const {
    settings,
    captionControlsDisabled,
    isCantoneseLanguage,
    onLanguageChange,
    onChineseStyleChange,
    generateCaptionLabel,
    onGenerateCaptions,
    isGenerateDisabled,
    showCaptionSetup,
    transcriptMediaRef,
    notify,
    editEnabled
  } = params;

  const captionSetupPanel = (
    <CaptionSetupPanel
      settings={settings}
      captionControlsDisabled={captionControlsDisabled}
      isCantoneseLanguage={isCantoneseLanguage}
      onLanguageChange={onLanguageChange}
      onChineseStyleChange={onChineseStyleChange}
      generateCaptionLabel={generateCaptionLabel}
      onGenerateCaptions={onGenerateCaptions}
      isGenerateDisabled={isGenerateDisabled}
    />
  );

  const compactCaptionsPanel = (
    <CaptionPanelBody
      captionSetupPanel={captionSetupPanel}
      showCaptionSetup={showCaptionSetup}
      transcriptMediaRef={transcriptMediaRef}
      notify={notify}
      editEnabled={editEnabled}
      suppressEmptyState={showCaptionSetup}
      containerClassName="min-h-0 h-[calc(100vh-320px)] max-h-[calc(100vh-320px)] w-full overflow-hidden"
    />
  );

  const captionSidebarContent = (
    <CaptionPanelBody
      captionSetupPanel={captionSetupPanel}
      showCaptionSetup={showCaptionSetup}
      transcriptMediaRef={transcriptMediaRef}
      notify={notify}
      editEnabled={editEnabled}
      suppressEmptyState={showCaptionSetup}
      containerClassName="min-h-0 h-[calc(100vh-340px)] max-h-[calc(100vh-340px)] overflow-hidden"
    />
  );

  const captionSidebarModalContent = (
    <CaptionPanelBody
      captionSetupPanel={captionSetupPanel}
      showCaptionSetup={showCaptionSetup}
      transcriptMediaRef={transcriptMediaRef}
      notify={notify}
      editEnabled={editEnabled}
      suppressEmptyState={showCaptionSetup}
      containerClassName="flex h-full min-h-0 flex-col"
    />
  );

  return {
    captionSetupPanel,
    compactCaptionsPanel,
    captionSidebarContent,
    captionSidebarModalContent
  };
}
