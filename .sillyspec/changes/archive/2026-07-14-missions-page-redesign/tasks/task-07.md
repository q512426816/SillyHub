---
id: task-07
title: "WorkerRow 改造：删 [role] 方括号代号 + objective 折叠"
title_zh: 分身行改造（去代号 + 分工目标折叠）
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-7, FR-8]
decision_ids: [D-005@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: >
  改造 WorkerRow 组件：删除角色徽标旁的 [role] 方括号英文代号（mission-console.tsx:299），
  并把几百字的 objective 分工目标包进默认折叠容器，点开看完整，避免长文本糊屏。
implementation:
  - 删除 mission-console.tsx:299 的 `<span className="text-[11px] text-gray-400">[{role}]</span>` 这一行（角标 `[arch]`/`[orchestrator]` 英文代号，中英重复且露内部 role key）。
  - 角色徽标（mission-console.tsx:289-298 Badge）保留，文案走 ROLE_LABEL 中文映射（架构分析/验证/主控等），用户只看到中文角色名。
  - objective 折叠：在 WorkerRow 内为 worker.objective 加 useState 折叠态（参考既有 ArtifactCard :197-217 的 open/setOpen 模式）。默认收起，显示「▸ 分工目标」按钮；点击展开渲染完整 objective 文本（whitespace-pre-wrap）。
  - objective 为空或极短（如 <20 字符）时不渲染折叠按钮，直接平铺（避免无意义折叠）。
  - worker.status 显示改中文（pending→排队中 / running→运行中 / completed→已完成 / failed→失败 / killed→已终止），沿用 task-09 STATUS_LABEL（本任务可先就地映射，task-09 统一收口）。
  - 文案全程中文，不露 role/objective/status 内部 key。
acceptance:
  - WorkerRow 角色徽标旁不再出现 `[arch]`/`[orchestrator]`/`[impl]` 等方括号代号（mission-console.tsx:299 行删除）。
  - 角色徽标文案为中文（ROLE_LABEL 映射值）。
  - objective 默认折叠，仅显示折叠按钮；点击展开看完整分工目标；再点收起。
  - objective 为空时不渲染折叠按钮（不显空「▸ 分工目标」）。
  - worker 状态词显示中文（completed→已完成 而非 "completed"）。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动：只改 WorkerRow 渲染，不改 worker 数据契约（MissionWorkerRun 不变）。
  - 文案默认中文。
  - 折叠用 React useState（client component），不引入新依赖。
  - 复用既有 ArtifactCard 的折叠交互模式（视觉/行为一致）。
  - 不删 WorkerRow 的日志查看按钮/artifacts 渲染（仅改角色代号 + objective 折叠 + status 中文化）。
---

# task-07: WorkerRow 改造 — 删 [role] 代号 + objective 折叠

详情态每个分身（WorkerRow，mission-console.tsx:266-332）当前两个问题：①角色徽标旁有 `<span>[{role}]</span>`（:299）露出内部 role key（`架构分析 [arch]`），中英重复；②objective（几百字指令原文，:309-314）直接平铺糊屏。本任务删代号 + objective 包折叠容器默认收起。

## 关键代码位置

- 删代号：mission-console.tsx:299 `<span className="text-[11px] text-gray-400">[{role}]</span>`。
- objective 折叠：mission-console.tsx:309-314 `{worker.objective && (<p>...</p>)}`，包进受控折叠容器（参考 ArtifactCard :197-217 的 open/setOpen）。
- 角色徽标保留：:289-298 Badge，文案 ROLE_LABEL[role]（:36-45）。

## 非目标

- 不改 CoordinatorPanel（:139-194，task-09 统一中文化时收口）。
- 不改 ArtifactCard（:196-218，本身已折叠）。
- 不改 WorkerLogPanel 日志查看（:220-264）。
- 不改主 agent 区块/分身列表的拆分逻辑（mission-console.tsx:835-879）。
