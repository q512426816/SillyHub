"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { Ban, KeyRound, Plus, RefreshCw, ShieldAlert, ShieldCheck } from "lucide-react";

import { McpTokenCreateDialog } from "@/components/mcp-token-create-dialog";
import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge, type StatusKind } from "@/components/ui/status-badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import { errMessage } from "@/lib/errors";
import { listMcpTokens, revokeMcpToken, type McpTokenRead } from "@/lib/mcp-tokens";
import { cn } from "@/lib/utils";

interface Props {
  params: { id: string };
}

/**
 * Workspace MCP 令牌管理主页（task-02，变更 2026-08-11-mcp-token-management-ui）。
 *
 * 结构 1:1 复刻 settings/api-keys：PageHeader + StatCard(本地组件，内联复制) +
 * SectionCard 表格 + EmptyState，手写 useState/useEffect 加载（非 react-query）。
 *
 * 与 api-keys 差异：workspace 级凭据（workspaceId 取自路由参数）、scope 多选徽章列、
 * 无 expires 概念（状态仅看 revoked_at）、GET 403 渲染"无权限"空态（D-001@v1：
 * tab 对所有 bound 成员可见，viewer 点入由服务端 WORKSPACE_WRITE 403 兜底，不泄漏 token 存在性）。
 */
export default function WorkspaceMcpTokensPage({ params }: Props) {
  const workspaceId = params.id;
  const [tokens, setTokens] = useState<McpTokenRead[]>([]);
  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);
  const [forbidden, setForbidden] = useState(false);
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    setForbidden(false);
    try {
      setTokens(await listMcpTokens(workspaceId));
    } catch (err) {
      // D-001@v1：viewer(只读成员) 调 GET 命中服务端 WORKSPACE_WRITE 403，
      // 渲染"无权限"空态且不展示任何 token 信息（不泄漏存在性）；其它错误走红条。
      if (err instanceof ApiError && err.status === 403) {
        setForbidden(true);
      } else {
        setPageError(errMessage(err, "加载失败"));
      }
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = useMemo(() => {
    const active = tokens.filter((t) => !t.revoked_at).length;
    const revoked = tokens.filter((t) => !!t.revoked_at).length;
    return { total: tokens.length, active, revoked };
  }, [tokens]);

  const handleRevoke = async (t: McpTokenRead) => {
    if (
      !confirm(
        `确定吊销 MCP 令牌 "${t.name}"？吊销后使用该令牌的外部客户端将立即无法访问本工作区 MCP 服务。`,
      )
    ) {
      return;
    }
    try {
      await revokeMcpToken(workspaceId, t.id);
      await load();
    } catch (err) {
      setPageError(errMessage(err, "吊销失败"));
    }
  };

  return (
    <PageContainer className="gap-5">
      <PageHeader
        title="MCP 令牌"
        subtitle="为外部客户端签发访问本工作区 MCP 服务的凭据，明文仅在签发后显示一次"
        actions={
          <>
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← 工作区
            </Link>
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
              签发令牌
            </Button>
          </>
        }
      />

      {pageError && <ErrorBanner message={pageError} />}

      {forbidden ? (
        <SectionCard>
          <EmptyState
            icon={<ShieldAlert className="h-5 w-5" />}
            title="无权限查看 MCP 令牌"
            description="只有具备本工作区写权限的成员才能查看与管理 MCP 令牌。如需访问，请联系工作区管理员。"
          />
        </SectionCard>
      ) : (
        <>
          <div className="grid gap-3 md:grid-cols-3">
            <StatCard
              icon={<KeyRound className="h-4 w-4" />}
              label="全部令牌"
              value={stats.total}
            />
            <StatCard
              icon={<ShieldCheck className="h-4 w-4" />}
              label="活跃"
              value={stats.active}
              tone="success"
            />
            <StatCard
              icon={<Ban className="h-4 w-4" />}
              label="已吊销"
              value={stats.revoked}
              tone="error"
            />
          </div>

          <SectionCard title="令牌列表" bodyPadding="p-0">
            {loading ? (
              <div className="px-6 py-10 text-center text-sm text-muted-foreground">
                加载中...
              </div>
            ) : tokens.length === 0 ? (
              <EmptyState
                icon={<KeyRound className="h-5 w-5" />}
                title="还没有 MCP 令牌"
                description="签发后可在外部客户端使用该令牌访问本工作区的 MCP 服务。"
                action={
                  <Button size="sm" onClick={() => setShowCreate(true)} className="gap-1">
                    <Plus className="h-3.5 w-3.5" />
                    签发令牌
                  </Button>
                }
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b bg-muted/40 text-left text-[11px] uppercase tracking-wide text-muted-foreground">
                      <th className="px-4 py-3 font-semibold">名称</th>
                      <th className="px-4 py-3 font-semibold">授权范围</th>
                      <th className="px-4 py-3 font-semibold">状态</th>
                      <th className="px-4 py-3 font-semibold">最近使用</th>
                      <th className="px-4 py-3 font-semibold">创建时间</th>
                      <th className="px-4 py-3 text-right font-semibold">操作</th>
                    </tr>
                  </thead>
                  <tbody>
                    {tokens.map((t) => {
                      const revoked = !!t.revoked_at;
                      const statusKind: StatusKind = revoked ? "error" : "success";
                      const statusLabel = revoked ? "已吊销" : "活跃";
                      return (
                        <tr key={t.id} className="border-b last:border-0 hover:bg-muted/25">
                          <td className="px-4 py-3">
                            <div className="font-medium text-foreground">{t.name}</div>
                            <div className="mt-0.5 text-[11px] text-muted-foreground">
                              …{t.id.slice(-8)}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex flex-wrap gap-1">
                              {t.scope.map((s) => (
                                <code
                                  key={s}
                                  className="rounded bg-muted px-1.5 py-0.5 text-[11px]"
                                >
                                  {s}
                                </code>
                              ))}
                            </div>
                          </td>
                          <td className="px-4 py-3">
                            <StatusBadge kind={statusKind}>{statusLabel}</StatusBadge>
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                            {formatDateTime(t.last_used_at)}
                          </td>
                          <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                            {formatDateTime(t.created_at)}
                          </td>
                          <td className="px-4 py-3 text-right">
                            {!revoked && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                                onClick={() => void handleRevoke(t)}
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
        </>
      )}

      {showCreate && (
        <McpTokenCreateDialog
          workspaceId={workspaceId}
          onCreated={() => {
            void load();
          }}
          onClose={() => setShowCreate(false)}
        />
      )}
    </PageContainer>
  );
}

function formatDateTime(value: string | null): string {
  if (!value) return "从未使用";
  return new Date(value).toLocaleString("zh-CN");
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
    neutral: "bg-brand-50 text-brand-700",
    success: "bg-success/10 text-success",
    warning: "bg-warning/10 text-warning",
    error: "bg-error/10 text-error",
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
