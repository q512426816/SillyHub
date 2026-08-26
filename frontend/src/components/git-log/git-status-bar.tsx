"use client";

/**
 * task-03：工作区 Git 状态条（共享组件，D-003 双形态）。
 *
 * - ``variant="full"``：git-log 页 PageHeader 下完整态——分支徽标⎇/upstream
 *   跟踪名/↑N 未推送/↓N 远程新提交/改动 +A/−D（N 文件）/未跟踪/已同步·HH:MM；
 * - ``variant="compact"``：sessions 门户页头 actions 槽紧凑态——只展示
 *   分支/↑↓/+−，antd Tooltip 悬停展开全量细节；
 * - 组件自治取数（useGitLogStatus，staleTime 60s 两页共享缓存——同 workspaceId
 *   双实例同屏只发一次请求、只触发一次 daemon 远程 fetch）；
 * - 边界形态（design §5.4 与原型五形态逐项）：fetch 失败 → full 黄条
 *   「无法连接远程，显示上次同步数据」+ behind 隐藏 / compact「⚠」（no_remote
 *   单独文案「未配置远程仓库」）；无 upstream → 「未设置远程跟踪」无 ↑↓；
 *   detached HEAD → 分支位显示短哈希 + 提示；空仓库 → 「仓库还没有任何提交」；
 *   非_git 工作区（git_mode=no_git）→ 返回 null（页面空态卡负责，不重复提示）；
 * - 颜色全走主题 token：状态色经 statusBarPalette 消费链（useThemeStore +
 *   themes[theme].color，对齐 commit-graph lanePalette 先例）以组件级
 *   --sb-* style 变量注入；容器/中性色走 Tailwind token 类（border/bg-card/
 *   text-muted-foreground），零硬编码 hex，三主题亮暗档随 themes.ts 换肤。
 *
 * 依据：tasks/task-03.md、design.md §5.3（响应字段）/ §5.4（前端全段）、
 *       prototype-git-status-bar.html（五形态双主题视觉参照）。
 */

import { useMemo } from "react";
import type { CSSProperties, ReactNode } from "react";
import { Tooltip } from "antd";

import { useGitLogStatus, type GitLogStatusResponse } from "@/lib/git-log";
import { useThemeStore } from "@/stores/theme";
import { themes, type ThemeName } from "@/styles/themes";

export interface GitStatusBarProps {
  /** 工作区 id（status 端点路径段，query 缓存按它共享）。 */
  workspaceId: string;
  /** 形态：full=git-log 页完整态 / compact=sessions 门户页头紧凑态。 */
  variant: "full" | "compact";
}

/**
 * 状态条色板（语义槽 → themes.ts 取值单一源，对齐 commit-graph lanePalette）：
 * ahead↑=accent 交互青 / behind↓与黄条=warning / additions+=success /
 * deletions−=error / 分支徽标=brand 阶（底 100 / 字 600）。本函数不写任何
 * hex，dark 主题语义取值即提亮档（themes.ts 已较浅色主题提亮）。
 */
export function statusBarPalette(theme: ThemeName): {
  ahead: string;
  behind: string;
  additions: string;
  deletions: string;
  badgeBg: string;
  badgeText: string;
} {
  const c = themes[theme].color;
  return {
    ahead: c.accent,
    behind: c.semantic.warning,
    additions: c.semantic.success,
    deletions: c.semantic.error,
    badgeBg: c.brand["100"],
    badgeText: c.brand["600"],
  };
}

/** fetch 失败代号 → 中文提示（design §5.3：fetch_timeout|fetch_failed|no_remote）。 */
function fetchWarnText(code: string): string {
  if (code === "no_remote") return "未配置远程仓库，跳过同步";
  return "无法连接远程，显示上次同步数据";
}

/** synced_at（ISO UTC）→「HH:MM」本地时刻（工程铁律 zh-CN）。解析失败返回空串不渲染。 */
function syncClock(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** 改动块是否有内容（空仓库 dirty 全 null / 干净工作区 0 不产出噪音行）。 */
function hasDirty(status: GitLogStatusResponse): boolean {
  return (status.dirty.files_changed ?? 0) > 0;
}

/**
 * 分支徽标（full/compact 共用）：⎇ + 分支名（detached 时 backend 已回填短哈希）。
 * 颜色取容器注入的 --sb-badge-* 变量（brand 阶）。
 */
function BranchBadge({
  branch,
  testid,
}: {
  branch: string;
  testid?: string;
}) {
  return (
    <span
      data-testid={testid}
      data-sb="branch"
      className="inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs font-semibold"
      style={{
        background: "var(--sb-badge-bg)",
        color: "var(--sb-badge-text)",
      }}
    >
      ⎇ {branch}
    </span>
  );
}

/**
 * 共享状态条（自治取数，两页挂载互不侵入）：
 * detailLines 为 full/compact 共用的信息行——full 直出其中大部分（带状态色），
 * compact 收进 Tooltip（antd Tooltip 走 portal 渲染在容器外，取不到 --sb-*
 * 变量——Tooltip 细节行一律纯文本，不依赖状态色变量）。
 */
export function GitStatusBar({ workspaceId, variant }: GitStatusBarProps) {
  const theme = useThemeStore((s) => s.theme);
  const statusQuery = useGitLogStatus(workspaceId);

  // 组件级注入 --sb-*（值源自 themes.ts 单一源，随主题切换即时换肤）
  const sbVars = useMemo(() => {
    const p = statusBarPalette(theme);
    const style: Record<string, string> = {
      "--sb-ahead": p.ahead,
      "--sb-behind": p.behind,
      "--sb-add": p.additions,
      "--sb-del": p.deletions,
      "--sb-badge-bg": p.badgeBg,
      "--sb-badge-text": p.badgeText,
    };
    return style as CSSProperties;
  }, [theme]);

  // 加载骨架文案（页面首渲不等 status，R-01）
  if (statusQuery.isPending) {
    return (
      <div
        data-testid="git-status-bar-loading"
        className="animate-pulse px-1 py-1.5 text-xs text-muted-foreground"
        aria-live="polite"
      >
        Git 状态加载中…
      </div>
    );
  }

  const status = statusQuery.data;
  // 非 git 工作区 / 查询失败（含 502 离线等，页面主体已有降级卡）→ 不渲染，
  // 避免与页面级空态/错误卡重复提示（no_git 语义归页面空态卡负责）。
  if (status == null || status.git_mode === "no_git" || statusQuery.isError) {
    return null;
  }

  // ── 空仓库：全字段 null 的极简提示行（空态卡语义归页面，条内轻提示）──────
  if (status.empty) {
    return (
      <div
        data-testid="git-status-bar-empty"
        data-variant={variant}
        className="flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs text-muted-foreground shadow-sm"
        style={sbVars}
        role="status"
        aria-label="Git 状态"
      >
        仓库还没有任何提交
      </div>
    );
  }

  const fetchError = status.fetch.error;
  const fetchFailed = fetchError != null;
  const fetchErrorText = fetchFailed ? fetchWarnText(fetchError) : null;
  const clock = status.fetch.performed ? syncClock(status.synced_at) : "";
  const showAhead = status.ahead != null && status.ahead > 0;
  // fetch 失败时 behind 为 stale 值——隐藏数字只留黄条（原型③，R-03）
  const showBehind = !fetchFailed && status.behind != null && status.behind > 0;

  // ── 共用信息元数据（full 直出 / compact Tooltip 展开细节纯文本行）────────
  const dirtyLine =
    status.dirty.files_changed != null && hasDirty(status)
      ? `改动 +${status.dirty.additions ?? 0} / −${
          status.dirty.deletions ?? 0
        }（${status.dirty.files_changed} 个文件）`
      : null;
  const detailLines = [
    status.detached ? "detached HEAD（游离头指针）" : null,
    status.upstream ? `跟踪 ${status.upstream}` : "未设置远程跟踪（无 ↑↓）",
    showAhead ? `↑ ${status.ahead} 未推送` : null,
    showBehind ? `↓ ${status.behind} 远程新提交` : null,
    dirtyLine,
    (status.dirty.untracked_count ?? 0) > 0
      ? `未跟踪 ${status.dirty.untracked_count}`
      : null,
    fetchErrorText != null ? `⚠ ${fetchErrorText}` : null,
    clock !== "" ? `已同步远程 · ${clock}` : null,
  ].filter((l): l is string => l != null);

  // ── compact：分支 + ↑↓ + ±（+ 失败 ⚠），Tooltip 展开全量细节 ─────────────
  if (variant === "compact") {
    return (
      <Tooltip
        title={
          <div className="space-y-0.5 text-xs leading-5">
            {detailLines.map((line) => (
              <div key={line}>{line}</div>
            ))}
          </div>
        }
      >
        <div
          data-testid="git-status-bar"
          data-variant="compact"
          className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 rounded-lg border border-border bg-card px-2.5 py-1 text-xs shadow-sm"
          style={sbVars}
          aria-label="Git 状态"
        >
          <BranchBadge branch={status.branch ?? "?"} testid="git-status-bar-branch" />
          {showAhead && (
            <span
              data-testid="git-status-bar-ahead"
              className="font-semibold"
              style={{ color: "var(--sb-ahead)" }}
            >
              ↑{status.ahead}
            </span>
          )}
          {showBehind && (
            <span
              data-testid="git-status-bar-behind"
              className="font-semibold"
              style={{ color: "var(--sb-behind)" }}
            >
              ↓{status.behind}
            </span>
          )}
          {hasDirty(status) && (
            <span data-testid="git-status-bar-dirty" className="inline-flex items-center">
              <span className="font-semibold" style={{ color: "var(--sb-add)" }}>
                +{status.dirty.additions ?? 0}
              </span>
              <span className="text-muted-foreground">/</span>
              <span className="font-semibold" style={{ color: "var(--sb-del)" }}>
                −{status.dirty.deletions ?? 0}
              </span>
            </span>
          )}
          {fetchFailed && (
            <span
              data-testid="git-status-bar-fetch-warn"
              className="font-semibold"
              style={{ color: "var(--sb-behind)" }}
              role="img"
              aria-label={fetchErrorText ?? ""}
            >
              ⚠
            </span>
          )}
        </div>
      </Tooltip>
    );
  }

  // ── full：完整态全要素 + 同步时刻右置（原型①）──────────────────────────
  const dirtyParts: ReactNode[] = [];
  if (hasDirty(status)) {
    dirtyParts.push(
      <span key="dirty" data-testid="git-status-bar-dirty" className="inline-flex items-baseline gap-1">
        <span>改动</span>
        <span className="font-semibold" style={{ color: "var(--sb-add)" }}>
          +{status.dirty.additions ?? 0}
        </span>
        <span className="text-muted-foreground">/</span>
        <span className="font-semibold" style={{ color: "var(--sb-del)" }}>
          −{status.dirty.deletions ?? 0}
        </span>
        <span className="text-muted-foreground">
          （{status.dirty.files_changed} 个文件）
        </span>
      </span>,
    );
  }
  if ((status.dirty.untracked_count ?? 0) > 0) {
    dirtyParts.push(
      <span
        key="untracked"
        data-testid="git-status-bar-untracked"
        className="text-muted-foreground"
      >
        未跟踪 {status.dirty.untracked_count}
      </span>,
    );
  }

  return (
    <div
      data-testid="git-status-bar"
      data-variant="full"
      className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-sm"
      style={sbVars}
      role="status"
      aria-label="Git 状态"
    >
      <BranchBadge branch={status.branch ?? "?"} testid="git-status-bar-branch" />

      {status.detached ? (
        <span data-testid="git-status-bar-detached" className="text-muted-foreground">
          detached HEAD（游离头指针）
        </span>
      ) : status.upstream != null ? (
        <span data-testid="git-status-bar-upstream" className="text-muted-foreground">
          跟踪 {status.upstream}
        </span>
      ) : (
        <span data-testid="git-status-bar-upstream" className="text-muted-foreground">
          未设置远程跟踪（无 ↑↓）
        </span>
      )}

      {showAhead && (
        <span
          data-testid="git-status-bar-ahead"
          className="font-semibold"
          style={{ color: "var(--sb-ahead)" }}
        >
          ↑ {status.ahead} 未推送
        </span>
      )}
      {showBehind && (
        <span
          data-testid="git-status-bar-behind"
          className="font-semibold"
          style={{ color: "var(--sb-behind)" }}
        >
          ↓ {status.behind} 远程新提交
        </span>
      )}
      {fetchFailed && (
        <span
          data-testid="git-status-bar-fetch-warn"
          className="inline-flex items-center gap-1 text-xs font-medium"
          style={{ color: "var(--sb-behind)" }}
        >
          ⚠ {fetchErrorText}
        </span>
      )}

      {dirtyParts.length > 0 && (
        <>
          <span aria-hidden className="text-muted-foreground">
            ·
          </span>
          {dirtyParts}
        </>
      )}

      {clock !== "" && (
        <span
          data-testid="git-status-bar-sync"
          className="ml-auto text-[11px] text-muted-foreground"
        >
          ↻ 已同步远程 · {clock}
        </span>
      )}
    </div>
  );
}
