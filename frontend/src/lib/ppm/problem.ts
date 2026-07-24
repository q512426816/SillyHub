/**
 * PPM problem 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 problem/router.py (3 态简化, 对齐任务计划):
 * - /problem-list                 问题清单 CRUD
 * - /problem-list/{id}/start      start (新建→进行中, 建 in-flight TaskExecute)
 * - /problem-list/{id}/execute    execute (收口: submit 回新建 / complete 已完成)
 * - /problem-list/export-excel    导出 (X-002)
 * - /problem-list/import-preview  Excel 批量导入预览 (multipart, task-07 / design §7)
 * - /problem-list/import-commit   Excel 批量导入提交 (**multipart: file + rows** D-013 / design §7)
 * - /problem-list/import-template 下载导入模板 (动态 xlsx, D-007 / design §7)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出 / 模板下载走 `downloadExcel`;
 * 导入预览走 `uploadExcelWithAuth`;提交 commit 走裸 fetch multipart
 * (file + rows Form, 不复用强制 JSON 的 apiFetch, D-013)。
 */
import { apiFetch, getApiBaseUrl, safeUUID } from "@/lib/api";
import { ensureFreshAccessToken } from "@/lib/token-refresh";
import { useSession } from "@/stores/session";
import { downloadExcel, uploadExcelWithAuth } from "./export";
import type {
  PageReq,
  PageResp,
  ProblemExecuteReq,
  ProblemImportPreviewResp,
  ProblemImportPreviewRow,
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

/**
 * 下载导入模板 (GET /api/ppm/problem-list/import-template, 动态生成 xlsx)。
 *
 * 后端按当前用户 data_scope 生成: 18 列表头 + 隐藏 sheet "_data" +
 * DataValidation 下拉 (项目/责任人/验证人 按范围、模块全部平铺 D-012、枚举固定)。
 * 替代旧静态 public/templates/problem-import-template.xlsx (task-09 删)。
 * 走统一 `downloadExcel` (token + 401 单飞刷新 + Content-Disposition 文件名兜底)。
 */
export async function downloadImportTemplate(): Promise<void> {
  await downloadExcel(
    "/api/ppm/problem-list/import-template",
    undefined,
    "problem-import-template.xlsx",
  );
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
 * 确认提交导入 (POST /api/ppm/problem-list/import-commit, **multipart: file + rows** D-013)。
 *
 * D-013 breaking: body 从 JSON 改为 multipart/form-data ——
 * - `file` 字段 = 用户预览时选择的同一 .xlsx (后端二次解析 ws._images, 按锚点行
 *   row_index 填回 commit rows 的 attachment, D-001);
 * - `rows` 字段 = `JSON.stringify({ rows })` 字符串 (用户勾选确认导入的行,
 *   含 preview 已反查的 UUID; 后端 commit 不信任, 按原文重新反查 + data_scope
 *   校验, D-011); 对齐后端 `UploadFile file + Form rows` (task-05)。
 *
 * 走裸 fetch + 401 单飞刷新 (复用 `uploadExcelWithAuth` 模式), 不复用强制 JSON
 * 的 `apiFetch`; **不设 Content-Type** 让浏览器按 FormData 自动加 multipart
 * boundary。单次事务原子提交 (D-008); 附件单图失败进 failed_rows 不中断 (D-009)。
 *
 * @param file 与 preview 同一文件 (后端按 row_index 关联附件图)
 * @param rows 用户勾选确认导入的预览行 (通常为 valid=true 的行)
 */
export async function importProblemsCommit(
  file: File,
  rows: ProblemImportPreviewRow[],
): Promise<ProblemImportResultResp> {
  // 相对路径走与 uploadExcelWithAuth 一致的 origin 解析 (浏览器内走 next rewrite)。
  const url = "/api/ppm/problem-list/import-commit";
  const resolved =
    typeof window === "undefined"
      ? new URL(url, getApiBaseUrl()).toString()
      : new URL(url, window.location.origin).toString();

  const doFetch = async (token: string | null): Promise<Response> => {
    // 不设 Content-Type — 让浏览器根据 FormData 自动加 multipart boundary。
    const headers: Record<string, string> = {
      accept: "application/json",
      "x-request-id": safeUUID(),
    };
    if (token) headers.Authorization = `Bearer ${token}`;
    const formData = new FormData();
    formData.append("file", file);
    // rows = JSON 串 (后端 Form rows 解析, D-013); 包一层 { rows } 对齐后端 schema。
    formData.append("rows", JSON.stringify({ rows }));
    return fetch(resolved, { method: "POST", headers, body: formData });
  };

  let { accessToken } = useSession.getState();
  let resp = await doFetch(accessToken);

  // 401 → refresh + retry once (uploadExcelWithAuth / apiFetch 行为对齐)
  if (resp.status === 401) {
    const newToken = await ensureFreshAccessToken();
    if (newToken) {
      resp = await doFetch(newToken);
    }
    if (resp.status === 401) {
      useSession.getState().clear();
      if (typeof window !== "undefined") {
        window.location.href = "/login";
      }
      throw new Error("导入失败:登录已过期,请重新登录");
    }
  }

  if (!resp.ok) {
    throw new Error(`导入失败:HTTP ${resp.status}`);
  }
  return (await resp.json()) as ProblemImportResultResp;
}
