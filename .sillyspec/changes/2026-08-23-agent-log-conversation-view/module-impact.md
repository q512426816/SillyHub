---
author: qinyi
created_at: 2026-08-23 21:20:00
---

# 模块影响分析（Module Impact）— 本地 Agent 会话日志对话化回显（zcode MVP）

> 首版生成于 plan 阶段（输入=design.md 文件变更清单 + plan.md 任务列表）；execute/verify 阶段回填更新结果，archive 阶段终审。

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| daemon（backend/app/modules/daemon + sillyhub-daemon） | 修改 + 新增 | 新增 src/agent-log/{parse-zcode-model-io,registry}.ts 与 tests/agent-log/；修改 host-fs-handler.ts 增 readAgentLogMessages 方法（task-01/02） |
| platform_sync | 修改 + 新增 | router.py 新增 GET /agent-logs/{id}/messages 并抽 content 端点共享 helper；schema.py 增 AgentLogMessagesResponse/AgentLogMessageItem；新增 tests/test_agent_log_messages.py（task-03） |
| frontend_lib | 修改 | lib/agent-logs.ts 增 readAgentLogMessages；api-types.ts 随 pnpm gen:types 再生成（task-04） |
| frontend_components | 修改 | agent-log-card.tsx 查看内容面板对话化渲染 + 全场景回落；__tests__/agent-log-card.test.tsx 改写（task-05） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/openapi.json | 生成物（OpenAPI 导出），随 task-04 `pnpm gen:types` 再生成提交，不手改 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/daemon.md` | 更新 daemon 模块卡（新增 agent-log 解析器与 read_agent_log_messages RPC） | done |
| `modules/platform_sync.md` | 更新 platform_sync 模块卡（新 messages 端点与共享 helper） | done |
| `modules/frontend_lib.md` | 更新 frontend_lib 模块卡（readAgentLogMessages） | done |
| `modules/frontend_components.md` | 更新 frontend_components 模块卡（agent-log-card 对话化渲染） | done |
| `_module-map.yaml` | 无变化（未增删模块，仅模块内新增文件） | skipped |
