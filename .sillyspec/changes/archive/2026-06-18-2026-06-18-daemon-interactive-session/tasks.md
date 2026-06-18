---
author: qinyi
created_at: 2026-06-18T13:54:52
---

# Tasks — 交互式会话管控（D-002@v3 · SDK driver 层）

任务按 Wave 分组（plan 阶段细化 task-01~11 blueprint + 依赖重排）。每任务列名称、关键文件、覆盖 FR/D；细节在 plan 展开。

## Wave 1 — 核心交互（SDK driver + session + lease 分流 + SSE）

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T1.1 | 数据模型迁移：agent_sessions 表 + lease.kind + agent_runs.agent_session_id | `backend/.../agent/model.py`、`backend/.../daemon/model.py`、alembic | FR-01, FR-09 / D-001, D-002@v3, D-005 |
| T1.2 | 协议契约：session/permission WS 控制消息常量 + payload（daemon↔backend 对端）+ 契约单测 | `sillyhub-daemon/src/protocol.ts`、`backend/.../daemon/protocol.py` | FR-02, FR-04, FR-05, FR-07 / NFR-05 |
| T1.3 | **daemon ClaudeSdkDriver**：封装 SDK `query(AsyncIterable)`，`pathToClaudeCodeExecutable`=系统 claude（D-009），result→AgentRun 映射，interrupt | `sillyhub-daemon/src/interactive/claude-sdk-driver.ts`(新)、`package.json`+`.npmrc`(加 SDK 主包排平台二进制) | FR-01, FR-02, FR-04 / D-002@v3, D-009 |
| T1.4 | **daemon SessionManager + input-queue**：session 生命周期 + 内存 SessionStore + AsyncIterable turn 级串行 | `sillyhub-daemon/src/interactive/session-manager.ts`(新)、`input-queue.ts`(新)、`daemon.ts`(lease.kind 分流) | FR-01, FR-02, FR-04, FR-09 |
| T1.5 | daemon 接收 interrupt/end 控制并路由到 SessionManager | `ws-client.ts`、`daemon.ts` | FR-04, FR-05 |
| T1.6 | backend session REST + service：create/inject 创建 AgentRun 并 dispatch，interrupt/end，end_session 统一入口 | `backend/.../daemon/router.py`、`service.py`、`agent/placement.py` | FR-01, FR-02, FR-04, FR-05 |
| T1.7 | session 级 SSE 聚合：submit_messages 双 publish + stream_session_logs（Redis `agent_session:{id}`） | `backend/.../agent/service.py`、`daemon/service.py`、`router.py` | FR-03 / D-005, R-08 |
| T1.8 | quick-chat 端点升级：首 prompt 创建 AgentSession + interactive lease；后续走 inject | `backend/app/main.py` | FR-01, FR-02 |
| T1.9 | **R-exe 补验**：显式 `pathToClaudeCodeExecutable`=系统 claude.CMD 跑通（复用 `%TEMP%\claude-sdk-spike` 脚本对照） | spike 脚本 + 集成测试 | R-exe / 成功标准 5 |
| T1.10 | 空闲自动回收（session_idle_timeout_sec 默认 30min） | `session-manager.ts`、`service.py`(end_session) | FR-06 / D-004 |

## Wave 2 — canUseTool 远程人审 + GLM 错误透传

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T2.1 | ClaudeSdkDriver `canUseTool` 回调接远程人审：WS permission_request → backend → 前端 → permission_response → resolve（5min 超时 deny） | `claude-sdk-driver.ts`、`ws-client.ts`、`protocol.ts`、`backend/.../daemon/{router,service,ws_hub}.py` | FR-07 / D-007 |
| T2.2 | 前端权限批准弹窗（订阅 permission_request，allow/deny 回传） | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts` | FR-07 / FR-10 |
| T2.3 | GLM 工具失败错误透传验证（tool_result is_error 返模型，不阻断） | `claude-sdk-driver.ts` + 集成测试 | FR-08b / D-008, R-GLM |

## Wave 3 — resume 持久化 + 崩溃恢复

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T3.1 | daemon SessionStore 元数据磁盘持久化（sessions.json：session_id/lease_id/agent_session_id/cwd） | `session-manager.ts`(persist/restore) | FR-08 / D-003 |
| T3.2 | 重启恢复：加载元数据 + currentRun 失败收敛 + `query({resume:agent_session_id})` 恢复（固定 cwd） | `session-manager.ts`、`claude-sdk-driver.ts` | FR-08 / spike D3 |
| T3.3 | reconnecting 状态 + backend 同步 | `model.py`(status 枚举)、`service.py` | FR-08 |

## Wave 4 — 前端管控台

| ID | 任务 | 关键文件 | 覆盖 |
|---|---|---|---|
| T4.1 | 会话面板：session SSE 进度 + 中途追问输入框 + 打断/结束按钮 | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts`(createSession/inject/interrupt/endSession/streamSession) | FR-10 |
| T4.2 | 会话列表 + 历史回看（agent_sessions + AgentRunLog） | `frontend/.../runtimes/page.tsx`、`lib/daemon.ts`、backend 列表端点 | FR-10 |

## 跨 Wave 共性

- **决策覆盖**：D-001@v1（AgentSession 命名）、D-002@v3（driver 与 TaskRunner 并存）、D-003@v1（Wave1/2 不恢复）、D-004@v1（空闲 30min）、D-005@v1（三元关系+SSE）、D-006@v1（全栈范围）、D-007@v1（canUseTool 远程人审）、D-008@v1（GLM 错误透传）、D-009@v1（系统 claude.CMD）—— 详见 decisions.md。
- 所有新增 WS 消息类型必须 daemon `protocol.ts` ↔ backend `protocol.py` 逐字对齐 + 契约单测。
- daemon 实际为 TypeScript（pnpm + vitest），scan/local.yaml 标的 Python 已过时——execute 用 `cd sillyhub-daemon && pnpm test`，勿用 pip/pytest。
- daemon `package.json` 加 `@anthropic-ai/claude-agent-sdk` 主包 + `.npmrc optional=false` 排平台二进制（D-009）。
- 每个 Wave 独立验收（design.md §12），Wave 间通过 SessionStore/WS 消息接口解耦。
- task-03/06/07/08/09 按 v3 重做（v2 蓝图废弃），task-01/04/05/10/11 框架保留（plan 阶段核定）。
