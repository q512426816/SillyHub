"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { key: "overview", label: "概览", path: "" },
  { key: "components", label: "组件", path: "/components" },
  { key: "changes", label: "变更", path: "/changes" },
  { key: "members", label: "成员", path: "/members" },
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
      return pathname === base || pathname.startsWith(`${base}/`);
    }
    return pathname === full || pathname.startsWith(`${full}/`);
  };

  return (
    <>
      <nav
        aria-label="工作区标签页"
        className="flex min-w-0 flex-wrap gap-1 border-b border-border"
      >
        {TABS.map((tab) => {
          const active = isActive(tab.path);
          return (
            <Link
              key={tab.key}
              href={`${base}${tab.path}`}
              aria-current={active ? "page" : undefined}
              className={cn(
                "inline-flex h-8 items-center border-b-2 -mb-px px-3 text-xs",
                active
                  ? "border-foreground text-foreground font-medium"
                  : "border-transparent text-muted-foreground hover:text-foreground",
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
