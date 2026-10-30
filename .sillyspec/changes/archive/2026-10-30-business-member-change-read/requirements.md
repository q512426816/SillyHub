---
author: zcode-qinyi
created_at: 2026-10-30T07:50:00.000Z
---
# 需求规格（Requirements）— 2026-10-30-business-member-change-read

## 功能需求

### FR-01: 新增 alembic 迁移为 business_member 幂等授予 change:read，含回滚

**必须**新增一条 alembic 迁移（down_revision 接当前 head `20261023090100`），向
`role_permissions` 插入 `(business_member, change:read)`；重复执行不得产生重复行
或报唯一键错误；**必须**提供 downgrade，仅删除该授权、不动角色本身与其他权限。
不修改历史迁移 `202607251600`（已部署的迁移不再重跑）。

#### 场景：角色存在且尚未授予

- Given `business_member` 角色存在且权限集为 8 项（不含 `change:read`）
- When 执行迁移 `upgrade()`
- Then `role_permissions` 新增一行 `(business_member, change:read)`，权限集变为 9 项

#### 场景：重复执行（幂等）

- Given 已授予 `change:read`
- When 再次执行 `upgrade()`
- Then 不新增行、不抛错，权限集仍为 9 项

#### 场景：回滚

- Given 已授予 `change:read`
- When 执行 `downgrade()`
- Then 该行被删除，权限集回到 8 项，角色行与其他权限不受影响

### FR-02: 迁移单测覆盖 upgrade 幂等与 downgrade 清理并通过

**必须**在 SQLite 上真实执行迁移本体（非 replay），覆盖 upgrade 幂等与 downgrade 清理，
且测试随代码提交、收口实测通过。

#### 场景：单测执行

- Given 内存 SQLite + `roles` / `role_permissions` 表 + business_member 种子
- When 连续两次 upgrade 后 downgrade
- Then 权限集依次为 9 / 9 / 8，且 `change:read` 唯一

### FR-03: 线上 business_member 已含 change:read 且权限缓存已失效，181228 工作区权限解析含 change:read

**必须**让线上库的 `business_member` 实际包含 `change:read`，并清空 `perm:*` /
`ppm-scope:*` 权限缓存；回归验证用户 181228 在 `pzdj` 工作区的权限解析结果包含
`change:read`（即 `GET /api/workspaces/a600a8a5-4b69-4296-b9fc-bd2349768089/changes`
的鉴权输入）。

#### 场景：线上核验

- Given 线上已按迁移 SQL 落库并清缓存
- When 读取 role_permissions 与 Redis 缓存，并按 `has_permission` 规则求工作区权限集
- Then 结果包含 `change:read`，缓存中不再有旧的 8 项快照

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/tests/modules/auth/test_business_member_change_read_migration.py「test_upgrade_grants_change_read_idempotently」「test_downgrade_removes_only_change_read」
FR-02: backend/tests/modules/auth/test_business_member_change_read_migration.py「test_migration_metadata」「test_upgrade_grants_change_read_idempotently」「test_downgrade_removes_only_change_read」
FR-03: 不适用：线上数据面核验（生产库 SQL + Redis 实测），无自动化测试可覆盖
