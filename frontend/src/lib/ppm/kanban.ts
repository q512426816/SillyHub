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
import type {
  KanbanOrgGroup,
  KanbanQueryReq,
  KanbanTaskAssignReq,
  KanbanTaskCard,
  KanbanTaskReorderReq,
  KanbanUserColumn,
} from "./types";

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
  }
  if (query.length > 0) {
    path = `${path}?${query.join("&")}`;
  }
  return apiFetch<KanbanTaskCard[]>(path);
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

/** 搜人 — 按 project_member.user_name 模糊匹配。 */
export async function searchKanbanUsers(keyword: string): Promise<KanbanUserColumn[]> {
  return apiFetch<KanbanUserColumn[]>("/api/ppm/kanban/search/users", {
    query: { keyword },
  });
}
