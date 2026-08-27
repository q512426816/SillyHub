"use client";

import { ChevronLeft } from "lucide-react";

import { cn } from "@/lib/utils";
import type { Workspace } from "@/lib/workspaces";

/**
 * 移动工作区头部（task-04 / FR-02 / D-004@V1 主页+双 Tab）：
 * 返回箭头 + 工作区名/副标题 + 段控双 Tab（变更中心 / 会话）。
 *
 * - 纯回调组件：双 Tab 切换与返回都只回调（onTabChange/onBack），不内嵌路由
 *   跳转与数据请求——路由 push（/m/workspaces/[id]/changes|sessions 真实路由）
 *   与 workspace 数据（task-02 layout Provider 预取）均归宿主页接线。
 * - 风格对齐 mobile-top-bar.tsx / mobile-app-shell.tsx：sticky 顶栏 + border-b
 *   bg-card + 语义 token；触摸热区 ≥44px、标题 text-base、Tab 文案 14px。
 * - 选中态走 brand 语义阶（bg-brand-600 + text-brand-50，随 html data-theme
 *   换肤，dark 主题 brand 阶翻转后对比仍成立）；阴影走主题 token。
 * - 在线状态点：WorkspaceRead 无在线字段（daemon 在线态在 useDaemonStatusMap，
 *   属数据请求），本组件按任务卡「字段存在时」约定不渲染。
 * - aria：双 Tab 为 role=tablist/tab + aria-selected（无 tabpanel 关联，
 *   切换由宿主页路由承载，不属本组件 tabpanel 语义）。
 */

/** 段控 Tab key（与宿主页路由 /changes、/sessions 一一对应）。 */
export type WorkspaceTabKey = "changes" | "sessions";

export interface MobileWorkspaceHeaderProps {
  /** 工作区数据（宿主页从 task-02 layout Provider 取后传入）。 */
  workspace: Workspace;
  /** 当前段控高亮 Tab（受控）。 */
  tab: WorkspaceTabKey;
  /** 点击非当前 Tab 回调（宿主页据此 router.push 到对应真实路由）。 */
  onTabChange: (t: WorkspaceTabKey) => void;
  /** 返回回调（宿主页 → /m/workspaces）。 */
  onBack: () => void;
}

/** 段控双 Tab 配置（顺序即渲染顺序）。 */
const WORKSPACE_TABS: { key: WorkspaceTabKey; label: string }[] = [
  { key: "changes", label: "变更中心" },
  { key: "sessions", label: "会话" },
];

export function MobileWorkspaceHeader({
  workspace,
  tab,
  onTabChange,
  onBack,
}: MobileWorkspaceHeaderProps) {
  const title = workspace.display_alias || workspace.name;

  return (
    <header
      data-testid="mobile-workspace-header"
      className="sticky top-0 z-30 shrink-0 border-b border-border bg-card px-1 pt-[env(safe-area-inset-top)] shadow-[var(--shadow-sm)]"
    >
      <div className="flex min-h-[44px] items-center gap-1">
        <button
          type="button"
          onClick={onBack}
          aria-label="返回"
          data-testid="mobile-workspace-header-back"
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-md text-foreground transition-colors hover:bg-muted"
        >
          <ChevronLeft className="h-5 w-5" aria-hidden />
        </button>
        <div className="min-w-0 flex-1 py-1 pl-1">
          <h1 className="truncate text-base font-medium text-foreground">
            {title}
          </h1>
          {/* 副标题（机器标识，辅助信息非正文）：12px 对齐 mobile-tab-bar 导航微标签档 */}
          <p className="truncate text-[12px] leading-tight text-muted-foreground">
            {workspace.slug}
          </p>
        </div>
      </div>

      <div
        role="tablist"
        aria-label="工作区视图切换"
        data-testid="mobile-workspace-header-tabs"
        className="flex gap-1 px-2 pb-2"
      >
        {WORKSPACE_TABS.map((t) => {
          const selected = t.key === tab;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={selected}
              data-testid={`mobile-workspace-header-tab-${t.key}`}
              onClick={() => {
                // 当前 Tab 不重复触发（宿主页不重复 push 同一路由）。
                if (!selected) {
                  onTabChange(t.key);
                }
              }}
              className={cn(
                "inline-flex min-h-[44px] flex-1 items-center justify-center rounded-md text-[14px] font-medium transition-colors",
                selected
                  ? "bg-brand-600 text-brand-50 shadow-[var(--shadow-sm)]"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          );
        })}
      </div>
    </header>
  );
}
