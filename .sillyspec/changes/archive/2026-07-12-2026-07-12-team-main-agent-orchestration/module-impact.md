# 模块影响分析（Module Impact）— team 主 agent 真 agent 动态编排

author: qinyi
created_at: 2026-07-12 21:12:00

变更 `2026-07-12-team-main-agent-orchestration`（v2，主 agent 动态编排）。基于 _module-map.yaml 顶层模块 + proposal/design/tasks 三重交叉验证。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 新增 + 逻辑变更 + 数据结构 | backend/app/modules/agent/{orchestrator.py(新), mcp_tools.py(新), execution.py, finalizer.py, router.py, model.py, mission_schema.py} + backend/migrations/versions/20260712_team_orch.py | OrchestratorService 主 agent 编排（team_mission_entry 旁路 GLM planner + schedule_loop 三重收敛 worker 全终态/主 agent 自主/budget 硬截断）+ mcp_tools 5 endpoint（dispatch_worker/get_worker_result/list_workers/converge_mission/report_progress，P0 鉴权 apiKey 经 X-API-Key）+ execution patch 采集 + finalizer converge 路由 + model AgentMission worker_preset/main_agent_config + AgentRun role=orchestrator/worktree_branch + migration 20260712_team_orch | false |
| frontend | 新增 + 逻辑变更 | frontend/src/components/{stage-team-config.tsx(新), team-progress.tsx(新)} + frontend/src/app/(dashboard)/workspaces/[id]/changes/[cid]/page.tsx + interactive-session-panel + lib/agent.ts + mission-console | TeamConfigPanel（主 agent 类型/模型 + worker 列表）+ team-progress（决策日志 + worker 进度 + CostBar）+ changes/[cid] page 三入口 team toggle + interactive-session-panel「用团队分析」+ lib/agent.ts CreateMissionInput worker_preset/main_agent_config | false |
| sillyhub-daemon | 新增 + 逻辑变更 + 配置 | sillyhub-daemon/src/{mcp-server.ts(新), mcp-config.ts, hub-client.ts, interactive/session-manager.ts, interactive/driver.ts, interactive/types.ts, cli.ts, daemon.ts, types.ts} | 内置 stdio MCP server 5 tool（createMcpServer/runMcpServer + errorContent 结构化错误）+ buildDaemonMcpServerConfig（fileURLToPath 推导 dist 绝对路径 + platform_default 注入）+ hub-client 5 方法（X-API-Key/apiKey 双路径鉴权）+ session-manager MCP 注入（isMainAgentSession 谓词 + mainAgentMcpConfigProvider + stage 持久化 create/restore 双路径）+ driver mcpServers 透传 Claude SDK options.mcpServers + cli MCP_SERVER_BACKEND_URL/DAEMON_API_KEY/DAEMON_TOKEN env 注入。P1 修复 mcp-server.ts isMain pathToFileURL（commit 7369903b Windows 兼容） | false |
| spikes | 新增 | sillyhub-daemon/spikes/06-mcp-server/{server.ts, spike.test.ts, README.md} | spike-01 MCP server 可行性验证（@modelcontextprotocol/sdk 1.29 + zod，5 test passed，验证 stdio MCP server + 1 tool 协议链路，不退方案 A） | false |

## 未匹配文件

无。所有变更文件都在 backend/frontend/sillyhub-daemon/spikes 模块 paths 内。

## 模块文档同步状态

- backend.md 变更索引：✅ 已加 2026-07-12-team-main-agent-orchestration 条目（task-13 文档同步）
- frontend.md 变更索引：✅ 已加
- sillyhub-daemon.md 变更索引：✅ 已加
- spikes.md：spike-01 非生产代码，未同步（可选）

## 备注

- task-04b（per-worker worktree）拆出新变更，本变更不含 daemon host_fs handler 改动
- mode=single/None 零回归（v1 原路径，不走 OrchestratorService）
