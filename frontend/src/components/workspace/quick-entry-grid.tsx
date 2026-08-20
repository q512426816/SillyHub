"use client";

import Link from "next/link";
import {
  Boxes,
  Bot,
  ClipboardList,
  Cpu,
  FileSearch,
  FolderOpen,
  type LucideIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";

interface EntryDef {
  href: string;
  label: string;
  icon: LucideIcon;
}

interface QuickEntryGridProps {
  workspaceId: string;
}

export function QuickEntryGrid({ workspaceId }: QuickEntryGridProps): JSX.Element {
  const entries: EntryDef[] = [
    {
      href: `/workspaces/${workspaceId}/components`,
      label: "项目组件",
      icon: Boxes,
    },
    {
      href: `/workspaces/${workspaceId}/changes`,
      label: "变更中心",
      icon: ClipboardList,
    },
    {
      href: `/workspaces/${workspaceId}/scan-docs`,
      label: "扫描文档",
      icon: FileSearch,
    },
    {
      href: `/workspaces/${workspaceId}/runtime`,
      label: "运行时",
      icon: Cpu,
    },
    {
      href: `/workspaces/${workspaceId}/agent-profiles`,
      label: "智能体档案",
      icon: Bot,
    },
    {
      href: `/workspaces/${workspaceId}/files`,
      label: "方案文件",
      icon: FolderOpen,
    },
  ];

  return (
    <section className="grid grid-cols-2 gap-3 lg:grid-cols-3">
      {entries.map((entry) => {
        const Icon = entry.icon;
        return (
          <Link
            key={entry.href}
            href={entry.href}
            className={cn(
              "group flex items-center gap-3 rounded-lg border border-border bg-card p-3 shadow-sm transition-[box-shadow,transform,border-color] duration-200",
              "hover:-translate-y-1 hover:border-brand-300 hover:shadow-lg",
            )}
          >
            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 transition-colors group-hover:bg-brand-100">
              <Icon className="size-5" />
            </span>
            <span className="text-sm font-medium text-foreground">{entry.label}</span>
          </Link>
        );
      })}
    </section>
  );
}
