---
author: qinyi
created_at: 2026-08-22 03:36:40
---

# 模块影响分析（Module Impact）— 会话内团队操作

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | agent 模块（model/mission/orchestrator/mcp_tools/execution/finalizer/patrol/control/router）+ daemon 模块（router/schema/session service）+ alembic 迁移：mission 绑定会话、主控轮双标记、懒建/converge 新语义、awaiting_input 状态、治理门判别、删 create/list 端点（task-01~08、13） |
| sillyhub-daemon | 修改 | cli.ts 注入谓词、mcp-config/session-manager env 注入、mcp-server 工具参数可选化+描述重写、hub-client X-Session-Id（task-09/10；spike-01 验证 env 透传） |
| frontend | 修改 | session-panel/interactive-session-panel 触发入口与挂载、新组件 team-task-block/team-trigger-popover、turn-segment-views 分身段块、lib/daemon.ts 与 lib/agent.ts client、删 mission-console+两路由+菜单（task-11~13） |
| backend | 依赖变更 | /sessions 列表与新建表单无变化；team-progress.tsx 依赖的 GET /missions/{id}、cancel 端点保留（D-011） |

## 未匹配文件

无（design §6 全部源码文件均落入 backend / sillyhub-daemon / frontend 三模块路径）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（mission 会话绑定/双标记/converge 语义/端点增删） | pending |
| `modules/sillyhub-daemon.md` | 更新 daemon 模块卡（注入谓词/MCP 会话上下文） | pending |
| `modules/frontend.md` | 更新 frontend 模块卡（TeamTaskBlock/触发入口/删旧页面） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
