---
author: qinyi
created_at: 2026-08-05 16:57:16
---

# 决策台账 — daemon kill 通道统一

本次变更的决策记录（有实现/验收影响的才记，闲聊不记）。长期术语留待 archive/scan 时提升到 `docs/multi-agent-platform/glossary.md`。

## D-001@v1: INTERRUPT 保留 turn 级软中断语义（已被 D-001@v2 取代）
- type: boundary
- status: superseded
- superseded-by: D-001@v2
- source: user
- priority: P0
- question: INTERRUPT（打断本轮）是否要改成硬杀进程？
- answer: 否。INTERRUPT 保留 turn 级软中断（Claude `q.interrupt()` / Codex `turn/interrupt` JSON-RPC），不杀进程，保持 session active 可续轮。只有 END / fail / budget 超限才硬杀。
- normalized_requirement: `SessionManager.interrupt` 不调用 `driverHandle.close`；仅 `end`/`fail` 路径调 `_terminateSession`（含 close）。
- impacts: [FR-01, FR-02, Phase1]
- evidence: 前端按钮 title="打断本轮（session 保持 active）"（`interactive-session-panel.tsx:1158`）；`claude-sdk-driver.ts:379-380` spike D1 注释

## D-001@v2: INTERRUPT 软语义只守"打断本轮"按钮；cancel/终止硬杀
- type: boundary
- status: accepted
- supersedes: D-001@v1
- source: user (Design Grill XC-01)
- priority: P0
- question: cancel_lease（取消/停止 run）对 interactive 当前发 SESSION_INTERRUPT（软），卡死 turn 时仍僵尸——cancel UX 期望软还是硬？
- answer: 区分两个操作。"打断本轮"按钮（interruptSession 端点）保持软（q.interrupt，可续轮，原 D-001@v1 意图）；"取消/停止 run"（cancel_lease, kill 端点）和"结束会话"（end_session）都是终止语义，必须硬杀。cancel_lease 对 interactive lease 改发 SESSION_END（复用 Phase1 硬杀链）。
- normalized_requirement: SESSION_INTERRUPT 消息仅对应"打断本轮"按钮；cancel_lease 对 interactive lease 改发 SESSION_END（不再发 INTERRUPT）。
- impacts: [FR-01, FR-02, FR-09, Phase1]
- evidence: Design Grill XC-01；`lease_service.py:363` 当前发 INTERRUPT；前端 interruptSession vs kill 两个独立端点

## D-002@v1: 不改 daemon-entity-binding / WorkspaceMemberRuntime
- type: architecture
- status: accepted
- source: docs (CLAUDE.md / arch-analysis-2026-08-02)
- priority: P0
- question: 是否借本次改动 daemon-entity-binding / WorkspaceMemberRuntime 绑定结构？
- answer: 否。`runtime_id`/`daemon_id` 经 134 文件引用，风险大且与本次目标正交。
- normalized_requirement: kill 通道改动局限于 lease/session 终态收口 + driver close 契约 + 新增 LEASE_CANCEL 消息，不碰 binding 字段或 runtime_id 传递链。
- impacts: [Phase1-4]
- evidence: `arch-analysis-daemon-agent-workspace-2026-08-02.md §6.4`；CLAUDE.md

## D-003@v1: Claude close 用 SDK 已有机制，不造轮子
- type: premise
- status: accepted
- source: code (spike)
- priority: P0
- question: Claude 子进程 kill 要自建 SIGTERM/SIGKILL 逻辑吗？
- answer: 否。SDK 的 `query.close()` 已实现 `close → stdin EOF → 2s 宽限 → SIGTERM → 5s → SIGKILL`（`sdk.mjs` close()，`vB=2000`）。`ClaudeDriverHandle.close` 调 `query.close()` 即可触发。
- normalized_requirement: `ClaudeDriverHandle` 新增 `close = () => query.close()`；daemon 不自己 spawn/kill claude 子进程。
- impacts: [FR-02, Phase1]
- evidence: `sdk.mjs:60` close()/`vB=2000`；`sdk.d.ts:2426` Query.close；`claude-sdk-driver.ts:374`

## D-004@v1: Windows 进程清理交给 SDK close()
- type: boundary
- status: accepted
- source: code + CONVENTIONS
- priority: P0
- question: Windows 下 daemon 如何终止 claude.exe？
- answer: 交给 SDK `close()`：win32 走 `stdin.end` + 5s 后 SIGKILL（TerminateProcess）。daemon 不自己 `taskkill`，遵守 CONVENTIONS 已知陷阱"禁止 `taskkill /IM` 通杀"（会杀掉当前会话自身）。
- normalized_requirement: daemon 全平台只调 `driverHandle.close`/`query.close`；代码中无 `taskkill /IM` 调用。
- impacts: [FR-02, Phase1]
- evidence: `sdk.mjs:60` close() win32 分支；`CONVENTIONS.md` 已知陷阱"claude.exe 孤儿进程"

## D-005@v1: 本次范围含 budget（隐患 4）
- type: boundary
- status: accepted
- source: user
- priority: P0
- question: 本次 change 是否包含 budget_tokens 强制点（隐患 4），还是只做 kill 契约？
- answer: 全做。kill 契约（隐患 1+2+3）+ budget 强制点（隐患 4）统一成一个 daemon 切断契约 change。
- normalized_requirement: 范围含 Phase3 budget（backend LeaseCtx 下发 budget_tokens + daemon 执行循环阈值检查 + 软切断）。
- impacts: [FR-05, Phase3]
- evidence: brainstorm step 3 用户选择"全做：含 budget"

## D-006@v1: budget 超阈值走软切断
- type: boundary
- status: accepted
- source: architect（默认，与 backend `can_dispatch_worker` 一致）
- priority: P1
- question: budget 超阈值时硬切断（立即 kill 当前 turn）还是软切断（跑完当前 turn 不续轮）？
- answer: 软切断。与现有 backend `can_dispatch_worker`（pre-dispatch 门，不杀在跑 worker）语义一致；硬切断会丢失当前 turn 已做的有用工作。设 `overBudget` flag，当前 turn 完成后拒绝续轮/不再派发，并回传 `budget_exceeded` 事件。
- normalized_requirement: daemon 检测累计 token ≥ budget_tokens 时不调 close/kill，仅设 flag + 回传事件；当前 turn 自然完成后终止。
- impacts: [FR-05, Phase3]
- evidence: `backend/app/modules/agent/control.py:69-87` can_dispatch_worker（pre-dispatch 语义）；与 D-001 软中断哲学一致

## D-007@v1: 选方案 C，不引入 outbox 重试 / 终态中间态状态机
- type: architecture
- status: accepted
- source: architect（方案对比，用户确认）
- priority: P0
- question: 终态确认是否引入 outbox report-with-retry + terminating 中间态状态机（方案 B）？
- answer: 否。方案 C：轻量 `terminating_at` 时间戳 + 复用现有 `complete_lease`/`notifySessionEnd` 作 ACK + 30s 超时告警。避免跨协议大改 + 不波及已上线 PPM 的 lease 终态状态机。
- normalized_requirement: 仅加 `terminating_at` 字段 + sweeper 告警；不改 `lease.status` 状态机取值集合，不新建 outbox 重试组件。
- impacts: [FR-06, Phase4]
- evidence: brainstorm step 4 方案对比；multica report-with-retry 对照（取"执行端确认"可见性，不取重试复杂度）

## D-009@v1: budget_tokens 口径 = input+output，per-run，batch 补累计器
- type: definition
- status: accepted
- source: user (Design Grill XC-02)
- priority: P1
- question: budget_tokens 计什么口径？（interactive 4 累计器 input/output/cache_read/cache_creation；batch task-runner 无累计器）
- answer: 计 input_tokens + output_tokens（不含 cache_read/cache_creation），按单个 AgentRun 归集（per-run）。batch（task-runner）本次补 token 累计器（否则 budget 对 batch 无效，违背 D-005 全做）。
- normalized_requirement: daemon budget 累计口径 = input_tokens + output_tokens；归集维度 = per AgentRun；task-runner 新增 input+output 累计逻辑。
- impacts: [FR-05, Phase3]
- evidence: Design Grill XC-02；`session-manager.ts:374-381` 现有累计器；`task-runner.ts` 当前无 token 累计器
