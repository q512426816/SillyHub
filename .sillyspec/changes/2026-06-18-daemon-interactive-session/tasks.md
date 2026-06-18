---
author: qinyi
created_at: 2026-06-18 13:54:52
---

# Tasks — 交互式会话管控

任务按 Wave 分组（execute 阶段拆 Wave/依赖）。每任务列名称、关键文件、覆盖的 FR/D；细节在 plan 阶段展开。

## Wave 1 — 核心交互（中途追问/多轮注入）

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T1.1 | 数据模型迁移：agent_sessions 表 + lease.kind + agent_runs.agent_session_id | `backend/app/modules/agent/model.py`、`backend/app/modules/daemon/model.py`、alembic 迁移 | FR-01, FR-09 / D-001, D-002, D-005 |
| T1.2 | 协议契约：新增 WS 控制消息常量 + payload（daemon 与 backend 对端） | `sillyhub-daemon/src/protocol.ts`、`backend/app/modules/daemon/protocol.py` + 契约单测 | FR-02, FR-04, FR-05 / NFR-05 |
| T1.3 | daemon sessionStore + task-runner session 模式（result 不 end stdin） | `sillyhub-daemon/src/session-store.ts`(新)、`task-runner.ts`、`daemon.ts`(kind 分流) | FR-01, FR-02, FR-09 / D-002 |
| T1.4 | daemon ws-client 接收控制消息 + 路由到 sessionStore（inject/interrupt/end） | `ws-client.ts`、`daemon.ts` | FR-02, FR-04, FR-05 |
| T1.5 | backend session REST + service + WS 控制路由（create/inject/interrupt/end） | `backend/.../daemon/router.py`、`service.py`、`ws_hub.py`(send_session_control)、`agent/placement.py` | FR-01, FR-02, FR-04, FR-05 |
| T1.6 | session 级 SSE 聚合：Redis channel `agent_session:{id}` + stream_session_logs + submit_messages 双 publish | `backend/.../agent/service.py`、`daemon/service.py`、`router.py` | FR-03 / D-005, R-08 |
| T1.7 | quick-chat 端点升级：首 prompt 创建 AgentSession + interactive lease；后续走 inject | `backend/app/main.py` | FR-01, FR-02 |
| T1.8 | R-01 端到端铁证验证：claude/codex stream-json 两轮 result（补网关 529 铁证） | 手动验证 + 集成测试 | R-01 / 成功标准 7 |
| T1.9 | 空闲自动回收（session_idle_timeout_sec，默认 30min） | `session-store.ts`、`service.py`(end_session) | FR-06 / D-004 |

## Wave 2 — 权限暂停往返

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T2.1 | manual_approval 开关 + permission_request/response WS 消息（两端） | `protocol.ts`、`protocol.py`、`agent_sessions.config` | FR-07 / Q3 |
| T2.2 | claude stream-json control_request 暂停往返（manual 模式不发 allow） | `adapters/stream-json.ts`、`session-store.ts`(pending permission map) | FR-07 |
| T2.3 | codex json-rpc approval 暂停往返 | `adapters/json-rpc.ts` | FR-07 |
| T2.4 | 前端权限批准弹窗（订阅 permission_request） | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts` | FR-07 / FR-10 |

## Wave 3 — resume 持久化 + 崩溃恢复

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T3.1 | daemon sessionStore 磁盘持久化（sessions.json） | `session-store.ts`(persist/restore) | FR-08 / D-003 |
| T3.2 | 重启 resume 恢复：claude --resume / codex thread/resume 重 spawn | `session-store.ts`、`task-runner.ts`、`adapters/*` | FR-08 |
| T3.3 | reconnecting 状态 + backend 同步 | `model.py`(status 枚举)、`service.py` | FR-08 |

## Wave 4 — 前端管控台

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T4.1 | 会话面板：SSE 进度 + 中途追问输入框 + 打断/结束按钮 | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts`(createSession/inject/interrupt/endSession/streamSession) | FR-10 |
| T4.2 | 会话列表 + 历史回看（agent_sessions + AgentRunLog） | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts`、backend 列表端点 | FR-10 |

## 跨 Wave 共性

- 所有新增 WS 消息类型必须 daemon `protocol.ts` ↔ backend `protocol.py` 逐字对齐 + 契约单测（延续现有 `stream-json.ts` / `protocol.py` 的对端约定）。
- daemon 实际为 TypeScript（pnpm + vitest），local.yaml/scan 文档标的 Python 已过时——execute 时用 `cd sillyhub-daemon && pnpm test`，勿用 `pip/pytest`。
- 每个 Wave 独立验收（见 design.md §12 验收标准），Wave 间通过 sessionStore/WS 消息接口解耦。
