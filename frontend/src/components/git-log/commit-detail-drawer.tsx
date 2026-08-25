"use client";

/**
 * task-06：提交详情抽屉（antd Drawer 右侧 560px）。
 *
 * - 详情区：哈希/作者/提交时间网格（哈希 monospace）+ refs 标签（复用
 *   commit-list 的 RefBadges）+ message 全文卡（whitespace-pre-wrap）；
 * - 变更文件目录树（GitLogFileTree）：叶子点击按需展开 unified diff；
 * - 数据按需：useGitLogCommitDetail 仅在 Drawer 打开（open && sha 非空）时
 *   发起；destroyOnClose 关闭即卸载内容——diff 展开态随关闭释放（design §5.4）；
 * - 文件树按提交 hash 作 key：切换提交时重挂，避免上一提交的 diff 展开态残留。
 *
 * 依据：tasks/task-06.md、design.md §5.4 / §7.4、prototype-workspace-git-log.html。
 */

import { Drawer } from "antd";

import { ApiError } from "@/lib/api";
import { useGitLogCommitDetail } from "@/lib/git-log";
import { GitLogFileTree } from "./file-tree";
import { RefBadges } from "./commit-list";

export interface CommitDetailDrawerProps {
  workspaceId: string;
  /** 选中的提交全长哈希（null = 未选中）。 */
  sha: string | null;
  open: boolean;
  onClose: () => void;
}

/** 作者时间格式化（zh-CN；测试不断言具体格式，防 CI ICU 差异）。 */
function formatTime(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString("zh-CN");
}

export function CommitDetailDrawer({
  workspaceId,
  sha,
  open,
  onClose,
}: CommitDetailDrawerProps) {
  // enabled = open && sha 非空：关闭态零请求
  const detailQuery = useGitLogCommitDetail(
    workspaceId,
    sha ?? "",
    open && sha != null,
  );
  const data = detailQuery.data;

  return (
    <Drawer
      title="提交详情"
      placement="right"
      width={560}
      open={open}
      onClose={onClose}
      destroyOnClose
      data-testid="git-log-detail-drawer"
    >
      {detailQuery.isPending ? (
        <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : detailQuery.isError ? (
        <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {detailQuery.error instanceof ApiError
            ? detailQuery.error.message
            : "加载提交详情失败"}
        </div>
      ) : data ? (
        <div className="flex flex-col gap-4">
          <dl
            className="grid grid-cols-[72px_1fr] gap-x-3 gap-y-1.5 text-xs"
            data-testid="git-log-detail-meta"
          >
            <dt className="text-muted-foreground">哈希</dt>
            <dd
              className="break-all font-mono text-foreground"
              data-testid="git-log-detail-hash"
            >
              {data.hash}
            </dd>
            <dt className="text-muted-foreground">作者</dt>
            <dd className="break-all text-foreground">
              {data.author_name}
              <span className="text-muted-foreground">
                {" "}
                &lt;{data.author_email}&gt;
              </span>
            </dd>
            <dt className="text-muted-foreground">提交时间</dt>
            <dd className="text-foreground">
              {formatTime(data.author_date)}
            </dd>
            <dt className="text-muted-foreground">分支 / 标签</dt>
            <dd className="flex flex-wrap items-center gap-1">
              <RefBadges refs={data.refs} />
            </dd>
          </dl>

          <section>
            <h3 className="mb-1.5 text-xs font-semibold text-foreground">
              提交说明
            </h3>
            <div className="whitespace-pre-wrap rounded-md border border-border bg-muted/40 p-2.5 text-xs leading-relaxed text-foreground">
              {data.message}
            </div>
          </section>

          <section>
            <h3 className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-foreground">
              变更文件（{data.files.length}）
              <span className="font-normal text-muted-foreground">
                点击文件查看 diff
              </span>
            </h3>
            {/* key=hash：切换提交时重挂文件树，重置 diff 展开态 */}
            <GitLogFileTree
              key={data.hash}
              workspaceId={workspaceId}
              sha={data.hash}
              files={data.files}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
