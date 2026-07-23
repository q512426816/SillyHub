---
author: qinyi
created_at: 2026-07-09 14:58:00
change: 2026-07-09-ask-user-question-approval
---

# 模块影响分析 · AskUserQuestion 审批中心集成

以 git diff（commit `42dd9ef9`，10 文件）为准，全部映射到已知模块。

## 模块影响矩阵

| 文件 | 模块 | 影响类型 | 说明 |
|---|---|---|---|
| backend/app/modules/agent/router.py | backend/agent | 接口变更 | 新增 `GET /workspaces/{id}/dialogs` 只读端点（require_permission TASK_READ，URL /api/workspaces/{id}/dialogs） |
| backend/app/modules/agent/service.py | backend/agent | 调用关系变更 | 挂载 dialogs 读方法到 service（+8 行薄封装转发 permission_service） |
| backend/app/modules/daemon/permission_service.py | backend/daemon·permission | 新增（逻辑） | 新增 `list_pending_dialogs_for_workspace`：三表 JOIN SessionDialogRequest→AgentRun→AgentRunWorkspace + session_type/run_summary 来源字段推导（D-003） |
| backend/app/modules/agent/tests/test_workspace_dialogs.py | backend/agent·tests | 新增 | 9 端点测试（权限 403 / JOIN / 跨 session / 上下文 / session_type 三类 / run_summary 空） |
| frontend/src/lib/daemon.ts | frontend/lib·daemon | 接口变更 | SessionPermissionRequest 加可选来源字段 + `listWorkspaceDialogs` 查询 + parseSessionPermissionEvent 兼容来源字段缺省 |
| frontend/src/components/permissions/session-permission-panel.tsx | frontend/permissions | 逻辑变更 | dialog_kind 渲染分流（AskUserDialogCard/PermissionApprovalCard）+ 按 request_id SSE/查询去重 |
| frontend/src/components/permissions/dialog-context-bar.tsx | frontend/permissions | 新增 | 来源上下文条组件（工作区/场景/会话/运行/时间/run_summary + 跳转 `/runtimes?session=`） |
| frontend/src/components/permissions/dialog-context-bar.test.tsx | frontend/permissions·tests | 新增 | 11 测试（来源条渲染/跳转/占位） |
| frontend/src/components/permissions/session-permission-panel.test.tsx | frontend/permissions·tests | 新增 | 11 测试（分流/去重/SSE 占位→查询回填） |
| frontend/src/app/(dashboard)/workspaces/[id]/approvals/page.tsx | frontend/workspaces·approvals | 逻辑变更 | 聚合范围 scan→scan+chat + refetchInterval ~10s 调 listWorkspaceDialogs 兜底（刷新不丢） |

## 未匹配文件

无。所有 10 个改动文件均映射到 backend/agent、backend/daemon、frontend/permissions、frontend/lib、frontend/workspaces 已知模块。

## 影响类型汇总

- **新增**：5（1 backend 读方法 + 1 backend test 套 + 1 前端组件 + 2 前端 test 套）
- **接口变更**：2（backend 新端点 + frontend 类型/查询 lib）
- **逻辑变更**：3（permission_service JOIN 读方法 + session-permission-panel 分流 + approvals 聚合）
- **调用关系变更**：1（agent service 挂载读方法）

## 模块文档同步

本变更新增只读端点 + 前端展示组件，不改既有模块核心职责/数据结构（D-001 隔离：不动 PERMISSION_REQUEST 持久化链路）。permissions 模块的「AskUserQuestion 来源展示」能力属增量，模块卡片可在后续补充，非阻塞归档（archive-impact.yaml doc-syncer 输出 required: false）。
