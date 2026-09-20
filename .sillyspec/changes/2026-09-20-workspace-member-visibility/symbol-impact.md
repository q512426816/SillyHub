# 符号影响面报告 — 2026-09-20-workspace-member-visibility

> execute 前缀步「加载上下文」硬门产物。逐 task 给出签名级变更结论；
> 签名引用处均相对仓根（源码位置写仓根相对全路径+行号）。

## 逐 task 结论

- **task-01**（backend/app/modules/auth/rbac.py:107-132 `has_permission`）：**无签名级变更**。函数签名 `(session, *, user, permission, workspace_id) -> bool` 不动，仅内部判定顺序收紧（平台段在 workspace_id 非空时仅认 `Permission.PLATFORM_ADMIN`）；docstring 同步。受影响调用点（`backend/app/core/auth_deps.py:116/:142` 及 agent/file/change/daemon/incident/release/mcp_gateway/platform_sync 等散点）均为行为语义变化（部分平台级授权用户从放行变 403），无调用方代码需要改动——属本变更设计目标，非回归。
- **task-02**（backend/app/modules/workspace/router.py:292-379 `list_workspaces`）：**无签名级变更**。端点路径/查询参数/响应模型（WorkspaceListResponse）全不动，仅 :351-362 平台分支条件收窄；docstring 同步。
- **task-03**（backend/app/modules/auth/rbac.py:135-203 `list_user_ids_with_permission`）：**无签名级变更**。签名 `(session, *, workspace_id, permission) -> list[uuid.UUID]` 不动，仅段 2 的 `RolePermission.permission.in_([target, admin_perm])` 收窄为 `in_([admin_perm])`。消费方 `backend/app/modules/notification/service.py:128` 无需改动（收件人集合语义变化即设计目标）。
- **task-04**（backend/app/modules/workspace/tests/test_platform_grant_list.py）：**无签名级变更**（纯测试断言/夹具改写，复用既有 `_grant_platform_role` 夹具）。
- **task-05**（NEW:backend/app/modules/auth/tests/test_rbac_workspace_scope.py）：**无签名级变更**（新增测试文件，不定义被生产代码引用的符号）。
- **task-06**（存量测试回归）：**无签名级变更**（仅测试断言/夹具修正）。

## 汇总

本变更为纯语义收紧（判定逻辑 + docstring + 测试），**全部 task 无签名级变更**；对外 API 契约（OpenAPI）零变化，前端 `api-types.ts` 无需再生成。
