"use client";

import { Badge } from "@/components/ui/badge";
import type { Mission } from "@/lib/agent";

/** 任务级状态徽标配色（STATUS_LABEL 控中文文案）。 */
const STATUS_BADGE: Record<string, string> = {
  planning: "bg-gray-100 text-gray-700",
  running: "bg-blue-100 text-blue-700",
  done: "bg-green-100 text-green-700",
  degraded: "bg-yellow-100 text-yellow-800",
  failed: "bg-red-100 text-red-700",
  cancelled: "bg-gray-200 text-gray-500",
};

/** 任务级状态中文（D-005@v1，藏英文 status）。 */
const STATUS_LABEL: Record<string, string> = {
  planning: "规划中",
  running: "运行中",
  done: "已完成",
  degraded: "部分完成",
  failed: "失败",
  cancelled: "已取消",
};

/**
 * 任务成败总览卡（task-05/06，D-003@v1）：顶部一眼看——中文状态 + 成败统计 +
 * 累计成本 + AI 最终结论（Finalizer 合并的 summary artifact）。
 *
 * 成败统计口径（G1）：只算真分身（role!=="orchestrator"），主控单独展示不计入。
 * AI 结论降级：summary 仅 mission∈{done,degraded} 由后端 Finalizer 落库
 * （finalizer.py:183-190）；running/planning 显「进行中」，其余无 summary 显「无最终结论」。
 */
export function MissionSummaryCard({ mission }: { mission: Mission }) {
  const realWorkers = mission.workers.filter((w) => w.role !== "orchestrator");
  const succeeded = realWorkers.filter((w) => w.status === "completed").length;
  const failed = realWorkers.filter(
    (w) => w.status === "failed" || w.status === "killed",
  ).length;

  // AI 最终结论：Finalizer 合并产出的 summary artifact（挂某个分身 run 下）。
  const summaryArtifact = mission.workers
    .flatMap((w) => w.artifacts)
    .find((a) => a.kind === "summary");
  const conclusion = summaryArtifact?.content_ref ?? null;

  let conclusionText: string;
  if (conclusion) {
    conclusionText = conclusion;
  } else if (mission.status === "running" || mission.status === "planning") {
    conclusionText = "进行中，暂无最终结论";
  } else {
    conclusionText = "无最终结论";
  }

  const budget = mission.budget_usd;
  const cost = mission.cost_so_far;

  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <Badge className={STATUS_BADGE[mission.status] ?? "bg-gray-100 text-gray-700"}>
          {STATUS_LABEL[mission.status] ?? mission.status}
        </Badge>
        <span className="text-sm text-gray-600">
          <b className="text-gray-800">{realWorkers.length}</b> 个分身 · 成功{" "}
          <b className="text-green-700">{succeeded}</b> / 失败{" "}
          <b className="text-red-600">{failed}</b>
        </span>
        <span className="text-sm text-gray-500">
          花费 <b className="text-gray-800">${cost.toFixed(4)}</b>
          {budget && budget > 0
            ? ` / 预算 $${budget.toFixed(2)}`
            : "（未设预算）"}
        </span>
      </div>
      <div className="rounded-md border border-indigo-200 bg-indigo-50 p-3">
        <div className="mb-1 text-[11px] font-bold tracking-wide text-indigo-600">
          🤖 AI 最终结论
        </div>
        <div className="whitespace-pre-wrap text-sm text-gray-700">
          {conclusionText}
        </div>
      </div>
    </div>
  );
}
