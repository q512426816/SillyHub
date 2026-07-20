"use client";

/**
 * PPM 公共状态操作组件。
 *
 * 里程碑明细 + 问题清单两套状态机的「操作按钮按状态/节点 + 当前用户
 * checkUser 显隐」逻辑抽取到本文件,供两个列表页复用。
 *
 * 设计依据:
 * - 里程碑明细状态机:backend/app/modules/ppm/plan/fsm.py
 *   draft → review → approve → done + rejected + archived(变更归档)
 * - 问题清单:3 态简化 (新建/进行中/已完成, 2026-07-20 对齐任务计划)。
 *   操作按钮 (开始/执行/详情/删除) 直接在 problem-list/page.tsx 内联,
 *   不再需要 ProblemActions 组件 (已删除)。
 *
 * 按钮显隐规则严格对齐源 Vue:
 * - 状态字典硬编码中文 (参照源 statusObj)。
 */
import { Button } from "@/components/ui/button";

// ===========================================================================
// 通用 helper:判断当前用户是否在 ID 集合内 (源 checkUser 语义)
// ===========================================================================

/** 当前列表项的某 user_id 字段可能是 "a,b" 逗号串(源 nowHandleUser 模式)。 */
export function matchAnyUser(
  candidateIds: (string | null | undefined)[],
  currentUserId: string,
): boolean {
  if (!currentUserId) return false;
  for (const raw of candidateIds) {
    if (!raw) continue;
    for (const part of String(raw).split(",")) {
      const trimmed = part.trim();
      if (trimmed && trimmed === currentUserId) return true;
    }
  }
  return false;
}

// ===========================================================================
// 状态字典 (硬编码中文)
// ===========================================================================

/** 里程碑明细状态 → 中文 (PlanNodeDetailStatus)。 */
export const PLAN_DETAIL_STATUS_TEXT: Record<string, string> = {
  draft: "草稿",
  review: "审核中",
  approve: "审批中",
  done: "已完成",
  rejected: "已驳回",
  archived: "已归档",
};

export const PLAN_DETAIL_STATUS_COLOR: Record<string, string> = {
  draft: "default",
  review: "processing",
  approve: "warning",
  done: "success",
  rejected: "error",
  archived: "default",
};

/** 问题清单状态 → 中文 (ProblemStatus 3 态, 2026-07-20 简化对齐任务计划)。 */
export const PROBLEM_STATUS_TEXT: Record<string, string> = {
  新建: "新建",
  进行中: "进行中",
  已完成: "已完成",
};

export const PROBLEM_STATUS_COLOR: Record<string, string> = {
  新建: "default",
  进行中: "processing",
  已完成: "success",
};

export const PROBLEM_TYPE_TEXT: Record<string, string> = {
  bug: "系统BUG",
  change: "变更",
};

/** 问题变更状态 → 中文 (ProblemChangeStatus 1-3)。 */
export const PROBLEM_CHANGE_STATUS_TEXT: Record<string, string> = {
  "1": "审核中",
  "2": "已完成",
  "3": "已作废",
};

// ===========================================================================
// 里程碑明细操作按钮
// ===========================================================================

export interface PlanDetailActionsProps {
  detail: {
    id: string;
    status: string;
    audit_user_id: string | null;
    approve_user_id: string | null;
    execute_user_id: string | null;
  };
  currentUserId: string;
  disabled?: boolean;
  onSubmit: (
    detailId: string,
    action: "save" | "reject" | "change",
  ) => void;
}

/**
 * 里程碑明细操作按钮 (draft/review/approve/done/rejected/archived):
 * - draft:草稿提交审核(save)。execute_user 可编辑由列表页另置「编辑」按钮。
 * - review:审核中 — 审核人(audit_user)可 save(推进到审批)/ reject(驳回)。
 * - approve:审批中 — 审批人(approve_user)可 save(完成)/ reject。
 * - done / archived:终态,无操作。
 * - rejected:已驳回,展示「重新提交」= save(后端会从 rejected 回到 draft 再进 review)。
 * - 任意非终态状态:展示「变更」(change) — 新建 parent_id 草稿版本。
 *
 * 审核人/审批人缺失(X-003 fallback):disabled + title 提示待指派。
 */
export function PlanDetailActions({
  detail,
  currentUserId,
  disabled,
  onSubmit,
}: PlanDetailActionsProps) {
  const status = detail.status;
  const isAuditor = matchAnyUser([detail.audit_user_id], currentUserId);
  const isApprover = matchAnyUser([detail.approve_user_id], currentUserId);
  const globalDisabled = !!disabled;

  const buttons: React.ReactNode[] = [];

  if (status === "draft") {
    buttons.push(
      <Button
        key="save"
        size="sm"
        variant="default"
        disabled={globalDisabled}
        onClick={() => onSubmit(detail.id, "save")}
      >
        提交审核
      </Button>,
    );
  } else if (status === "review") {
    buttons.push(
      <Button
        key="save"
        size="sm"
        variant="default"
        disabled={globalDisabled || !isAuditor}
        title={isAuditor ? undefined : "待指派审核人 / 非审核人"}
        onClick={() => onSubmit(detail.id, "save")}
      >
        审核通过
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="destructive"
        disabled={globalDisabled || !isAuditor}
        title={isAuditor ? undefined : "待指派审核人 / 非审核人"}
        onClick={() => onSubmit(detail.id, "reject")}
      >
        驳回
      </Button>,
    );
  } else if (status === "approve") {
    buttons.push(
      <Button
        key="save"
        size="sm"
        variant="default"
        disabled={globalDisabled || !isApprover}
        title={isApprover ? undefined : "待指派审批人 / 非审批人"}
        onClick={() => onSubmit(detail.id, "save")}
      >
        审批通过
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="destructive"
        disabled={globalDisabled || !isApprover}
        title={isApprover ? undefined : "待指派审批人 / 非审批人"}
        onClick={() => onSubmit(detail.id, "reject")}
      >
        驳回
      </Button>,
    );
  } else if (status === "rejected") {
    buttons.push(
      <Button
        key="save"
        size="sm"
        variant="default"
        disabled={globalDisabled}
        onClick={() => onSubmit(detail.id, "save")}
      >
        重新提交
      </Button>,
    );
  }

  // 变更:任意非 archived/done 状态都可发起(生成新版本)。
  if (status !== "archived" && status !== "done") {
    buttons.push(
      <Button
        key="change"
        size="sm"
        variant="outline"
        disabled={globalDisabled}
        onClick={() => onSubmit(detail.id, "change")}
      >
        变更
      </Button>,
    );
  }

  if (buttons.length === 0) {
    return null;
  }
  return <div className="flex flex-wrap justify-end gap-1">{buttons}</div>;
}
