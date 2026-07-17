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
 * - 问题审批流:backend/app/modules/ppm/problem/fsm.py
 *   status 1-7 + nowNode 10-40;nextProcess/rejectProcess/doneTask/closeTask
 *
 * 按钮显隐规则严格对齐源 Vue:
 * - problemlist/index.vue:checkUser(nowHandleUser.split(',')) / checkUser([creator])
 *   / checkUser([dutyUserId]) / checkUser([auditUserId])
 * - 状态字典硬编码中文 (参照源 statusObj)。
 *
 * 「驳回/挂起」(X-003 fallback):若项目无对应角色成员,后端在 now_handle_user
 * 返回 null 时,审批/处置按钮 disabled 并提示「待指派」。
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

/** 问题清单状态 → 中文 (ProblemStatus 1-7)。 */
export const PROBLEM_STATUS_TEXT: Record<string, string> = {
  "1": "已保存",
  "2": "审核中",
  "3": "执行中",
  "4": "已完成",
  "5": "已作废",
  "6": "待验证",
  "7": "变更中",
};

export const PROBLEM_STATUS_COLOR: Record<string, string> = {
  "1": "default",
  "2": "processing",
  "3": "warning",
  "4": "success",
  "5": "error",
  "6": "blue",
  "7": "gold",
};

/** 问题审批流节点 → 中文 (ProblemNode 10-40)。 */
export const PROBLEM_NODE_TEXT: Record<number, string> = {
  10: "申请",
  20: "开发经理审批",
  30: "项目经理审批",
  40: "部门经理审批",
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

// ===========================================================================
// 问题清单操作按钮
// ===========================================================================

export interface ProblemActionsProps {
  problem: {
    id: string;
    status: string;
    effective_status: string | null;
    now_node: number | null;
    now_handle_user: string | null;
    duty_user_id: string | null;
    audit_user_id: string | null;
    /** 创建人 ID (源 creator 字段)。后端 effective_status=7 时有未关闭变更。 */
    creator_id?: string | null;
  };
  currentUserId: string;
  disabled?: boolean;
  onAction: (
    problemId: string,
    action: "next" | "reject" | "done" | "close",
  ) => void;
}

/**
 * 问题清单审批流操作按钮 (对照源 problemlist/index.vue 操作列):
 *
 * - status=1 已保存 (Node10 申请):creator 可 nextProcess 提交进审核。
 * - status=2 审核中 (Node20/30/40):当前处理人(now_handle_user) 可
 *   nextProcess(推进)/ rejectProcess(作废)。
 * - status=3 处置中:当前处理人(now_handle_user,fsm.py 在该状态即责任人)
 *   doneTask(completed=true → 待验证)。对照源 Vue doneTask 按钮的
 *   `checkUser([dutyUserId])` 语义,我方后端把 status=3 处理人收口到
 *   now_handle_user,故用 matchAnyUser([now_handle_user]) 判定命中。
 * - status=6 待验证:验证人(audit_user) closeTask(check_result="1" 关闭 / 否则打回)。
 * - status=4/5:终态无操作。
 * - effective_status=7 变更中:展示「变更中」标记,主操作仍按 status 走。
 *
 * now_handle_user 为 null 时(X-003 fallback)禁用审批/处置按钮并提示待指派。
 */
export function ProblemActions({
  problem,
  currentUserId,
  disabled,
  onAction,
}: ProblemActionsProps) {
  const status = problem.status;
  const isNowHandler = matchAnyUser(
    [problem.now_handle_user],
    currentUserId,
  );
  const isCreator = matchAnyUser([problem.creator_id], currentUserId);
  const isDuty = matchAnyUser([problem.duty_user_id], currentUserId);
  const isAuditor = matchAnyUser([problem.audit_user_id], currentUserId);
  const globalDisabled = !!disabled;
  const noAssignee = !problem.now_handle_user;

  const buttons: React.ReactNode[] = [];

  if (status === "1") {
    // 已保存 — creator 提交审核 (nextProcess:Node10 → Node20)
    buttons.push(
      <Button
        key="next"
        size="sm"
        variant="default"
        disabled={globalDisabled || !isCreator}
        title={isCreator ? undefined : "仅创建人可提交"}
        onClick={() => onAction(problem.id, "next")}
      >
        提交审核
      </Button>,
    );
  } else if (status === "2") {
    // 审核中 — now_handle_user 推进/驳回
    buttons.push(
      <Button
        key="next"
        size="sm"
        variant="default"
        disabled={globalDisabled || !isNowHandler}
        title={
          noAssignee
            ? "待指派处理人"
            : isNowHandler
              ? undefined
              : "非当前处理人"
        }
        onClick={() => onAction(problem.id, "next")}
      >
        审核通过
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="destructive"
        disabled={globalDisabled || !isNowHandler}
        title={
          noAssignee
            ? "待指派处理人"
            : isNowHandler
              ? undefined
              : "非当前处理人"
        }
        onClick={() => onAction(problem.id, "reject")}
      >
        驳回
      </Button>,
    );
  } else if (status === "3") {
    // 处置中 — 命中 now_handle_user 即可处置(对照源 Vue doneTask 按钮的
    // checkUser([dutyUserId]) 语义;fsm.py 把 status=3 处理人收口到
    // now_handle_user)。now_handle_user 缺失(X-003)时,若 duty_user_id
    // 命中当前用户则作为兜底放行,否则禁用并提示待指派。
    const canHandle = isNowHandler || (!problem.now_handle_user && isDuty);
    buttons.push(
      <Button
        key="done"
        size="sm"
        variant="default"
        disabled={globalDisabled || !canHandle}
        title={canHandle ? undefined : "仅当前处理人可处置"}
        onClick={() => onAction(problem.id, "done")}
      >
        处置
      </Button>,
    );
  } else if (status === "6") {
    // 待验证 — 验证人验证关闭 (closeTask)
    buttons.push(
      <Button
        key="close"
        size="sm"
        variant="default"
        disabled={globalDisabled || !isAuditor}
        title={isAuditor ? undefined : "仅验证人可关闭"}
        onClick={() => onAction(problem.id, "close")}
      >
        验证关闭
      </Button>,
      <Button
        key="reject"
        size="sm"
        variant="outline"
        disabled={globalDisabled || !isAuditor}
        title={isAuditor ? undefined : "仅验证人可打回"}
        onClick={() => onAction(problem.id, "reject")}
      >
        打回处置
      </Button>,
    );
  }

  if (buttons.length === 0) {
    return null;
  }
  return <div className="flex flex-wrap justify-end gap-1">{buttons}</div>;
}
