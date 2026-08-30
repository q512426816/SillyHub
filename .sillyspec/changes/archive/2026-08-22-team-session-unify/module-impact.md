---
author: qinyi
created_at: 2026-08-22 03:36:40
---

# 模块影响分析（Module Impact）— 会话内团队操作

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend | 修改 | agent 模块（model/mission/orchestrator/mcp_tools/execution/finalizer/patrol/control/router）+ daemon 模块（router/schema/session service）+ alembic 迁移：mission 绑定会话、主控轮双标记、懒建/converge 新语义、awaiting_input 状态、治理门判别、删 create/list 端点（task-01~08、13）。Wave1 已落：model.py session_id 列+部分唯一索引+迁移（e2d8e267）、control.py non_orchestrator_runs 治理口径（a3dc8ccf）、execution.py stage 常量化+lease metadata.role（f4665fa0）；Wave2 已落：mission.py derive_status awaiting_input+get_active_mission_for_session（4788bdaf）、orchestrator.py 预建模式+占位常量（720f4a48）、daemon/router.py+schema.py 触发/列表端点与 DTO（720f4a48）、daemon/session/service.py inject 双标记+占位回填（d2c7d39a）；Wave3 已落：mcp_tools.py 会话定位+懒建+三族路由+router.py include 前移遮蔽修复（25994ae4）；Wave4 已落：mcp_tools/finalizer converge 语义重定义+测试债适配（386109f1）；Wave5 已落：patrol/orchestrator 超时收敛与会话分流+core/config 新配置（8467b91c） |
| sillyhub-daemon | 修改 | cli.ts 注入谓词、mcp-config/session-manager env 注入、mcp-server 工具参数可选化+描述重写、hub-client X-Session-Id（task-09/10）。Wave1 已落：cli.ts 谓词矩阵（f4665fa0）；spike-01 PASS 确认 env 须放 mcpServers[*].env（顶层 options.env 无效）；Wave3 已落：mcp-config/session-manager env 注入链+mcp-server 工具可选化+hub-client X-Session-Id（5a8c3fc9） |
| frontend | 修改 | session-panel/interactive-session-panel 触发入口与挂载、新组件 team-task-block/team-trigger-popover、turn-segment-views 分身段块、lib/daemon.ts 与 lib/agent.ts client、删 mission-console+两路由+菜单（task-11~13）。Wave5 已落：team-task-block+分身段块+lib/daemon.ts client（65c2d547）；Wave6 已落：task-11 会话触发入口（派团队按钮+弹层+chip+/team 拦截+Codex 置灰+用团队分析改造+TeamTaskBlock 挂载 5s 轮询）（8e47dc70）；Wave7 已落：task-13 删旧入口（mission-console+两页面路由+菜单项+create/list client+GET/cancel workers 改治理口径+ppm 项目页改跳会话页）（3a3f190f） |
| backend | 依赖变更 | /sessions 列表与新建表单无变化；team-progress.tsx 依赖的 GET /missions/{id}、cancel 端点保留（D-011） |

## 未匹配文件

无（design §6 全部源码文件均落入 backend / sillyhub-daemon / frontend 三模块路径）。

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `modules/backend.md` | 更新 backend 模块卡（mission 会话绑定/双标记/converge 语义/端点增删/patrol 适配） | done |
| `modules/sillyhub-daemon.md` | 更新 daemon 模块卡（注入谓词/MCP 会话上下文） | done |
| `modules/frontend.md` | 更新 frontend 模块卡（TeamTaskBlock/触发入口/删旧页面） | done |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
