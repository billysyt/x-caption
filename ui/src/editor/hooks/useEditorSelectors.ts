import { useMemo } from "react";
import { useAppSelector } from "../../hooks";

export function useEditorSelectors() {
  const settings = useAppSelector((s) => s.settings);
  const exportLanguage = useAppSelector((s) => s.transcript.exportLanguage);
  const appVersion = useAppSelector((s) => s.app.version);
  const showExportModal = useAppSelector((s) => s.app.showExportModal);
  const showAboutModal = useAppSelector((s) => s.app.showAboutModal);
  const isPlayerModalOpen = useAppSelector((s) => s.app.isPlayerModalOpen);
  const isPlayerModalVisible = useAppSelector((s) => s.app.isPlayerModalVisible);
  const isLeftDrawerOpen = useAppSelector((s) => s.app.isLeftDrawerOpen);
  const isTranscriptEdit = useAppSelector((s) => s.app.isTranscriptEdit);
  const alertModal = useAppSelector((s) => s.app.alertModal);
  const jobsById = useAppSelector((s) => s.jobs.jobsById);
  const jobOrder = useAppSelector((s) => s.jobs.order);
  const selectedJobId = useAppSelector((s) => s.jobs.selectedJobId);

  const isTranscribing = useMemo(
    () =>
      jobOrder.some((id) => {
        const status = jobsById[id]?.status;
        return status === "queued" || status === "processing";
      }),
    [jobOrder, jobsById]
  );

  const selectedJob = useMemo(
    () => (selectedJobId ? jobsById[selectedJobId] : null),
    [jobsById, selectedJobId]
  );

  return {
    settings,
    exportLanguage,
    appVersion,
    showExportModal,
    showAboutModal,
    isPlayerModalOpen,
    isPlayerModalVisible,
    isLeftDrawerOpen,
    isTranscriptEdit,
    alertModal,
    jobsById,
    jobOrder,
    selectedJobId,
    isTranscribing,
    selectedJob
  };
}
