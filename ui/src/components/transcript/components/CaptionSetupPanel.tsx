import { Select } from "../../../components/common/Select";
import { cn } from "../../../lib/cn";
import { LANGUAGE_OPTIONS } from "../../../lib/languageOptions";
import type { SettingsState } from "../../settings/settingsSlice";

export type CaptionSetupPanelProps = {
  settings: SettingsState;
  captionControlsDisabled: boolean;
  isCantoneseLanguage: boolean;
  onLanguageChange: (value: SettingsState["language"]) => void;
  onChineseStyleChange: (value: SettingsState["chineseStyle"]) => void;
  generateCaptionLabel: string;
  onGenerateCaptions: () => void;
  isGenerateDisabled: boolean;
};

export function CaptionSetupPanel({
  settings,
  captionControlsDisabled,
  isCantoneseLanguage,
  onLanguageChange,
  onChineseStyleChange,
  generateCaptionLabel,
  onGenerateCaptions,
  isGenerateDisabled
}: CaptionSetupPanelProps) {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <label className="text-[11px] font-semibold text-slate-400" htmlFor="languageSelect">
          Language
        </label>
        <Select
          className={cn("stt-select-dark", captionControlsDisabled && "opacity-60")}
          id="language"
          buttonId="languageSelect"
          value={String(settings.language)}
          options={LANGUAGE_OPTIONS}
          onChange={(value) => onLanguageChange(value as SettingsState["language"])}
          disabled={captionControlsDisabled}
        />
      </div>
      {isCantoneseLanguage && (
        <div className="space-y-2">
          <label className="text-[11px] font-semibold text-slate-400" htmlFor="chineseStyleSelect">
            Cantonese Output Style
          </label>
          <Select
            className={cn(
              "stt-select-dark",
              captionControlsDisabled && "opacity-60"
            )}
            id="chineseStyle"
            buttonId="chineseStyleSelect"
            value={String(settings.chineseStyle)}
            options={[
              { value: "written", label: "Written (書面語)" },
              { value: "spoken", label: "Spoken (口語)" },
              { value: "yue", label: "English (英文)" } // Yue is correct in this model
            ]}
            onChange={(value) => onChineseStyleChange(value as SettingsState["chineseStyle"])}
            disabled={captionControlsDisabled}
          />
        </div>
      )}
      <div className="pt-2">
        <button
          className={cn(
            "inline-flex w-full items-center justify-center rounded-md bg-[#1b1b22] px-3 py-2.5 text-[11.5px] font-semibold text-slate-200 transition hover:bg-[#26262f]",
            isGenerateDisabled ? "cursor-not-allowed opacity-60 hover:bg-[#1b1b22]" : ""
          )}
          onClick={onGenerateCaptions}
          disabled={isGenerateDisabled}
          type="button"
        >
          {generateCaptionLabel}
        </button>
      </div>
    </div>
  );
}
