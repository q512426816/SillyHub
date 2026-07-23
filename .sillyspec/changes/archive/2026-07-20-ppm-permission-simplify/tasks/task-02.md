---
id: task-02
title: 数据库迁移双轨——改旧种子迁移 202607041000 的 PPM_PERMISSIONS 清单 25→8 + 新增清理迁移 DELETE 17 条 role_permissions（覆盖：FR-04, D-003@v1）
title_zh: 数据库迁移双轨清理 17 个 PPM 操作权限授权（改旧 seed 清单 25→8 + 新清理迁移 DELETE 17 条）
author: qinyi
created_at: 2026-07-20 13:12:48
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-04]
decision_ids: [D-003@v1]
allowed_paths:
  - backend/migrations/versions/202607041000_seed_ppm_permissions.py
  - backend/migrations/versions/20260720_drop_ppm_operation_permissions.py
goal: >
  双轨迁移清理 17 个操作权限授权——新环境从头 seed 仅 8 个菜单权限，已部署环境 upgrade 删除多余的 17 条 role_permissions。
implementation:
  - 修改 backend/migrations/versions/202607041000_seed_ppm_permissions.py 的 PPM_PERMISSIONS 列表：删除 17 个操作权限（ppm:project:write/delete/export、ppm:customer:write/delete/export、ppm:plan:write/delete/export、ppm:problem:write/delete/export、ppm:task:write/delete/export、ppm:work-hour:write、ppm:kanban:assign），只保留 8 个菜单权限（ppm:project:read、ppm:customer:read、ppm:plan:read、ppm:problem:read、ppm:task:read、ppm:work-hour:read、ppm:work-hour:stat、ppm:kanban:view）；upgrade/downgrade 函数体保持不变（幂等 SELECT+bulk_insert / LIKE 'ppm:%' DELETE 逻辑天然适用缩短后的清单）。
  - 新建迁移 backend/migrations/versions/20260720_drop_ppm_operation_permissions.py：revision="20260720_drop_ppm_operation_permissions"；down_revision 接 execute 时 `uv run alembic heads` 确认的当前唯一 head（本次调研核实为 20260720_problem_status_3state，execute 前必须再次核实，若已变以实测为准）。
  - 新迁移 upgrade 执行 `DELETE FROM role_permissions WHERE permission IN (<17 个被删权限字符串硬编码列表>)`；downgrade 对称回植到 platform_admin 角色——参照旧迁移 202607041000 的幂等风格（先 `SELECT id FROM roles WHERE key='platform_admin' LIMIT 1` 取 role_id，角色不存在则 return 跳过；再 `SELECT permission FROM role_permissions WHERE role_id=:rid` 拿已存在集合；对 17 个权限 `perm not in existing` 的 op.bulk_insert，避开 PG/SQLite 方言差异不用 ON CONFLICT）。
  - 新迁移在模块顶部硬编码 17 个权限字符串列表常量（命名如 DROPPED_PPM_PERMISSIONS），不 import app.*（沿用旧迁移离线生成 SQL 风格，保证迁移可离线执行）；docstring 说明本次清理对应变更 2026-07-20-ppm-permission-simplify。
acceptance:
  - 旧迁移 202607041000 的 PPM_PERMISSIONS 列表只剩 8 项（5 个 read + work-hour:read/stat + kanban:view），grep 不到任何 write/delete/export/assign。
  - 新迁移文件 20260720_drop_ppm_operation_permissions.py 存在，upgrade 内含 DELETE FROM role_permissions WHERE permission IN (17 个)，downgrade 对称 bulk_insert 回植到 platform_admin，幂等写法完整（SELECT 判重 + 角色缺失 return）。
  - 新迁移 down_revision 值等于 execute 时 `uv run alembic heads` 输出的当前唯一 head（本次调研为 20260720_problem_status_3state）。
  - 在测试 SQLite 库执行 `uv run alembic upgrade head` 后，`SELECT COUNT(*) FROM role_permissions WHERE permission IN (17 个被删字符串)` == 0。
  - `uv run alembic heads` 仍显示单一 head，无分叉（无新多 head 产生）。
verify:
  - cd backend && uv run alembic heads（确认 down_revision 接的是当前唯一 head，执行后仍单一 head）
  - cd backend && uv run alembic upgrade head（在测试 SQLite 库跑通 upgrade 链路）
  - cd backend && uv run ruff check migrations（迁移文件 lint 通过）
constraints:
  - 迁移内硬编码权限字符串，不 import app.*（沿用旧迁移 202607041000 离线生成 SQL 风格，见其模块 docstring）。
  - 避开 PG/SQLite 方言差异：upgrade 用 DELETE ... WHERE permission IN (...)（标准 SQL，两端通用），downgrade 不用 ON CONFLICT、用 SELECT 判重 + op.bulk_insert 幂等回植（参照旧迁移）。
  - downgrade 对称回植：仅回植被删的 17 个权限到 platform_admin 角色，不动其余 role_permissions 行。
  - down_revision 必须接 execute 时 `alembic heads` 确认的当前唯一 head（防多 head 分叉，对应 R-02；本次调研为 20260720_problem_status_3state，execute 时若已有新变更合入需重新核实）。
  - 不改表结构（role_permissions 无 schema 变更），仅数据层 DELETE/INSERT。
---
