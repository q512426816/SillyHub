"use client";

/**
 * QuickEntryGrid — 个人工作台快捷入口 (task-11 / FR-11)。
 *
 * 5 按钮 grid(参照原型):
 *  - 问题清单 → /ppm/problem-list(已有路由,router.push 跳转)
 *  - 任务计划 → /ppm/task-plans(已有路由,router.push 跳转)
 *  - 绩效考评 → Toast 提示「绩效考评功能暂未开放」(不跳转 D-007@v1 占位)
 *  - 知识库   → Toast 提示「知识库入口未配置」(平台 knowledge 路由为工作空间级
 *              /workspaces/[id]/knowledge,个人工作台无对应入口,落实后再接)
 *  - 消息通知 → Toast 提示「消息功能开发中」(D-007@v1 占位)
 *
 * 绩效/消息只 Toast 不建后端(D-007@v1,design §3 非目标)。
 */
import { useRouter } from "next/navigation";
import {
  Award,
  BookOpen,
  ClipboardCheck,
  ListChecks,
  MessageSquare,
  type LucideIcon,
} from "lucide-react";

import { SectionCard } from "@/components/layout";
import { cn } from "@/lib/utils";
import { Toast, useToast } from "../../shared";

interface EntryDef {
  label: string;
  icon: LucideIcon;
  /** 图标底色(对齐指标条语义色)。 */
  tile: string;
  onClick: () => void;
}

export function QuickEntryGrid() {
  const router = useRouter();
  const { toast, showToast } = useToast();

  const entries: EntryDef[] = [
    {
      label: "问题清单",
      icon: ListChecks,
      tile: "bg-red-50 text-red-600",
      onClick: () => router.push("/ppm/problem-list"),
    },
    {
      label: "任务计划",
      icon: ClipboardCheck,
      tile: "bg-blue-50 text-blue-600",
      onClick: () => router.push("/ppm/task-plans"),
    },
    {
      label: "绩效考评",
      icon: Award,
      tile: "bg-emerald-50 text-emerald-600",
      onClick: () => showToast(false, "绩效考评功能暂未开放"),
    },
    {
      label: "知识库",
      icon: BookOpen,
      tile: "bg-cyan-50 text-cyan-600",
      onClick: () => showToast(false, "知识库入口未配置"),
    },
    {
      label: "消息通知",
      icon: MessageSquare,
      tile: "bg-amber-50 text-amber-600",
      onClick: () => showToast(false, "消息功能开发中"),
    },
  ];

  return (
    <SectionCard title="快捷入口" bodyPadding="p-4">
      <div className="grid grid-cols-2 gap-2">
        {entries.map((e) => {
          const Icon = e.icon;
          return (
            <button
              key={e.label}
              type="button"
              onClick={e.onClick}
              className="group flex items-center gap-2.5 rounded-xl border border-border/60 bg-muted/40 px-3 py-2.5 text-left transition hover:-translate-y-0.5 hover:bg-muted/70 hover:shadow-sm"
            >
              <span
                className={cn(
                  "flex size-8 shrink-0 items-center justify-center rounded-lg",
                  e.tile,
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="text-sm text-foreground group-hover:font-medium">
                {e.label}
              </span>
            </button>
          );
        })}
      </div>
      <div className="mt-2">
        <Toast toast={toast} />
      </div>
    </SectionCard>
  );
}
