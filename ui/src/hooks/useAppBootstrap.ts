import { useEffect } from "react";
import { setVersion } from "../components/layout/uiSlice";
import { bootstrapJobs } from "../components/jobs/jobsSlice";
import type { AppDispatch } from "../store";
import { getAppVersion } from "../lib/window";

export function useAppBootstrap(dispatch: AppDispatch) {
  useEffect(() => {
    const appVersion = getAppVersion();
    if (appVersion) {
      dispatch(setVersion(appVersion));
    }
    dispatch(bootstrapJobs()).catch(() => undefined);
  }, [dispatch]);
}
