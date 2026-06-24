"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, Clock3, KeyRound, Plus, RefreshCw, ShieldCheck } from "lucide-react";

import { ApiKeyCreateDialog } from "@/components/api-key-create-dialog";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { listApiKeys, revokeApiKey, type ApiKeyRead } from "@/lib/api-keys";
import { cn } from "@/lib/utils";

type ApiKeyStatus = {
  label: string;
  kind: StatusKind;
};

function getKeyStatus(k: ApiKeyRead): ApiKeyStatus {
  if (k.revoked_at) return { label: "已吊销", kind: "error" };
  if (k.expires_at && new Date(k.expires_at) <= new Date()) {
    return { label: "已过期", kind: "warning" };
  }
  return { label: "活跃", kind: "success" };
}

function formatDateTime(value: string | null): string {
  if (!value) return "从未使用";
  return new Date(value).toLocaleString("zh-CN");
}

function formatExpiry(value: string | null): string {
  return value ? new Date(value).toLocaleString("zh-CN") : "永不过期";
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

  const stats = useMemo(() => {
    const now = Date.now();
    const active = keys.filter(
      (k) =>
        !k.revoked_at &&
        (!k.expires_at || new Date(k.expires_at).getTime() > now),
    ).length;
    const expired = keys.filter(
      (k) => !k.revoked_at && k.expires_at && new Date(k.expires_at).getTime() <= now,
    ).length;
    const revoked = keys.filter((k) => k.revoked_at).length;
    return { total: keys.length, active, expired, revoked };
  }, [keys]);

  const handleRevoke = async (k: ApiKeyRead) => {
    if (!confirm(`确定吊销 API 密钥 "${k.name}"？吊销后使用该密钥的守护进程将立即下线。`)) {
      return;
    }
    try {
      await revokeApiKey(k.id);
      await load();
    } catch (err) {
      setPageError(err instanceof ApiError ? `${err.code}: ${err.message}` : "吊销失败");
    }
  };

  return (
    <PageContainer className="gap-5">
      <PageHeader
        title="API 密钥"
        subtitle={
          <span>
            <Link href="/settings" className="hover:underline">
              设置
            </Link>
            <span className="px-1 text-muted-foreground/60">/</span>
            为守护进程签发长期凭证，明文仅在创建时显示一次
          </span>
        }
        actions={
          <>
            <Button
              variant="outline"
              size="lg"
              onClick={() => void load()}
              disabled={loading}
              className="gap-2"
            >
              <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
              刷新
            </Button>
            <Button size="lg" onClick={() => setShowCreate(true)} className="gap-2">
              <Plus className="h-4 w-4" />
              签发 API 密钥
            </Button>
          </>
        }
      />

      {pageError && (
        <div className="rounded-lg border border-destructive/30 bg-red-50 px-4 py-3 text-sm text-destructive">
          {pageError}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-4">
        <StatCard icon={<KeyRound className="h-4 w-4" />} label="全部密钥" value={stats.total} />
        <StatCard icon={<ShieldCheck className="h-4 w-4" />} label="活跃" value={stats.active} tone="success" />
        <StatCard icon={<Clock3 className="h-4 w-4" />} label="已过期" value={stats.expired} tone="warning" />
        <StatCard icon={<Ban className="h-4 w-4" />} label="已吊销" value={stats.revoked} tone="error" />
      </div>

      <SectionCard title="密钥列表" bodyPadding="p-0">
        {loading ? (
          <div className="px-6 py-10 text-center text-sm text-muted-foreground">加载中...</div>
        ) : keys.length === 0 ? (
          <EmptyState
            icon={<KeyRound className="h-5 w-5" />}
            title="还没有 API 密钥"
            description={
              <span>
                签发后可在{" "}
                <Link href="/runtimes" className="underline">
                  /runtimes
                </Link>{" "}
                页面复制带 --api-key 的守护进程启动命令。
              </span>
            }
            action={
              <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
                <Plus className="h-3.5 w-3.5" />
                签发密钥
              </Button>
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                  <th className="px-4 py-3 font-semibold">名称</th>
                  <th className="px-4 py-3 font-semibold">前缀</th>
                  <th className="px-4 py-3 font-semibold">状态</th>
                  <th className="px-4 py-3 font-semibold">最近使用</th>
                  <th className="px-4 py-3 font-semibold">创建时间</th>
                  <th className="px-4 py-3 font-semibold">过期时间</th>
                  <th className="px-4 py-3 text-right font-semibold">操作</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const status = getKeyStatus(k);
                  return (
                    <tr key={k.id} className="border-b last:border-0 hover:bg-muted/25">
                      <td className="px-4 py-3">
                        <div className="font-medium text-foreground">{k.name}</div>
                        <div className="mt-0.5 text-[11px] text-muted-foreground">{k.id}</div>
                      </td>
                      <td className="px-4 py-3">
                        <code className="rounded bg-muted px-2 py-1 text-xs">{k.key_prefix}...</code>
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge kind={status.kind}>{status.label}</StatusBadge>
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(k.last_used_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatDateTime(k.created_at)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                        {formatExpiry(k.expires_at)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        {!k.revoked_at && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => void handleRevoke(k)}
                          >
                            吊销
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>

      {showCreate && (
        <ApiKeyCreateDialog
          onCreated={() => {
            void load();
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </PageContainer>
  );
}

function StatCard({
  icon,
  label,
  value,
  tone = "neutral",
}: {
  icon: ReactNode;
  label: string;
  value: number;
  tone?: "neutral" | "success" | "warning" | "error";
}) {
  const toneClass = {
    neutral: "bg-blue-50 text-blue-700",
    success: "bg-emerald-50 text-emerald-700",
    warning: "bg-amber-50 text-amber-700",
    error: "bg-red-50 text-red-700",
  }[tone];
  return (
    <div className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex items-center justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">{label}</div>
          <div className="mt-1 text-2xl font-semibold tracking-tight">{value}</div>
        </div>
        <div className={cn("flex h-9 w-9 items-center justify-center rounded-md", toneClass)}>
          {icon}
        </div>
      </div>
    </div>
  );
}
