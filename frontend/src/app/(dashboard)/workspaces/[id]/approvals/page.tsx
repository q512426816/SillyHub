"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  approveRequest,
  listApprovalHistory,
  listPendingApprovals,
  rejectRequest,
  type ApprovalHistoryEntry,
  type ApprovalRequest,
  type RiskLevel,
} from "@/lib/approvals";
import { SessionPermissionPanel } from "@/components/permissions/session-permission-panel";
import { listWorkspaceAgentSessions } from "@/lib/agent";

/* ------------------------------------------------------------------ */
/*  Props & constants                                                 */
/* ------------------------------------------------------------------ */

interface Props {
  params: { id: string };
}

const RISK_COLORS: Record<
  RiskLevel,
  "default" | "success" | "warning" | "destructive" | "outline"
> = {
  low: "success",
  medium: "default",
  high: "warning",
  extreme: "destructive",
};

const RISK_LABELS: Record<RiskLevel, string> = {
  low: "低",
  medium: "中",
  high: "高",
  extreme: "极高",
};

const RISK_BG: Record<RiskLevel, string> = {
  low: "border-emerald-300 bg-emerald-50",
  medium: "border-blue-300 bg-blue-50",
  high: "border-amber-300 bg-amber-50",
  extreme: "border-red-300 bg-red-50",
};

const RISK_TOOLS: Record<RiskLevel, { label: string; tools: string[] }> = {
  low: {
    label: "低风险",
    tools: ["file_read", "git_status", "git_diff"],
  },
  medium: {
    label: "中风险",
    tools: ["file_write", "shell_exec", "git_commit", "run_tests"],
  },
  high: {
    label: "高风险",
    tools: ["git_push_branch", "create_pr"],
  },
  extreme: {
    label: "极高风险",
    tools: [
      "deploy_production",
      "db_migration",
      "git_merge",
      "git_push_main",
      "secret_read",
    ],
  },
};

/* ------------------------------------------------------------------ */
/*  Page component                                                    */
/* ------------------------------------------------------------------ */

export default function ApprovalsPage({ params }: Props) {
  const workspaceId = params.id;

  const [pending, setPending] = useState<ApprovalRequest[] | null>(null);
  const [history, setHistory] = useState<ApprovalHistoryEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  // scan 真阻塞：workspace 维度 active scan sessions（供实时审批聚合面板订阅）。
  const [scanSessions, setScanSessions] = useState<string[]>([]);

  /* ---- data loading ---- */

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [pendingList, historyList, scanList] = await Promise.all([
        listPendingApprovals(workspaceId),
        listApprovalHistory(workspaceId),
        // scan 真阻塞：active scan sessions（失败不阻塞工具网关审批列表）。
        listWorkspaceAgentSessions(workspaceId, "scan").catch(() => []),
      ]);
      setPending(pendingList);
      setHistory(historyList);
      setScanSessions(scanList.map((s) => s.id));
    } catch (err) {
      setPending([]);
      setHistory([]);
      setError(
        err instanceof ApiError ? err.message : "加载审批列表失败",
      );
    }
  }, [workspaceId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  /* ---- actions ---- */

  const handleApprove = async (requestId: string) => {
    setActionLoading(requestId);
    setError(null);
    try {
      await approveRequest(workspaceId, requestId);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "审批失败",
      );
    } finally {
      setActionLoading(null);
    }
  };

  const handleReject = async (requestId: string) => {
    setActionLoading(requestId);
    setError(null);
    try {
      await rejectRequest(workspaceId, requestId);
      await reload();
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : "拒绝失败",
      );
    } finally {
      setActionLoading(null);
    }
  };

  /* ---- render ---- */

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-5 px-6 py-6">
      {/* ---- header ---- */}
      <header className="flex items-center justify-between">
        <div>
          <p className="text-[11px] text-muted-foreground">
            <Link
              href={`/workspaces/${workspaceId}/components`}
              className="hover:underline"
            >
              &larr; 工作区
            </Link>
          </p>
          <h1 className="mt-0.5">审批中心</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            审阅并管理智能体操作的工具网关审批请求。
          </p>
        </div>
        <Button size="sm" onClick={() => void reload()}>
          刷新
        </Button>
      </header>

      {/* ---- scan 真阻塞：会话级实时审批聚合（改造点 F）---- */}
      <SessionPermissionPanel sessionIds={scanSessions} />

      {/* ---- error banner ---- */}
      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ---- risk classification ---- */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">
          工具网关风险分级
        </h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(Object.keys(RISK_TOOLS) as RiskLevel[]).map((level) => (
            <div
              key={level}
              className={`rounded-md border p-3 ${RISK_BG[level]}`}
            >
              <div className="mb-1.5 flex items-center gap-2">
                <Badge variant={RISK_COLORS[level]}>
                  {RISK_LABELS[level]}
                </Badge>
                <span className="text-[11px] text-muted-foreground">
                  {level === "low" || level === "medium"
                    ? "自动放行"
                    : level === "high"
                      ? "需审批"
                      : "必须审批"}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {RISK_TOOLS[level].tools.map((tool) => (
                  <code
                    key={tool}
                    className="rounded bg-white/60 px-1.5 py-0.5 text-[11px] font-mono"
                  >
                    {tool}
                  </code>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ---- pending approvals ---- */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">
          待审批{" "}
          {pending !== null && (
            <span className="text-muted-foreground">
              ({pending.length})
            </span>
          )}
        </h2>

        {pending === null ? (
          <div className="rounded-md border bg-card px-3 py-12 text-center text-xs text-muted-foreground">
            加载中…
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-md border bg-card px-3 py-12 text-center text-xs text-muted-foreground">
            暂无待审批请求。
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {pending.map((req) => (
              <div
                key={req.id}
                className="rounded-md border bg-card p-4 space-y-3"
              >
                {/* card header */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Badge variant={RISK_COLORS[req.risk_level]}>
                      {RISK_LABELS[req.risk_level]}
                    </Badge>
                    <span className="font-mono text-xs font-medium">
                      {req.tool_name}
                    </span>
                  </div>
                  <span className="text-[11px] text-muted-foreground">
                    {new Date(req.created_at).toLocaleString()}
                  </span>
                </div>

                {/* detail rows */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-[11px]">
                  <div>
                    <span className="text-muted-foreground">运行：</span>
                    <span className="font-mono">
                      {req.run_id.slice(0, 8)}…
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">任务：</span>
                    <span className="font-mono">{req.task_key}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">智能体：</span>
                    <span>{req.agent_name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">分支：</span>
                    <span className="font-mono">{req.branch}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">目标：</span>
                    <span className="font-mono text-xs">{req.target}</span>
                  </div>
                </div>

                {/* commit message */}
                {req.commit_message && (
                  <pre className="overflow-x-auto rounded bg-muted/50 px-3 py-2 text-[11px] font-mono leading-4 whitespace-pre-wrap">
                    {req.commit_message}
                  </pre>
                )}

                {/* actions */}
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    onClick={() => void handleApprove(req.id)}
                    disabled={actionLoading !== null}
                  >
                    {actionLoading === req.id ? "处理中…" : "批准"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleReject(req.id)}
                    disabled={actionLoading !== null}
                  >
                    拒绝
                  </Button>
                  <Button size="sm" variant="outline">
                    查看详情
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ---- approval history ---- */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">
          审批历史
        </h2>

        <div className="rounded-md border bg-card">
          {history === null ? (
            <p className="py-12 text-center text-xs text-muted-foreground">
              加载中…
            </p>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              暂无审批历史。
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>操作</th>
                  <th>风险</th>
                  <th>运行</th>
                  <th>审批人</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                {history.map((entry) => (
                  <tr key={entry.id}>
                    <td className="whitespace-nowrap text-[11px] text-muted-foreground">
                      {new Date(entry.resolved_at).toLocaleString()}
                    </td>
                    <td className="font-mono text-[11px]">
                      {entry.tool_name}
                    </td>
                    <td>
                      <Badge variant={RISK_COLORS[entry.risk_level]}>
                        {RISK_LABELS[entry.risk_level]}
                      </Badge>
                    </td>
                    <td className="font-mono text-[11px]">
                      {entry.run_id.slice(0, 8)}…
                    </td>
                    <td className="text-xs">{entry.approver}</td>
                    <td>
                      {entry.status === "approved" ? (
                        <Badge variant="success">已批准</Badge>
                      ) : (
                        <Badge variant="destructive">已拒绝</Badge>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </div>
  );
}
