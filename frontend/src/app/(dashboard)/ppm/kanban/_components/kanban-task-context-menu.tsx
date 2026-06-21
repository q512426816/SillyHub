"use client";

/**
 * KanbanTaskContextMenu — 对齐源 `TaskContextMenu.vue`。
 *
 * 源实现:position:fixed 浮层 + 全局 click/contextmenu 关闭。
 * 本仓用 AntD Dropdown trigger=contextmenu 包裹触发节点(更符合 React 范式,
 * 无需手动管理 document listener)。但卡片本身的 onContextMenu 需要同时承担
 * 两个职责:阻止默认菜单 + 打开 TaskDetailDrawer/触发 dropdown。
 *
 * 折中方案:本组件渲染为受控浮层(对齐源 task-context-menu DOM 形态),由父级
 * 通过 visible + position + task 控制;点菜单项后回调父级相应 handler。
 *
 * 删除走 Modal.confirm 二次确认(对齐源 ElMessageBox.confirm),调 store.deleteTask。
 */
import { useEffect } from "react";
import {
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  UserSwitchOutlined,
} from "@ant-design/icons";
import { Modal, message } from "antd";

import { ApiError } from "@/lib/api";
import { useKanbanStore } from "@/stores/kanban";
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
  onEdit,
  onAssign,
  onDeleted,
}: {
  state: ContextMenuState | null;
  onClose: () => void;
  onViewDetail: (task: KanbanTaskCard) => void;
  onEdit: (task: KanbanTaskCard) => void;
  onAssign: (task: KanbanTaskCard) => void;
  onDeleted?: () => void;
}) {
  const deleteTask = useKanbanStore((s) => s.deleteTask);

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

  const handleDelete = () => {
    onClose();
    Modal.confirm({
      title: "删除确认",
      content: `确定要删除任务「${task.title ?? "(未命名)"}」吗?此操作不可恢复。`,
      okText: "确定",
      cancelText: "取消",
      okType: "danger",
      onOk: async () => {
        try {
          await deleteTask(task.id);
          void message.success("任务删除成功");
          onDeleted?.();
        } catch (err) {
          if (err instanceof ApiError) {
            void message.error(err.message || "删除任务失败");
          }
        }
      },
    });
  };

  const itemCls =
    "flex w-full items-center gap-2 px-4 py-2 text-left text-sm text-foreground hover:bg-muted/50";
  const dangerCls = `${itemCls} text-destructive hover:bg-red-50`;

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
      <button className={itemCls} onClick={() => { onEdit(task); onClose(); }}>
        <EditOutlined /> 编辑任务
      </button>
      <button className={itemCls} onClick={() => { onAssign(task); onClose(); }}>
        <UserSwitchOutlined /> 分配给他人
      </button>
      <div className="my-1 h-px bg-border" />
      <button className={dangerCls} onClick={handleDelete}>
        <DeleteOutlined /> 删除任务
      </button>
    </div>
  );
}

export default KanbanTaskContextMenu;
