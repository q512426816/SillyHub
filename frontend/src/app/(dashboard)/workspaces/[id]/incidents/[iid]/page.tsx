"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  getIncident,
  getPostmortem,
  updateIncident,
  createPostmortem,
  type Incident,
  type Postmortem,
} from "@/lib/incidents";

interface Props {
  params: { id: string; iid: string };
}

const STATUS_COLORS: Record<string, "default" | "success" | "warning" | "destructive" | "outline"> = {
  open: "destructive",
  investigating: "warning",
  mitigated: "warning",
  resolved: "success",
};

const STATUS_LABELS: Record<string, string> = {
  open: "待处理",
  investigating: "调查中",
  mitigated: "已缓解",
  resolved: "已解决",
};

const SEVERITY_LABELS: Record<string, string> = {
  low: "低",
  medium: "中",
  high: "高",
  critical: "严重",
};

export default function IncidentDetailPage({ params }: Props) {
  const workspaceId = params.id;
  const incidentId = params.iid;

  const [incident, setIncident] = useState<Incident | null>(null);
  const [postmortem, setPostmortem] = useState<Postmortem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  const [showPmForm, setShowPmForm] = useState(false);
  const [pmTimeline, setPmTimeline] = useState("");
  const [pmImpact, setPmImpact] = useState("");
  const [pmRca, setPmRca] = useState("");
  const [pmActions, setPmActions] = useState("");
  const [pmLessons, setPmLessons] = useState("");

  const reload = useCallback(async () => {
    setError(null);
    try {
      const inc = await getIncident(incidentId);
      setIncident(inc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "加载事件失败");
      return;
    }
    try {
      const pm = await getPostmortem(incidentId);
      setPostmortem(pm);
    } catch {
      setPostmortem(null);
    }
  }, [incidentId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const handleTransition = async (
    targetStatus: "investigating" | "mitigated" | "resolved",
  ) => {
    setActionLoading(true);
    setError(null);
    try {
      await updateIncident(incidentId, { status: targetStatus });
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "状态变更失败");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCreatePostmortem = async () => {
    setActionLoading(true);
    setError(null);
    try {
      await createPostmortem(incidentId, {
        timeline: pmTimeline || undefined,
        impact: pmImpact || undefined,
        root_cause_analysis: pmRca || undefined,
        action_items: pmActions
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        lessons_learned: pmLessons || undefined,
      });
      setShowPmForm(false);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "创建 Postmortem 失败");
    } finally {
      setActionLoading(false);
    }
  };

  if (incident === null && error === null) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6 text-xs text-muted-foreground">
        加载中…
      </div>
    );
  }

  if (incident === null) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-6">
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
        <Link
          href={`/workspaces/${workspaceId}/incidents`}
          className="mt-3 inline-block text-xs text-primary hover:underline"
        >
          ← 事件列表
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-5 px-6 py-6">
      <header>
        <p className="text-[11px] text-muted-foreground">
          <Link href={`/workspaces/${workspaceId}/incidents`} className="hover:underline">
            ← 事件列表
          </Link>
        </p>
        <div className="mt-0.5 flex items-center gap-2">
          <h1 className="truncate">{incident.title}</h1>
          <Badge variant={STATUS_COLORS[incident.status] ?? "outline"}>
            {STATUS_LABELS[incident.status] ?? incident.status}
          </Badge>
        </div>
        <div className="mt-1 flex flex-wrap gap-x-5 gap-y-0.5 text-xs text-muted-foreground">
          <span>严重度: {SEVERITY_LABELS[incident.severity] ?? incident.severity}</span>
          <span>创建: {new Date(incident.created_at).toLocaleString()}</span>
        </div>
      </header>

      {error && (
        <div className="rounded border border-destructive/30 bg-red-50 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      )}

      <div className="flex gap-2">
        {incident.status === "open" && (
          <Button size="sm" onClick={() => handleTransition("investigating")} disabled={actionLoading}>
            开始调查
          </Button>
        )}
        {incident.status === "investigating" && (
          <Button size="sm" variant="outline" onClick={() => handleTransition("mitigated")} disabled={actionLoading}>
            标记已缓解
          </Button>
        )}
        {incident.status === "mitigated" && (
          <Button size="sm" variant="outline" onClick={() => handleTransition("resolved")} disabled={actionLoading}>
            标记已解决
          </Button>
        )}
      </div>

      {incident.description && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">描述</h3>
          <p className="whitespace-pre-wrap text-xs">{incident.description}</p>
        </section>
      )}

      {incident.affected_components.length > 0 && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">受影响组件</h3>
          <div className="flex flex-wrap gap-1.5">
            {incident.affected_components.map((c) => (
              <Badge key={c} variant="outline">{c}</Badge>
            ))}
          </div>
        </section>
      )}

      {incident.root_cause && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">根因</h3>
          <p className="whitespace-pre-wrap text-xs">{incident.root_cause}</p>
        </section>
      )}

      {incident.resolution && (
        <section className="rounded-md border bg-card p-3">
          <h3 className="mb-1.5 text-xs font-medium text-muted-foreground">解决方案</h3>
          <p className="whitespace-pre-wrap text-xs">{incident.resolution}</p>
        </section>
      )}

      <section className="rounded-md border bg-card">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <h3 className="text-xs font-medium">Postmortem</h3>
          {incident.status === "resolved" && !postmortem && !showPmForm && (
            <Button size="sm" variant="outline" onClick={() => setShowPmForm(true)}>
              撰写 Postmortem
            </Button>
          )}
        </div>

        {postmortem ? (
          <div className="space-y-3 p-3">
            {[
              { label: "时间线", content: postmortem.timeline },
              { label: "影响范围", content: postmortem.impact },
              { label: "根因分析", content: postmortem.root_cause_analysis },
              { label: "经验教训", content: postmortem.lessons_learned },
            ].map(
              ({ label, content }) =>
                content && (
                  <div key={label}>
                    <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
                    <p className="mt-0.5 whitespace-pre-wrap text-xs">{content}</p>
                  </div>
                ),
            )}
            {postmortem.action_items.length > 0 && (
              <div>
                <p className="text-[11px] font-medium text-muted-foreground">改进措施</p>
                <ul className="mt-0.5 list-inside list-disc text-xs">
                  {postmortem.action_items.map((a, i) => (
                    <li key={i}>{a}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        ) : showPmForm ? (
          <div className="space-y-2 p-3">
            {[
              { label: "时间线", value: pmTimeline, set: setPmTimeline, rows: 2 },
              { label: "影响范围", value: pmImpact, set: setPmImpact, rows: 2 },
              { label: "根因分析", value: pmRca, set: setPmRca, rows: 3 },
              { label: "改进措施 (每行一条)", value: pmActions, set: setPmActions, rows: 2 },
              { label: "经验教训", value: pmLessons, set: setPmLessons, rows: 2 },
            ].map(({ label, value, set, rows }) => (
              <textarea
                key={label}
                className="w-full rounded border border-input bg-background px-2.5 py-1.5 text-xs focus:border-ring focus:outline-none"
                rows={rows as number}
                placeholder={label}
                value={value}
                onChange={(e) => (set as (_v: string) => void)(e.target.value)}
              />
            ))}
            <div className="flex gap-2 pt-1">
              <Button size="sm" onClick={handleCreatePostmortem} disabled={actionLoading}>
                {actionLoading ? "提交中…" : "提交"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setShowPmForm(false)}>
                取消
              </Button>
            </div>
          </div>
        ) : (
          <p className="px-3 py-4 text-xs text-muted-foreground">
            {incident.status === "resolved"
              ? "尚未撰写 Postmortem。"
              : "事件解决后可撰写 Postmortem。"}
          </p>
        )}
      </section>
    </div>
  );
}
