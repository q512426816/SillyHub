---
author: qinyi
created_at: 2026-09-05 00:10:00
---

# 模块影响分析（Module Impact）— 会话任务执行面板

> 首版（plan 阶段）；execute/verify 按实际代码变更回填「更新结果」，archive 终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| daemon | 修改 | 新表 `AgentSessionTask`（model.py，18 列+唯一约束+run_id 索引+会话级联）；新 DTO `AgentSessionTaskRead`（schema.py）；新端点 `GET /sessions/{id}/tasks` 与上报端点 upsert 接线（router.py）；新 agent_task_store.py（终态定格 upsert）；新测试 test_agent_session_tasks.py |
| frontend_components | 修改 | 新组件 task-execution-panel.tsx（折叠+三页签）；归约函数抽出 agent-task-store.ts（session-panel.tsx 保留 re-export）；session-panel.tsx page/dialog/mobile 三挂载点接线；新测试 task-execution-panel.test.tsx |
| frontend_lib | 修改 | daemon.ts 新增 listSessionTasks；api-types.ts 由 pnpm gen:types 重新生成（新增 AgentSessionTaskRead） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/migrations/versions/<rev>_add_agent_session_task.py | Alembic 迁移脚本按仓惯例不映射模块；模块影响随 daemon 卡一并说明 |
| frontend/src/hooks/use-session-tasks.ts | hooks/ 目录现行映射未单列（既有 use-message-queue.ts 同例）；直接消费方为 frontend_components 面板，archive 时并入 frontend_components 文档说明 |
| backend/openapi.json | OpenAPI 生成产物（gen:types 同步输出），不映射模块 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/daemon.md` | 更新 daemon 模块卡（新表+快照端点+上报落库链路） | pending |
| `modules/frontend_components.md` | 更新前端组件卡（任务执行面板组件+归约抽出+三挂载） | pending |
| `modules/frontend_lib.md` | 更新前端 lib 卡（listSessionTasks+api-types 再生成） | pending |
| `_module-map.yaml` | 无变化（未增删模块，变更路径均落既有模块范围） | skipped |
