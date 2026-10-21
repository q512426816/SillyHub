---
id: task-14
title: 'Docs sync: daemon interactive, backend run model, frontend session card, proto routes'
title_zh: '文档同步：daemon interactive / backend 读模型 / 前端会话卡片 / 原型路由'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P1
depends_on: [task-08, task-11, task-12]
blocks: []
requirement_ids: [FR-17, FR-19]
decision_ids: [D-010@v1, D-026@v1]
allowed_paths:
  - .sillyspec/docs/frontend/modules/components-daemon.md
  - .sillyspec/docs/sillyhub-daemon/modules/interactive.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/SillyHub/scan/PROTOTYPE.md
target_files:
  - .sillyspec/docs/frontend/modules/components-daemon.md
  - .sillyspec/docs/sillyhub-daemon/modules/interactive.md
  - .sillyspec/docs/backend/modules/daemon.md
  - .sillyspec/docs/SillyHub/scan/PROTOTYPE.md
goal: >
  把本变更落地的三件新事写进模块文档（否则 docs-check 在 archive/pre-push 阶段拦）：daemon 每轮快照与 TTFT/attempt 采集、
  backend 的 `daemon_run_snapshots` 侧表与读模型字段、前端会话页的轮级文件变更卡 + 会话级汇总 + 模型泳道口径切换。
  同时补 `PROTOTYPE.md` 的 dev 预览路由条目（D-010 时期留的演进项已落地）。
implementation:
  - '.sillyspec/docs/sillyhub-daemon/modules/interactive.md：新增段「每轮工作区快照（1b）与 TTFT/attempt 采集」——collectTurnFileChanges 的输入/输出、≤3 子进程、1500ms→partial、单工作区串行队列、ignored 目录 mtime 探测、`_onResult` 之后异步上报的时序约束；给出文件与函数级 file:line 锚点（turn-file-changes.ts / turn-timing.ts / session-manager.ts:1567）'
  - '.sillyspec/docs/backend/modules/daemon.md：新增段「run 快照读模型」——`daemon_run_snapshots` 侧表字段、`(run_id)` 幂等 upsert 点（lease/service.py 的轮终态 apply）、轮次读模型新增 `file_changes` / `file_changes_capability` / `timing`、capability 计算口径（字段缺失 → tool_only）'
  - '.sillyspec/docs/frontend/modules/components-daemon.md：扩写既有「## 会话轨迹视图（2026-10-20-session-page-dsh-alignment）」段——模型泳道 observed/approx 两态、轮级文件变更卡与会话级汇总、降级文案；再补 turn-timeline 的轮级挂载与 session-panel-page 的透传锚点'
  - '.sillyspec/docs/SillyHub/scan/PROTOTYPE.md：在 dev 预览路由条目补 `/proto/session-trajectory`、`/proto/session-file-changes`、`/proto/session-redesign` 三条已落地实况与 dev-only 边界（不进导航 / 不进 middleware / 真实数据不进 public）'
acceptance:
  - '四个文档各新增段落且含 file:line 锚点；`sillyspec docs check`（或等价 docs gate）无新增失效引用'
  - '`PROTOTYPE.md` 的 dev 路由条目不再把这三条写成「待落地」'
  - '文档中的字段名与 task-08 的 pydantic / task-11 的前端类型逐字一致（抽查 `file_changes` / `file_changes_capability` / `timing` / `concurrentSessionsHint`）'
verify:
  - sillyspec docs check --change 2026-10-20-session-page-dsh-alignment
constraints:
  - 只改文档，不改代码；文档描述必须与已落地实现一致（禁止写「计划中」）
  - file:line 锚点必须真实存在（写完用 Select-String 抽查命中）
  - 不重写整篇模块文档，只增量补段（保留既有 quick 增量段）
related_tests: []
---
