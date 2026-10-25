"use client";

/**
 * 「工作区更改」卡（2026-10-25-explorer-git-status task-04，FR-02 / D-001 /
 * D-002 / D-007）：Git 日志页状态条之下、提交列表之上，IDEA 三分组展示
 * 工作区未提交改动。
 *
 * - 数据源 ``useGitLogDirtyFiles``（D-007 单一数据源——explorer 树着色共用）；
 * - 三分组（原型 ①）：「更改」（added/modified/deleted，对比基线 = 最近一次
 *   提交 head_short）/「未纳入版本管理」（untracked）/「已忽略」（顶层聚合
 *   行，D-003 不递归展开）；目录聚合复用 file-tree.tsx 的 buildFileTree；
 * - 文件行四色（D-002，仅本变更新功能）：新增/新文件=绿 text-success、修改=
 *   蓝 text-primary、删除=红+删除线 text-error line-through、忽略=灰
 *   text-muted-foreground；行尾 +N/−N 行数（null 不显示，R-06 untracked 仅
 *   「新文件」徽标）+ 状态徽标；点击文件行 ``onOpenFile(path, status)``
 *   （diff 弹窗由父层装配，本卡不开弹窗）；
 * - 卡头：汇总计数徽标 + 快照时间（dataUpdatedAt）+ 刷新（invalidate
 *   ``["git-log", wid]`` 前缀，覆盖本卡与页面全部 git-log 查询）+ 折叠；
 * - 降级：no_git / 空态轻提示、错误分型小黄条（不挤掉提交列表）。
 *
 * 依据：design.md §Phase 3 / §接口定义、tasks/task-04.md、
 * prototype-explorer-git-status.html ①。
 */

import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ChevronRight, FileText, Folder } from "lucide-react";

import { buildFileTree, type GitLogFileTreeNode } from "@/components/git-log/file-tree";
import { ApiError } from "@/lib/api";
import {
  useGitLogDirtyFiles,
  type DirtyFileStatus,
  type GitDirtyFileItem,
  type GitIgnoredItem,
} from "@/lib/git-log";
import { cn } from "@/lib/utils";

// ── 四色状态元数据（D-002；与 file-changes-card 的 FILE_STATUS_META 无关）──

export interface WorktreeStatusMeta {
  label: string;
  text: string;
  badge: string;
  dot: string;
}

/**
 * IDEA 颜色语义（D-002，仅本变更新功能使用）：新增/新文件=绿、修改=蓝、
 * 删除=红+删除线、忽略=灰。导出供 explorer 树着色（task-07）复用同一语义。
 */
export const WORKTREE_STATUS_META: Record<DirtyFileStatus, WorktreeStatusMeta> = {
  added: {
    label: "新增",
    text: "text-success",
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  modified: {
    label: "修改",
    text: "text-primary",
    badge: "border-primary/30 bg-primary/10 text-primary",
    dot: "bg-primary",
  },
  deleted: {
    label: "删除",
    text: "text-error line-through",
    badge: "border-error/30 bg-error/10 text-error",
    dot: "bg-error",
  },
  untracked: {
    label: "新文件",
    text: "text-success",
    badge: "border-success/30 bg-success/10 text-success",
    dot: "bg-success",
  },
  ignored: {
    label: "忽略",
    text: "text-muted-foreground",
    badge: "border-border bg-muted/50 text-muted-foreground",
    dot: "bg-muted-foreground/40",
  },
};

/** 叶子数（目录行「N 个文件」计数）。 */
function countLeaves(node: GitLogFileTreeNode): number {
  if (node.children.length === 0) return 1;
  return node.children.reduce((acc, c) => acc + countLeaves(c), 0);
}

// ── 树渲染（目录聚合复用 buildFileTree；叶子状态按 path 查映射）────────────

function StatusTreeRows({
  nodes,
  statusByPath,
  onOpenFile,
  depth = 0,
}: {
  nodes: GitLogFileTreeNode[];
  statusByPath: Map<string, GitDirtyFileItem>;
  onOpenFile: (path: string, status: DirtyFileStatus) => void;
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleDir = (path: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  return (
    <div>
      {nodes.map((node) => {
        if (node.children.length > 0) {
          const isOpen = !collapsed.has(node.path);
          return (
            <div key={node.path}>
              <button
                type="button"
                className="flex w-full items-center gap-1.5 rounded px-2 py-0.5 text-xs transition-colors hover:bg-muted/60"
                style={{ paddingLeft: `${depth * 14 + 8}px` }}
                onClick={() => toggleDir(node.path)}
                data-testid={`worktree-dir-${node.path}`}
              >
                <ChevronRight
                  className={cn(
                    "h-3 w-3 shrink-0 text-muted-foreground transition-transform duration-200",
                    isOpen && "rotate-90",
                  )}
                  aria-hidden
                />
                <Folder className="h-3.5 w-3.5 shrink-0 text-brand-600" aria-hidden />
                {/* 本卡目录节点子树内必有改动文件（按改动清单构建），恒显蓝点 */}
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary" aria-hidden />
                <span className="truncate text-foreground">{node.name}</span>
                <span className="ml-auto shrink-0 text-[11px] text-muted-foreground">
                  {countLeaves(node)} 个文件
                </span>
              </button>
              {isOpen && (
                <StatusTreeRows
                  nodes={node.children}
                  statusByPath={statusByPath}
                  onOpenFile={onOpenFile}
                  depth={depth + 1}
                />
              )}
            </div>
          );
        }

        const item = statusByPath.get(node.path);
        const status: DirtyFileStatus = item?.status ?? "modified";
        const meta = WORKTREE_STATUS_META[status];
        return (
          <button
            key={node.path}
            type="button"
            className="flex w-full items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors hover:bg-muted/60"
            style={{ paddingLeft: `${depth * 14 + 8}px` }}
            onClick={() => onOpenFile(node.path, status)}
            data-testid={`worktree-file-${node.path}`}
          >
            <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
            <span className={cn("truncate font-mono", meta.text)} title={node.path}>
              {node.name}
            </span>
            {item?.binary && (
              <span className="shrink-0 rounded bg-muted px-1 text-[10px] text-muted-foreground">
                二进制
              </span>
            )}
            <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[11px]">
              {/* untracked 无行数（R-06）仅「新文件」徽标；二进制行数 null 同不显示 */}
              {item?.additions != null && item.additions > 0 && (
                <span className="text-success">+{item.additions}</span>
              )}
              {item?.deletions != null && item.deletions > 0 && (
                <span className="text-error">−{item.deletions}</span>
              )}
              <span className={cn("rounded border px-1 text-[10px] leading-4", meta.badge)}>
                {meta.label}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}

/** 忽略行（顶层聚合，不可点击——无 diff 语义，D-003）。 */
function IgnoredRow({ item }: { item: GitIgnoredItem }) {
  const meta = WORKTREE_STATUS_META.ignored;
  const name = item.is_dir ? item.path : item.path.split("/").pop() ?? item.path;
  return (
    <div
      className="flex items-center gap-1.5 rounded px-2 py-1 text-xs"
      data-testid={`worktree-ignored-${item.path}`}
    >
      {item.is_dir ? (
        <Folder className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      ) : (
        <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      )}
      <span className={cn("truncate font-mono", meta.text)} title={item.path}>
        {item.is_dir ? name : name}
      </span>
      <span className="ml-auto flex shrink-0 items-center gap-2">
        {item.is_dir && (
          <span className="text-[10px] text-muted-foreground">目录整体</span>
        )}
        <span className={cn("rounded border px-1 text-[10px] leading-4", meta.badge)}>
          {meta.label}
        </span>
      </span>
    </div>
  );
}

// ── 卡片本体 ──────────────────────────────────────────────────────────

export interface WorktreeChangesCardProps {
  workspaceId: string;
  /** 点击文件行（打开 diff 弹窗由父层装配）。 */
  onOpenFile: (path: string, status: DirtyFileStatus) => void;
}

export function WorktreeChangesCard({
  workspaceId,
  onOpenFile,
}: WorktreeChangesCardProps) {
  const query = useGitLogDirtyFiles(workspaceId);
  const queryClient = useQueryClient();
  const [collapsed, setCollapsed] = useState(false);

  const data = query.data;

  // 三分组数据（useMemo 防 treeData 每渲染重建）。
  const groups = useMemo(() => {
    if (!data) return null;
    const changed: GitDirtyFileItem[] = [];
    const untracked: GitDirtyFileItem[] = [];
    const statusByPath = new Map<string, GitDirtyFileItem>();
    for (const f of data.files) {
      statusByPath.set(f.path, f);
      if (f.status === "untracked") untracked.push(f);
      else changed.push(f);
    }
    // buildFileTree 消费 GitLogFileStatItem 形状（add/del 仅作层级聚合输入，
    // 展示行数直接读 statusByPath 原 item，null 语义不丢失）。
    const toStat = (f: GitDirtyFileItem) => ({
      path: f.path,
      add: f.additions ?? 0,
      del: f.deletions ?? 0,
      binary: f.binary,
    });
    return {
      changedTree: buildFileTree(changed.map(toStat)),
      untrackedTree: buildFileTree(untracked.map(toStat)),
      statusByPath,
      counts: {
        modified: changed.filter((f) => f.status === "modified").length,
        deleted: changed.filter((f) => f.status === "deleted").length,
        // 「新文件」口径含 untracked（IDEA「未纳入版本管理」同为新增语义）。
        added: changed.filter((f) => f.status === "added").length + untracked.length,
        ignored: data.ignored.length,
      },
    };
  }, [data]);

  const handleRefresh = () => {
    // invalidate ["git-log", wid] 前缀：覆盖本卡 dirty-files 与页面既有
    // commits/status 查询（design §Phase 3）。
    void queryClient.invalidateQueries({ queryKey: ["git-log", workspaceId] });
  };

  if (query.isPending) {
    return (
      <div
        className="rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground"
        data-testid="worktree-changes-loading"
      >
        正在读取工作区更改…
      </div>
    );
  }

  // 错误分型小黄条（对齐 git-log 页既有降级口径，卡级不挤掉提交列表）。
  if (query.isError) {
    const status = query.error instanceof ApiError ? query.error.status : undefined;
    const desc =
      status === 422
        ? "本机 daemon 版本过旧，不支持工作区文件状态查询，请升级 daemon。"
        : status === 404
          ? "当前账号未绑定本机工作区，无法读取工作区更改。"
          : status === 502 || status === 504
            ? "本机守护进程离线或超时，无法读取工作区更改，请稍后重试。"
            : "读取工作区更改失败，请稍后重试。";
    return (
      <div
        className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-2.5 text-xs text-warning"
        role="status"
        data-testid="worktree-changes-error"
      >
        {desc}
      </div>
    );
  }

  // no_git：组件自渲染 null（页面层 no_git 空态卡已覆盖，不重复堆叠）；
  // 无数据（非 pending 非 error 的异常态，如 hook 被 mock 置空）同样静默 null
  // ——不渲染半张卡（空卡头会与页面工具栏等断言/视觉产生噪声）。
  if (data == null || data.git_mode === "no_git") return null;

  const snapshotTime = new Date(query.dataUpdatedAt).toLocaleTimeString("zh-CN", {
    hour12: false,
  });

  return (
    <div
      className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      data-testid="worktree-changes-card"
    >
      {/* 卡头：标题 + 汇总计数 + 快照时间 + 刷新 + 折叠 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5">
        <span className="text-sm font-semibold">工作区更改</span>
        {groups && groups.counts.modified > 0 && (
          <span className="rounded border border-primary/30 bg-primary/10 px-1.5 text-[11px] text-primary">
            {groups.counts.modified} 处修改
          </span>
        )}
        {groups && groups.counts.deleted > 0 && (
          <span className="rounded border border-error/30 bg-error/10 px-1.5 text-[11px] text-error">
            {groups.counts.deleted} 删除
          </span>
        )}
        {groups && groups.counts.added > 0 && (
          <span className="rounded border border-success/30 bg-success/10 px-1.5 text-[11px] text-success">
            {groups.counts.added} 新文件
          </span>
        )}
        {groups && groups.counts.ignored > 0 && (
          <span className="rounded border border-border bg-muted/50 px-1.5 text-[11px] text-muted-foreground">
            忽略 {groups.counts.ignored} 项（聚合）
          </span>
        )}
        <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
          {data?.empty ? (
            <span>仓库还没有任何提交</span>
          ) : (
            <span>快照 {snapshotTime}</span>
          )}
          <button
            type="button"
            className="h-7 rounded-md border border-border px-2 transition-colors hover:bg-muted"
            onClick={handleRefresh}
            data-testid="worktree-changes-refresh"
          >
            刷新
          </button>
          <button
            type="button"
            className="text-muted-foreground/70 transition-colors hover:text-foreground"
            onClick={() => setCollapsed((c) => !c)}
            data-testid="worktree-changes-toggle"
          >
            {collapsed ? "▸ 展开" : "▾ 收起"}
          </button>
        </span>
      </div>

      {!collapsed && (
        <div className="px-2 py-2">
          {data?.empty ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              仓库还没有任何提交——第一次提交后这里会显示工作区更改。
            </div>
          ) : groups &&
            groups.counts.modified + groups.counts.deleted + groups.counts.added === 0 &&
            groups.counts.ignored === 0 ? (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              工作区干净，没有未提交的更改。
            </div>
          ) : (
            <>
              {/* 更改组：已跟踪文件 vs 最近一次提交（D-004 HEAD 基线） */}
              {groups && groups.changedTree.length > 0 && (
                <div data-testid="worktree-group-changed">
                  <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
                    <span>▾</span> 更改
                    {data?.head_short && (
                      <span className="font-normal">
                        （对比基线：最近一次提交 {data.head_short}）
                      </span>
                    )}
                  </div>
                  <div className="ml-2">
                    <StatusTreeRows
                      nodes={groups.changedTree}
                      statusByPath={groups.statusByPath}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                </div>
              )}

              {/* 未纳入版本管理组（untracked，D-004 全文新增语义） */}
              {groups && groups.untrackedTree.length > 0 && (
                <div className="mt-2" data-testid="worktree-group-untracked">
                  <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
                    <span>▾</span> 未纳入版本管理
                  </div>
                  <div className="ml-2">
                    <StatusTreeRows
                      nodes={groups.untrackedTree}
                      statusByPath={groups.statusByPath}
                      onOpenFile={onOpenFile}
                    />
                  </div>
                </div>
              )}

              {/* 忽略组：顶层聚合一行式（D-003 不递归） */}
              {data && data.ignored.length > 0 && (
                <div className="mt-2" data-testid="worktree-group-ignored">
                  <div className="flex items-center gap-2 px-1 py-1 text-xs font-medium text-muted-foreground">
                    <span>▸</span> 已忽略（目录按整体聚合，不逐个列出）
                  </div>
                  <div className="ml-2">
                    {data.ignored.map((item) => (
                      <IgnoredRow key={item.path} item={item} />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
