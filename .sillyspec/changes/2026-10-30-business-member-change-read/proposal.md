---
author: flow-machine-draft
created_at: 2026-10-30T07:47:23.286Z
---
# 提案书（Proposal）— 2026-10-30-business-member-change-read

## 动机

任务原话转写：业务成员角色补变更查看权限

动机与背景：工作区成员 181228（业务成员 business_member）访问 GET /api/workspaces/{id}/changes 返回 403 change:read。business_member 是系统内置角色（is_system=true），管理后台接口禁止编辑，需用迁移补权限。

成功标准：
- 新增 alembic 迁移为 business_member 幂等授予 change:read，含回滚
- 迁移单测覆盖 upgrade 幂等与 downgrade 清理并通过
- 线上 business_member 已含 change:read 且权限缓存已失效，181228 工作区权限解析含 change:read

## 变更范围

按成功标准机械推导，共 3 条验收面：
1. 新增 alembic 迁移为 business_member 幂等授予 change:read，含回滚
2. 迁移单测覆盖 upgrade 幂等与 downgrade 清理并通过
3. 线上 business_member 已含 change:read 且权限缓存已失效，181228 工作区权限解析含 change:read

## 成功标准（可验证）

1. 新增 alembic 迁移为 business_member 幂等授予 change:read，含回滚
2. 迁移单测覆盖 upgrade 幂等与 downgrade 清理并通过
3. 线上 business_member 已含 change:read 且权限缓存已失效，181228 工作区权限解析含 change:read
