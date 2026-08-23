---
author: qinyi
created_at: 2026-08-23 12:23:00
---

# 任务清单（Tasks）— 工具上报 Agent 日志会话化

- [x] task-01: [repo: sillyspec] CLI 协议上下文上报——上报块移至 changeName/quickSessionId 解析后（Grill P1-3）传 context；entry 级 ctx 持久化与透传（存量 entry 保留原 ctx，Grill P1-5）+ hub_session_id（env）+ 协议文档增补 + mock fetch 测试 (depends_on: —)
- [x] task-02: daemon env 注入——buildSpawnEnv 层注入 SILLYHUB_SESSION_ID（create 路径 execPayload.agentSessionId + restore/_reloadSession 两处 state.sessionId，Grill P1-4；注入层在 tool_config 之上）+ 三路径注入/缺省测试（主仓任务，sillyhub-daemon/ 目录） (depends_on: —)
- [x] task-03: [repo: main] 后端数据层——agent_sessions 加 origin/aggregation_key/title 列（title NULL 兼容，router 派生改 session.title 优先）、platform_agent_logs 加 agent_session_id FK、迁移 20260823120000 + conftest 建表扩展 (depends_on: —)
- [x] task-04: [repo: main] 后端归属服务——schema v2（body 级 hub_session_id + entry 级 change_key/quick_id）+ upsert 扩展（hub 关联/跨ws降级、无 hub 按 (harness, entry.ctx) 分组 find-or-create tool_report 会话）+ GET 增 session_id 过滤 + pytest（关联命中/降级/聚合幂等/entry 级 ctx 分组/无ctx单桶） (depends_on: task-03)
- [ ] task-05: [repo: main] 后端激活与内容——inject 懒激活分支（prepare 自选机器 D-010/provider 映射/cwd/turn_count=1/AppError 包装离线）+ AgentSessionRead.origin 下发（列表+详情）+ GET /api/agent-logs/{id}/content（直连 ws_rpc 不走 degrade/字节截断/format 门控/404-409-503-504）+ pytest（app/modules/daemon/tests/ 平铺：激活成功/离线闭环/已激活直通/内容四类失败） (depends_on: task-04)
- [ ] task-06: [repo: main] 前端类型同步——pnpm gen:types（origin/title/新 schema/内容端点） (depends_on: task-05)
- [ ] task-07: [repo: main] 前端会话化——listAgentLogs(sessionId)+query-keys 键改造 + AgentLogCard 会话驱动 + AgentLogSessionBody 主体（查看内容交互）+ 列表 🧾 徽标 + SessionPanelPage turn_count===0&&origin 分支与旧 workspace 挂载移除 + vitest (depends_on: task-06)
- [ ] task-08: 三仓全量回归 + Docker 部署 + 端到端实证（本机直跑 sillyspec → 平台 🧾 会话出现并可继续对话；daemon 会话内跑 → 关联条目；变更 B 日志不串到变更 A 会话）+ runtime-evidence 留档 (depends_on: task-01, task-02, task-07)
