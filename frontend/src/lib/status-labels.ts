/**
 * 枚举状态值的中文 label 映射（单一数据源）。
 *
 * 后端返回的英文枚举值（status / resource_type / run.status /
 * daemon runtime status / approval status / risk 等）经此映射为中文展示。
 * labelOf 做兜底：未命中的值原样返回，避免显示 undefined。
 *
 * 依据：ql-20260620-001（前端 UI 文案中文化，用户决策「枚举状态值加映射表彻底汉化」）
 * 技术标识符（日志频道 INFO/TOOL/WARN、Claude 工具名、数据字段名）不走此表，保留英文。
 */

/** 通用运行/任务/工作区状态 */
export const STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  inactive: "未激活",
  pending: "待处理",
  queued: "排队中",
  running: "运行中",
  completed: "已完成",
  succeeded: "成功",
  success: "成功",
  failed: "失败",
  canceled: "已取消",
  cancelled: "已取消",
  killed: "已终止",
  error: "错误",
  archived: "已归档",
  unknown: "未知",
};

/** daemon runtime 状态 */
export const DAEMON_RUNTIME_STATUS_LABELS: Record<string, string> = {
  online: "在线",
  offline: "离线",
  maintenance: "维护中",
  disabled: "已禁用",
  unknown: "未知",
};

/** 审计 resource_type */
export const AUDIT_RESOURCE_TYPE_LABELS: Record<string, string> = {
  change: "变更",
  task: "任务",
  release: "发布",
  review: "审查",
  agent_run: "智能体运行",
  component: "组件",
  workspace: "工作区",
  git: "Git",
  tool_call: "工具调用",
  approval: "审批",
  credential: "凭据",
  other: "其他",
};

/** 审批结果状态 */
export const APPROVAL_STATUS_LABELS: Record<string, string> = {
  approved: "已批准",
  rejected: "已拒绝",
  pending: "待审批",
};

/** 工具网关审批策略 */
export const APPROVAL_ACTION_LABELS: Record<string, string> = {
  "auto-pass": "自动放行",
  "needs approval": "需审批",
  "must approve": "必须审批",
};

/** 风险等级 */
export const RISK_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  extreme: "极高",
};

/** git identity 状态 */
export const GIT_IDENTITY_STATUS_LABELS: Record<string, string> = {
  active: "活跃",
  revoked: "已撤销",
  expired: "已过期",
};

/**
 * 通用映射：命中返回中文，未命中原样返回；null/空返回「—」。
 */
export function labelOf(
  map: Record<string, string>,
  value: string | null | undefined,
): string {
  if (value == null || value === "") return "—";
  return map[value] ?? value;
}
