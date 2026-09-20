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
} from "@/lib/workspace-path";
import type { Workspace } from "@/lib/workspaces";

interface WorkspacePathFieldsProps {
  workspace: Pick<Workspace, "root_path">;
  runtime?: DaemonRuntimeRead | null;
  /**
   * 遗留 1（daemon-entity-binding）：按 daemon 实体展示绑定信息。
   * 绑定存 member binding 行，卡片优先传 daemon 实体，显示 hostname/display_alias + provider 徽标（在线状态由卡片头 daemon 徽标承担，ql-20260821-007 去重）。
   * 传入时优先于 ``runtime`` 旧路径渲染。
   */
  daemon?: DaemonInstanceRead | null;
  /** Show link to /runtimes when daemon-client */
  linkRuntime?: boolean;
  /**
   * ql-20260920-007（D-004，2026-09-20-workspace-member-visibility）：当前用户本人
   * binding 的本地项目路径。string=本人路径；null=未绑定（显示「未绑定」引导文案）；
   * undefined=调用方未接线（兼容旧调用方，退回 workspace.root_path 全局路径）。
   */
  myRootPath?: string | null;
  /**
   * ql-20260918-012：Git 远程仓库地址（后端 probe 自动识别回填 DB）。
   * 为空（direct/unknown 态、未识别或无权限探测）不渲染该行。
   */
  repoUrl?: string | null;
}

/**
 * ql-20260918-012：「Git 地址」行——http(s) 地址渲染为可点外链（卡片整卡
 * 可点，链接 click 不冒泡），scp/ssh 形态纯文本展示。
 */
function RepoUrlRow({ repoUrl }: { repoUrl: string }) {
  return (
    <>
      <dt className="text-muted-foreground">Git 地址</dt>
      <dd className="break-all font-mono" title={repoUrl}>
        {/^https?:\/\//.test(repoUrl) ? (
          <a
            href={repoUrl}
            target="_blank"
            rel="noreferrer"
            className="text-primary hover:underline"
            onClick={(e) => e.stopPropagation()}
          >
            {repoUrl}
          </a>
        ) : (
          repoUrl
        )}
      </dd>
    </>
  );
}

/**
 * ql-20260920-007：「客户端路径」行渲染——优先本人 binding 路径（D-004 成员制口径，
 * 不同账号各自看到自己的路径），未绑定显示引导文案；调用方未接线（undefined）时
 * 退回 workspace.root_path（创建者全局路径，兼容旧调用方）。
 */
function ClientPathRow({
  workspace,
  myRootPath,
}: {
  workspace: Pick<Workspace, "root_path">;
  myRootPath?: string | null;
}) {
  if (myRootPath === null) {
    return (
      <>
        <dt className="text-muted-foreground">客户端路径</dt>
        <dd className="text-muted-foreground">
          未绑定——进入工作区后在「我的接入」绑定后显示你的本地路径
        </dd>
      </>
    );
  }
  const path = myRootPath ?? workspace.root_path;
  return (
    <>
      <dt className="text-muted-foreground">客户端路径</dt>
      <dd className="break-all font-mono" title={path}>
        {path}
      </dd>
    </>
  );
}

export function WorkspacePathFields({
  workspace,
  runtime,
  daemon,
  linkRuntime = false,
  myRootPath,
  repoUrl,
}: WorkspacePathFieldsProps) {
  // 遗留 1：daemon 实体维度渲染（绑定走 member binding，daemon 实体优先）。
  if (daemon) {
    const daemonLabel = daemon.display_alias ?? daemon.hostname;
    const providerLabels = daemon.providers
      .map((p) => PROVIDER_META[p.provider]?.label ?? p.provider)
      .filter(Boolean);
    return (
      <>
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
        </dd>

        <ClientPathRow workspace={workspace} myRootPath={myRootPath} />

        {repoUrl ? <RepoUrlRow repoUrl={repoUrl} /> : null}
      </>
    );
  }

  // 兜底分支：未传 daemon 实体时退化为 runtime 摘要展示（老调用方）。
  // daemon-entity-binding 后 runtime 恒为 null，此分支实为空态兜底。
  return (
    <>
      <dt className="text-muted-foreground">绑定守护进程</dt>
      <dd className="min-w-0">
        {linkRuntime ? (
          <Link
            href="/runtimes"
            className="truncate text-primary hover:underline"
          >
            {formatDaemonRuntimeSummary(runtime)}
          </Link>
        ) : (
          <span className="truncate">
            {formatDaemonRuntimeSummary(runtime)}
          </span>
        )}
        {runtime && (
          <Badge
            variant={daemonRuntimeStatusVariant(runtime)}
            className="ml-1.5 inline-flex flex-wrap gap-1 align-middle text-[10px]"
          >
            {labelOf(DAEMON_RUNTIME_STATUS_LABELS, runtime.status)}
          </Badge>
        )}
      </dd>

      <ClientPathRow workspace={workspace} myRootPath={myRootPath} />

      {repoUrl ? <RepoUrlRow repoUrl={repoUrl} /> : null}
    </>
  );
}
