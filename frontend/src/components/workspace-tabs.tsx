"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "概览", path: "" },
  { key: "components", label: "组件", path: "/components" },
  { key: "changes", label: "变更", path: "/changes" },
  { key: "sessions", label: "会话", path: "/sessions" },
  { key: "explorer", label: "文件", path: "/explorer" },
  // 2026-08-20-workspace-nav-consolidate：概览宫格退役，4 入口并入菜单（顺序按使用频率）
  { key: "scan-docs", label: "扫描文档", path: "/scan-docs" },
  { key: "runtime", label: "运行时", path: "/runtime" },
  { key: "agent-profiles", label: "智能体档案", path: "/agent-profiles" },
  { key: "skills", label: "Skills", path: "/skills" },
  { key: "mcp", label: "MCP", path: "/mcp" },
  { key: "mcp-tokens", label: "MCP 令牌", path: "/mcp-tokens" },
  { key: "members", label: "成员", path: "/members" },
  { key: "files", label: "方案文件", path: "/files" },
] as const;

export function WorkspaceTabs({
  workspaceId,
  children,
}: {
  workspaceId: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname() ?? "";
  const base = `/workspaces/${workspaceId}`;

  const isActive = (tabPath: string) => {
    const full = `${base}${tabPath}`;
    if (tabPath === "") {
      // R-04 双高亮修复：概览仅精确匹配 base，
      // 不再 startsWith(base+"/") 抢占所有子页的 aria-current
      return pathname === base;
    }
    return pathname === full || pathname.startsWith(`${full}/`);
  };

  return (
    <>
      <nav
        aria-label="工作区标签页"
        className="flex min-w-0 flex-nowrap overflow-x-auto gap-1.5 rounded-lg border bg-card p-1.5 shadow-sm [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {TABS.map((tab) => {
          const active = isActive(tab.path);
          return (
            <Link
              key={tab.key}
              href={`${base}${tab.path}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                // ql-20260820-013 用户反馈：下划线旧风格与工作台式不协调，
                // 改胶囊分段（brand 主题化，同 FRONTEND_PAGE_STYLE §0.5 铁律）
                "inline-flex h-8 items-center rounded-md px-3 text-xs transition-colors",
                active
                  ? "bg-brand-50 font-semibold text-brand-700"
                  : "text-muted-foreground hover:bg-brand-50/60 hover:text-brand-700",
              )}
            >
              {tab.label}
            </Link>
          );
        })}
      </nav>
      <div className="min-w-0 pt-4">{children}</div>
    </>
  );
}
