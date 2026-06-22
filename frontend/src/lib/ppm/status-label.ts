/**
 * PPM 状态枚举 → 中文展示标签。
 *
 * plan/node/detail 三层用同一套英文状态机 (``draft/review/approve/done/
 * rejected/archived``,见 ``backend/app/modules/ppm/plan/fsm.py``);
 * task 表本身存中文文本字段,不需要映射但走同一 helper 也兼容。
 *
 * 未知值原样返回,避免后端临时返回新状态时前端直接显示 ``undefined``。
 */

const STATUS_LABELS: Record<string, string> = {
  // plan / node / detail 状态机
  draft: "草稿",
  review: "审核中",
  approve: "审批中",
  done: "已完成",
  rejected: "已驳回",
  archived: "已归档",
  // problem 审批流复用 (见 backend/app/modules/ppm/problem/fsm.py)
  submitting: "待审核",
  approving: "审批中",
  approved: "已批准",
  closed: "已关闭",
};

export function statusLabel(value: string | null | undefined): string | null {
  if (value === null || value === undefined || value === "") return null;
  return STATUS_LABELS[value] ?? value;
}
