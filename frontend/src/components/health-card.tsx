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
    <section className="rounded-md border bg-card">
      <header className="flex items-center justify-between border-b px-4 py-2.5">
        <h2>平台健康</h2>
        {state.kind === "ok" ? (
          <Badge variant={state.data.status === "ok" ? "success" : "warning"}>
            后端: {state.data.status}
          </Badge>
        ) : state.kind === "loading" ? (
          <Badge variant="outline">加载中…</Badge>
        ) : (
          <Badge variant="destructive">不可达</Badge>
        )}
      </header>

      {state.kind === "ok" ? (
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2 p-4 text-xs">
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">数据库</dt>
            <dd>{depBadge(state.data.db, "db")}</dd>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-muted-foreground">Redis</dt>
            <dd>{depBadge(state.data.redis, "redis")}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">版本</dt>
            <dd className="font-mono">{state.data.version}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">commit</dt>
            <dd className="font-mono">{state.data.commit_sha.slice(0, 12)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">环境</dt>
            <dd className="font-mono">{state.data.environment}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">服务器时间</dt>
            <dd className="font-mono">
              {new Date(state.data.server_time).toLocaleString()}
            </dd>
          </div>
        </dl>
      ) : state.kind === "error" ? (
        <p className="p-4 text-xs text-destructive">{state.message}</p>
      ) : (
        <p className="p-4 text-xs text-muted-foreground">读取 /api/health…</p>
      )}
    </section>
  );
}
