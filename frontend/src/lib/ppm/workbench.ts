/**
 * PPM workbench(个人工作台)只读聚合 API client。
 *
 * 端点前缀 `/api/ppm/workbench/*`(design §7.1~§7.3),3 个只读 GET 聚合接口:
 * - GET /profile         当前登录人基本信息(姓名/工号/部门/角色/头像首字)
 * - GET /summary?range=  指标汇总(任务数/完成率/延期率/工时/缺陷)+ 派生待办
 * - GET /calendar?year_month=  当月每日任务负载/预警分档
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新),对齐 lib/ppm/task.ts 风格;
 * 字段 snake_case 与后端 Pydantic 直出一致,不做 camelCase 转换。
 * query 参数用对象字面量(apiFetch 内部已处理 undefined/null/空串过滤)。
 *
 * 依据:design §7 + tasks/task-07.md。无 id 路径参数,直接常量路径,无需 queryOf 辅助器。
 */
import { apiFetch } from "@/lib/api";
import type { WorkbenchCalendar, WorkbenchProfile, WorkbenchSummary } from "./types";

/**
 * 当前登录人基本信息(design §7.1)。
 * 后端从 token 注入 user_id,无入参。
 */
export async function fetchWorkbenchProfile(): Promise<WorkbenchProfile> {
  return apiFetch<WorkbenchProfile>("/api/ppm/workbench/profile");
}

/**
 * 个人工作台指标汇总 + 待办(design §7.2)。
 *
 * @param range 统计口径区间:"week" 本周 / "month" 当月(默认) / "all" 全部;
 *              后端按 PlanTask.start_time 区间过滤(month 字段可空不可靠)。
 */
export async function fetchWorkbenchSummary(
  range: "week" | "month" | "all" = "month",
): Promise<WorkbenchSummary> {
  return apiFetch<WorkbenchSummary>("/api/ppm/workbench/summary", {
    query: { range },
  });
}

/**
 * 个人工作台当月日历(design §7.3)。
 *
 * @param yearMonth "YYYY-MM" 格式(如 "2026-07");query key 用 snake_case
 *                  `year_month` 对齐后端 design §7.3 参数名。
 */
export async function fetchWorkbenchCalendar(
  yearMonth: string,
): Promise<WorkbenchCalendar> {
  return apiFetch<WorkbenchCalendar>("/api/ppm/workbench/calendar", {
    query: { year_month: yearMonth },
  });
}
