"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { ApiError } from "@/lib/api";
import {
  listDaemonRuntimes,
  type DaemonRuntimeRead,
} from "@/lib/daemon";

/* ---------- Status helpers ---------- */

function statusVariant(
  status: string | null,
): "success" | "outline" | "warning" {
  switch (status) {
    case "online":
      return "success";
    case "maintenance":
      return "warning";
    default:
      return "outline";
  }
}

function statusLabel(status: string | null): string {
  switch (status) {
    case "online":
      return "Online";
    case "offline":
      return "Offline";
    case "maintenance":
      return "Maintenance";
    default:
      return status ?? "Unknown";
  }
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("zh-CN");
}

/* ---------- Main Page ---------- */

export default function RuntimesPage() {
  const [items, setItems] = useState<DaemonRuntimeRead[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setError(null);
    try {
      const list = await listDaemonRuntimes();
      setItems(list);
    } catch (err) {
      setItems([]);
      setError(err instanceof ApiError ? err.message : "加载列表失败");
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-5 px-6 py-8">
      <header>
        <h1>Daemon Runtimes</h1>
        <p className="mt-0.5 text-xs text-muted-foreground">
          管理已注册的本地 Daemon 运行时
        </p>
      </header>

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {items === null ? (
        <p className="py-8 text-center text-xs text-muted-foreground">
          加载中…
        </p>
      ) : items.length === 0 ? (
        <section className="rounded-md border border-dashed py-10 text-center text-xs text-muted-foreground">
          <p className="mb-4">尚未注册任何 Daemon 运行时。</p>
          <div className="mx-auto inline-block rounded-md border bg-muted/40 px-6 py-4 text-left text-[11px] leading-relaxed">
            <p className="mb-2 font-medium text-foreground">快速开始</p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>安装守护进程：<code className="rounded bg-muted px-1 py-0.5">pip install sillyhub-daemon</code></li>
              <li>
                编辑配置文件 <code className="rounded bg-muted px-1 py-0.5">~/.sillyhub/daemon/config.json</code>，填入服务器地址：
                <pre className="mt-1 rounded bg-muted/60 px-2 py-1 font-mono text-[10px]">{`{
  "server_url": "${typeof window !== "undefined" ? window.location.origin : "http://your-server:8001"}",
  "runtime_name": "my-daemon"
}`}</pre>
              </li>
              <li>启动守护进程：<code className="rounded bg-muted px-1 py-0.5">sillyhub daemon start</code></li>
            </ol>
            <p className="mt-3 text-muted-foreground">
              启动后守护进程会自动注册并出现在上方列表中。Agent Run 创建时可选择在本地运行。
            </p>
          </div>
        </section>
      ) : (
        <div className="rounded-md border bg-card">
          <table>
            <thead>
              <tr>
                <th>{"名称"}</th>
                <th>Provider</th>
                <th>{"版本"}</th>
                <th>{"状态"}</th>
                <th>{"最后心跳"}</th>
                <th>{"创建时间"}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((r) => (
                <tr key={r.id}>
                  <td className="text-xs font-mono">
                    {r.name ?? "—"}
                  </td>
                  <td className="text-xs">{r.provider ?? "—"}</td>
                  <td className="text-xs font-mono">
                    {r.version ?? "—"}
                  </td>
                  <td>
                    <Badge variant={statusVariant(r.status)}>
                      {statusLabel(r.status)}
                    </Badge>
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {formatTime(r.last_heartbeat_at)}
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {formatTime(r.created_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
