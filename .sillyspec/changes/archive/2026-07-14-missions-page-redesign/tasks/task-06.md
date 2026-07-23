---
id: task-06
title: "AI 最终结论：提取 summary artifact + 状态降级展示"
title_zh: AI 最终结论（summary 提取与降级）
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: [task-05]
blocks: []
requirement_ids: [FR-6, FR-12]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/mission-summary-card.tsx
  - frontend/src/components/mission-console.tsx
goal: >
  在 MissionSummaryCard 内提取 mission.workers 中 kind==="summary" 的 artifact
  content_ref 作为「AI 最终结论」展示，并按 mission 状态降级（进行中显占位、
  失败/取消无结论显兜底），让用户看到任务到底得出了什么结论。
implementation:
  - 在 task-05 建好的 MissionSummaryCard 内，下方加紫底「🤖 AI 最终结论」区块。
  - 提取 summary：const summary = mission.workers.flatMap(w => w.artifacts).find(a => a.kind === "summary")?.content_ref（design §7 数据契约，artifacts 类型见 lib/agent.ts:218-223 MissionArtifact.kind/content_ref）。
  - 展示分支：summary 存在且非空 → 渲染结论文本（whitespace-pre-wrap 保留换行）；summary 缺失 → 按 mission.status 降级。
  - 降级文案（design §12）：mission.status∈{planning,running} → 「进行中，暂无结论」；mission.status∈{failed,cancelled} 且无 summary → 「失败，无最终结论」/「已取消，无最终结论」；done/degraded 无 summary（异常但兜底）→ 「任务结束，无最终结论」。
  - 在 mission-console.tsx 详情态顶部接入 MissionSummaryCard（替换原散落的 Badge + CostBar + CoordinatorPanel 总览部分，:815-831 区段），主 agent 单独区块与分身列表保留在 mission-console.tsx。
  - 文案全程中文，不露 summary/artifact/kind 等内部词（用户可见处只叫「AI 最终结论」）。
acceptance:
  - mission.workers 含 kind==="summary" artifact 时，MissionSummaryCard 展示其 content_ref 文本。
  - mission.status=running/planning 无 summary 时，显「进行中，暂无结论」（不显空白/报错）。
  - mission.status=failed/cancelled 无 summary 时，显「失败，无最终结论」或「已取消，无最终结论」。
  - summary 为空字符串/null 时走降级，不渲染空结论块。
  - mission-console.tsx 详情态顶部正确渲染 MissionSummaryCard（取代散落总览元素）。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动：summary artifact 仅 mission∈{done,degraded} 时由 finalizer.py 产出，前端只读提取，不触发产出。
  - 文案默认中文。
  - summary 缺失时必须降级兜底，不得抛错或渲染 undefined。
  - 复用 task-05 的 MissionSummaryCard 组件（同文件扩展），不新建第二个组件。
  - 不改 lib/agent.ts 的 MissionArtifact/Mission 类型（content_ref 已是 string|null）。
---

# task-06: AI 最终结论 — summary 提取与降级

在 task-05 建好的 MissionSummaryCard 下半部分接入「AI 最终结论」。summary artifact 是主 agent（Finalizer）在 mission 终态（done/degraded）产出的任务结论，数据已落库（finalizer.py:183-190），前端只需提取展示。非终态或失败/取消时按状态降级，避免空白或报错。

## 提取与降级（design §7 + §12）

- 提取：`mission.workers.flatMap(w => w.artifacts).find(a => a.kind === "summary")?.content_ref`。
- 降级矩阵：planning/running → 「进行中，暂无结论」；failed → 「失败，无最终结论」；cancelled → 「已取消，无最终结论」；done/degraded 异常无 summary → 「任务结束，无最终结论」。

## 非目标

- 不改 FinalizerService 产出 summary 的逻辑（后端不动）。
- 不渲染其他 kind 的 artifact（归 WorkerRow 内 ArtifactCard，mission-console.tsx:196-218）。
- 不做 summary 内容的 Markdown 富文本渲染（纯文本 whitespace-pre-wrap 即可，YAGNI）。
- 不持久化 summary（每次渲染从 mission.workers 现取，轮询刷新由父组件负责）。
