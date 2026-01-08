import { memo, forwardRef, useImperativeHandle, type ForwardedRef } from "react";
import { createPortal } from "react-dom";
import { DndContext, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";
import { SortableMediaRow } from "./SortableMediaRow";
import { useUploadTab, ACCEPTED_MEDIA_TYPES } from "../hooks/useUploadTab";
import type { UploadTabHandle, UploadTabProps } from "../upload.types";

export const UploadTab = memo(
  forwardRef(function UploadTab(props: UploadTabProps, ref: ForwardedRef<UploadTabHandle>) {
    const {
      viewMode,
      setViewMode,
      filterMode,
      setFilterMode,
      viewMenuOpen,
      setViewMenuOpen,
      filterMenuOpen,
      setFilterMenuOpen,
      contextMenu,
      setContextMenu,
      selectedId,
      fileInputRef,
      viewMenuRef,
      filterMenuRef,
      contextMenuRef,
      filteredMediaItems,
      hasMediaItems,
      canReorder,
      sortableIds,
      jobsById,
      getPreviewKind,
      formatTimestamp,
      handleDragEnd,
      handleMediaItemActivate,
      handleMediaItemContextMenu,
      handleRemoveJob,
      removeLocalItem,
      addLocalFiles,
      addLocalPathItem,
      submitTranscription,
      requestFilePicker,
      handleClearSelection,
      hasSelection
    } = useUploadTab(props);

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

    useImperativeHandle(ref, () => ({
      submitTranscription,
      hasSelection,
      openFilePicker: requestFilePicker,
      addLocalPathItem
    }));

    return (
      <>
        <div
          className="flex h-full min-h-0 flex-col space-y-3"
          onPointerDownCapture={(event) => {
            const target = event.target as HTMLElement;
            if (target.closest("[data-media-row]")) return;
            if (target.closest("[data-media-toolbar]")) return;
            if (target.closest("[data-media-menu]")) return;
            handleClearSelection();
          }}
        >
          {/* Toolbar */}
          <div className="flex items-center justify-between gap-2" data-media-toolbar>
            <span className="text-[11px] font-semibold text-slate-400">
              {filteredMediaItems.length} Job{filteredMediaItems.length === 1 ? "" : "s"}
            </span>
            <div className="flex items-center gap-2">
              {/* View Mode Menu */}
              <div className="relative" ref={viewMenuRef}>
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#1b1b22] text-[10px] text-slate-200 transition hover:bg-[#26262f]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setFilterMenuOpen(false);
                    setViewMenuOpen((prev) => !prev);
                  }}
                  type="button"
                  aria-label="View"
                  title="View"
                >
                  <AppIcon name="sort" />
                </button>
                {viewMenuOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 w-32 overflow-hidden rounded-lg border border-slate-800/70 bg-[#151515] text-[11px] text-slate-200 shadow-lg"
                    data-media-menu
                  >
                    {[
                      { id: "list-view", label: "List View" },
                      { id: "list", label: "List" }
                    ].map((option) => (
                      <button
                        key={option.id}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#1b1b22]",
                          viewMode === option.id && "bg-[#1b1b22] text-white"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setViewMode(option.id as "list-view" | "list");
                          setViewMenuOpen(false);
                        }}
                        type="button"
                      >
                        {option.label}
                        {viewMode === option.id ? <AppIcon name="check" className="text-[10px]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>

              {/* Filter Menu */}
              <div className="relative" ref={filterMenuRef}>
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-[#1b1b22] text-[10px] text-slate-200 transition hover:bg-[#26262f]"
                  onClick={(e) => {
                    e.stopPropagation();
                    setViewMenuOpen(false);
                    setFilterMenuOpen((prev) => !prev);
                  }}
                  type="button"
                  aria-label="Filter media"
                  title="Filter"
                >
                  <AppIcon name="filter" />
                </button>
                {filterMenuOpen ? (
                  <div
                    className="absolute right-0 z-50 mt-2 w-36 overflow-hidden rounded-lg border border-slate-800/70 bg-[#151515] text-[11px] text-slate-200 shadow-lg"
                    data-media-menu
                  >
                    {[
                      { id: "all", label: "All" },
                      { id: "video", label: "Video" },
                      { id: "audio", label: "Audio" }
                    ].map((option) => (
                      <button
                        key={option.id}
                        className={cn(
                          "flex w-full items-center justify-between px-3 py-2 text-left hover:bg-[#1b1b22]",
                          filterMode === option.id && "bg-[#1b1b22] text-white"
                        )}
                        onClick={(e) => {
                          e.stopPropagation();
                          setFilterMode(option.id as "all" | "video" | "audio");
                          setFilterMenuOpen(false);
                        }}
                        type="button"
                      >
                        {option.label}
                        {filterMode === option.id ? <AppIcon name="check" className="text-[10px]" /> : null}
                      </button>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {/* Media List */}
          <div
            className={cn("flex-1 rounded-xl p-1")}
            onDragOver={(e) => {
              const types = Array.from(e.dataTransfer?.types ?? []);
              if (!types.includes("Files")) return;
              e.preventDefault();
            }}
            onDragLeave={(e) => {
              e.preventDefault();
            }}
            onDrop={(e) => {
              const types = Array.from(e.dataTransfer?.types ?? []);
              if (!types.includes("Files")) return;
              e.preventDefault();
              const files = Array.from(e.dataTransfer.files || []);
              if (files.length) addLocalFiles(files);
            }}
          >
            <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
              <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
                <div className={cn(viewMode === "list" ? "space-y-px" : "space-y-2")}>
                  {filteredMediaItems.map((item) => {
                    const job = item.source === "job" && item.jobId ? jobsById[item.jobId] : null;
                    const updatedAt = job?.completedAt ?? job?.startTime ?? item.createdAt ?? null;
                    const isSelected = selectedId === item.id;
                    const isProcessingJob = job?.status === "processing" || job?.status === "queued";
                    return (
                      <SortableMediaRow
                        key={item.id}
                        item={item}
                        updatedAt={updatedAt}
                        isSelected={isSelected}
                        isProcessingJob={isProcessingJob}
                        canReorder={canReorder}
                        viewMode={viewMode}
                        getPreviewKind={getPreviewKind}
                        onActivate={handleMediaItemActivate}
                        onContextMenu={handleMediaItemContextMenu}
                        formatTimestamp={formatTimestamp}
                      />
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
            {!hasMediaItems ? (
              <div className="py-6 text-center text-[11px] text-slate-500">
                No media yet. Use Open in the header to add a file.
              </div>
            ) : null}
          </div>

          {/* Context Menu */}
          {contextMenu && typeof document !== "undefined"
            ? createPortal(
                <div
                  ref={contextMenuRef}
                  className="fixed z-[2000] min-w-[160px] overflow-hidden rounded-lg border border-slate-800/70 bg-[#151515] text-[11px] text-slate-200 shadow-xl"
                  data-media-menu
                  style={{ left: contextMenu.x, top: contextMenu.y }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#1b1b22]"
                    onClick={(e) => {
                      e.preventDefault();
                      const target = contextMenu.item;
                      setContextMenu(null);
                      if (target.source === "local") {
                        removeLocalItem(target);
                      } else if (target.jobId) {
                        void handleRemoveJob(e, target.jobId);
                      }
                    }}
                    type="button"
                  >
                    <AppIcon name="trashAlt" />
                    Remove
                  </button>
                </div>,
                document.body
              )
            : null}

          {/* Hidden File Input */}
          <input
            ref={fileInputRef}
            type="file"
            accept={ACCEPTED_MEDIA_TYPES}
            className="hidden"
            onChange={() => {
              const files = Array.from(fileInputRef.current?.files ?? []);
              if (files.length) addLocalFiles(files);
            }}
          />
        </div>
      </>
    );
  })
);

export type { UploadTabHandle, UploadTabProps, MediaItem, MediaSourceInfo } from "../upload.types";
