---
author: qinyi
created_at: 2026-08-23 04:50:00
---

# 任务清单（Tasks）— 平台承接 Agent 日志上报

- [x] task-01: 后端模型层——`AgentSessionLogORM`（platform_agent_logs 表，(workspace_id, log_path) 唯一约束）+ alembic 迁移 20260823090000（接 20260822090000）+ platform_sync tests conftest 建表扩展 (depends_on: —)
- [x] task-02: 后端接口层——schema（AgentLogEntry/AgentLogPushRequest/AgentLogPushOk/AgentLogListItem/AgentLogListResponse，extra=ignore）+ service（upsert_agent_log_entries 单事务批量幂等 / list_agent_logs scope 过滤 + last_seen_at 倒序）+ router（POST /agent-logs _write_auth fail-closed、GET /agent-logs _read_auth）+ pytest（鉴权矩阵/幂等/批量/跨 workspace/422/GET scope） (depends_on: task-01)
- [x] task-03: 类型同步——`pnpm gen:types` 重生成 `frontend/src/lib/api-types.ts` + `backend/openapi.json` (depends_on: task-02)
- [x] task-04: 前端——`src/lib/agent-logs.ts`（listAgentLogs + query-keys 工厂 agentLogs 键）+ `agent-log-card.tsx` 组件（三态：列表/空态/折叠，复制交互，双主题 brand 阶，dayjs.extend(relativeTime)）+ SessionPanelPage 挂载（workspace_id null 守卫）+ vitest 组件测试 (depends_on: task-03)
- [x] task-05: 全量回归与端到端实证——backend pytest + ruff + mypy、frontend vitest + tsc + lint；本地起后端跑真实 `sillyspec status` 验证 CLI 上报 200 落库（对齐上一会话 404 基线） (depends_on: task-04)
