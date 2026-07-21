"use client";

/**
 * 问题清单 Drawer 分发器 — 3 态简化后只承载 新建/编辑 (2026-07-20)。
 *
 * 审批/处置/验证/变更等 6 态入口已删除:
 *  - 详情/执行 → 走公共弹窗 ProblemDetailModal (page.tsx 直接控制)
 *  - 开始       → page.tsx handleStart 调 startProblem API
 *  - 变更       → 变更流 deprecated (D-005), 前端入口移除
 *
 * 设计依据:.sillyspec/changes/2026-07-20-problem-list-align-task-plan/design.md
 */
import { Modal } from "antd";

import { PROBLEM_STATUS_TEXT } from "@/components/ppm-status-actions";
import type { ProblemList } from "@/lib/ppm";
import { ProblemCreateForm } from "./_forms";

export type ProblemDrawerMode = "create" | "edit";

export interface ProblemDrawerProps {
  open: boolean;
  mode: ProblemDrawerMode;
  problem?: ProblemList;
  onClose: () => void;
  onSaved: () => void;
}

const TITLE: Record<ProblemDrawerMode, string> = {
  create: "新建问题",
  edit: "编辑问题",
};

export function ProblemDrawer({
  open,
  mode,
  problem,
  onClose,
  onSaved,
}: ProblemDrawerProps) {
  return (
    <Modal
      open={open}
      title={
        <span>
          {TITLE[mode]}
          {problem && (
            <span className="ml-2 text-xs text-muted-foreground">
              {PROBLEM_STATUS_TEXT[problem.status] ?? problem.status}
            </span>
          )}
        </span>
      }
      width={680}
      onCancel={onClose}
      destroyOnClose
      maskClosable={false}
    >
      <ProblemCreateForm
        problem={mode === "edit" ? problem : undefined}
        onSuccess={onSaved}
        onCancel={onClose}
      />
    </Modal>
  );
}
