---
author: qinyi
created_at: 2026-08-06 13:23:21
---

# 任务清单（Tasks）

> 任务细节在 plan 阶段展开（本清单只列任务名 + 锚点）。Wave 串行（依赖），Wave 内任务可并行。文件名/类名来自 design.md §6 文件变更清单。

## Wave 1 — McpToken 鉴权地基（P2，其余 Wave 依赖）
- task-01: 新增 `mcp_tokens` 表 + ORM（`mcp_gateway/model.py`，字段见 design §8.1）
- task-02: alembic 迁移（建 `mcp_tokens` + `mcp_webhooks` + `agent_runs` 加 `read_only` 列，design §8.4）
- task-03: McpToken service（签发/校验/吊销 + Redis 缓存，复用 `ApiKeyService` 模式 `auth_deps.py:168`）
- task-04: McpToken 管理 HTTP API（POST/GET/DELETE `/workspaces/{wid}/mcp-tokens`）
- task-05: Starlette middleware（校验 `Authorization: Bearer` → 注入 workspace_id/scope 到 tool 上下文）

## Wave 2 — 对外 MCP 端点（P1）
- task-06: 加 `mcp` 官方 Python SDK 依赖（锁版本 + 早期 spike 验证 FastMCP mount + 鉴权注入，R-01/R-04）
- task-07: `mcp_gateway/server.py`（FastMCP 实例 + `http_app()` ASGI + mount 到 `/mcp`）
- task-08: `mcp_gateway/tools.py`（8 tool handler 接 service 层 + scope 校验，design §7.1）
- task-09: `main.py` 挂载 mcp_router + `app.mount("/mcp", mcp_asgi)`

## Wave 3 — read_only 物制 + 绑 profile（P3+P4）
- task-10: **端到端实测 read_only worker `--allowedTools` 现状**（CC-03/R-09，定 Phase 3 范围——派一个 read_only worker 验是否真被限 Read/Glob/Grep）
- task-11: 修 `execution.py:14-23` docstring + 厘清/补通传递链（必要时拆 `tool_config` 二义 key：tool_governance vs credential_config）
- task-12: `AgentRun.read_only` 列落记录（dispatch 时写，design §8.3）
- task-13: `DispatchWorkerRequest` 加 `agent_profile_id` + `dispatch_worker` 绑 profile + 冻结 `agent_profile_snapshot`（复用 `model.py:133-145`，不改表）
- task-14: read_only worker dispatch 流转 read_only 标志到 run

## Wave 4 — 完成通知（P5）
- task-15: `mcp_webhooks` 表 + ORM（design §8.2）
- task-16: webhook 投递器（HMAC-SHA256 签名 + 指数退避重试最多 5 次）
- task-17: `lease/service.py::DaemonService.complete_lease` 终态钩子触发 webhook（CC-08：service 层非 router）
- task-18: mission SSE 端点（`GET /workspaces/{wid}/missions/{mid}/events`，复用 `stream_agent_run_logs` 模式）

## Wave 5 — 工具补全 + 文档（P6+P7）
- task-19: `list_agent_profiles` tool（复用 `profile/router.py` 清单逻辑）
- task-20: `create_mission` tool（复用 `OrchestratorService.team_mission_entry`，CC-05 `created_by` 来源 plan 定）
- task-21: `get_run_logs` tool（查 `AgentRunLog` by run_id，字段含 `content_redacted`，CC-09）
- task-22: `docs/mcp/` 全套文档（README/getting-started/tools-reference/webhooks/sse/security）
- task-23: `pnpm gen:types` 同步 `api-types.ts` + `backend/openapi.json`（管理接口 DTO，CLAUDE.md 规则 20）
