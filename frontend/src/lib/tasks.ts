import { apiFetch } from "./api";
import type { components } from "@/lib/api-types";

// 类型从 OpenAPI 自动生成（@/lib/api-types，由 scripts/gen-api-types.mjs 产出），
// 消除手写类型漂移。后端 schema 来源：backend/app/modules/task/schema.py。
// 注意：schema 的 TaskSummary/TaskRead 比旧手写多 `workspace_ids: string[]`（超集，
// 读侧消费者忽略即可）；TaskParseWarning.task_key 在 schema 中为可选（旧手写为可空）。
export type TaskSummary = components["schemas"]["TaskSummary"];
export type TaskRead = components["schemas"]["TaskRead"];
export type TaskList = components["schemas"]["TaskList"];
export type TaskBoardColumn = components["schemas"]["TaskBoardColumn"];
export type TaskBoard = components["schemas"]["TaskBoard"];
export type TaskParseWarning = components["schemas"]["TaskParseWarning"];
export type TaskReparseStats = components["schemas"]["TaskReparseStats"];
export type TaskReparseResponse = components["schemas"]["TaskReparseResponse"];

export function getTask(workspaceId: string, taskId: string) {
  return apiFetch<TaskRead>(
    `/api/workspaces/${workspaceId}/tasks/${taskId}`,
  );
}

export function getTaskBoard(workspaceId: string, changeId: string) {
  return apiFetch<TaskBoard>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/tasks/board`,
  );
}

export function reparseTasks(workspaceId: string, changeId: string) {
  return apiFetch<TaskReparseResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/tasks/reparse`,
    { method: "POST" },
  );
}
