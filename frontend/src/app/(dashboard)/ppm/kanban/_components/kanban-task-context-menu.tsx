"use client";

/**
 * KanbanTaskContextMenu — 右键菜单，仅保留查看详情。
 *
 * 根据用户要求，团队计划排程表右键菜单移除了编辑任务/分配给他人/删除任务。
 */
import { useEffect } from "react";
import { EyeOutlined } from "@ant-design/icons";

import type { KanbanTaskCard } from "@/lib/ppm/types";

export interface ContextMenuState {
  task: KanbanTaskCard;
  x: number;
  y: number;
}

export function KanbanTaskContextMenu({
  state,
  onClose,
  onViewDetail,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
  onViewDetail: (task: KanbanTaskCard) => void;
}) {
  // 全局点击/右键/滚动关闭(对齐源 document.addEventListener)
  useEffect(() => {
    if (!state) return;
    const hide = () => onClose();
    document.addEventListener("click", hide);
    document.addEventListener("contextmenu", hide);
    document.addEventListener("scroll", hide, true);
    return () => {
      document.removeEventListener("click", hide);
      document.removeEventListener("contextmenu", hide);
      document.removeEventListener("scroll", hide, true);
    };
  }, [state, onClose]);

  if (!state) return null;
  const { task, x, y } = state;

  // 防止超出视口右下
  const left = Math.min(x, window.innerWidth - 180);
  const top = Math.min(y, window.innerHeight - 200);

  const itemCls =
    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-foreground hover:bg-muted/50";

  return (
    <div
      className="fixed z-[9999] min-w-40 rounded-md border border-border bg-popover py-1 shadow-lg"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <button className={itemCls} onClick={() => { onViewDetail(task); onClose(); }}>
        <EyeOutlined /> 查看详情
      </button>
    </div>
  );
}

export default KanbanTaskContextMenu;
