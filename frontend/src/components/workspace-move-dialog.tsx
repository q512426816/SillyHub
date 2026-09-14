"use client";

import { useEffect, useState } from "react";
import { Modal, Select } from "antd";

import type { Workspace } from "@/lib/workspaces";

/**
 * task-09 / 2026-09-14-workspace-drag-sort / FR-06 / D-009@v2：
 * 「移动到…」弹窗（antd Modal + Select 受控，对照原型 §移动到…弹窗——
 * 目标页 + 页首/页尾两下拉）。「某卡前后」的精确落位由页内拖拽覆盖，
 * 弹窗不重复提供。
 *
 * 纯受控组件边界：不拉数据不发请求——目标页数据获取与锚点方向规则
 * （页首向上 before/向下 after=目标页第一张；页尾对偶；同页页首 before、
 * 页尾 after；自锚跳过）全由父级 page.tsx 的 onConfirm 提交流程实现。
 */

/** 页内位置（「页首」=目标页第一张前，「页尾」=目标页最后一张后）。 */
export type WorkspaceMovePosition = "first" | "last";

/** 弹窗提交意图（onConfirm 上抛）：page 为 0 基目标页。 */
export interface WorkspaceMoveTarget {
  /** 目标页（0 基） */
  page: number;
  /** 页内位置（页首/页尾） */
  position: WorkspaceMovePosition;
}

interface Props {
  open: boolean;
  /** 被移动工作区（null 时弹窗内容空挂，open 由父级联动控制） */
  workspace: Workspace | null;
  /** 当前页（0 基）——打开时默认选中的目标页 */
  currentPage: number;
  /** 目标页总数（按默认视图分页 N=ceil(total/WORKSPACE_PAGE_SIZE)） */
  totalPages: number;
  /** 筛选禁拖态（D-005@v2）：确认按钮禁用兜底，杜绝非默认视图发出 move */
  disabled?: boolean;
  /** 提交中（父级拉目标页 + moveWorkspace 期间） */
  confirmLoading?: boolean;
  onConfirm: (_target: WorkspaceMoveTarget) => void;
  onCancel: () => void;
}

const POSITION_OPTIONS: { value: WorkspaceMovePosition; label: string }[] = [
  { value: "first", label: "页首" },
  { value: "last", label: "页尾" },
];

export function WorkspaceMoveDialog({
  open,
  workspace,
  currentPage,
  totalPages,
  disabled = false,
  confirmLoading = false,
  onConfirm,
  onCancel,
}: Props) {
  // 内部受控选择：每次打开重置为「当前页 + 页首」（原型 openModal 同款默认）。
  const [targetPage, setTargetPage] = useState(currentPage);
  const [position, setPosition] = useState<WorkspaceMovePosition>("first");

  useEffect(() => {
    if (open) {
      setTargetPage(currentPage);
      setPosition("first");
    }
  }, [open, currentPage]);

  const pageOptions = Array.from({ length: Math.max(1, totalPages) }, (_, i) => ({
    value: i,
    label: `第 ${i + 1} 页`,
  }));

  const title = workspace
    ? `移动工作区「${workspace.display_alias ?? workspace.name}」`
    : "移动工作区";

  return (
    <Modal
      title={title}
      open={open}
      onOk={() => onConfirm({ page: targetPage, position })}
      onCancel={onCancel}
      okText="移动"
      cancelText="取消"
      confirmLoading={confirmLoading}
      okButtonProps={{ disabled: disabled && !confirmLoading }}
      destroyOnClose
    >
      <div className="space-y-3 pt-1">
        <div>
          <p className="mb-1 text-xs text-muted-foreground">目标页</p>
          <Select
            aria-label="目标页"
            value={targetPage}
            onChange={setTargetPage}
            className="w-full"
            options={pageOptions}
            disabled={disabled}
          />
        </div>
        <div>
          <p className="mb-1 text-xs text-muted-foreground">页内位置</p>
          <Select
            aria-label="页内位置"
            value={position}
            onChange={setPosition}
            className="w-full"
            options={POSITION_OPTIONS}
            disabled={disabled}
          />
        </div>
        <p className="text-xs text-muted-foreground">
          精确到某张卡的前后，请直接在列表中拖拽；此处仅支持整页页首/页尾移动。
        </p>
      </div>
    </Modal>
  );
}
