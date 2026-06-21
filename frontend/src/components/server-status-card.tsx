"use client";

/**
 * ServerStatusCard — 服务器运行状态看板(性能 + 业务统计)。
 *
 * 调 /api/health/system-status,展示:
 *  - 性能:CPU/内存/磁盘 使用率(进度条)+ 已用/总量
 *  - 业务统计:任务/项目/里程碑/用户 数量
 * 5s 轮询刷新(同 HealthCard)。
 */
import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import { type SystemStatus, getSystemStatus } from "@/lib/health";
import { tokens } from "@/styles";

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: SystemStatus }
  | { kind: "error"; message: string };

/** 进度条:percent → 颜色(<70 绿 / <90 黄 / 否则红)。 */
function barColor(p: number): string {
  if (p >= 90) return tokens.color.semantic.error.color;
  if (p >= 70) return tokens.color.semantic.warning.color;
  return tokens.color.emerald;
}

function Meter({
  label,
  percent,
  detail,
}: {
  label: string;
  percent: number;
  detail: string;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono">
          {percent.toFixed(1)}% <span className="text-muted-foreground">({detail})</span>
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded bg-muted">
        <div
          className="h-full rounded transition-all"
          style={{ width: `${Math.min(percent, 100)}%`, background: barColor(percent) }}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded border border-border bg-background px-3 py-2 text-center">
      <div className="text-lg font-semibold text-foreground">{value}</div>
      <div className="text-[11px] text-muted-foreground">{label}</div>
    </div>
  );
}

export function ServerStatusCard() {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await getSystemStatus();
        if (!cancelled) setState({ kind: "ok", data });
      } catch (err) {
        if (cancelled) return;
        const msg = err instanceof ApiError ? `${err.code}: ${err.message}` : "网络错误";
        setState({ kind: "error", message: msg });
      }
    };
    void tick();
    const handle = setInterval(tick, 5000);
    return () => {
      cancelled = true;
      clearInterval(handle);
    };
  }, []);

  return (
    <section className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2>服务器运行状态</h2>
        {state.kind === "ok" ? (
          <Badge variant="success">运行中</Badge>
        ) : state.kind === "loading" ? (
          <Badge variant="outline">加载中…</Badge>
        ) : (
          <Badge variant="destructive">不可达</Badge>
        )}
      </header>

      {state.kind === "ok" ? (
        <div className="space-y-3 p-4">
          {/* 性能 */}
          <div className="space-y-2.5">
            <Meter
              label="CPU"
              percent={state.data.cpu_percent}
              detail={`${state.data.cpu_percent.toFixed(1)}%`}
            />
            <Meter
              label="内存"
              percent={state.data.memory_percent}
              detail={`${state.data.memory_used_mb}/${state.data.memory_total_mb} MB`}
            />
            <Meter
              label="磁盘"
              percent={state.data.disk_percent}
              detail={`${state.data.disk_used_gb}/${state.data.disk_total_gb} GB`}
            />
          </div>
          {/* 业务统计 */}
          <div className="grid grid-cols-4 gap-2 pt-1">
            <Stat label="任务" value={state.data.tasks} />
            <Stat label="项目" value={state.data.projects} />
            <Stat label="里程碑" value={state.data.milestones} />
            <Stat label="用户" value={state.data.users} />
          </div>
          <div className="text-[11px] text-muted-foreground">
            服务器时间: {new Date(state.data.server_time).toLocaleString()}
          </div>
        </div>
      ) : state.kind === "error" ? (
        <p className="p-4 text-xs text-destructive">{state.message}</p>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">读取 /api/health/system-status…</p>
      )}
    </section>
  );
}
