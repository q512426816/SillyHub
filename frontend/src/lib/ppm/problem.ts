/**
 * PPM problem 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 problem/router.py (3 态简化, 对齐任务计划):
 * - /problem-list                 问题清单 CRUD
 * - /problem-list/{id}/start      start (新建→进行中, 建 in-flight TaskExecute)
 * - /problem-list/{id}/execute    execute (收口: submit 回新建 / complete 已完成)
 * - /problem-list/export-excel    导出 (X-002)
 * - /problem-list/import-preview  Excel 批量导入预览 (multipart, task-07 / design §7)
 * - /problem-list/import-commit   Excel 批量导入提交 (JSON, task-07 / design §7)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`;
 * 导入预览走 `uploadExcelWithAuth`(multipart, 不复用强制 JSON 的 apiFetch)。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel, uploadExcelWithAuth } from "./export";
import type {
  PageReq,
  PageResp,
  ProblemExecuteReq,
  ProblemImportCommitReq,
  ProblemImportPreviewResp,
  ProblemImportResultResp,
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
  params?: ProblemListPageReq | PageReq,
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

// ---------- Excel 批量导入 (task-07 / design §7) ----------

/**
 * 上传 Excel 预览导入 (POST /api/ppm/problem-list/import-preview, multipart)。
 *
 * 走 `uploadExcelWithAuth`(不复用强制 JSON 的 apiFetch), 与 plan 子域
 * `importModulesPreview` 范式一致;差异:**不带 pm_project_id query** — 项目按
 * Excel 每行 `project_name` 反查(D-002),preview 函数只收一个 File。
 *
 * 后端解析 + 严格校验(项目/模块/责任人/验证人 匹配 + 必填 D-004/D-009),
 * 返回每行 valid/error 及反查到的 UUID(仅供前端展示)。
 */
export async function importProblemsPreview(
  file: File,
): Promise<ProblemImportPreviewResp> {
  const resp = await uploadExcelWithAuth(
    "/api/ppm/problem-list/import-preview",
    file,
  );
  return (await resp.json()) as ProblemImportPreviewResp;
}

/**
 * 确认提交导入 (POST /api/ppm/problem-list/import-commit, JSON body)。
 *
 * 走 `apiFetch` POST JSON;body.rows 为用户勾选确认导入的行(含 preview 已反查
 * 的 UUID,但后端 commit 不信任,按原文重新反查 + data_scope 校验,D-011)。
 * 单次事务原子提交,要么全进要么全回滚(D-008)。
 */
export async function importProblemsCommit(
  body: ProblemImportCommitReq,
): Promise<ProblemImportResultResp> {
  return apiFetch<ProblemImportResultResp>(
    "/api/ppm/problem-list/import-commit",
    { method: "POST", json: body },
  );
}
