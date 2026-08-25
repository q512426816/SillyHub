---
author: qinyi
created_at: 2026-08-25 21:20:00
---
# 模块影响分析（Module Impact）— 团队分身子会话化 P1 治理地基（会话树）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | migrations/versions 新增 20260825210000（agent_sessions 加 parent_session_id/worker_done_at + 索引）（task-01） |
| backend | 修改 | agent/model.py 加两列 + mission_worker_sessions/resolve_mission_for_session 解析（task-01） |
| backend | 修改 | agent/execution.py worktree 块抽共享 helper（task-02） |
| backend | 修改 | agent/placement.py stage 参数 + 代表 binding 钉定模式（task-03） |
| backend | 修改 | daemon/session/service.py create_session 三元组参数化（task-04） |
| backend | 修改 | agent/mission_context.py 分身简报 + worker_done DEL helper + workers_all_terminal_with_stats 判据替换（task-04/07/09） |
| backend | 修改 | agent/mission.py is_worker_complete + mission_derive_status 虚拟 run 映射（task-08） |
| backend | 修改 | agent/mcp_tools.py dispatch_worker 三元组派发 + worker_done 端点 + converge/status 判据替换（task-05/07/09） |
| backend | 修改 | agent/finalizer.py converge 沿树批量 end_session + cleanup 判据（task-09/10） |
| backend | 修改 | agent/orchestrator.py schedule_loop 信号 1 判据（task-09） |
| backend | 修改 | agent/control.py cancel 名单/并发口径/成本 union（task-11） |
| backend | 修改 | agent/patrol.py 孤儿子会话扫描（task-12） |
| backend | 修改 | daemon/router.py _team_mission_summary 子会话行化（task-09/13） |
| backend | 修改 | daemon/schema.py TeamMissionWorkerSummary 加 sub_session_id/first_run_id（task-13） |
| backend | 修改 | openapi.json gen:types 再生成（task-13） |
| sillyhub-daemon | 修改 | src/mcp-server.ts 分身受限 server（worker_done 单工具 + env 门控）（task-06） |
| sillyhub-daemon | 修改 | src/interactive/session-manager.ts mission_worker stage 注入分支（三路）（task-06） |
| frontend | 修改 | components/daemon/team-task-block.tsx 分身行点击复用 session-panel（task-14） |
| frontend | 修改 | lib/api-types.ts gen:types 再生成（task-13） |
| backend | 新增 | agent/tests/test_worker_subsession_{dispatch,done,lifecycle}.py + 8 个既有测试断言更新（task-15 等） |
| sillyhub-daemon | 新增 | tests/interactive 分身受限注入测试（task-15） |

## 未匹配文件

无（design §6 文件清单全部命中 backend / sillyhub-daemon / frontend 三模块）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | agent.md + daemon.md 补分身子会话派发链路/判据单一真相源/worker_done/create_session 参数化注意事项 | done |
| `modules/sillyhub-daemon.md`（interactive.md 细卡） | 补受限注入分支/三路生效/递归闸注意事项 | done |
| `modules/frontend.md` | 补分身行点击入口/浮层复用/零回归注意事项 | done |
| `_module-map.yaml` | 无变化（未增删模块，仅既有模块内改） | skipped |
