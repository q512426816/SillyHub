---
author: qinyi
created_at: 2026-06-22T13:46:00+08:00
---

# Tasks — fix-dialog-recovery-session-field

修复 AskUserQuestion 审批卡片刷新后无法恢复的 bug（fetchPendingDialogs 用错 session 字段）。

## 根因（DB 实证）
前端 `useAgentRunStream` hook 调 `fetchPendingDialogs(run.session_id)`，但 `run.session_id` 是 **daemon 内部 session id**（如 835b4558），而后端 `agent_sessions` + `session_dialog_requests` 表用的是 **AgentSession.id**（如 7e4e2139 = `run.agent_session_id`）。导致 `GET /sessions/{id}/dialogs` ownership check 查 `agent_sessions`(835b4558) 无 → 404，刷新后卡片无法恢复。

DB 证据（run 896bcf50）：agent_runs.session_id=835b4558 / agent_session_id=7e4e2139；agent_sessions 表有 7e4e2139 无 835b4558；session_dialog_requests 3 条 session_id 全是 7e4e2139（含 1 pending AskUserQuestion）。

## Tasks
- [x] task-1: `backend/app/modules/agent/schema.py` AgentRunRead 暴露 `agent_session_id: str | None = None`（映射 model.agent_session_id，model 已有此字段）
- [x] task-2: `frontend/src/lib/agent.ts` AgentRun interface 加 `agent_session_id: string | null`
- [x] task-3: `frontend/src/lib/use-agent-run-stream.ts` hook 用 `run.agent_session_id` 调 fetchPendingDialogs（为空则跳过，batch run 无 session）

## 验证
- backend mypy + ruff 过
- frontend typecheck + test 过
- 真实验收：scan run 触发 AskUserQuestion → 刷新页面 → 卡片恢复（GET /dialogs 200 返回 pending dialog）
- 改后端 schema 需重启 backend 容器生效

## 依据
backend/app/modules/daemon/permission_service.py（list_pending_dialogs:360 + _upsert_dialog_row:316）、service.py（session_id/agent_session_id 语义:1252-1255,1481-1482）。非 2026-06-22-unify-agent-run-sse-hook 引入（该变更 hook 首个在 /agent+changes 调 fetchPendingDialogs，暴露既有字段错误）。
