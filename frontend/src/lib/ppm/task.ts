/**
 * PPM task 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 task/router.py (注意:后端用 action-path
 * 风格,非 RESTful /{id};大部分写操作把 id 走 query 参数):
 * - /task-plan/create | /update | /get | /delete | /page | /execute | /export-excel
 * - /personal-task-plan/page | /list-by-date-range
 * - /task-execute/create | /update | /get | /delete | /page | /list-by-date-range
 * - /work-hour/create | /update | /get | /delete | /page | /stat-by-user | /stat-by-project | /export-excel
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type {
  ExecutePlanReq,
  PageResp,
  PlanTask,
  PlanTaskCreate,
  PlanTaskPageReq,
  PlanTaskUpdate,
  StartReq,
  TaskExecute,
  TaskExecuteCreate,
  TaskExecuteWithPlan,
  TaskExecutePageReq,
  TaskExecuteUpdate,
  WorkHour,
  WorkHourCreate,
  WorkHourPageReq,
  WorkHourStatResponse,
  WorkHourUpdate,
} from "./types";

function queryOf(
  params?: Record<string, unknown>,
): { query: Record<string, string | number | boolean | string[] | undefined> } | undefined {
  if (!params) return undefined;
  const out: Record<string, string | number | boolean | string[] | undefined> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    out[k] = v as string | number | boolean | string[];
  }
  return { query: out };
}

// ===========================================================================
// 任务计划 /task-plan/*
// ===========================================================================

export async function listPlanTasks(
  params?: PlanTaskPageReq,
): Promise<PageResp<PlanTask>> {
  return apiFetch<PageResp<PlanTask>>(
    "/api/ppm/task-plan/page",
    queryOf(params as Record<string, unknown> | undefined),
  );
}

export async function getPlanTask(planTaskId: string): Promise<PlanTask> {
  return apiFetch<PlanTask>("/api/ppm/task-plan/get", {
    query: { plan_id: planTaskId },
  });
}

export async function createPlanTask(body: PlanTaskCreate): Promise<PlanTask> {
  return apiFetch<PlanTask>("/api/ppm/task-plan/create", {
    method: "POST",
    json: body,
  });
}

export async function updatePlanTask(
  planTaskId: string,
  body: PlanTaskUpdate,
): Promise<PlanTask> {
  return apiFetch<PlanTask>("/api/ppm/task-plan/update", {
    method: "PUT",
    query: { plan_id: planTaskId },
    json: body,
  });
}

export async function deletePlanTask(planTaskId: string): Promise<void> {
  await apiFetch("/api/ppm/task-plan/delete", {
    method: "DELETE",
    query: { plan_id: planTaskId },
  });
}

/** 执行计划 — 联动生成/更新 TaskExecute + 状态机推进。 */
export async function executePlanTask(body: ExecutePlanReq): Promise<TaskExecute> {
  return apiFetch<TaskExecute>("/api/ppm/task-plan/execute", {
    method: "PUT",
    json: body,
  });
}

/** 启动任务(未开始→进行中) — 创建 in-flight TaskExecute 记 actual_start_time。

 * 返回的 id 作为后续 executePlanTask({action, task_execute_id}) 的 task_execute_id。
 * D-002 多次填报: 每次 start 产生一条独立 TaskExecute。
 */
export async function startPlanTask(body: StartReq): Promise<TaskExecute> {
  return apiFetch<TaskExecute>("/api/ppm/task-plan/start", {
    method: "POST",
    json: body,
  });
}

export async function exportPlanTasks(
  params?: PlanTaskPageReq,
): Promise<void> {
  await downloadExcel(
    "/api/ppm/task-plan/export-excel",
    params as Record<string, unknown> | undefined,
    "任务计划.xlsx",
  );
}

// ===========================================================================
// 个人任务计划 /personal-task-plan/* (按当前登录用户过滤)
// ===========================================================================

export async function listPersonalPlanTasks(
  params?: Omit<PlanTaskPageReq, "user_id">,
  targetUserId?: string | null,
): Promise<PageResp<PlanTask>> {
  const merged = { ...params, target_user_id: targetUserId ?? undefined };
  return apiFetch<PageResp<PlanTask>>(
    "/api/ppm/personal-task-plan/page",
    queryOf(merged as Record<string, unknown>),
  );
}

/** 当前登录用户在 [start, end] 区间的任务计划。 */
export async function listPersonalPlanTasksByDateRange(
  start: string,
  end: string,
): Promise<PlanTask[]> {
  return apiFetch<PlanTask[]>(
    "/api/ppm/personal-task-plan/list-by-date-range",
    { query: { start, end } },
  );
}

// ===========================================================================
// 任务执行 /task-execute/*
// ===========================================================================

export async function listTaskExecutes(
  params?: TaskExecutePageReq,
): Promise<PageResp<TaskExecute>> {
  return apiFetch<PageResp<TaskExecute>>(
    "/api/ppm/task-execute/page",
    queryOf(params as Record<string, unknown> | undefined),
  );
}

export async function getTaskExecute(executeId: string): Promise<TaskExecute> {
  return apiFetch<TaskExecute>("/api/ppm/task-execute/get", {
    query: { execute_id: executeId },
  });
}

export async function createTaskExecute(
  body: TaskExecuteCreate,
): Promise<TaskExecute> {
  return apiFetch<TaskExecute>("/api/ppm/task-execute/create", {
    method: "POST",
    json: body,
  });
}

export async function updateTaskExecute(
  executeId: string,
  body: TaskExecuteUpdate,
): Promise<TaskExecute> {
  return apiFetch<TaskExecute>("/api/ppm/task-execute/update", {
    method: "PUT",
    query: { execute_id: executeId },
    json: body,
  });
}

export async function deleteTaskExecute(executeId: string): Promise<void> {
  await apiFetch("/api/ppm/task-execute/delete", {
    method: "DELETE",
    query: { execute_id: executeId },
  });
}

/** 按日期区间查任务执行 (可选按执行人过滤)。 */
export async function listTaskExecutesByDateRange(
  start: string,
  end: string,
  executeUserId?: string,
): Promise<TaskExecute[]> {
  return apiFetch<TaskExecute[]>(
    "/api/ppm/task-execute/list-by-date-range",
    { query: { start, end, execute_user_id: executeUserId } },
  );
}

/** 按日期区间查任务执行 + 关联计划任务(看板「实际」tab,展示任务名/项目)。 */
export async function listTaskExecutesWithPlanByDateRange(
  start: string,
  end: string,
  opts?: { projectId?: string; executeUserIds?: string[] },
): Promise<TaskExecuteWithPlan[]> {
  const query: string[] = [
    `start=${encodeURIComponent(start)}`,
    `end=${encodeURIComponent(end)}`,
  ];
  if (opts?.projectId) {
    query.push(`project_id=${encodeURIComponent(opts.projectId)}`);
  }
  if (opts?.executeUserIds) {
    for (const uid of opts.executeUserIds) {
      query.push(`execute_user_ids=${encodeURIComponent(uid)}`);
    }
  }
  return apiFetch<TaskExecuteWithPlan[]>(
    `/api/ppm/task-execute/list-by-date-range-with-plan?${query.join("&")}`,
  );
}

// ===========================================================================
// 工时 /work-hour/*
// ===========================================================================

export async function listWorkHours(
  params?: WorkHourPageReq,
): Promise<PageResp<WorkHour>> {
  return apiFetch<PageResp<WorkHour>>(
    "/api/ppm/work-hour/page",
    queryOf(params as Record<string, unknown> | undefined),
  );
}

export async function getWorkHour(workHourId: string): Promise<WorkHour> {
  return apiFetch<WorkHour>("/api/ppm/work-hour/get", {
    query: { work_hour_id: workHourId },
  });
}

export async function createWorkHour(body: WorkHourCreate): Promise<WorkHour> {
  return apiFetch<WorkHour>("/api/ppm/work-hour/create", {
    method: "POST",
    json: body,
  });
}

export async function updateWorkHour(
  workHourId: string,
  body: WorkHourUpdate,
): Promise<WorkHour> {
  return apiFetch<WorkHour>("/api/ppm/work-hour/update", {
    method: "PUT",
    query: { work_hour_id: workHourId },
    json: body,
  });
}

export async function deleteWorkHour(workHourId: string): Promise<void> {
  await apiFetch("/api/ppm/work-hour/delete", {
    method: "DELETE",
    query: { work_hour_id: workHourId },
  });
}

/** 工时统计 — 按用户聚合 (ECharts/AntD Chart 友好)。 */
export async function statWorkHoursByUser(params?: {
  start_date?: string;
  end_date?: string;
  user_id?: string;
}): Promise<WorkHourStatResponse> {
  return apiFetch<WorkHourStatResponse>(
    "/api/ppm/work-hour/stat-by-user",
    queryOf(params as Record<string, unknown> | undefined),
  );
}

/** 工时统计 — 按项目聚合 (ECharts/AntD Chart 友好)。 */
export async function statWorkHoursByProject(params?: {
  start_date?: string;
  end_date?: string;
  project_id?: string;
}): Promise<WorkHourStatResponse> {
  return apiFetch<WorkHourStatResponse>(
    "/api/ppm/work-hour/stat-by-project",
    queryOf(params as Record<string, unknown> | undefined),
  );
}

export async function exportWorkHours(
  params?: WorkHourPageReq,
): Promise<void> {
  await downloadExcel(
    "/api/ppm/work-hour/export-excel",
    params as Record<string, unknown> | undefined,
    "工时记录.xlsx",
  );
}
