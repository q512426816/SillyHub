---
author: qinyi
created_at: 2026-07-09 11:32:00
change: 2026-07-09-ask-user-question-approval
---

# 任务清单（Tasks）· 初步

> 初步任务清单，plan 阶段细化为 plan.md（Wave 分组 + 依赖 + 验收）。参照 design.md §9 影响模块 + §7 AC + decisions D-001~D-003。

## backend（daemon 零改动，D-001）
- **T1**：`daemon/schema.py` 加 `WorkspaceDialogRead` DTO（扩展 `SessionDialogRead` + 来源字段 `workspace_name`/`session_type`/`run_summary`，全可选）
- **T2**：`daemon/permission_service.py` 加 `list_pending_dialogs_for_workspace(workspace_id, user_id)`——三表 JOIN（`SessionDialogRequest → AgentRun → AgentRunWorkspace`）过滤 workspace_id；session_type 推导（D-003：change_id 非空=stage / config.mode=scan=scan / 其余=chat）；run_summary 取 lease.metadata.prompt（scan/stage）或首条 user AgentRunLog（对话），空→null
- **T3**：`agent/router.py` 挂 `GET /workspaces/{id}/dialogs` 路由（`require_permission(TASK_READ)` 成员校验 + 调 T2 读方法，URL 落地 `/api/workspaces/{id}/dialogs`）
- **T4**：backend 测试——端点权限（非成员 403）/ JOIN 正确 / 跨 session / 上下文字段 / session_type 三类 / run_summary 空

## frontend
- **T5**：`lib/daemon.ts`——`SessionPermissionRequest` 加可选来源字段；新 `listWorkspaceDialogs(workspaceId)`；`parseSessionPermissionEvent` 兼容（来源字段缺省，SSE 路不解析）
- **T6**：`approvals/page.tsx`——聚合范围 scan→scan+chat（`listWorkspaceAgentSessions` 去 mode 参数）+ 初始加载 + 约 10s 定期刷新调 `listWorkspaceDialogs` 兜底（刷新不丢）
- **T7**：`permissions/session-permission-panel.tsx`——渲染按 `dialog_kind` 分流（`AskUserDialogCard` / `PermissionApprovalCard`）+ SSE 与查询按 `request_id` 合并去重（查询回填覆盖 SSE 占位）
- **T8**：新组件 `DialogContextBar`（兄弟包裹层，不侵入 AskUserDialogCard）——渲染来源上下文条（工作区/场景/会话/运行/时间/run_summary 占位）+ 跳转 `/runtimes?session=<id>` + 「查看会话」按钮；集成到 SessionPermissionPanel
- **T9**：frontend 测试——渲染分流 / 聚合去重 / 上下文条 / 跳转 / SSE 占位→查询回填

## 验收 + 非功能
- **T10**：三端集成验收（AC-1~AC-8）+ 既有行为零回归（runtime 会话弹窗 / 工具网关审批）+ 性能（list_workspace_active_sessions 加 limit top 50 + 前端 SSE 连接数硬上限，NFR-1）

## plan 阶段细化要点
- Wave 分组：W1 backend（T1-T4，端点先通）/ W2 frontend（T5-T9，依赖 T3 端点 + T5 lib）/ W3 集成验收（T10）
- 依赖：T2 依赖 T1 DTO；T3 依赖 T2；T6/T7/T8 依赖 T5；T9 依赖 T7/T8；T10 依赖全部
- 关键风险点：T2 三表 JOIN 正确性（C1）、T8 跳转路由真实（C8 `/runtimes?session=`）、T7 SSE+查询字段不对称处理（C4）
