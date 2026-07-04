import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type {
  DaemonInstanceRead,
  DaemonRuntimeRead,
} from "@/lib/daemon";
import { PROVIDER_META } from "@/lib/daemon";
import {
  DAEMON_RUNTIME_STATUS_LABELS,
  labelOf,
} from "@/lib/status-labels";
import {
  daemonRuntimeStatusVariant,
  formatDaemonRuntimeSummary,
  isDaemonClientWorkspace,
  workspacePathSourceLabel,
  workspaceRootPathLabel,
  type WorkspacePathSource,
} from "@/lib/workspace-path";
import type { Workspace } from "@/lib/workspaces";

interface WorkspacePathFieldsProps {
  workspace: Pick<Workspace, "root_path" | "path_source" | "daemon_runtime_id">;
  runtime?: DaemonRuntimeRead | null;
  /**
   * 遗留 1（daemon-entity-binding）：按 daemon 实体展示绑定信息。
   * 新工作区 ``workspace.daemon_runtime_id`` 为 NULL（绑定存 member binding 行），
   * 卡片改为传 daemon 实体，显示 hostname/display_alias + provider 徽标。
   * 传入时优先于 ``runtime`` 旧路径渲染。
   */
  daemon?: DaemonInstanceRead | null;
  /** Show link to /runtimes when daemon-client */
  linkRuntime?: boolean;
}

export function WorkspacePathFields({
  workspace,
  runtime,
  daemon,
  linkRuntime = false,
}: WorkspacePathFieldsProps) {
  const pathSource: WorkspacePathSource = workspace.path_source ?? "server-local";
  const daemonClient = isDaemonClientWorkspace({ path_source: pathSource });

  if (!daemonClient) {
    return (
      <>
        <dt className="text-muted-foreground">{workspaceRootPathLabel(pathSource)}</dt>
        <dd className="break-all font-mono" title={workspace.root_path}>
          {workspace.root_path}
        </dd>
      </>
    );
  }

  // 遗留 1：daemon 实体维度渲染（新绑定走 member binding，daemon_runtime_id 已废弃为 NULL）。
  if (daemon) {
    const daemonLabel = daemon.display_alias ?? daemon.hostname;
    const providerLabels = daemon.providers
      .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
      .filter(Boolean);
    return (
      <>
        <dt className="text-muted-foreground">路径来源</dt>
        <dd>
          <Badge variant="outline" className="text-[10px]">
            {workspacePathSourceLabel(pathSource)}
          </Badge>
        </dd>

        <dt className="text-muted-foreground">绑定守护进程</dt>
        <dd className="min-w-0">
          {linkRuntime ? (
            <Link
              href="/runtimes"
              className="truncate text-primary hover:underline"
              title={daemon.id}
            >
              {daemonLabel}
            </Link>
          ) : (
            <span className="truncate" title={daemon.id}>
              {daemonLabel}
            </span>
          )}
          {providerLabels.length > 0 && (
            <span className="ml-1.5 inline-flex flex-wrap gap-1 align-middle">
              {providerLabels.map((label) => (
                <Badge key={label} variant="outline" className="text-[10px]">
                  {label}
                </Badge>
              ))}
            </span>
          )}
          <Badge
            variant={daemon.status === "online" ? "success" : "outline"}
            className="ml-1.5 align-middle text-[10px]"
          >
            {daemon.status === "online" ? "在线" : "离线"}
          </Badge>
        </dd>

        <dt className="text-muted-foreground">{workspaceRootPathLabel(pathSource)}</dt>
        <dd className="break-all font-mono" title={workspace.root_path}>
          {workspace.root_path}
        </dd>
      </>
    );
  }

  return (
    <>
      <dt className="text-muted-foreground">路径来源</dt>
      <dd>
        <Badge variant="outline" className="text-[10px]">
          {workspacePathSourceLabel(pathSource)}
        </Badge>
      </dd>

      {daemonClient && (
        <>
          <dt className="text-muted-foreground">绑定守护进程</dt>
          <dd className="min-w-0">
            {linkRuntime && workspace.daemon_runtime_id ? (
              <Link
                href="/runtimes"
                className="truncate text-primary hover:underline"
                title={workspace.daemon_runtime_id}
              >
                {formatDaemonRuntimeSummary(runtime)}
              </Link>
            ) : (
              <span className="truncate" title={workspace.daemon_runtime_id ?? undefined}>
                {formatDaemonRuntimeSummary(runtime)}
              </span>
            )}
            {runtime && (
              <Badge
                variant={daemonRuntimeStatusVariant(runtime)}
                className="ml-1.5 align-middle text-[10px]"
              >
                {labelOf(DAEMON_RUNTIME_STATUS_LABELS, runtime.status)}
              </Badge>
            )}
          </dd>
        </>
      )}

      <dt className="text-muted-foreground">{workspaceRootPathLabel(pathSource)}</dt>
      <dd className="break-all font-mono" title={workspace.root_path}>
        {workspace.root_path}
      </dd>
    </>
  );
}
