"use client";

/**
 * 工作区单文件 diff 弹窗（2026-10-25-explorer-git-status task-05，FR-03 /
 * D-004 / D-010）：点击「工作区更改」卡文件行后打开，展示该文件
 * 「工作区 vs 最近一次提交」的 unified diff 红绿对比。
 *
 * - 受控组件（``open``/``path``/``status`` props，挂载接线在 git-log 页
 *   task-06）；取数组件内自持 ``useGitLogWorktreeDiff``（``enabled =
 *   open && path 非空``，关闭态零请求）；
 * - 三态渲染（daemon 侧分流落点）：modified 红绿对比 / untracked 全 +
 *   行（no-index 全新增形态，D-010）/ deleted 全 − 行；行渲染复用
 *   file-tree.tsx 导出的 ``parseUnifiedDiff`` + ``DiffBody``（不引入第三方
 *   diff 库，对齐 conflict-compare-modal 先例）；
 * - ``truncated`` 顶部截断提示条（超 64KB，daemon 侧截断）；``binary``
 *   只提示「二进制文件」不渲染 diff；
 * - 错误分型降级对齐 scope-file-diff-modal.tsx 先例：422 daemon 版本过旧
 *   （不可重试，升级引导）/ 404（未绑定、文件已被提交或删除）/ 502 离线 /
 *   504 超时；可重试族给重试按钮。
 *
 * 依据：design.md §Phase 3 / §接口定义、tasks/task-05.md、
 * prototype-explorer-git-status.html ②。
 */

import { Modal } from "antd";

import { DiffBody } from "@/components/git-log/file-tree";
import {
  WORKTREE_STATUS_META,
  type WorktreeStatusMeta,
} from "@/components/git-log/worktree-changes-card";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  useGitLogWorktreeDiff,
  type DirtyFileStatus,
  type GitWorktreeDiffResponse,
} from "@/lib/git-log";
import { cn } from "@/lib/utils";

export interface WorktreeDiffModalProps {
  workspaceId: string;
  /** 打开的目标文件（仓库相对路径）；null 不取数。 */
  path: string | null;
  /** 触发行状态（响应缺失时的徽标回退值）。 */
  status: DirtyFileStatus | null;
  open: boolean;
  onClose: () => void;
}

/** 错误降级文案（ApiError.status 分型，对齐 git-log 页既有口径）。 */
function degradeCopy(err: ApiError): { title: string; desc: string; retry: boolean } {
  if (err.status === 422) {
    return {
      title: "本机 daemon 版本过旧",
      desc: "守护进程版本过旧，未注册工作区文件 diff 指令；升级 daemon 后重试。",
      retry: false,
    };
  }
  if (err.status === 404) {
    return {
      title: "文件差异不存在",
      desc:
        err.code === "HTTP_404_GIT_LOG_NOT_BOUND"
          ? "当前账号未绑定本机工作区，请先到「成员」页完成绑定。"
          : "文件可能已被提交或删除，请刷新工作区更改后重试。",
      retry: false,
    };
  }
  if (err.status === 502) {
    return {
      title: "守护进程离线",
      desc: "本机守护进程离线，无法读取文件差异。请启动 daemon 后重试。",
      retry: true,
    };
  }
  if (err.status === 504) {
    return {
      title: "查询超时",
      desc: "文件差异查询超时，请稍后重试。",
      retry: true,
    };
  }
  return {
    title: "读取文件差异失败",
    desc: err.message || "网络异常，请稍后重试。",
    retry: true,
  };
}

function Body({
  query,
}: {
  query: ReturnType<typeof useGitLogWorktreeDiff>;
}) {
  if (query.isPending) {
    return (
      <div
        className="flex min-h-[320px] items-center justify-center"
        data-testid="worktree-diff-loading"
      >
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        <span className="ml-3 text-sm text-muted-foreground">
          正在读取文件差异…
        </span>
      </div>
    );
  }
  if (query.isError) {
    const err =
      query.error instanceof ApiError
        ? degradeCopy(query.error)
        : {
            title: "读取文件差异失败",
            desc: "网络异常，请稍后重试。",
            retry: true,
          };
    return (
      <div
        className="flex min-h-[320px] flex-col items-center justify-center gap-4 p-8 text-center"
        data-testid="worktree-diff-error"
      >
        <p className="text-sm font-semibold text-foreground">{err.title}</p>
        <p className="max-w-md text-xs text-muted-foreground">{err.desc}</p>
        {err.retry && (
          <Button variant="outline" onClick={() => void query.refetch()}>
            重试
          </Button>
        )}
      </div>
    );
  }
  const data: GitWorktreeDiffResponse | undefined = query.data;
  if (data == null) return null;
  if (data.binary) {
    return (
      <div
        className="flex min-h-[320px] items-center justify-center p-8 text-xs text-muted-foreground"
        data-testid="worktree-diff-binary"
      >
        二进制文件，不支持文本 diff
      </div>
    );
  }
  if (data.diff === "") {
    // 竞态：列表点开后文件被提交/还原 → 无差异。
    return (
      <div
        className="flex min-h-[320px] items-center justify-center p-8 text-center text-xs text-muted-foreground"
        data-testid="worktree-diff-empty"
      >
        该文件与最近一次提交已无差异（可能刚被提交或还原），请刷新工作区更改。
      </div>
    );
  }
  return (
    <>
      {data.truncated && (
        <p
          className="mb-2 rounded border border-warning/30 bg-warning/10 px-3 py-1.5 text-xs text-warning"
          data-testid="worktree-diff-truncated"
        >
          文件差异超过 64KB 上限，以下内容已截断。
        </p>
      )}
      <div className="max-h-[calc(100vh-360px)] min-h-[320px] overflow-auto rounded border border-border bg-card">
        <DiffBody diff={data.diff} />
      </div>
    </>
  );
}

export function WorktreeDiffModal({
  workspaceId,
  path,
  status,
  open,
  onClose,
}: WorktreeDiffModalProps) {
  // 关闭态（open=false / path=null）enabled=false：零请求（挂载即渲染壳，不取数）。
  const diffQuery = useGitLogWorktreeDiff(
    workspaceId,
    path ?? "",
    open && path !== null,
  );

  // 徽标状态：响应值优先（真实判态），缺省回退触发行传入的展示态。
  const badgeStatus: DirtyFileStatus | null =
    diffQuery.data?.status ?? status ?? null;
  const meta: WorktreeStatusMeta | null =
    badgeStatus == null ? null : WORKTREE_STATUS_META[badgeStatus];

  return (
    <Modal
      open={open}
      onCancel={onClose}
      footer={null}
      width="min(1080px, 94vw)"
      destroyOnClose
      title={
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span>工作区文件差异</span>
          {meta && (
            <span
              className={cn("rounded border px-1 text-[10px] leading-4", meta.badge)}
              data-testid="worktree-diff-status-badge"
            >
              {meta.label}
            </span>
          )}
          <code
            data-testid="worktree-diff-path"
            className="min-w-0 break-all font-mono text-xs text-muted-foreground"
          >
            {path ?? "—"}
          </code>
        </div>
      }
    >
      {/* 头部基线信息条（对齐 scope-file-diff-modal 锚点条形态） */}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-muted/40 px-4 py-2 text-xs text-muted-foreground">
        <span>
          对比基线：最近一次提交
          <b className="ml-1 font-mono font-semibold text-foreground">
            {diffQuery.data?.head_short ?? "—"}
          </b>
        </span>
        <span>口径：工作区当前内容 vs HEAD（不区分暂存）</span>
      </div>
      <Body query={diffQuery} />
    </Modal>
  );
}
