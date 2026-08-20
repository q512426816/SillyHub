"use client";

import Link from "next/link";
import { Plug } from "lucide-react";

import { PageContainer, PageHeader, SectionCard } from "@/components/layout";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorBanner } from "@/components/ui/error-banner";
import { StatusBadge } from "@/components/ui/status-badge";
import { useWorkspaceMcpConfig } from "@/lib/workspace-skills-view";

interface Props {
  params: { id: string };
}

/**
 * Workspace MCP 子页（task-10，变更 2026-07-07-skills-mcp-management-ui）。
 *
 * 只读展示 workspace specDir/.mcp.json 的 mcpServers 配置。env secret 已被
 * backend 脱敏（值显示为 <set>），本页原样展示不二次处理。
 * D-006：只读——无编辑按钮。membership 校验由 layout 的 WorkspaceBindingGuard 完成。
 */
export default function WorkspaceMcpPage({ params }: Props) {
  const workspaceId = params.id;
  const { mcpServers, isLoading, isError, error, refetch } =
    useWorkspaceMcpConfig(workspaceId);

  const serverNames = Object.keys(mcpServers);

  return (
    <PageContainer>
      <PageHeader
        title="MCP 配置"
        subtitle="查看工作区 .mcp.json 的 MCP 服务器配置（只读，env 密钥已脱敏）"
        actions={
          <div className="flex items-center gap-2">
            <Link
              href={`/workspaces/${workspaceId}`}
              className="text-xs text-muted-foreground hover:text-foreground"
            >
              ← 工作区
            </Link>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void refetch()}
            >
              刷新
            </Button>
          </div>
        }
      />

      {isError && (
        <ErrorBanner message={error?.message ?? "加载 MCP 配置失败"} />
      )}

      {isLoading && (
        <p className="py-8 text-center text-xs text-muted-foreground">
          加载中...
        </p>
      )}

      {!isLoading && !isError && serverNames.length === 0 && (
        <SectionCard>
          <EmptyState
            icon={<Plug className="h-5 w-5" />}
            title="暂无 MCP 服务器配置"
            description="specDir/.mcp.json 不存在或未配置 mcpServers。"
          />
        </SectionCard>
      )}

      {!isLoading && !isError && serverNames.length > 0 && (
        <div className="space-y-2">
          {serverNames.map((name) => {
            const server = mcpServers[name] ?? {};
            const entries = Object.entries(server);
            return (
              <SectionCard key={name} hover="lift">
                <div className="mb-2 flex items-center gap-2">
                  <span className="text-sm font-semibold">{name}</span>
                  <StatusBadge kind="neutral">
                    {entries.length} 项
                  </StatusBadge>
                </div>
                {entries.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground">
                    该服务器无配置字段。
                  </p>
                ) : (
                  <dl className="grid grid-cols-[7rem_1fr] gap-y-0.5 text-[11px]">
                    {entries.map(([k, v]) => (
                      <FieldRow key={k} k={k} v={v} />
                    ))}
                  </dl>
                )}
              </SectionCard>
            );
          })}
        </div>
      )}
    </PageContainer>
  );
}

/** 单个配置字段行：env 这类 dict 折叠展示其键值（secret 值为 <set>）。 */
function FieldRow({ k, v }: { k: string; v: unknown }) {
  if (v && typeof v === "object" && !Array.isArray(v)) {
    const subEntries = Object.entries(v as Record<string, unknown>);
    return (
      <>
        <dt className="text-muted-foreground">{k}</dt>
        <dd>
          <dl className="grid grid-cols-[8rem_1fr] gap-y-0.5 rounded border border-border/60 bg-muted/30 px-2 py-1">
            {subEntries.map(([sk, sv]) => (
              <div key={sk} className="contents">
                <dt className="font-mono text-muted-foreground">{sk}</dt>
                <dd className="font-mono break-all">
                  {formatValue(sv)}
                  {sv === "<set>" && (
                    <span className="ml-1 text-warning">（密钥已脱敏）</span>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </dd>
      </>
    );
  }
  return (
    <>
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono break-all">{formatValue(v)}</dd>
    </>
  );
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}
