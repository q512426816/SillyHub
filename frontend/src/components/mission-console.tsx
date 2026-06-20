"use client";

import { useCallback, useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ApiError } from "@/lib/api";
import {
  cancelMission,
  createMission,
  getMission,
  type Mission,
} from "@/lib/agent";

const STATUS_BADGE: Record<string, string> = {
  planning: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  degraded: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

const ACTIVE = new Set(["planning", "running", "degraded"]);

export function MissionConsole({ workspaceId }: { workspaceId: string }) {
  const [objective, setObjective] = useState("");
  const [mission, setMission] = useState<Mission | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (id: string) => {
    try {
      setMission(await getMission(id));
    } catch {
      /* swallow poll errors */
    }
  }, []);

  // Poll while the Mission is active. 10s (not 3s) — the backend shares a small
  // connection pool with daemon websockets; aggressive polling provoked pool
  // exhaustion under load.
  useEffect(() => {
    if (!mission || !ACTIVE.has(mission.status)) return;
    const t = setInterval(() => refresh(mission.id), 10000);
    return () => clearInterval(t);
  }, [mission?.id, mission?.status, refresh]);

  const onCreate = async () => {
    if (!objective.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const m = await createMission(workspaceId, {
        objective: objective.trim(),
        budget_usd: 1.0,
      });
      setMission(m);
      setObjective("");
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const onCancel = async () => {
    if (!mission) return;
    try {
      setMission(await cancelMission(mission.id));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4">
      <h2 className="flex items-center gap-2 text-lg font-semibold">
        🤝 Agent 团队（Mission）
      </h2>
      <p className="text-sm text-gray-500">
        描述任务目标，Coordinator 会拆解为 Worker 团队，并行派发到 daemon 执行、收敛产出。
      </p>

      {!mission && (
        <div className="space-y-2">
          <textarea
            className="w-full rounded border p-2 text-sm"
            rows={2}
            placeholder="例：分析 backend/app/modules/agent/ 目录的架构，输出摘要"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
          />
          <Button onClick={onCreate} disabled={busy || !objective.trim()}>
            {busy ? "规划中…" : "启动团队"}
          </Button>
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {mission && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <Badge className={STATUS_BADGE[mission.status] ?? "bg-gray-100"}>
              {mission.status}
            </Badge>
            <span className="text-xs text-gray-500">
              成本 ${mission.cost_so_far.toFixed(4)}
              {mission.budget_usd ? ` / 预算 $${mission.budget_usd}` : ""}
            </span>
            {ACTIVE.has(mission.status) && (
              <Button variant="outline" size="sm" onClick={onCancel}>
                取消
              </Button>
            )}
          </div>
          <p className="text-sm text-gray-700">{mission.objective}</p>
          <ul className="space-y-1">
            {mission.workers.map((w) => (
              <li key={w.id} className="flex items-center gap-2 text-sm">
                <Badge variant="outline">{w.role ?? "worker"}</Badge>
                <span
                  className={
                    w.status === "failed"
                      ? "text-red-600"
                      : w.status === "completed"
                        ? "text-green-700"
                        : w.status === "running"
                          ? "text-blue-700"
                          : "text-gray-600"
                  }
                >
                  {w.status}
                </span>
                <span className="truncate text-gray-500">{w.objective ?? ""}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}
