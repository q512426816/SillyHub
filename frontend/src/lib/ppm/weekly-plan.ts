/**
 * PPM 项目周计划一览表 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 plan/router.py:
 * - GET /weekly-plan          分页列表(所有项目实施阶段明细+任务计划)
 * - GET /weekly-plan/export-excel  导出 Excel(按项目分组)
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type { PageReq, PageResp, WeeklyPlanPageReq, WeeklyPlanRow } from "./types";

/**
 * 构建查询参数(支持 status 数组 → 重复 query)。
 */
function weeklyQuery(
  params?: WeeklyPlanPageReq,
): { query: Record<string, string | number | undefined | string[]> } | undefined {
  if (!params) return undefined;
  const q: Record<string, string | number | undefined | string[]> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q[k] = v;
  }
  return { query: q };
}

/** 项目周计划一览表分页查询。 */
export async function listWeeklyPlan(
  params?: WeeklyPlanPageReq,
): Promise<PageResp<WeeklyPlanRow>> {
  return apiFetch<PageResp<WeeklyPlanRow>>(
    "/api/ppm/weekly-plan",
    weeklyQuery(params),
  );
}

/** 导出项目周计划一览表 Excel(按项目分组)。 */
export async function exportWeeklyPlan(
  params?: WeeklyPlanPageReq,
): Promise<void> {
  // downloadExcel 的 params 是 Record<string, unknown>,手动构建(含 status 数组)
  const query: Record<string, unknown> = {};
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v === undefined || v === null || v === "") continue;
      query[k] = v;
    }
  }
  await downloadExcel(
    "/api/ppm/weekly-plan/export-excel",
    Object.keys(query).length > 0 ? query : undefined,
    "项目周计划一览表.xlsx",
  );
}

// 便捷导出:PageReq 类型供页面复用
export type { PageReq, PageResp, WeeklyPlanPageReq, WeeklyPlanRow };
