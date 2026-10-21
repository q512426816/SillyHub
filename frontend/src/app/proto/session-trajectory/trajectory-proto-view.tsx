"use client";

/**
 * dev-only 会话轨迹页的客户端壳 —— 2026-10-20-session-page-dsh-alignment 档 1。
 *
 * 真实数据由 Server Component（./page.tsx）在请求时读盘后经 props 注入：
 * `frontend/.proto-staging/session-export.json`（21 runs / 1271 logs，2026-10-21
 * 从 `public/__proto/` 迁出免鉴权静态面，见 ../session-redesign/staged-session-export.ts）。
 * 因此首屏 HTML（含 SSR 快照）里就有完整轨迹，不依赖浏览器 JS 才出现。
 *
 * 兜底：props 为空（文件未 staging）时才回退旧公开 URL `/__proto/session-export.json`
 * 运行时 fetch，并显示一行加载提示；该 URL 在迁移后常态 404，不影响正常路径。
 *
 * 本文件只做「取数 → buildTrajectory → TrajectoryView」的胶水，不含视图实现。
 */

import { useEffect, useMemo, useState } from "react";

import {
  buildTrajectory,
  type Trajectory,
} from "@/components/daemon/trajectory/build-trajectory";
import { TrajectoryView } from "@/components/daemon/trajectory/trajectory-view";

import type { StagedSessionExport } from "../session-redesign/types";

function windowMinutes(trajectory: Trajectory): number {
  const spanMs = Math.max(0, trajectory.windowEnd - trajectory.windowStart);
  return Math.max(1, Math.round(spanMs / 60_000));
}

export function TrajectoryProtoView({
  stagedExport,
}: {
  /** Server Component 读盘得到的真实导出；null = 客户端 fetch 兜底。 */
  stagedExport: StagedSessionExport | null;
}) {
  const [payload, setPayload] = useState<StagedSessionExport | null>(stagedExport);
  const [loading, setLoading] = useState<boolean>(!stagedExport);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);

  useEffect(() => {
    if (payload) return;
    let cancelled = false;
    // 旧公开 URL 兜底（迁移后通常 404；正常路径不会走到这里）。
    fetch("/__proto/session-export.json")
      .then((response) => (response.ok ? response.json() : null))
      .then((json: StagedSessionExport | null) => {
        if (!cancelled && json && Array.isArray(json.logs) && Array.isArray(json.runs)) {
          setPayload(json);
        }
      })
      .catch(() => undefined)
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [payload]);

  const trajectory = useMemo(
    () => (payload ? buildTrajectory(payload.logs, payload.runs) : null),
    [payload],
  );

  const session = payload?.session ?? null;

  return (
    <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground">
      {/* 与 /proto/session-redesign 同一套 dev 说明条样式 */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-1.5 text-[11px]">
        <span className="font-semibold">dev 预览 · 会话轨迹（档 1）</span>
        <span className="text-muted-foreground">
          真实导出 · 上=泳道时间轴（输入/模型/工具共轴）/ 下=账本+检查器 · 仅本地
        </span>
        {trajectory ? (
          <span
            data-testid="trajectory-header-counts"
            className="font-mono tabular-nums text-muted-foreground"
          >
            {`${trajectory.turns.length} 轮 / ${trajectory.rows.length} 条记录 / 窗口 ${windowMinutes(
              trajectory,
            )} 分钟`}
          </span>
        ) : null}
        <span className="ml-auto flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
          {session?.title ? (
            <span className="max-w-[360px] truncate" title={session.title}>
              {session.title}
            </span>
          ) : null}
          {payload ? (
            <span className="tabular-nums">
              {payload.runs.length} runs · {payload.logs.length} logs
            </span>
          ) : null}
          <span className="rounded border border-border px-1.5 py-px">/proto/session-trajectory</span>
        </span>
      </div>

      <div className="min-h-0 flex-1">
        {trajectory ? (
          <TrajectoryView
            trajectory={trajectory}
            selectedRowId={selectedRowId}
            onSelectRow={setSelectedRowId}
          />
        ) : (
          <div
            data-testid="proto-trajectory-loading"
            className="flex h-full items-center justify-center text-[12px] text-muted-foreground"
          >
            {loading ? "加载真实会话轨迹…" : "真实会话导出缺失：请先将 session-export.json 放入 frontend/.proto-staging/"}
          </div>
        )}
      </div>
    </div>
  );
}
