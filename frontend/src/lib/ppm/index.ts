/**
 * PPM 前端 API client 入口 — barrel re-export。
 *
 * 页面统一从 `@/lib/ppm` 引入,避免深路径。
 *
 * 子域:
 * - project  项目/客户/成员/干系人
 * - plan     计划节点模板/ps 项目计划/里程碑/明细 + 流程
 * - problem  问题清单/问题变更 + 审批流
 * - task     任务计划/任务执行/工时 + 统计
 * - kanban   看板人员列/任务卡片/分配/排序/搜人
 */
export * from "./types";
export * from "./format";
export * from "./project";
export * from "./plan";
export * from "./problem";
export * from "./task";
export * from "./kanban";
export { downloadExcel } from "./export";
export { statusLabel } from "./status-label";
