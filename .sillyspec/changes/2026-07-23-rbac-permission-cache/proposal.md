---
author: qinyi
created_at: 2026-07-23 09:10:29
change: 2026-07-23-rbac-permission-cache
---

# 提案(Proposal)

## 动机

权限检查是全应用最高频 DB 热点:
- `has_permission`(`auth/rbac.py:87`)经 `auth_deps.require_permission` 被**每个受保护路由**调用,未短路时每次 2 条 JOIN,无缓存。
- PPM `data_scope.manager_project_ids` / `is_super_admin` 每个 PPM 列表请求都查,无缓存。

性能审计 W5 / C6-1 / P1 识别此为高价值优化点。项目 Redis 已是基础设施级服务(compose + 依赖 + `core/redis.py` 客户端就绪),无需新基建。

## 方案概述

集中式 `permission_cache` 模块(方案 A):新建 `core/permission_cache.py` 统一缓存 helper,`rbac.collect_permissions*` 与 `data_scope` 底层函数调它读缓存;所有权限写 service 显式调 `invalidate_all_permissions` 清空。Redis 故障降级回 DB,认证永不失败。

详见 `design.md`(经 Design Grill v2 修订,闭合 1 P0 + 2 P1)。

## 范围

- 路由鉴权 `has_permission`(platform/all/workspace 三键)
- PPM 数据范围 `data_scope`(manager_project_ids / is_super_admin,ppm-scope 键)
- 失效:角色/用户角色/工作区成员/工作区创建/项目成员变更

## 非目标

- 不缓存动态 SQL(scope_clause)
- 不加本地内存兜底
- 不做精确失效(整体清空)
- 不引入新缓存依赖
