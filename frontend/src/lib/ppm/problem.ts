/**
 * PPM problem 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 problem/router.py:
 * - /problem-list               问题清单 CRUD
 * - /problem-list/{id}/next     nextProcess (推进到下一节点)
 * - /problem-list/{id}/reject   rejectProcess (驳回到已作废)
 * - /problem-list/{id}/done     doneTask (责任人完成处置)
 * - /problem-list/{id}/close    closeTask (验证人验证关闭)
 * - /problem-list/{id}/tasks    在办任务查询
 * - /problem-list/{id}/logs     流程履历查询
 * - /problem-change             问题变更 CRUD
 * - /problem-list/export-excel  导出 (X-002)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type {
  PageReq,
  ProblemChange,
  ProblemChangeCreate,
  ProblemChangeNextProcessReq,
  ProblemChangeRejectProcessReq,
  ProblemChangeUpdate,
  ProblemCloseTaskReq,
  ProblemDoneTaskReq,
  ProblemList,
  ProblemListCreate,
  ProblemListUpdate,
  ProblemNextProcessReq,
  ProblemProcessLog,
  ProblemProcessTask,
  ProblemRejectProcessReq,
} from "./types";

function pageQuery(
  params?: PageReq,
): { query: Record<string, string | number | undefined> } | undefined {
  if (!params) return undefined;
  const q: Record<string, string | number | undefined> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q[k] = v;
  }
  return { query: q };
}

// ===========================================================================
// 问题清单 /problem-list
// ===========================================================================

export async function listProblems(
  params?: PageReq,
): Promise<ProblemList[]> {
  return apiFetch<ProblemList[]>("/api/ppm/problem-list", pageQuery(params));
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

// ---------- 审批流端点 ----------

/** nextProcess — 推进到下一节点。 */
export async function nextProcessProblem(
  problemId: string,
  body?: ProblemNextProcessReq,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}/next`, {
    method: "POST",
    json: body ?? {},
  });
}

/** rejectProcess — 驳回到已作废。 */
export async function rejectProcessProblem(
  problemId: string,
  body?: ProblemRejectProcessReq,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}/reject`, {
    method: "POST",
    json: body ?? {},
  });
}

/** doneTask — 责任人完成处置。 */
export async function doneTaskProblem(
  problemId: string,
  body?: ProblemDoneTaskReq,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}/done`, {
    method: "POST",
    json: body ?? {},
  });
}

/** closeTask — 验证人验证关闭。 */
export async function closeTaskProblem(
  problemId: string,
  body?: ProblemCloseTaskReq,
): Promise<ProblemList> {
  return apiFetch<ProblemList>(`/api/ppm/problem-list/${problemId}/close`, {
    method: "POST",
    json: body ?? {},
  });
}

/** 在办任务 — 查询该问题当前未完成的流程任务。 */
export async function listProblemTasks(
  problemId: string,
): Promise<ProblemProcessTask[]> {
  return apiFetch<ProblemProcessTask[]>(
    `/api/ppm/problem-list/${problemId}/tasks`,
  );
}

/** 流程履历 — 查询该问题的所有流转记录。 */
export async function listProblemLogs(
  problemId: string,
): Promise<ProblemProcessLog[]> {
  return apiFetch<ProblemProcessLog[]>(
    `/api/ppm/problem-list/${problemId}/logs`,
  );
}

export async function exportProblems(): Promise<void> {
  await downloadExcel("/api/ppm/problem-list/export-excel", undefined, "problem_list.xlsx");
}

// ===========================================================================
// 问题变更 /problem-change
// ===========================================================================

export async function listProblemChanges(
  params?: PageReq,
): Promise<ProblemChange[]> {
  return apiFetch<ProblemChange[]>("/api/ppm/problem-change", pageQuery(params));
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
