"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiKeyCreateDialog } from "@/components/api-key-create-dialog";
import { ApiError } from "@/lib/api";
import { listApiKeys, revokeApiKey, type ApiKeyRead } from "@/lib/api-keys";

function StatusBadge({ k }: { k: ApiKeyRead }) {
  if (k.revoked_at) return <Badge variant="destructive">已吊销</Badge>;
  if (k.expires_at && new Date(k.expires_at) <= new Date())
    return <Badge variant="warning">已过期</Badge>;
  return <Badge variant="success">活跃</Badge>;
}

export default function ApiKeysSettingsPage() {
  const [keys, setKeys] = useState<ApiKeyRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      setKeys(await listApiKeys());
    } catch (err) {
      setPageError(err instanceof ApiError ? `${err.code}: ${err.message}` : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = async (k: ApiKeyRead) => {
    if (!confirm(`确定吊销 API 密钥 "${k.name}"？吊销后使用该密钥的守护进程将立即下线。`))
      return;
    try {
      await revokeApiKey(k.id);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? `${err.code}: ${err.message}` : "吊销失败");
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      <header className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">
            <Link href="/settings" className="hover:underline">
              设置
            </Link>{" "}
            / API 密钥
          </div>
          <h1 className="mt-0.5">API 密钥</h1>
          <p className="text-xs text-muted-foreground">
            长期凭证供守护进程进程使用。明文仅在签发时显示一次。
          </p>
        </div>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          + 签发 API 密钥
        </Button>
      </header>

      {pageError && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {pageError}
        </div>
      )}

      {loading ? (
        <p className="py-8 text-center text-xs text-muted-foreground">加载中…</p>
      ) : keys.length === 0 ? (
        <div className="rounded-md border bg-card p-8 text-center">
          <p className="text-sm">还没有 API 密钥</p>
          <p className="mt-1 text-xs text-muted-foreground">
            签发后可在{" "}
            <Link href="/runtimes" className="underline">
              /runtimes
            </Link>{" "}
            页面看到带 --api-key 的启动命令。
          </p>
        </div>
      ) : (
        <div className="rounded-md border bg-card">
          <table>
            <thead>
              <tr>
                <th>名称</th>
                <th>前缀</th>
                <th>状态</th>
                <th>最近使用</th>
                <th>创建时间</th>
                <th>过期</th>
                <th className="text-right">操作</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td className="text-xs font-medium">{k.name}</td>
                  <td>
                    <code className="text-[11px]">{k.key_prefix}…</code>
                  </td>
                  <td>
                    <StatusBadge k={k} />
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {k.last_used_at
                      ? new Date(k.last_used_at).toLocaleString("zh-CN")
                      : "—"}
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {new Date(k.created_at).toLocaleString("zh-CN")}
                  </td>
                  <td className="text-[11px] text-muted-foreground">
                    {k.expires_at
                      ? new Date(k.expires_at).toLocaleString("zh-CN")
                      : "永不过期"}
                  </td>
                  <td className="text-right">
                    {!k.revoked_at && (
                      <button
                        className="text-[11px] text-destructive hover:underline"
                        onClick={() => void handleRevoke(k)}
                      >
                        吊销
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <ApiKeyCreateDialog
          onCreated={() => {
            void load();
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </div>
  );
}
