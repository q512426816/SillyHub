/**
 * PPM problem 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 problem/router.py (3 态简化, 对齐任务计划):
 * - /problem-list                 问题清单 CRUD
 * - /problem-list/{id}/start      start (新建→进行中, 建 in-flight TaskExecute)
 * - /problem-list/{id}/execute    execute (收口: submit 回新建 / complete 已完成)
 * - /problem-change               问题变更 CRUD (deprecated, D-005)
 * - /problem-change/{id}/next|reject|tasks|logs  变更审批流 (deprecated)
 * - /problem-list/export-excel    导出 (X-002)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type {
  PageReq,
  PageResp,
  ProblemChange,
  ProblemChangeCreate,
  ProblemChangeNextProcessReq,
  ProblemChangeRejectProcessReq,
  ProblemChangePageReq,
  ProblemChangeUpdate,
  ProblemExecuteReq,
  ProblemList,
  ProblemListCreate,
  ProblemListPageReq,
  ProblemListUpdate,
  ProblemProcessLog,
  ProblemProcessTask,
  ProblemStartReq,
  TaskExecute,
} from "./types";

function pageQuery(
  params?: ProblemListPageReq | ProblemChangePageReq | PageReq,
): { query: Record<string, string | number | string[] | undefined> } | undefined {
  if (!params) return undefined;
  const q: Record<string, string | number | string[] | undefined> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    q[k] = v as string | number | string[] | undefined;
  }
  return { query: q };
}

// ===========================================================================
// 问题清单 /problem-list
// ===========================================================================

export async function listProblems(
  params?: ProblemListPageReq,
): Promise<PageResp<ProblemList>> {
  return apiFetch<PageResp<ProblemList>>("/api/ppm/problem-list", pageQuery(params));
}

export async function getProblem(problemId: string): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}`);
}

/**
 * 按 find_time 区间过滤问题清单 (task-06 / FR-06)。
 *
 * 端点固定路径前置于 /{item_id},参数对齐后端 start_date/end_date 命名。
 * 后端反向区间自动 swap,find_time 为空的 problem 不返回。
 */
export async function listProblemsByDateRange(
  start: string,
  end: string,
): Promise<ProblemList[]> {
  return apiFetch<ProblemList[]>(
    "/api/ppm/problem-list/list-by-date-range",
    { query: { start_date: start, end_date: end } },
  );
}

export async function createProblem(
  body: ProblemListCreate,
): Promise<ProblemList> {
  return apiFetch<ProblemList>("/api/ppm/problem-list", {
    method: "POST",
    json: body,
  });
}

export async function updateProblem(
  problemId: string,
  body: ProblemListUpdate,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteProblem(problemId: string): Promise<void> {
  await apiFetch(`/api/ppm/problem-list/${problemId}`, { method: "DELETE" });
}

// ---------- 执行流端点 (3 态, 对齐任务计划) ----------

/**
 * start — 启动问题 (新建 → 进行中): 建 in-flight TaskExecute, 记 actual_start_time。
 * 返回的 id 作为后续 executeProblem 的 task_execute_id。多次执行每次「开始」产生
 * 一条独立 TaskExecute (1 problem : N execute)。
 */
export async function startProblem(
  problemId: string,
  body?: ProblemStartReq,
): Promise<TaskExecute> {
  return apiFetch<TaskExecute>(`/api/ppm/problem-list/${problemId}/start`, {
    method: "POST",
    json: body ?? {},
  });
}

/**
 * execute — 收口 in-flight TaskExecute 并推进状态机:
 * - action="submit"   : 回「新建」(可再次 start, 支持重复执行)
 * - action="complete" : 「已完成」(终态)
 *
 * task_execute_id 必填 (start 返回的 in-flight 记录)。跨天校验在后端 service。
 */
export async function executeProblem(
  problemId: string,
  body: ProblemExecuteReq,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}/execute`, {
    method: "PUT",
    json: body,
  });
}

export async function exportProblems(): Promise<void> {
  await downloadExcel("/api/ppm/problem-list/export-excel", undefined, "problem_list.xlsx");
}

/** P2-3:导出问题变更 (problemchange)。 */
export async function exportProblemChanges(): Promise<void> {
  await downloadExcel(
    "/api/ppm/problem-change/export-excel",
    undefined,
    "problem_changes.xlsx",
  );
}

// ===========================================================================
// 问题变更 /problem-change
// ===========================================================================

export async function listProblemChanges(
  params?: ProblemChangePageReq,
): Promise<PageResp<ProblemChange>> {
  return apiFetch<PageResp<ProblemChange>>("/api/ppm/problem-change", pageQuery(params));
}

export async function getProblemChange(
  changeId: string,
): Promise<ProblemChange> {
  return apiFetch<ProblemChange>(`/api/ppm/problem-change/${changeId}`);
}

export async function createProblemChange(
  body: ProblemChangeCreate,
): Promise<ProblemChange> {
  return apiFetch<ProblemChange>("/api/ppm/problem-change", {
    method: "POST",
    json: body,
  });
}

export async function updateProblemChange(
  changeId: string,
  body: ProblemChangeUpdate,
): Promise<ProblemChange> {
  return apiFetch<ProblemChange>(`/api/ppm/problem-change/${changeId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteProblemChange(changeId: string): Promise<void> {
  await apiFetch(`/api/ppm/problem-change/${changeId}`, { method: "DELETE" });
}

// ---------- 变更审批流端点 (task-02:4 节点链) ----------

/** 变更流 nextProcess — 推进到下一节点 (申请→开发经理→项目经理→[非bug部门经理]→结束)。 */
export async function nextProcessProblemChange(
  changeId: string,
  body?: ProblemChangeNextProcessReq,
): Promise<ProblemChange> {
  return apiFetch<ProblemChange>(
    `/api/ppm/problem-change/${changeId}/next`,
    { method: "POST", json: body ?? {} },
  );
}

/** 变更流 rejectProcess — 驳回到已作废 (仅审核节点 20/30/40 可驳回)。 */
export async function rejectProcessProblemChange(
  changeId: string,
  body?: ProblemChangeRejectProcessReq,
): Promise<ProblemChange> {
  return apiFetch<ProblemChange>(
    `/api/ppm/problem-change/${changeId}/reject`,
    { method: "POST", json: body ?? {} },
  );
}

/** 变更流在办任务 — 查询该变更当前未完成的流程任务。 */
export async function listProblemChangeTasks(
  changeId: string,
): Promise<ProblemProcessTask[]> {
  return apiFetch<ProblemProcessTask[]>(
    `/api/ppm/problem-change/${changeId}/tasks`,
  );
}

/** 变更流流程履历 — 查询该变更的所有流转记录。 */
export async function listProblemChangeLogs(
  changeId: string,
): Promise<ProblemProcessLog[]> {
  return apiFetch<ProblemProcessLog[]>(
    `/api/ppm/problem-change/${changeId}/logs`,
  );
}
