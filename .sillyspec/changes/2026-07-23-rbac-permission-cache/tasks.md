---
author: qinyi
created_at: 2026-07-23 09:10:29
change: 2026-07-23-rbac-permission-cache
---

# 任务清单(Tasks)

> 细节在 plan 阶段展开。Wave/依赖/验收在 plan.md。

- task-01: 新建 `core/permission_cache.py` 缓存 helper(P1)— get/set_cached_permissions(scope 三键)、get/set_cached_ppm_scope(uuid 反序列化)、invalidate_all_permissions(ERROR 告警)
- task-02: `core/config.py` 加 permission_cache_ttl=300(P5)
- task-03: `auth/rbac.py` collect_* 缓存接入 + everywhere 内存并集(P2)
- task-04: `ppm/common/data_scope.py` manager_project_ids/is_super_admin 缓存接入(P3)
- task-05: `admin/roles_service` 失效 hook(P4)
- task-06: `admin/users_service` 失效 hook(P4)
- task-07: `workspace/members_service` 失效 hook(P4)
- task-08: `workspace/service.WorkspaceService.create` 失效 hook(P4, D-006@v1)
- task-09: `ppm/project/service.ProjectMemberService` 失效 hook(P4)
- task-10: 测试 — 缓存读写+降级、每失效点清空安全、uuid 类型断言、无 Redis 回退(P6)
