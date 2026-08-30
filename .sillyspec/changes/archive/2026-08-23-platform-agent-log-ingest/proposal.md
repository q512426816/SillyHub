---
author: qinyi
created_at: 2026-08-23 04:50:00
---

# 提案书（Proposal）— 平台承接 Agent 日志上报（platform-agent-log-ingest）

## 动机

SillySpec CLI 侧已完成「本地 agent 会话日志主动 REST 上报」改造（CLI 仓 `src/agent-session-log.js`，协议文档 `docs/platform-agent-log-protocol.md`）：agent 每次调 `sillyspec run` 时探测本地 harness 日志（codex rollout / claude-code transcript / zcode model-io），立即 `POST {platform}/api/agent-logs` 上报**路径 + 元信息**（不发内容）。本仓库（SillyHub 平台）后端尚无该端点——CLI 实测收到 404（优雅降级留底），会话视图也看不到 agent 的真实执行日志线索。平台会话目前只能看 CLI 内部阶段信息，完整模型 I/O 都在 agent 本机日志文件里，运维排障时无从定位。

## 关键问题

1. **写通道缺失**：`POST /api/agent-logs` 端点不存在，CLI 上报全部 404 丢弃，平台侧没有任何 agent 日志元数据落库。
2. **会话视图盲区**：会话详情（SessionPanelPage）只有对话流与团队任务块，看不到「这个会话的 agent 在本机写了哪些日志文件、多大、最后活跃时间、跑的最后一条 sillyspec 命令」——而这些恰是排查 agent 执行问题的一手线索。

## 变更范围

- **后端（platform_sync 模块扩展，与 quicklog-entries 同构）**：
  - 新表 `platform_agent_logs`：`(workspace_id, log_path)` 复合唯一键 upsert，整行存 entry 元信息（harness/format/session_id/originator/detected_via/agent_cwd/exists/size_bytes/mtime_ms/first_seen_at/last_seen_at/invocations/last_command/scan_run_id），alembic 迁移。
  - `POST /api/agent-logs`：写端点，鉴权与 `POST /changes/{name}/progress` 同规（仅 `shpsync_` token 可写，workspace 由 token 派生，body 的 workspace_id 不信任；JWT/`shk_live_` 403、无凭据 401）。
  - `GET /api/agent-logs`：读通道（供前端面板），JWT 读权限（CHANGE_READ 并集）/shpsync_ 单 workspace，按 workspace 过滤、`last_seen_at` 新→旧。
- **前端（会话详情新增卡片）**：
  - `SessionPanelPage` 挂「本地 Agent 日志」卡片（模式 A 小卡片，先例 change-sessions-card）：harness 徽标 / session_id（点击复制）/ originator / 大小 / 活跃时间 / 调用次数 / 最近命令 / 日志路径（点击复制）；空态与折叠态。
  - `src/lib/agent-logs.ts` API 封装；`pnpm gen:types` 同步 `api-types.ts` + `backend/openapi.json`。

## 非目标（Non-Goals）

- **不做日志内容展示**：daemon 按路径增量 tail + 按 format 解析渲染（协议 §1.3）是可选增强，本次不做；面板只列元信息。
- **不做 daemon 派发记录与 agent session_id 的自动对齐**（协议提及 `originator="sillyhub-daemon"` 可人工比对，不建关联表）。
- **不做服务端 TTL/清理任务**：每 workspace 活跃日志条目量级 ≤10（CLI 侧产物上限），与 quicklog_entries 同口径不加清理。
- **不改 CLI 侧任何行为**（CLI 已实现并测试完毕，本变更纯平台端承接）。
- **不做生命周期状态机改动**：不触碰 session/lease/agent_run/daemon 任何状态。

## 风险

- CLI 上报高频（每次 `sillyspec run` 都推）→ upsert 幂等吸收，量级 = 每 workspace 活跃日志文件数，无膨胀风险（D-005/D-007）。
- CLI 字段演进（schema_version 升级新增字段）→ schema `extra=ignore` 宽松接收不 422，未知字段暂不落库（D-002），升版时再加列。
