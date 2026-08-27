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
 *
 * task-05（2026-08-28-session-ppm-task-binding / FR-04）：编辑态（problem 实体
 * 已存在）底部挂「💬 发起会话」入口 + 关联会话卡（ppm-item-sessions-card）——
 * 入口写 pendingPpmItem 挂起位 + requestNewSession 唤起悬浮抽屉预会话（绑定经
 * 挂起位构造，宿主解析项目第一个关联工作区预填）；新建态无实体 id 不挂载。
 */
import { useRef } from "react";
import { Button, Modal } from "antd";

import { PpmItemSessionsCard } from "@/components/ppm/ppm-item-sessions-card";
import { PROBLEM_STATUS_TEXT } from "@/components/ppm-status-actions";
import type { ProblemList } from "@/lib/ppm";
import { useFloatingSessionStore } from "@/stores/floating-session";
import { ProblemCreateForm, type ProblemCreateFormHandle } from "./_forms";

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
  const formRef = useRef<ProblemCreateFormHandle>(null);
  // task-05（FR-04 / D-001@v1）：问题侧「发起会话」触发通道（仅编辑态——
  // problem 实体存在才有可绑定的 item id；pro_desc 作 chip 标题）。
  const setPendingPpmItem = useFloatingSessionStore((s) => s.setPendingPpmItem);
  const requestNewSession = useFloatingSessionStore((s) => s.requestNewSession);
  const handleStartItemSession = () => {
    if (!problem) return;
    setPendingPpmItem({
      kind: "problem",
      id: problem.id,
      projectId: problem.project_id,
      title: problem.pro_desc,
    });
    requestNewSession(null);
  };
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
      width={920}
      styles={{
        // body 限高:问题表单/详情内容超高时内部滚动不撑满屏幕 (对齐 ppm-project-plan-form ql-20260728-001)
        body: {
          maxHeight: "70vh",
          minHeight: "300px",
          overflowY: "auto",
        },
      }}
      onCancel={onClose}
      destroyOnClose
      maskClosable={false}
      footer={
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" onClick={() => void formRef.current?.submit()}>
            保存
          </Button>
        </div>
      }
    >
      <ProblemCreateForm
        ref={formRef}
        problem={mode === "edit" ? problem : undefined}
        onSuccess={onSaved}
        onCancel={onClose}
      />

      {/* task-05（FR-04）：编辑态底部「发起会话」入口 + 关联会话卡（本人前 3
          条预览 + ?session= 深链 + 「+ 新会话」同通道）；新建态无实体不挂载。 */}
      {mode === "edit" && problem && (
        <div className="mt-4 space-y-2 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-foreground">会话协作</span>
            <Button size="small" onClick={handleStartItemSession}>
              💬 发起会话
            </Button>
          </div>
          <PpmItemSessionsCard
            kind="problem"
            itemId={problem.id}
            projectId={problem.project_id}
            title={problem.pro_desc}
          />
        </div>
      )}
    </Modal>
  );
}
