import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import type { DaemonRuntimeRead } from "@/lib/daemon";
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
  /** Show link to /runtimes when daemon-client */
  linkRuntime?: boolean;
}

export function WorkspacePathFields({
  workspace,
  runtime,
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
