"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import { type DependencyStatus, type HealthResponse, getHealth } from "@/lib/health";

type FetchState =
  | { kind: "loading" }
  | { kind: "ok"; data: HealthResponse }
  | { kind: "error"; message: string };

function depBadge(status: DependencyStatus | undefined, label: string) {
  if (!status) return <Badge variant="outline">{label}: ?</Badge>;
  return (
    <Badge variant={status === "ok" ? "success" : "destructive"}>
      {label}: {status}
    </Badge>
  );
}

export function HealthCard() {
  const [state, setState] = useState<FetchState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const tick = async () => {
      try {
        const data = await getHealth();
        if (!cancelled) setState({ kind: "ok", data });
      } catch (err) {
        if (cancelled) return;
        const msg =
          err instanceof ApiError ? `${err.code}: ${err.message}` : "网络错误";
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
    <section className="rounded-lg border bg-card p-6 shadow-sm">
      <header className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold tracking-tight">平台健康</h2>
        {state.kind === "ok" ? (
          <Badge variant={state.data.status === "ok" ? "success" : "warning"}>
            后端健康: {state.data.status}
          </Badge>
        ) : state.kind === "loading" ? (
          <Badge variant="outline">加载中…</Badge>
        ) : (
          <Badge variant="destructive">后端不可达</Badge>
        )}
      </header>

      {state.kind === "ok" ? (
        <dl className="grid grid-cols-2 gap-4 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">数据库</span>
            {depBadge(state.data.db, "db")}
          </div>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Redis</span>
            {depBadge(state.data.redis, "redis")}
          </div>
          <div>
            <span className="text-muted-foreground">版本</span>
            <p className="font-mono">{state.data.version}</p>
          </div>
          <div>
            <span className="text-muted-foreground">commit</span>
            <p className="font-mono">{state.data.commit_sha.slice(0, 12)}</p>
          </div>
          <div>
            <span className="text-muted-foreground">环境</span>
            <p className="font-mono">{state.data.environment}</p>
          </div>
          <div>
            <span className="text-muted-foreground">服务器时间</span>
            <p className="font-mono">
              {new Date(state.data.server_time).toLocaleString()}
            </p>
          </div>
        </dl>
      ) : state.kind === "error" ? (
        <p className="text-sm text-destructive">{state.message}</p>
      ) : (
        <p className="text-sm text-muted-foreground">读取后端 /api/health…</p>
      )}
    </section>
  );
}
