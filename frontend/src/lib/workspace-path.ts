import type { DaemonRuntimeRead } from "@/lib/daemon";
import type { Workspace } from "@/lib/workspaces";

export type WorkspacePathSource = Workspace["path_source"];

export function isDaemonClientWorkspace(workspace: Pick<Workspace, "path_source">): boolean {
  return workspace.path_source === "daemon-client";
}

export function workspacePathSourceLabel(pathSource: WorkspacePathSource): string {
  return pathSource === "daemon-client" ? "本机守护进程路径" : "服务器本地路径";
}

export function workspaceRootPathLabel(pathSource: WorkspacePathSource): string {
  return pathSource === "daemon-client" ? "客户端路径" : "root_path";
}

export function formatDaemonRuntimeSummary(
  runtime: DaemonRuntimeRead | null | undefined,
): string {
  if (!runtime) {
    return "未找到绑定运行时";
  }
  const label = runtime.name?.trim() || runtime.provider?.trim() || runtime.id.slice(0, 8);
  const version = runtime.version ? ` v${runtime.version}` : "";
  const status =
    runtime.status === "online"
      ? "在线"
      : runtime.status === "offline"
        ? "离线"
        : runtime.status ?? "未知";
  return `${label}${version}（${status}）`;
}

export function daemonRuntimeStatusVariant(
  runtime: DaemonRuntimeRead | null | undefined,
): "success" | "outline" | "destructive" {
  if (!runtime) return "destructive";
  if (runtime.status === "online") return "success";
  if (runtime.status === "offline") return "destructive";
  return "outline";
}
