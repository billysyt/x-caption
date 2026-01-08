import { memo, useCallback, useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { AppIcon } from "../../common/AppIcon";
import { cn } from "../../../lib/cn";
import type { SortableMediaRowProps } from "../upload.types";

export const SortableMediaRow = memo(function SortableMediaRow({
  item,
  updatedAt,
  isSelected,
  isProcessingJob,
  canReorder,
  viewMode,
  getPreviewKind,
  onActivate,
  onContextMenu,
  formatTimestamp
}: SortableMediaRowProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !canReorder
  });
  const pointerStartRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };
  const isListMode = viewMode === "list";
  const isYoutube = item.externalSource?.type === "youtube";
  const isExternal = isYoutube;
  const previewKind = getPreviewKind(item);
  const fallbackIcon = isYoutube ? "youtube" : previewKind === "video" ? "video" : "volume";
  const displayThumbnail = item.thumbnailUrl ?? item.externalSource?.thumbnailUrl ?? null;
  const displayName = item.displayName ?? item.name;
  const radiusClass = isListMode ? "rounded-md" : "rounded-lg";

  const handleActivate = useCallback(() => {
    onActivate(item);
  }, [onActivate, item]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onContextMenu(e, item);
  }, [onContextMenu, item]);

  return (
    <div ref={setNodeRef} style={style}>
      <button
        data-media-row
        className={cn(
          "relative w-full text-left transition focus:outline-none focus-visible:outline-none pywebview-no-drag",
          isListMode
            ? "bg-transparent px-2 py-1.5 hover:bg-[rgba(255,255,255,0.04)]"
            : "bg-transparent px-3 py-2 hover:bg-[rgba(255,255,255,0.04)]",
          radiusClass,
          canReorder && "cursor-grab active:cursor-grabbing",
          isDragging && "shadow-[0_12px_24px_rgba(0,0,0,0.35)]",
          isSelected && (isListMode ? "ring-1 ring-primary/40" : "ring-1 ring-primary/40 bg-[#1b1b22]"),
          item.invalid && "ring-1 ring-rose-500/40"
        )}
        {...attributes}
        {...listeners}
        onPointerDownCapture={(event) => {
          if (event.button !== 0) return;
          pointerStartRef.current = { x: event.clientX, y: event.clientY, id: event.pointerId };
        }}
        onPointerUpCapture={(event) => {
          const start = pointerStartRef.current;
          if (!start || start.id !== event.pointerId) return;
          pointerStartRef.current = null;
          if (event.button !== 0) return;
          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          if (dx * dx + dy * dy > 36) return;
          if (isDragging) return;
          handleActivate();
        }}
        onPointerCancel={() => {
          pointerStartRef.current = null;
        }}
        onClick={() => {
          if (isDragging) return;
          handleActivate();
        }}
        onContextMenu={handleContextMenu}
        type="button"
      >
        <div className={cn(isProcessingJob && "blur-[1px] opacity-70")}>
          {isListMode ? (
            <div className="flex w-full items-center gap-2">
              <div
                className={cn(
                  "flex h-7 w-7 items-center justify-center rounded-md bg-[#0f0f10]",
                  isYoutube ? "text-[#ef4444]" : "text-slate-200"
                )}
              >
                <AppIcon name={fallbackIcon} className="text-[13px]" />
              </div>
              <span
                className={cn(
                  "min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-100",
                  item.invalid && "text-rose-300"
                )}
              >
                {displayName}
              </span>
            </div>
          ) : (
            <div className="flex w-full items-center gap-3">
              {displayThumbnail && (previewKind === "video" || isExternal) ? (
                <div className="relative h-10 w-16 overflow-hidden rounded-md bg-[#0f0f10]">
                  <img src={displayThumbnail} alt="" className="h-full w-full object-cover" />
                  {isYoutube ? (
                    <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded bg-black/60">
                      <AppIcon name="youtube" className="text-[9px] text-[#ff0000]" />
                    </span>
                  ) : null}
                </div>
              ) : (
                <div
                  className={cn(
                    "flex h-10 w-16 items-center justify-center rounded-md bg-[#0f0f10]",
                    isYoutube ? "text-[#ef4444]" : "text-slate-300"
                  )}
                >
                  <AppIcon name={fallbackIcon} className="text-[14px]" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <span
                  className="block text-[12px] font-semibold leading-snug text-slate-100"
                  style={{
                    display: "-webkit-box",
                    WebkitLineClamp: 2,
                    WebkitBoxOrient: "vertical",
                    overflow: "hidden"
                  }}
                >
                  {displayName}
                </span>
                {updatedAt || item.invalid ? (
                  <div
                    className="mt-1 flex items-center gap-2 text-[10px] text-slate-500"
                    style={{ whiteSpace: "nowrap" }}
                  >
                    {updatedAt ? <span className="truncate">{formatTimestamp(updatedAt)}</span> : null}
                    {item.invalid ? (
                      <span className="inline-flex items-center gap-1 text-rose-400">
                        <AppIcon name="exclamationTriangle" className="text-[10px]" />
                        Invalid file
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          )}
        </div>
        {isProcessingJob ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-black/35",
              radiusClass
            )}
          >
            <div className="processing-spinner" aria-hidden>
              <span className="processing-bar processing-bar-1" />
              <span className="processing-bar processing-bar-2" />
              <span className="processing-bar processing-bar-3" />
              <span className="processing-bar processing-bar-4" />
            </div>
          </div>
        ) : null}
      </button>
    </div>
  );
});
