import { useCallback, useEffect, useMemo } from "react";
import { buildUpdateModalInfo, type UpdateModalInfo } from "../../../lib/update";
import { compareVersions } from "../../../lib/format";
import { useAppDispatch, useAppSelector } from "../../../hooks";
import { setUpdateModal as setUpdateModalAction } from "../../layout/uiSlice";
import { getEnvAppVersion, getUpdateCheckUrl, getUpdateProject } from "../../../lib/env";
import { logger } from "../../../lib/logger";

export function useUpdateCheck(appVersion: string | null) {
  const dispatch = useAppDispatch();
  const updateModal = useAppSelector((state) => state.app.updateModal);
  const setUpdateModal = useCallback(
    (value: UpdateModalInfo | null) => {
      dispatch(setUpdateModalAction(value));
    },
    [dispatch]
  );

  useEffect(() => {
    const updateUrl = getUpdateCheckUrl();
    if (!updateUrl) {
      logger.debug("[UpdateCheck] VITE_UPDATE_CHECK_URL not configured, skipping update check");
      return;
    }
    const fallbackVersion = appVersion || getEnvAppVersion();
    const updateProject = getUpdateProject();

    logger.debug("[UpdateCheck] Initializing:", {
      updateUrl,
      project: updateProject,
      version: fallbackVersion
    });

    let cancelled = false;
    const loadCachedUpdate = async () => {
      try {
        logger.debug("[UpdateCheck] Loading cached update...");
        const response = await fetch(`/api/update/cache?project=${encodeURIComponent(updateProject)}`, {
          cache: "no-store"
        });
        if (!response.ok) {
          logger.debug("[UpdateCheck] Cache not found or error:", response.status);
          return;
        }
        const cached = await response.json();
        if (cancelled || !cached) return;
        const cachedPayload = cached?.payload ?? null;
        logger.debug("[UpdateCheck] Cached update loaded:", cachedPayload ? "yes" : "no");
        const info = buildUpdateModalInfo(cachedPayload, fallbackVersion, updateProject);
        if (info) {
          logger.debug("[UpdateCheck] Update modal set:", info);
          setUpdateModal(info);
        }
      } catch (error) {
        logger.error("[UpdateCheck] Error loading cache:", error);
      }
    };
    const storeCachedUpdate = async (payload: unknown) => {
      try {
        logger.debug("[UpdateCheck] Storing update cache...");
        await fetch("/api/update/cache", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ project: updateProject, payload })
        });
        logger.debug("[UpdateCheck] Update cache stored successfully");
      } catch (error) {
        logger.error("[UpdateCheck] Error storing cache:", error);
      }
    };
    const fetchLatestUpdate = async () => {
      try {
        const url = new URL(updateUrl, window.location.origin);
        if (updateProject) {
          url.searchParams.set("project", updateProject);
        }
        if (fallbackVersion) {
          url.searchParams.set("current", fallbackVersion);
        }

        // Use backend proxy to avoid CORS issues
        const proxyUrl = `/api/update/fetch?url=${encodeURIComponent(url.toString())}`;
        logger.debug("[UpdateCheck] Fetching latest update via proxy:", proxyUrl);

        const response = await fetch(proxyUrl, { cache: "no-store" });
        if (!response.ok) {
          logger.debug("[UpdateCheck] Fetch failed:", response.status, response.statusText);
          return;
        }
        const payload = await response.json();
        logger.debug("[UpdateCheck] Latest update fetched:", payload);
        if (cancelled || !payload) return;
        await storeCachedUpdate(payload);
        if (cancelled) return;
        await loadCachedUpdate();
      } catch (error) {
        logger.error("[UpdateCheck] Error fetching update:", error);
      }
    };
    void loadCachedUpdate();
    void fetchLatestUpdate();
    return () => {
      cancelled = true;
    };
  }, [appVersion, setUpdateModal]);

  const { updateAvailable, updateForceRequired, updateLatestVersion, updateCurrentVersion } = useMemo(() => {
    const updateLatest = updateModal?.latestVersion ?? null;
    const updateCurrent = updateModal?.currentVersion ?? appVersion ?? null;
    const available = updateModal
      ? updateModal.updateAvailable ??
        (updateLatest && updateCurrent ? compareVersions(updateLatest, updateCurrent) > 0 : false)
      : false;
    return {
      updateAvailable: available,
      updateForceRequired: updateModal ? Boolean(updateModal.forceUpdate) : false,
      updateLatestVersion: updateLatest,
      updateCurrentVersion: updateCurrent
    };
  }, [appVersion, updateModal]);

  return {
    updateModal,
    setUpdateModal,
    updateAvailable,
    updateForceRequired,
    updateLatestVersion,
    updateCurrentVersion
  };
}
