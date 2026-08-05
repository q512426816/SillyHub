---
author: qinyi
created_at: 2026-08-05 16:57:16
---

# 任务清单 — daemon kill 通道统一

> 按 Phase 分组（对齐 design.md §5，含 Design Grill XC-01~XC-08 修正）。详细 Wave 排序与依赖在 plan.md 细化。FR 映射见 requirements.md。

## Phase 1 · Interactive 切断契约（止血 P0，FR-01/FR-02/FR-06/FR-09）

1. [daemon] `claude-sdk-driver.ts`：`ClaudeDriverHandle` 新增 `close = () => query.close()`（D-003）
2. [daemon] `session-manager.ts`：新增私有 `_terminateSession(state, reason)`，统一 `driverHandle.close?.()` + `inputQueue.close()` + abort resolver + 清 partial buffer；`end`/`fail` 改调它；`interrupt` 保持不动（仅"打断本轮"按钮软，D-001@v2）
3. [backend] `lease_service.py` `cancel_lease`：对 **interactive lease 改发 SESSION_END**（不再发 SESSION_INTERRUPT，D-001@v2/XC-01）——"取消/停止 run"也走 `_terminateSession` 硬杀链；SESSION_INTERRUPT 此后仅 interruptSession 按钮用
4. [daemon] Codex `_close` 经 `state.driverHandle.close` 已可达（XC-05 确认，session-manager.ts:919），无需改 driver.ts——仅测试验证
5. [daemon-test] session-manager `end`/`fail` 触发 `close`（mock driver）；`interrupt` 不触发 close（守 D-001@v2）
6. [daemon-test+backend-test] Claude `close` 调 `query.close`（mock SDK，异常 try/catch 不阻塞）；cancel_lease→SESSION_END→`_terminateSession` 链路集成测试

## Phase 2 · Batch 即时取消（FR-03）

7. [protocol] 双端新增 `LEASE_CANCEL = 'daemon:lease_cancel'`：`backend/.../protocol.py` + `daemon/src/protocol.ts`，payload `{lease_id, runtime_id}`
8. [backend] `lease_service.py` `cancel_lease`：对 batch lease（`kind != interactive`）标记 cancelled 后经 `ws_hub.send_to_runtime` 发 LEASE_CANCEL（best-effort）
9. [daemon] `daemon.ts` `_handleWsMessage`：新增 `LEASE_CANCEL` case → `taskRunner.cancel(leaseId)`（复用现有 AbortController → `_killChild`）
10. [backend-test] cancel_lease 对 batch 发 LEASE_CANCEL（ws_hub mock）；interactive lease 走 SESSION_END（不发 LEASE_CANCEL）
11. [daemon-test] 收 LEASE_CANCEL 触发 `taskRunner.cancel`；与心跳轮询双触发幂等（R-06）

## Phase 3 · Budget 执行循环检查点（FR-05/D-006/D-009）

12. [backend] `LeaseCtx` claim payload 加 `budget_tokens: int | None`；`execution.py` dispatch_worker/batch dispatch 从 `AgentMission.budget_tokens` 下发
13. [gen:types] 后端 DTO 改后跑 `pnpm gen:types`，提交 `api-types.ts`（双端）+ `openapi.json`（CLAUDE.md 规则 20；先确认 node_modules 健康）
14. [daemon] `types.ts` `LeaseCtx` 加 `budget_tokens?: number`
15. [daemon] `task-runner.ts`：**新增 batch token 累计器**（input_tokens + output_tokens，per-run，不含 cache；D-009）——当前 task-runner 无累计器；`session-manager.ts` 复用现有 input/output 累计器
16. [daemon] `task-runner.ts`/`session-manager.ts`：执行循环检查点（累计 input+output ≥ budget → `overBudget` flag + 回传 `budget_exceeded` + usage；当前 turn/step 完成后终止，软切断 D-006）
17. [backend-test] dispatch 下发 budget_tokens 到 claim payload
18. [daemon-test] 超 budget 软切断（不调 close/kill，当前 turn 完成后终止）；budget=None 短路；input+output 口径正确（不含 cache）

## Phase 4 · 轻量终态确认（FR-04/D-007，含 XC-03/04/08 修正）

19. [backend] `DaemonTaskLease` 加 `terminating_at: datetime | None` + Alembic migration（先 `alembic heads` 确认单 head，R-05）
20. [backend] `cancel_lease` 写 `terminating_at`（**仅 cancel_lease**；end_session 同事务即 completed 不写，XC-03）；`complete_lease`/`notifySessionEnd` 收到回传即清
21. [backend] 新增 sweeper：**独立查询** `terminating_at IS NOT NULL`（**不并入** `expire_overdue_leases`，XC-08），超 30s 无回传 → 告警 + 标记（不改 lease.status，D-007）
22. [backend-test] terminating_at 写（仅 cancel）/清时序；sweeper 超时告警（mock 时钟）；end_session 不写 terminating_at

## Phase 5 · 前端最小（FR-04 展示侧 + R-08）

23. [frontend] `interactive-session-panel.tsx`：lease `terminating` 态（`terminating_at` 非空）显示"终止中…"而非立刻"已停止"；确认"打断本轮"与"取消 run"两按钮文案/反馈对齐（R-08）
24. [gen:types] 前端 api-types.ts 同步（与 task 13 合并）

## 跨切 · 文档（FR-08）

25. [doc] 更新 scan CONCERNS.md：标原 P0-1/P0-2 已修（commit 引用）+ 本次新机制（LEASE_CANCEL / cancel→END / budget / terminating_at）
26. [doc] 更新 protocol 双端消息表（新增 LEASE_CANCEL；SESSION_INTERRUPT 收窄、SESSION_END 扩大用范围）+ QUICKLOG 记录本次关键修复点
