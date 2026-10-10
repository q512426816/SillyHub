/**
 * 工作区「关联仓」API 封装（2026-10-10-workspec-maintenance task-05/06 / FR-06）。
 *
 * 后端：backend/app/modules/workspace/linked_repos/router.py（六个端点）。
 * 类型：api-types.ts 生成类型（`pnpm gen:types`，CLAUDE.md 规则 21）。
 */

import { apiFetch } from "./api";
import type { components } from "./api-types";

export type LinkedRepoView = components["schemas"]["LinkedRepoOut"];
export type LinkedRepoSyncBrief = components["schemas"]["SyncStateBrief"];

/** 创建/编辑共享字段入参（对齐后端 LinkedRepoCreate/Update 的可选并集）。 */
export interface LinkedRepoUpsertInput {
  name?: string;
  repo_url?: string | null;
  description?: string | null;
  rel_path?: string | null;
}

function base(workspaceId: string): string {
  return `/api/workspaces/${workspaceId}/linked-repos`;
}

export async function listLinkedRepos(workspaceId: string): Promise<LinkedRepoView[]> {
  const data = await apiFetch<LinkedRepoView[]>(base(workspaceId));
  return data ?? [];
}

export async function createLinkedRepo(
  workspaceId: string,
  input: LinkedRepoUpsertInput,
): Promise<LinkedRepoView> {
  return apiFetch<LinkedRepoView>(base(workspaceId), {
    method: "POST",
    json: input,
  });
}

export async function updateLinkedRepo(
  workspaceId: string,
  repoId: string,
  input: LinkedRepoUpsertInput,
): Promise<LinkedRepoView> {
  return apiFetch<LinkedRepoView>(`${base(workspaceId)}/${repoId}`, {
    method: "PATCH",
    json: input,
  });
}

export async function deleteLinkedRepo(workspaceId: string, repoId: string): Promise<void> {
  await apiFetch(`${base(workspaceId)}/${repoId}`, { method: "DELETE" });
}

/** 成员级本机路径 upsert；path=null 清除（仅作用本人行）。 */
export async function saveMyLinkedRepoPath(
  workspaceId: string,
  repoId: string,
  path: string | null,
): Promise<LinkedRepoView> {
  return apiFetch<LinkedRepoView>(`${base(workspaceId)}/${repoId}/my-path`, {
    method: "PUT",
    json: { path },
  });
}

export interface SyncNowOutcome {
  dispatched: boolean;
  reason?: string;
  repo_count: number;
}

/** 「立即同步」：受理即返；结果经 daemon 回报落库后由列表刷新可见。 */
export async function syncLinkedReposNow(workspaceId: string): Promise<SyncNowOutcome> {
  return apiFetch<SyncNowOutcome>(`${base(workspaceId)}/sync`, { method: "POST" });
}
