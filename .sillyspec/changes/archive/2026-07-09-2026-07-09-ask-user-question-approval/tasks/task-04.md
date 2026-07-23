---
id: task-04
title: backend 端点测试（权限/JOIN/跨 session/上下文/session_type/run_summary）
title_zh: 工作区对话查询端点测试
author: qinyi
created_at: 2026-07-09 12:14:04
priority: P0
depends_on: [task-03]
blocks: [task-10]
allowed_paths:
  - backend/app/modules/agent/tests/test_workspace_dialogs.py
provides:
  fields: [test_workspace_dialogs]
expects_from:
  task-03:
    needs: ["GET /api/workspaces/{workspace_id}/dialogs"]
  task-02:
    needs: [list_pending_dialogs_for_workspace]
---

# task-04 · 工作区对话查询端点测试（AC-7 全分支）

## 目标

为 `GET /api/workspaces/{workspace_id}/dialogs`（task-03 挂载，task-02 实现）写 pytest 覆盖 design **AC-7 全分支**：权限校验（非成员 403 / 成员 200）、JOIN 路径正确（SessionDialogRequest→AgentRun→AgentRunWorkspace）、跨 session 聚合、来源上下文回填（session_type 三类 + run_summary 占位 null）。TDD：先写测试，红 → task-02/03 实现 → 绿。

## 实现依据

- AC-7（design §7）：backend 端点权限校验 + JOIN 路径 + 跨 session 返回上下文。
- JOIN 模式（C1 修正，design §4.1）：复用 `list_workspace_active_sessions`（service.py:798-806）三表 JOIN `AgentSession → AgentRun → AgentRunWorkspace.workspace_id`；本端点对 `SessionDialogRequest → AgentRun → AgentRunWorkspace` 同形态。
- session_type 推导（D-003，design §4.1）：stage=`AgentRun.change_id` 非空；scan=`config.mode=="scan"` 且 change_id 空；chat=其余。run_summary 取不到 → DTO 返回 `null`（前端占位「会话进行中」）。
- 测试夹具：`backend/conftest.py` 的 `client`（httpx ASGITransport + DB 路由到 in-memory SQLite）+ `auth_headers`（platform admin token）+ `db_session`（直接造数据）。成员/非成员权限测试需建 WorkspaceMember 行（`require_permission(TASK_READ)` 走 `has_permission` 校验）。
- 现有模式参考：`test_ws_hub_permission.py:207 _make_user_session`（建 User+manual_approval AgentSession+AgentRun）、`test_router.py:22 _setup`（建 workspace/change/task/user/token + AgentRunWorkspace M:N 关联）。

## 实现步骤

1. 仿 `test_router.py:_setup` 建 helper `_seed_world(db_session, tmp_path)`：Workspace + User + (WorkspaceMember for 成员；非成员用独立 User 无成员行) + Change + AgentSession + AgentRun + AgentRunWorkspace(workspace_id 关联) + SessionDialogRequest(pending, dialog_kind="AskUserQuestion")。
2. **test_权限**：非成员 token（非 is_platform_admin，无 WorkspaceMember 行）GET → 断言 **403**；成员 token GET → **200** + `list[WorkspaceDialogRead]`。
3. **test_JOIN 隔离**：两个 workspace 各一个 pending dialog（同 session 域），GET workspace A → 只返回 A 的 dialog（断言 len==1 + request_id 匹配），跨 workspace 不串。
4. **test_跨 session 聚合**：同 workspace 下两个不同 AgentSession 各一个 pending dialog → GET 返回 2 条。
5. **test_session_type 三类**：造三个 run——`change_id` 非空（断言 `session_type=="stage"`）、`config.mode=="scan"` change_id 空（`"scan"`）、`config.mode=="chat"`（`"chat"`）——各挂一个 dialog，GET 后逐项断言 session_type。
6. **test_run_summary 空**：scan/stage run 的 lease.metadata 无 prompt + 无 AgentRunLog 首条 user 消息 → DTO `run_summary is None`（占位）；附一个带 prompt 的 stage run → `run_summary == "<prompt>"`。
7. **test_只 pending**：放一个 answered + 一个 pending 的 dialog → 只返回 pending（status 过滤）。
8. 全程 SQLite in-memory；遇 PG 方言分支（如 run_summary 取 AgentRunLog 首条的 `ORDER BY created_at LIMIT 1`）写 dialect 无关查询（参考 [[backend-test-sqlite-vs-pg]]：不绑死 `date_trunc`，用 `func.min/limit` 或 Python 端排序兜底）。

## 验收标准

- 覆盖 AC-7 全分支：权限（403/200）、JOIN（跨 workspace 隔离）、跨 session 聚合、session_type 三类（scan/chat/stage）、run_summary 空占位。
- 既有 agent/daemon 测试零回归（`uv run pytest -q app/modules/agent/ app/modules/daemon/`）。
- 覆盖率门槛：`--cov=app --cov-fail-under=60`（端点 + service 读路径）。

## 验证

```bash
cd backend
uv run pytest -q app/modules/agent/tests/test_workspace_dialogs.py --cov=app --cov-fail-under=60
uv run pytest -q app/modules/agent/ app/modules/daemon/   # 零回归
```

## 约束

- **TDD**：本文件先写，跑红（端点未挂/服务未实现 → ImportError 或 404），由 task-02/03 实现转绿。
- 仅改 `backend/app/modules/agent/tests/test_workspace_dialogs.py`（allowed_paths 收口）。
- **不 mock 过度**（[[scan-generate-failure-chain]] 教训：过度 mock 遮蔽真实 FK 路径，单测全绿生产 500）——真实建 SessionDialogRequest/AgentRun/AgentRunWorkspace/WorkspaceMember 行，让 JOIN 跑真实 SQL；service 层不 mock，端点层用 `client` fixture（已 wire DB）。
- SQLite/PG 方言感知（[[backend-test-sqlite-vs-pg]]）：断言用行数 + 字段值，不绑死 SQL 函数名；时间字段比较转本地 naive。
- 遵循 D-001：只测读路径，不触碰 PERMISSION_REQUEST 写链路。
- UI/注释中文。
