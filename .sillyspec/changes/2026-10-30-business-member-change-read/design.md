---
author: zcode-qinyi
created_at: 2026-10-30T07:50:00.000Z
---
# 设计记录（Design Record）— 2026-10-30-business-member-change-read

## 做法概述

本变更怎么解决问题？改哪里、为什么选这个方案（一两段）。

`business_member` 是 `is_system=true` 的系统内置角色，管理后台 `roles_service.update`
明确抛 `RoleSystemProtected`，界面上改不了；系统角色的权限集由迁移定义。因此新增一条
独立 alembic 迁移 `20261030160000_grant_business_member_change_read.py`（down_revision
接当前 head `20261023090100`），用可移植 SQL 幂等插入 `(business_member, change:read)`，
并提供 downgrade 删除该行。不改历史迁移 `202607251600`（已部署不会再跑），也不在应用
启动时动态补权限（隐式、不可审计）。线上先以同一 SQL 落库并清缓存，使当前部署立即生效；
下次镜像重建时该迁移会正常记录 revision 并保持幂等。

## 接口契约

动了哪些函数/端点/命令/文件格式？对外可见的签名或行为变化是什么（含「无」的说明）？

- 无 HTTP 端点、请求/响应结构、函数签名变化。
- 数据面：`role_permissions` 中 `business_member` 的权限集从 8 项变为 9 项（新增
  `change:read`）。所有以 `business_member` 为工作区角色的用户在所属工作区获得变更只读
  能力（用户已确认 B 方案为全局口径）。
- 迁移 revision/downgrade：`20261030160000` / `20261023090100`。

## 边界与并发（盲维四问——每问必答，答不了即设计缺口）

1. 乱序/迟到到达：输入或事件乱序时，本设计的假设还成立吗？

迁移链由 down_revision 固定，必须在 `20261023090100` 之后执行；线上手工 SQL 先落库、
迁移后到也安全——`ON CONFLICT DO NOTHING` 使其不重复插入、不报错。

2. 并发写：两个执行体同时操作同一数据/文件会发生什么？

`role_permissions` 主键 `(role_id, permission)` + `ON CONFLICT DO NOTHING` 保证重复/
并发插入幂等；当前 compose 单副本执行 `alembic upgrade head`，无并发迁移。

3. 切换/生命周期：会话、请求或变更中途切换/中断时状态是否安全？

迁移失败会阻断容器启动（`alembic upgrade head && exec uvicorn`），可通过 downgrade
回退；权限缓存由本次手工清空，后续缓存按用户懒填、TTL 300s，无残留旧快照。

4. 作用域：跨工作区/跨仓/多实例时数据会不会串台？

`business_member` 是全局角色模板，授权按工作区 membership 生效，不跨工作区串数据；
不影响 `developer` / `viewer` / `workspace_owner` 等其他角色的权限集。

## 风险与死路

本方案最大的风险是什么？试过但放弃的方案及放弃理由？

- 最大风险：全局扩大系统角色权限，所有工作区的业务成员获得 `change:read`；若产品后续
  收紧，需再发一条迁移删除该行。
- 放弃方案 A：改后台允许编辑系统角色——破坏 `RoleSystemProtected` 保护语义，改动面大。
- 放弃方案 B'：把个别用户换成 `viewer`/`developer`——会丢掉 `daemon:borrow`，与"全部
  业务成员都能看变更"的诉求不符。
- 放弃方案 C：应用启动时补权限——隐式覆盖、不可审计、多实例行为不确定。
