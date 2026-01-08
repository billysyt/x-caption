import { TranscriptPanel } from "./TranscriptPanel";
import type { ToastType } from "../../../components/common/ToastHost";
import type { ReactNode, RefObject } from "react";

export type CaptionPanelBodyProps = {
  captionSetupPanel: ReactNode;
  showCaptionSetup: boolean;
  transcriptMediaRef: RefObject<HTMLMediaElement>;
  notify: (message: string, type?: ToastType) => void;
  editEnabled: boolean;
  suppressEmptyState: boolean;
  containerClassName?: string;
};

export function CaptionPanelBody({
  captionSetupPanel,
  showCaptionSetup,
  transcriptMediaRef,
  notify,
  editEnabled,
  suppressEmptyState,
  containerClassName
}: CaptionPanelBodyProps) {
  return (
    <div className={containerClassName ?? ""}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        {showCaptionSetup ? captionSetupPanel : null}
        <div className="min-h-0 flex-1">
          <TranscriptPanel
            mediaRef={transcriptMediaRef}
            notify={notify}
            editEnabled={editEnabled}
            suppressEmptyState={suppressEmptyState}
          />
        </div>
      </div>
    </div>
  );
}
