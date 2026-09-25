"use client";

/**
 * SpecSyncConflictBanner — 工作区 spec 同步冲突横幅（2026-09-26-spec-sync-receipt-visibility）。
 *
 * 背景：增量同步冲突（乐观锁 / platform_deleted 墓碑拒收）此前只活在 daemon 日志一行
 * warn，spec-conflicts 注册表恒空、页面零感知——c84182bc 冲突挂一周、镜像与遥测全冻结
 * 无人知晓。本变更起 apply_ops 冲突幂等写注册表开放行（全绿自动置 resolved），本横幅
 * 消费开放行：有则显示细条警示（数量 + 镜像可能滞后提示），无则不渲染。
 * 样式对齐 circuit-banner 的细条形态（warning 语义阶）。
 */

import { useQuery } from "@tanstack/react-query";
import { TriangleAlert } from "lucide-react";

import { listSpecConflicts } from "@/lib/spec-workspaces";

export function specConflictsQueryKey(workspaceId: string) {
  return ["spec-conflicts", "open", workspaceId] as const;
}

export function SpecSyncConflictBanner({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({
    queryKey: specConflictsQueryKey(workspaceId),
    queryFn: () => listSpecConflicts(workspaceId),
    // 低频轮询：冲突是长滞留态（人工拍板），60s 足够；失败静默（横幅缺位不阻塞页面）。
    refetchInterval: 60_000,
    retry: false,
  });
  if (!q.data || q.data.length === 0) return null;
  return (
    <div
      data-testid="spec-sync-conflict-banner"
      className="flex items-center gap-2 rounded-md border border-warning/40 bg-warning/10 px-3 py-1.5 text-xs text-warning"
    >
      <TriangleAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
      <span>
        spec 同步有 {q.data.length} 条冲突待裁决——镜像可能滞后于本地，最新内容暂未同步。
      </span>
    </div>
  );
}
