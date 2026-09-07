/**
 * Daemon API client —— 目录枚举域（listDir/listRoots RPC）。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";

/**
 * 目录条目（task-11 list_dir RPC 响应，FR-03 / D-005@v1）。
 */
export interface DirEntry {
  name: string;
  type: "dir" | "file";
}

export interface ListDirResponse {
  entries: DirEntry[];
}

/**
 * 经 backend 转发的 daemon list_dir RPC（task-04 端点）。
 * 受 daemon allowed_roots 白名单限制（D-002@v1），越界 403。
 */
export async function listDir(
  runtimeId: string,
  path: string,
): Promise<ListDirResponse> {
  return apiFetch<ListDirResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-dir`,
    { method: "POST", json: { path } },
  );
}

/**
 * task-07 / FR-2：经 backend 转发的 daemon list_roots RPC（task-04 端点）。
 * 返回 daemon 主机可枚举的根锚点：Windows 盘符（如 C:\）或 Unix 根（/）。
 * RemoteFolderPicker 打开时调用，作为目录树的初始根节点。
 */
export interface ListRootsResponse {
  roots: string[];
}

export async function listRoots(
  runtimeId: string,
): Promise<ListRootsResponse> {
  return apiFetch<ListRootsResponse>(
    `/api/daemon/runtimes/${runtimeId}/list-roots`,
    { method: "POST", json: {} },
  );
}
