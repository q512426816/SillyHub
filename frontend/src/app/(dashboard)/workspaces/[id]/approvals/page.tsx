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
  low: "Low",
  medium: "Medium",
  high: "High",
  extreme: "Extreme",
};

const RISK_BG: Record<RiskLevel, string> = {
  low: "border-emerald-300 bg-emerald-50",
  medium: "border-blue-300 bg-blue-50",
  high: "border-amber-300 bg-amber-50",
  extreme: "border-red-300 bg-red-50",
};

const RISK_TOOLS: Record<RiskLevel, { label: string; tools: string[] }> = {
  low: {
    label: "Low Risk",
    tools: ["file_read", "git_status", "git_diff"],
  },
  medium: {
    label: "Medium Risk",
    tools: ["file_write", "shell_exec", "git_commit", "run_tests"],
  },
  high: {
    label: "High Risk",
    tools: ["git_push_branch", "create_pr"],
  },
  extreme: {
    label: "Extreme Risk",
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

  /* ---- data loading ---- */

  const reload = useCallback(async () => {
    setError(null);
    try {
      const [pendingList, historyList] = await Promise.all([
        listPendingApprovals(workspaceId),
        listApprovalHistory(workspaceId),
      ]);
      setPending(pendingList);
      setHistory(historyList);
    } catch (err) {
      setPending([]);
      setHistory([]);
      setError(
        err instanceof ApiError ? err.message : "Failed to load approvals",
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
        err instanceof ApiError ? err.message : "Approval failed",
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
        err instanceof ApiError ? err.message : "Rejection failed",
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
              &larr; Workspace
            </Link>
          </p>
          <h1 className="mt-0.5">Approval Center</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Review and manage tool-gateway approval requests for agent
            operations.
          </p>
        </div>
        <Button size="sm" onClick={() => void reload()}>
          Refresh
        </Button>
      </header>

      {/* ---- error banner ---- */}
      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      {/* ---- risk classification ---- */}
      <section>
        <h2 className="text-xs font-medium text-muted-foreground mb-3">
          Tool Gateway Risk Classification
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
                    ? "auto-pass"
                    : level === "high"
                      ? "needs approval"
                      : "must approve"}
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
          Pending Approvals{" "}
          {pending !== null && (
            <span className="text-muted-foreground">
              ({pending.length})
            </span>
          )}
        </h2>

        {pending === null ? (
          <div className="rounded-md border bg-card px-3 py-12 text-center text-xs text-muted-foreground">
            Loading…
          </div>
        ) : pending.length === 0 ? (
          <div className="rounded-md border bg-card px-3 py-12 text-center text-xs text-muted-foreground">
            No pending approval requests.
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
                    <span className="text-muted-foreground">Run: </span>
                    <span className="font-mono">
                      {req.run_id.slice(0, 8)}…
                    </span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Task: </span>
                    <span className="font-mono">{req.task_key}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Agent: </span>
                    <span>{req.agent_name}</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">Branch: </span>
                    <span className="font-mono">{req.branch}</span>
                  </div>
                  <div className="col-span-2">
                    <span className="text-muted-foreground">Target: </span>
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
                    {actionLoading === req.id ? "Processing…" : "Approve"}
                  </Button>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => void handleReject(req.id)}
                    disabled={actionLoading !== null}
                  >
                    Reject
                  </Button>
                  <Button size="sm" variant="outline">
                    View Details
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
          Approval History
        </h2>

        <div className="rounded-md border bg-card">
          {history === null ? (
            <p className="py-12 text-center text-xs text-muted-foreground">
              Loading…
            </p>
          ) : history.length === 0 ? (
            <div className="py-12 text-center text-xs text-muted-foreground">
              No approval history yet.
            </div>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>Operation</th>
                  <th>Risk</th>
                  <th>Run</th>
                  <th>Approver</th>
                  <th>Result</th>
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
                        <Badge variant="success">Approved</Badge>
                      ) : (
                        <Badge variant="destructive">Rejected</Badge>
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
