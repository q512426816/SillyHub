---
id: task-03
title: 挂载 GET /api/workspaces/{id}/dialogs 路由（agent router）
title_zh: 工作区级对话查询端点
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-02]
blocks: [task-04, task-05]
allowed_paths:
  - backend/app/modules/agent/router.py
provides:
  fields: ["GET /api/workspaces/{workspace_id}/dialogs"]
expects_from:
  task-02:
    needs: [list_pending_dialogs_for_workspace]
---

# task-03 · 工作区级对话查询端点

## 目标

在 `agent/router.py` 挂载只读端点 `GET /workspaces/{workspace_id}/dialogs`，返回该 workspace 下所有 active session 的 **pending** `SessionDialogRequest`（含 D-002/D-003 来源上下文字段），供审批中心 `/approvals` 数据兜底 + 刷新不丢（design §4.1 / §4.3 / FR-5）。

## 实现依据

- 端点归属（C7 修正，design §4.1 / §9）：**挂 `agent/router.py`**（workspace-aware router，最终 URL 落地 `/api/workspaces/{workspace_id}/dialogs`）。**不挂 daemon router**——daemon router 的 `prefix=/daemon` 会把 URL 变形为 `/daemon/workspaces/{id}/dialogs`，与前端 `lib/daemon.ts` 的 `listWorkspaceDialogs` 契约不符。
- 权限域（C7，design §4.1）：与 `/workspaces/{workspace_id}/agent-sessions`（router.py:507-531）**同模式**，用 `require_permission(Permission.TASK_READ)` 从 `{workspace_id}` 路径参数做 workspace 成员校验。
  - `require_permission`（core/auth_deps.py:100-121）内部 `_checker` 取 `workspace_id: Annotated[uuid.UUID, Path(...)]` 调 `has_permission`，非成员直接 raise `PermissionDenied`（403）——**只读端点复用现有读权限域，无需新权限**。
- 跨模块读：端点挂 agent router，但实现委托 daemon `DaemonPermissionService.list_pending_dialogs_for_workspace(workspace_id, user_id)`（task-02 提供，design §9「跨模块读已有先例：permission_service.py:211 import AgentSession」）。

## 实现步骤

1. 在 `agent/router.py` 顶部 import 补充：`DaemonPermissionService`（from `app.modules.daemon.permission_service`）+ `WorkspaceDialogRead`（from `app.modules.daemon.schema`，task-02 产出）。
2. 仿 `list_workspace_agent_sessions`（router.py:507-531）追加端点：
   ```python
   @router.get(
       "/workspaces/{workspace_id}/dialogs",
       response_model=list[WorkspaceDialogRead],
   )
   async def list_workspace_dialogs(
       workspace_id: uuid.UUID,
       session: SessionDep,
       user: Annotated[User, Depends(require_permission(Permission.TASK_READ))],
   ) -> list[WorkspaceDialogRead]:
       svc = DaemonPermissionService(session)
       dialogs = await svc.list_pending_dialogs_for_workspace(workspace_id, user.id)
       return [WorkspaceDialogRead.from_model(d) for d in dialogs]
   ```
   （`from_model` 形态以 task-02 实际导出为准，可能直接 return service 结果——对齐 task-02 的 `provides`。）
3. 返回类型 `list[WorkspaceDialogRead]`，FastAPI 自动序列化（response_model 已约束），无需手写 dict。

## 验收标准

- **AC-1**：端点 URL 落地 `/api/workspaces/{workspace_id}/dialogs`（agent router 默认 `/api` 前缀，非 `/daemon`）。
- **AC-2**：非 workspace 成员访问返回 **403**（`PermissionDenied`，经 `require_permission(TASK_READ)`）。
- **AC-3**：返回 pending `SessionDialogRequest` 列表，每项含来源字段（workspace_id/workspace_name/session_type/run_summary，D-003 全可选）；跨 session 聚合（design AC-7）。
- **AC-4**：只读，不触碰 `SessionDialogRequest` 写路径 / daemon PERMISSION_REQUEST 链路（D-001）。

## 验证

```bash
cd backend
uv run pytest -q app/modules/agent/
uv run pytest -q app/modules/agent/test_router.py   # 改 router 必跑 test_router（不只 test_service，见 [[backend-router-change-run-router-tests]]）
uv run mypy app
```

## 约束

- 仅改 `backend/app/modules/agent/router.py`（allowed_paths 收口）。
- 遵循 **D-001**：只读查询，不修改既有 PERMISSION_REQUEST 持久化链路。
- 遵循 **D-003**：来源字段（session_type/run_summary）由 task-02 service 层推导，本端点只做透传 + 序列化。
- UI/注释中文。
