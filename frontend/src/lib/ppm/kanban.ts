/**
 * PPM kanban 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 kanban/router.py (5 端点):
 * - GET    /kanban/users          人员列 (可按 Organization 分组,X-001)
 * - GET    /kanban/tasks          任务卡片
 * - POST   /kanban/task/assign    分配任务
 * - PUT    /kanban/task/reorder   拖拽排序
 * - GET    /kanban/search/users   搜人
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新)。
 */
import { apiFetch } from "@/lib/api";
import type { components } from "@/lib/api-types";
import type {
  KanbanComment,
  KanbanCommentCreateReq,
  KanbanOrgGroup,
  KanbanQueryReq,
  KanbanTaskAssignReq,
  KanbanTaskCard,
  KanbanTaskCreateReq,
  KanbanTaskReorderReq,
  KanbanUserColumn,
} from "./types";

/** 工时热力网格响应(类型来自 api-types 生成,禁手写)。 */
export type WorkloadGridResponse = components["schemas"]["WorkloadGridResponse"];
export type WorkloadGridUserRow = components["schemas"]["WorkloadGridUserRow"];

/** /kanban/users:group_by_org 决定返回 UserColumnVO[] 或 OrgGroup[]。 */
export type KanbanUsersResult = KanbanUserColumn[] | KanbanOrgGroup[];

/**
 * 人员列 — 当前用户可见的 project_member (可按 Organization 分组)。
 *
 * 后端 `user_ids` 接收多次同名 query 聚合;apiFetch 的 query 是
 * `Record<string, scalar>`,故把数组每个元素以 `user_ids` 为 key 重复 set
 * 时会被覆盖。这里改用直接拼 URL 多值 query 的方式。
 */
export async function listKanbanUsers(
  params?: KanbanQueryReq,
): Promise<KanbanUsersResult> {
  let path = "/api/ppm/kanban/users";
  const query: string[] = [];
  if (params) {
    if (params.user_ids && params.user_ids.length > 0) {
      for (const uid of params.user_ids) {
        query.push(`user_ids=${encodeURIComponent(uid)}`);
      }
    }
    if (params.status !== undefined && params.status !== null) {
      query.push(`status=${encodeURIComponent(params.status)}`);
    }
    if (params.project_id !== undefined && params.project_id !== null) {
      query.push(`project_id=${encodeURIComponent(params.project_id)}`);
    }
    if (params.keyword !== undefined && params.keyword !== null) {
      query.push(`keyword=${encodeURIComponent(params.keyword)}`);
    }
    if (params.group_by_org !== undefined) {
      query.push(`group_by_org=${String(params.group_by_org)}`);
    }
    if (params.start_date !== undefined && params.start_date !== null) {
      query.push(`start_date=${encodeURIComponent(params.start_date)}`);
    }
    if (params.end_date !== undefined && params.end_date !== null) {
      query.push(`end_date=${encodeURIComponent(params.end_date)}`);
    }
  }
  if (query.length > 0) {
    path = `${path}?${query.join("&")}`;
  }
  return apiFetch<KanbanUsersResult>(path);
}

/** 任务卡片 (按 kanban_order 排序)。 */
export async function listKanbanTasks(
  params?: Omit<KanbanQueryReq, "group_by_org">,
): Promise<KanbanTaskCard[]> {
  let path = "/api/ppm/kanban/tasks";
  const query: string[] = [];
  if (params) {
    if (params.user_ids && params.user_ids.length > 0) {
      for (const uid of params.user_ids) {
        query.push(`user_ids=${encodeURIComponent(uid)}`);
      }
    }
    if (params.status !== undefined && params.status !== null) {
      query.push(`status=${encodeURIComponent(params.status)}`);
    }
    if (params.project_id !== undefined && params.project_id !== null) {
      query.push(`project_id=${encodeURIComponent(params.project_id)}`);
    }
    if (params.keyword !== undefined && params.keyword !== null) {
      query.push(`keyword=${encodeURIComponent(params.keyword)}`);
    }
    if (params.start_date !== undefined && params.start_date !== null) {
      query.push(`start_date=${encodeURIComponent(params.start_date)}`);
    }
    if (params.end_date !== undefined && params.end_date !== null) {
      query.push(`end_date=${encodeURIComponent(params.end_date)}`);
    }
  }
  if (query.length > 0) {
    path = `${path}?${query.join("&")}`;
  }
  return apiFetch<KanbanTaskCard[]>(path);
}

/**
 * 工时热力网格 — 逐人逐日 plan/actual 工时 (人天,FR-02)。
 *
 * 后端聚合口径 (kanban/service.py `get_workload_grid`):
 * - plan_hours   剩余负载摊天 (仅 ≥ today,面向未来;过去日期无值)
 * - actual_hours time_spent 覆盖日求和 (含今天)
 * user_ids 多次同名 query(同 listKanbanTasks 拼 URL 方式)。
 */
export async function fetchWorkloadGrid(params: {
  start_date: string;
  end_date: string;
  project_id?: string | null;
  user_ids?: string[] | null;
}): Promise<WorkloadGridResponse> {
  const query: string[] = [
    `start_date=${encodeURIComponent(params.start_date)}`,
    `end_date=${encodeURIComponent(params.end_date)}`,
  ];
  if (params.project_id !== undefined && params.project_id !== null) {
    query.push(`project_id=${encodeURIComponent(params.project_id)}`);
  }
  if (params.user_ids && params.user_ids.length > 0) {
    for (const uid of params.user_ids) {
      query.push(`user_ids=${encodeURIComponent(uid)}`);
    }
  }
  return apiFetch<WorkloadGridResponse>(
    `/api/ppm/kanban/workload-grid?${query.join("&")}`,
  );
}

/** 分配任务给人员 (更新 PlanTask.user_id/user_name/kanban_order)。 */
export async function assignKanbanTask(
  body: KanbanTaskAssignReq,
): Promise<boolean> {
  return apiFetch<boolean>("/api/ppm/kanban/task/assign", {
    method: "POST",
    json: body,
  });
}

/** 拖拽排序 — 按 body.task_ids 顺序批量写 kanban_order。 */
export async function reorderKanbanTasks(
  body: KanbanTaskReorderReq,
): Promise<boolean> {
  return apiFetch<boolean>("/api/ppm/kanban/task/reorder", {
    method: "PUT",
    json: body,
  });
}

// ---------------------------------------------------------------------------
// task-01: task CRUD + comment/subtask (FR-01 / D-011)
// ---------------------------------------------------------------------------

/** 新建看板任务。kanban_order 后端自动取该 user 列尾 +1。 */
export async function createKanbanTask(
  body: KanbanTaskCreateReq,
): Promise<KanbanTaskCard> {
  return apiFetch<KanbanTaskCard>("/api/ppm/kanban/task", {
    method: "POST",
    json: body,
  });
}

/** 删除任务(级联删 comment/subtask)。 */
export async function deleteKanbanTask(taskId: string): Promise<boolean> {
  await apiFetch<void>(`/api/ppm/kanban/task?task_id=${encodeURIComponent(taskId)}`, {
    method: "DELETE",
  });
  return true;
}

/** 列任务评论(按 created_at 升序)。 */
export async function listKanbanComments(
  taskId: string,
): Promise<KanbanComment[]> {
  return apiFetch<KanbanComment[]>(
    `/api/ppm/kanban/task/${encodeURIComponent(taskId)}/comments`,
  );
}

/** 新增评论。 */
export async function addKanbanComment(
  taskId: string,
  body: KanbanCommentCreateReq,
): Promise<KanbanComment> {
  return apiFetch<KanbanComment>(
    `/api/ppm/kanban/task/${encodeURIComponent(taskId)}/comments`,
    {
      method: "POST",
      json: body,
    },
  );
}
