---
id: task-02
title: 新增 list_pending_dialogs_for_workspace 读方法（三表 JOIN + 上下文推导）
title_zh: 工作区级 pending 对话查询读方法
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-01]
blocks: [task-03]
allowed_paths:
  - backend/app/modules/daemon/permission_service.py
provides:
  fields: [list_pending_dialogs_for_workspace]
expects_from:
  task-01:
    needs: [WorkspaceDialogRead]
---

## 目标

在 `DaemonPermissionService`（`backend/app/modules/daemon/permission_service.py`）新增只读方法 `list_pending_dialogs_for_workspace(workspace_id, user_id) -> list[WorkspaceDialogRead]`：聚合 workspace 下所有 session 的 pending `SessionDialogRequest` + 来源上下文（session_type / run_summary / workspace_id / workspace_name），供 task-03 挂在 `GET /api/workspaces/{id}/dialogs` 的 agent router 调用。

**只读、纯新增**（D-001）：不修改既有 `handle_permission_request` / `_upsert_dialog_row` / `list_pending_dialogs` / `respond_permission` 链路。

## 实现

### 1. JOIN 路径（复用 §3.3 + list_workspace_active_sessions 模式）

`AgentSession 无 workspace_id 列`（C1 修正），走三表 JOIN：
```
SessionDialogRequest
  → AgentRun          (on AgentRun.id == SessionDialogRequest.run_id)
  → AgentRunWorkspace (on AgentRunWorkspace.agent_run_id == AgentRun.id)
where AgentRunWorkspace.workspace_id == workspace_id
  and SessionDialogRequest.status == "pending"
```
JOIN 模式逐字参照 `agent/service.py:798-806`（`list_workspace_active_sessions`）。permission_service 跨模块读 agent 模型已有先例（:211 `from app.modules.agent.model import AgentSession`），新增 import `AgentRun` / `AgentRunWorkspace`。

### 2. session_type 推导（D-003，C3 修正）

JOIN 同行带出 `AgentRun.change_id` + AgentSession.config（经 `AgentRun.agent_session_id` 反查 AgentSession，或 JOIN 时一并取）。判定优先级：
- `change_id` 非空 → `"stage"`
- `config.get("mode") == "scan"` 且 `change_id` 为空 → `"scan"`
- 其余 → `"chat"`

### 3. run_summary 数据源（D-003，C2 修正，AgentRun 无 prompt 列）

- scan/stage：取 `DaemonTaskLease.metadata.prompt`（placement.py 写入的执行指令；经 `AgentRun.lease_id` 反查 lease）
- 对话（chat）：取首条 `channel == "user"` 的 `AgentRunLog.content_redacted`（`LIMIT 1 ORDER BY timestamp` —— 注意列名是 `content_redacted` + `timestamp`，不是 `content` / `created_at`）
- 取不到 → `None`（前端占位「会话进行中」）

lease / log 查询按 run_id 单独发，N+1 在 dialog 罕见 + pending 量小的前提下可接受（R-3）；若需优化后续可 batch。

### 4. 组装 DTO

复用 `SessionDialogRead.from_model`（:127）取既有 11 字段，再补 task-01 定义的来源字段（`workspace_id` / `workspace_name` / `session_type` / `run_summary`）构造 `WorkspaceDialogRead`。`workspace_name` 经 workspace_id 查 `Workspace` 表（跨模块读，同 AgentSession 先例）。

## 验收标准

- AC-a：JOIN 正确 —— 按 `workspace_id` 过滤，跨 session 返回所有 pending dialog（不止单 session）。
- AC-b：session_type 三类判定准（stage / scan / chat）。
- AC-c：run_summary 三分支覆盖（lease.prompt / log 首条 user / 取不到→null）。
- AC-d：只读无副作用（无 commit / 无写库 / 无 SSE publish）。
- AC-e：workspace 成员校验交由 router 层 `require_permission(TASK_READ)`（本方法不重复校验，user_id 仅留接口位以备日志/审计）。
- AC-f：空 workspace（无 pending dialog）返回 `[]` 而非 None。

## 验证

```bash
cd backend && uv run pytest -q app/modules/daemon/
cd backend && uv run mypy app
```

测试覆盖：三表 JOIN 正确性（构造跨 session 的 pending row）、session_type 三分支、run_summary 三分支 + 空兜底、workspace_id 过滤（其它 workspace 的 row 不混入）。

## 约束

- D-001：不修 PERMISSION_REQUEST 持久化链路，**只新增读方法**。
- D-003：session_type / run_summary 推导规则严格按上文（change_id 区分 stage，config.mode==scan 区分 scan，其余 chat）。
- 列名坑：`AgentRunLog` 是 `content_redacted` + `timestamp`（非 `content` / `created_at`），`AgentSession.config` 是 JSON 列取 `.get("mode")`。
- 复用 `SessionDialogRead.from_model`，不重写既有字段映射。
- 用户不太懂代码，方法 docstring 用中文 + 简明注释（参照既有 :405 `list_pending_dialogs` 风格）。
