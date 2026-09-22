---
author: qinyi
created_at: 2026-09-16 07:45:37
generated_by: sillyspec-design-init
scale: small
---

# 设计文档（Design）— 2026-09-16-background-task-grace-timeout

## 背景

2026-09-16 的 24 小时代码变更风险审查发现：2026-09-15-background-task-permission-lockout（3a389d08d）引入的写通道第三放行源 `hasBackgroundTaskGrace`（sillyhub-daemon/src/interactive/session-manager/permission.ts:154-163）没有时间上限。后台任务注册表条目（`mgr._backgroundTasks`）仅有两条注销路径：task_notification 终态注销（background-tasks.ts:210）与会话终态 `clearBackgroundTasks`（:444）；条目虽有 `startedAt`/`lastProgressAt`（:121/:149 progress 事件刷新）但无 TTL 失效机制。若 SDK 丢失某后台任务的终态通知，条目永驻 → `onResult` 的后台锚点 `currentRunId` 永不清（events.ts:55-63 仅注册表空时清）→ 该会话「无进行中轮次即拒写」守卫长期放行，且 `backgroundTaskFlag` 持续让 backend 的 active-turn 校验处于放宽态。

对照事实：同类第一放行源 `withinStaleFlipGrace`（permission.ts:133-143）有界 60 分钟（`STALE_RUN_WRITE_GRACE_MS = 60 * 60_000`，types.ts:452）——泄漏场景下 bg-task 宽限的暴露面超出既有先例，直至会话终态/daemon 重启才收敛。

需要说明：前作设计 R-01（.sillyspec/changes/2026-09-15-background-task-permission-lockout/design.md:155）已把「注册表泄漏 → 锚点永不清 → 守卫放行窗变长」登记为 P1 并显式接受（缓解：仅放行通道存在性、写策略 allowed_roots/policyEngine 与人审链路全程生效、下一次 inject 正常切新 run、会话终态兜底、60min stale-flip 先例）。本变更是对该已接受风险的复审：经用户裁决维持接受，但把审查新增的暴露差事实与重估条件文档化，避免未来重议无锚。

## 设计目标

- 把「stale-flip 宽限有界 60min vs bg-task 宽限无界」的暴露差、缓解链有效性、重估触发条件、未来修复首选方案四要素登记到 `.sillyspec/knowledge/known-issues.md`，供后续风险复审与线上异常归因时检索。
- 在本变更 design.md/decisions.md 存档否定决策（为什么不修），保证决策链可追溯。

## 非目标

- 不修改 sillyhub-daemon 任何源码（`hasBackgroundTaskGrace`/注册表/守卫行为零变化）。
- 不修改 interactive.md 等模块文档（无代码行为变化，模块卡无需增量）。
- 不实现双窗兜底/绝对上限/静默失活任何一种封顶方案（用户裁决 D-001@v1：不改代码）。

## 总体方案

单步文档动作（无 Phase/Wave）：

1. `.sillyspec/knowledge/known-issues.md` 在后台任务权限锁死条目（ql-20260915 系）邻近节新增一条观察项，四要素：
   - **暴露差**：stale-flip 写通道宽限有界 60min（`STALE_RUN_WRITE_GRACE_MS`，permission.ts `withinStaleFlipGrace` 消费），bg-task 宽限（`hasBackgroundTaskGrace`）无界——注册表条目仅终态通知/会话终态两路注销，泄漏条目使写通道放行直至会话结束；
   - **缓解链**（维持有效）：仅放行"通道存在性"（写策略白名单 + 人审全程生效）、下次 inject 切新 run 即收敛、会话终态 `clearBackgroundTasks` 兜底、daemon 重启内存注册表丢失自然 fail-closed；
   - **重估触发条件**：线上再现注册表泄漏实证（守卫放行但无对应存活后台任务）或 policy_audit_log 出现锚点态误放行线索；
   - **未来修复首选**：双窗兜底——条目存活 = 静默 <60min（对齐 stale-flip 先例，`lastProgressAt` 已有信号）且总时长 <4h 绝对上限（原事故任务存活 94.5min，双窗防误杀）。
2. 本变更目录 design.md + decisions.md 记录否定决策与裁决证据。

执行注意（Grill 补记）：known-issues.md 属 quick 边界审计的受保护/危险文件（ql-20260916-003 实证），落盘 quick `--done` 需带 `--force-baseline` 显式放行；`--files` 需声明 `.sillyspec/knowledge/known-issues.md`。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | .sillyspec/knowledge/known-issues.md | 后台任务权限节新增 1 条观察项（四要素，见总体方案） |
| 新增 | .sillyspec/changes/2026-09-16-background-task-grace-timeout/design.md | 本文档（否定决策存档） |
| 新增 | .sillyspec/changes/2026-09-16-background-task-grace-timeout/decisions.md | D-001@v1 裁决记录 |

无对外字段/接口/DTO/事件 payload/配置键变动，不涉及数据流标注。known-issues 条目经 quick --linked-changes 本变更落盘（quick 收尾时 CLI 自动登记 QUICKLOG）。

## 接口定义

不适用：无代码变更（文档动作）。

## 生命周期契约表

不涉及生命周期契约（本变更零源码改动，不产生/消费任何 lifecycle 事件；设计背景中提及的 session/daemon 状态机为既有 2026-09-15-background-task-permission-lockout 契约，本变更不触碰）。

## 兼容策略（brownfield 必填）

不涉及生命周期契约重申：行为零变化——守卫、注册表、锚点、backend 受理逻辑全部保持 3a389d08d 落地后的现状；唯一产物是文档（known-issues 观察项）。无回退路径需求（文档可随时增删）。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | 观察项登记后无人复查，真实泄漏发生时暴露面无界（继承自前作 R-01，非本变更新增） | P1 | 缓解链全程有效（写策略+人审+inject 切轮+终态兜底+重启 fail-closed）；重估触发条件已写入观察项，线上异常归因时可检索 |
| R-02 | 未来重议时若直接采用静默失活方案，静默阈值过小会误杀真任务重演 94.5min 锁死事故 | P2 | 观察项已写明首选方案为双窗兜底（静默 60min + 绝对 4h），并标注原事故时长作阈值依据 |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1（维持 R-01 不修代码，方案 A 文档动作） | 设计目标/非目标/总体方案/文件变更清单全部 | 已覆盖（无 FR 编号——文档动作） |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/风险登记）
- [x] frontmatter 字段齐全（author/created_at/scale=small——文档动作 ≤2 个实质文件、单仓、无 schema/API/状态机变更）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1 唯一决策，已入决策追踪）
- [x] 涉及生命周期关键词时含豁免短语（「不涉及生命周期契约」紧邻生命周期契约表章节）
- [x] UI 原型分级核对：无 UI/前端文件改动，无需原型（跳过理由已在 Step 5 记录）
- [x] 无自审存疑项——用户两轮亲选（不改代码 + 方案 A），裁决链完整
