---
id: task-02
title: PPM_* 权限枚举 + RBAC 种子迁移
priority: P0
estimated_hours: 4
depends_on: []
blocks: [task-03, task-08, task-13]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06]
decision_ids: [D-005@v1]
author: qinyi
created_at: 2026-06-20T14:52:22+0800
---

## 目标
在 auth/permissions.py 新增 PPM_* 权限枚举(归并源 29 个 @PreAuthorize),并写 RBAC 种子迁移给 platform_admin 角色全量授权,为后续端点 require_permission_any 提供基础。

## 文件
- 修改 backend/app/modules/auth/permissions.py(Permission StrEnum 追加 PPM_* 成员)
- 新增 backend/migrations/versions/2026mmdd_seed_ppm_permissions.py(RBAC 种子)
- 新增 backend/tests/auth/test_ppm_permissions.py(枚举/种子回归)

## 实现要点(参照源)
- 参照源 @PreAuthorize 列表,归并命名:<域>_<动作>,动作 = READ/WRITE/DELETE/EXPORT(对应源 select/create-update/delete/export):
  - PPM_PROJECT_READ/WRITE/DELETE/EXPORT
  - PPM_CUSTOMER_READ/WRITE/DELETE(无导出)
  - PPM_PLAN_READ/WRITE/DELETE
  - PPM_PROBLEM_READ/WRITE/DELETE
  - PPM_TASK_READ/WRITE/DELETE
  - PPM_WORKHOUR_READ/WRITE(工时统计)
  - PPM_KANBAN_VIEW(只读看板)、PPM_KANBAN_ASSIGN(分配)
- 枚举值统一前缀 `ppm:*`(参照现有 Permission 命名风格)。
- 种子迁移参照现有 create_auth_and_rbac 迁移:upsert 角色权限映射(platform_admin 全量,其他角色不动);down 删除 ppm:* 前缀行。
- 确保幂等(用 INSERT ... ON CONFLICT DO NOTHING 或先 SELECT 判定)。

## 验收
- [ ] Permission 枚举包含全部 PPM_* 成员,无重复
- [ ] migration upgrade/downgrade 幂等可重复执行
- [ ] platform_admin 角色查询含全部 PPM_* 权限
- [ ] 普通用户角色不含 PPM_* (回归)
