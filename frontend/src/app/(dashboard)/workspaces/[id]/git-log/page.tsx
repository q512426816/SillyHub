"use client";

/**
 * task-06：工作区 Git 日志页（/workspaces/[id]/git-log，类 IDEA Git Log）。
 *
 * 页面骨架对齐 explorer page（PageContainer/PageHeader + 三降级中文卡同款）：
 * - 副标题：工作区名 · 已加载 N 条 · 当前过滤态（不显示仓库提交总数，CC-06——
 *   避免为此增加 rev-list --count 第 5 个 RPC）；
 * - 工具栏：分支下拉（数据源 = 响应 top-level branches[] 全量，CC-07，含
 *   「全部分支」空值项）+ 作者文本输入（回车/失焦触发，git --author 子串语义，
 *   不做作者下拉——候选随分页窗口漂移无稳定数据源）+ 刷新（invalidate git-log
 *   前缀缓存）；
 * - 分页：底部「加载更多」按钮 skip += limit 逐页追加（has_more=false 隐藏）。
 *   取数用 useQueries + fetchGitLogCommits/gitLogQueryKeys（同为 task-05 导出
 *   契约；useGitLogCommits 单窗口 hook 不可在动态页数下循环调用，逐页 queryKey
 *   与 hook 完全一致、缓存互通；后端全前缀确定性 lane 计算，跨页 seq 连续）；
 * - 降级形态：git_mode=no_git → 空态卡（探测说明文案）；查询 error → 502/422/
 *   404 三降级卡（explorer 同款优先级分发），其余错误走 ErrorBanner 中文 message；
 * - 点击提交行 → 右侧 CommitDetailDrawer（详情 + 变更文件树 + 文件级 diff）。
 *
 * 依据：tasks/task-06.md、design.md §2 / §5.4 / §7.4、
 *       prototype-workspace-git-log.html、FRONTEND_PAGE_STYLE.md §0.5。
 */

import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient, useQueries } from "@tanstack/react-query";
import { Button, Input, Select } from "antd";
import { FolderX, GitBranch, RefreshCw } from "lucide-react";

import { CommitDetailDrawer } from "@/components/git-log/commit-detail-drawer";
import { CommitList } from "@/components/git-log/commit-list";
import { PageContainer, PageHeader } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { ApiError } from "@/lib/api";
import {
  fetchGitLogCommits,
  gitLogQueryKeys,
  type GitLogCommitItem,
} from "@/lib/git-log";
import { getWorkspace } from "@/lib/workspaces";

/** 服务端分页页大小（backend limit 上限 200，取原型口径 100）。 */
const PAGE_LIMIT = 100;

export default function WorkspaceGitLogPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id ?? "";
  const queryClient = useQueryClient();

  // 过滤条件（已提交值入 query；作者输入框为受控草稿，回车/失焦才提交）
  const [branch, setBranch] = useState("");
  const [author, setAuthor] = useState("");
  const [authorInput, setAuthorInput] = useState("");
  // 已加载页数（加载更多 skip += limit；过滤条件变更时重置回第 1 页）
  const [pageCount, setPageCount] = useState(1);
  const [selectedSha, setSelectedSha] = useState<string | null>(null);

  // 工作区名（副标题展示用；失败静默降级为不显示名字，不阻断页面）
  const workspaceQuery = useQuery({
    queryKey: ["workspaces", "detail", workspaceId],
    queryFn: () => getWorkspace(workspaceId),
    enabled: workspaceId !== "",
    select: (ws) => ws.name,
  });

  // 逐页取数：[0,100) [100,200) …；queryKey 与 useGitLogCommits 一致（缓存互通）
  const skips = useMemo(
    () => Array.from({ length: pageCount }, (_, i) => i * PAGE_LIMIT),
    [pageCount],
  );
  const pages = useQueries({
    queries: skips.map((skip) => ({
      queryKey: gitLogQueryKeys.commits(
        workspaceId,
        skip,
        PAGE_LIMIT,
        branch,
        author,
      ),
      queryFn: () =>
        fetchGitLogCommits(workspaceId, skip, PAGE_LIMIT, branch, author),
      enabled: workspaceId !== "",
    })),
  });

  const firstPage = pages[0];
  const gitMode = firstPage?.data?.git_mode;
  const branches = firstPage?.data?.branches ?? [];
  // 各页窗口拼接（seq 全局连续，按 seq 稳定排序防御乱序）
  const commits = useMemo(() => {
    const all: GitLogCommitItem[] = [];
    for (const p of pages) all.push(...(p.data?.commits ?? []));
    return all.sort((a, b) => a.seq - b.seq);
  }, [pages]);

  const isInitialLoading = firstPage?.isPending ?? false;
  const loadingMore = pages.slice(1).some((p) => p.isPending);
  const lastResolved = [...pages].reverse().find((p) => p.data != null);
  const hasMore = lastResolved?.data?.has_more ?? false;

  // 任一页失败按 ApiError 三降级分发（502 > 422 > 404，explorer 同款优先级）
  const pageError = useMemo(() => {
    for (const p of pages) {
      if (p.isError && p.error instanceof ApiError) return p.error;
    }
    return null;
  }, [pages]);

  const handleBranchChange = useCallback((value: string) => {
    setBranch(value);
    setPageCount(1);
  }, []);
  const commitAuthor = useCallback(() => {
    setAuthor(authorInput.trim());
    setPageCount(1);
  }, [authorInput]);
  const handleLoadMore = useCallback(() => {
    setPageCount((c) => c + 1);
  }, []);
  const handleRefresh = useCallback(() => {
    // 失效本工作区全部 git-log 查询（列表各页 + 详情 + diff 前缀匹配）
    void queryClient.invalidateQueries({
      queryKey: ["git-log", workspaceId],
    });
  }, [queryClient, workspaceId]);
  const handleSelectCommit = useCallback((commit: GitLogCommitItem) => {
    setSelectedSha(commit.hash);
  }, []);

  // ── 副标题：工作区名 · 已加载 N 条 · 当前过滤态（无提交总数，CC-06）────
  const subtitle = useMemo(() => {
    const parts: string[] = [];
    if (workspaceQuery.data) parts.push(workspaceQuery.data);
    parts.push(`已加载 ${commits.length} 条`);
    parts.push(branch === "" ? "全部分支" : `分支：${branch}`);
    if (author !== "") parts.push(`作者：${author}`);
    return parts.join(" · ");
  }, [workspaceQuery.data, commits.length, branch, author]);

  // ── 三降级卡（文案对齐 explorer，git 场景化）─────────────────────────
  const blockingStatus = ([502, 422, 404] as const).find(
    (s) => pageError != null && pageError.status === s,
  );
  let degradeCard: ReactNode = null;
  if (pageError != null && blockingStatus != null) {
    const meta: Record<
      502 | 422 | 404,
      { title: string; desc: string; cls: string }
    > = {
      502: {
        title: "守护进程离线",
        desc: "本机守护进程离线，无法读取 Git 提交历史。请启动 daemon 后刷新。",
        cls: "border-warning/30 bg-warning/10 text-warning",
      },
      422: {
        title: "守护进程版本过旧",
        desc: "本机 daemon 版本过旧，不支持 Git 日志，请升级 daemon。",
        cls: "border-warning/30 bg-warning/10 text-warning",
      },
      404: {
        title: "未绑定工作区",
        desc: "当前账号未绑定本机工作区，请先到「成员」页完成绑定。",
        cls: "border-info/30 bg-info/10 text-info",
      },
    };
    const m = meta[blockingStatus];
    degradeCard = (
      <div className="flex items-center justify-center p-6" role="status">
        <div
          className={`w-full max-w-md rounded-lg border p-6 text-center shadow-sm ${m.cls}`}
        >
          <h3 className="text-sm font-semibold">{m.title}</h3>
          <p className="mt-2 text-xs opacity-90">{m.desc}</p>
        </div>
      </div>
    );
  }

  return (
    <PageContainer size="full" className="gap-3">
      <PageHeader title="Git 日志" subtitle={subtitle} />

      {degradeCard}

      {!degradeCard && pageError != null && (
        <ErrorBanner
          message={pageError.message || "加载 Git 日志失败，请重试"}
          onRetry={handleRefresh}
        />
      )}

      {!degradeCard && (
        <>
          {/* 工具栏：分支下拉 + 作者输入 + 刷新（antd 组件经 ConfigProvider 主题化） */}
          <div className="flex flex-none flex-wrap items-center gap-2 border-b border-border pb-3">
            <Select
              value={branch}
              onChange={(v) => handleBranchChange(v ?? "")}
              className="w-52"
              aria-label="分支过滤"
              options={[
                { value: "", label: "全部分支" },
                ...branches.map((b) => ({
                  value: b.name,
                  label: b.kind === "remote" ? `${b.name}（远程）` : b.name,
                })),
              ]}
              data-testid="git-log-branch-select"
            />
            <Input
              value={authorInput}
              onChange={(e) => setAuthorInput(e.target.value)}
              onPressEnter={commitAuthor}
              onBlur={commitAuthor}
              placeholder="按作者过滤（回车生效）"
              className="w-56"
              allowClear
              aria-label="作者过滤"
              data-testid="git-log-author-input"
            />
            <Button
              icon={<RefreshCw className="h-3.5 w-3.5" aria-hidden />}
              onClick={handleRefresh}
              data-testid="git-log-refresh"
            >
              刷新
            </Button>
          </div>

          {isInitialLoading ? (
            // 首屏骨架（6 行脉冲条）
            <div
              className="rounded-lg border border-border bg-card p-4 shadow-sm"
              data-testid="git-log-skeleton"
            >
              {Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="mb-2 h-9 animate-pulse rounded bg-muted" />
              ))}
            </div>
          ) : gitMode === "no_git" ? (
            // 非 git 工作区空态（probe=direct 映射，非报错）
            <div
              className="rounded-lg border border-border bg-card shadow-sm"
              data-testid="git-log-no-git"
            >
              <EmptyState
                icon={<FolderX className="h-6 w-6" aria-hidden />}
                title="该工作区不是 Git 仓库"
                description="探测结果（probe_workspace_git_mode）：目录下未发现 .git。无法展示提交历史，可先在本地初始化仓库并关联后重试。"
              />
            </div>
          ) : commits.length === 0 ? (
            // 空仓库（CC-17：git log exit 128 转空态，非报错）
            <div
              className="rounded-lg border border-border bg-card shadow-sm"
              data-testid="git-log-empty-repo"
            >
              <EmptyState
                icon={<GitBranch className="h-6 w-6" aria-hidden />}
                title="仓库还没有提交"
                description="该仓库尚未有任何提交记录；在本地完成首次提交后刷新查看。"
              />
            </div>
          ) : (
            <div className="overflow-hidden rounded-lg border border-border bg-card shadow-sm">
              <CommitList
                commits={commits}
                selectedSha={selectedSha}
                onSelectCommit={handleSelectCommit}
              />
              {(hasMore || loadingMore) && (
                <div className="flex justify-center border-t border-border py-2.5">
                  <Button
                    loading={loadingMore}
                    disabled={!hasMore && !loadingMore}
                    onClick={handleLoadMore}
                    data-testid="git-log-load-more"
                  >
                    加载更多（每页 {PAGE_LIMIT} 条）
                  </Button>
                </div>
              )}
            </div>
          )}
        </>
      )}

      <CommitDetailDrawer
        workspaceId={workspaceId}
        sha={selectedSha}
        open={selectedSha != null}
        onClose={() => setSelectedSha(null)}
      />
    </PageContainer>
  );
}
