import { apiFetch } from "./api";

export type TaskSummary = {
  id: string;
  workspace_id: string;
  change_id: string;
  task_key: string;
  title: string | null;
  status: string;
  phase: string | null;
  priority: string | null;
  owner_key: string | null;
  estimated_hours: number | null;
  affected_components: string[];
  depends_on: string[];
  blocks: string[];
  created_at: string;
  updated_at: string;
};

export type TaskRead = TaskSummary & {
  allowed_paths: string[];
  path: string | null;
  content: string | null;
};

export type TaskList = {
  items: TaskSummary[];
  total: number;
};

export type TaskBoardColumn = {
  status: string;
  count: number;
  items: TaskSummary[];
};

export type TaskBoard = {
  columns: TaskBoardColumn[];
};

export type TaskParseWarning = {
  code: string;
  detail: string;
  task_key: string | null;
};

export type TaskReparseStats = {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
};

export type TaskReparseResponse = {
  workspace_id: string;
  change_id: string;
  stats: TaskReparseStats;
  warnings: TaskParseWarning[];
};

export function listTasks(
  workspaceId: string,
  changeId: string,
  params?: {
    status?: string;
    owner?: string;
    priority?: string;
    phase?: string;
  },
) {
  const searchParams = new URLSearchParams();
  if (params?.status) searchParams.set("status", params.status);
  if (params?.owner) searchParams.set("owner", params.owner);
  if (params?.priority) searchParams.set("priority", params.priority);
  if (params?.phase) searchParams.set("phase", params.phase);
  const qs = searchParams.toString();
  return apiFetch<TaskList>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/tasks${qs ? `?${qs}` : ""}`,
  );
}

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
