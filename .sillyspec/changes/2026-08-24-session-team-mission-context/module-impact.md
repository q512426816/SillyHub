---
author: qinyi
created_at: 2026-08-24 19:35:00
---

# 模块影响分析（Module Impact）— 会话团队任务上下文贯通

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend/agent | 修改 | orchestrator.py：抽共享 collect_scope_workspace_statuses/render_scope_brief/render_session_orchestrator_briefing（task-01，patrol 零影响）+ team_mission_entry flush-only 重构（task-04，D-009@v2）；新增 mission_context.py（task-06，首主控轮判定+简报组装）；mcp_tools.py+agent/schema.py：GET /missions/status 路由+MissionStatusResponse/ScopeWorkspaceStatus，WorkerListItem 上移 schema.py 消循环导入（task-03）；execution.py：三态探测分流+render_worker_prompt 直通变体（task-05，finalizer 零改动） |
| backend/daemon | 修改 | session/service.py：inject 路径简报前缀（task-08）+create 路径 flush-only 预建/objective 直取/首 run 双标记/create 简报前缀/E2 解析（task-09，含 binding 钉定 422）；host_fs/delegate.py：probe_workspace_git_mode 三态探测（task-02，非降级通道+stat 绝对路径）；daemon/schema.py+daemon/router.py：TeamMissionCreateBlock+SessionCreateRequest.team_mission+trigger 校验抽共享+create 端点透传（task-07/09） |
| backend/workspace | 新增 | router.py+schema.py：POST /api/workspaces/probe 批量端点（task-10，任一成员 binding 口径，git_mode+daemon_name+daemon_online） |
| sillyhub-daemon | 修改 | mcp-server.ts：注册第 6 个常驻工具 mission_status（参数可选+X-Session-Id 定位）；hub-client.ts：getMissionStatus 方法（task-11）；src/api-types.ts 再生成（task-14）。零协议变更（SESSION_INJECT 字段不动，仅 prompt 内容） |
| frontend | 修改 | team-trigger-popover.tsx：probe 一次拉取+机器名/在线 dot/git 模式标签+preSession 主 agent 选择器（task-12）；session-panel.tsx：预会话 TeamTriggerRow 解禁+payload 暂存+handlePreSessionSend 携 team_mission（task-13）；lib/daemon.ts：createSession 扩展+probeWorkspaces client（task-13）；api-types.ts 再生成（task-14） |
| 部署/协议 | 无变化 | 零 alembic 迁移（复用 agent_sessions.workspace_id 既有列）；零 daemon WS 协议新消息；旧 daemon 不升级时简报/直通/新会话派团队仍生效（mission_status 工具缺失仅损失按需查询） |

## 未匹配文件

无。design.md §6 文件清单 19 项全部归属 backend（agent/daemon/workspace 三域）/ sillyhub-daemon / frontend 三个模块；测试文件随实现模块归属。

## 更新结果

| 目标 | 操作 | 状态 |
|---|---|---|
| `modules/backend.md` | 待更新：简报注入链路/mission_status+probe 路由/三态直通/E1 预建+E2 解析（task-14 收尾同步） | pending |
| `modules/sillyhub-daemon.md` | 待更新：mission_status 第 6 工具+hub-client getMissionStatus（task-14 收尾同步） | pending |
| `modules/frontend.md` | 待更新：预会话解禁+弹层探测+client 扩展（task-14 收尾同步） | pending |
| `_module-map.yaml` | 无变化（未增删模块） | skipped |
