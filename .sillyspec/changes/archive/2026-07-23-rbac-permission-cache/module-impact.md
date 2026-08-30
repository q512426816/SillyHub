---
author: qinyi
created_at: 2026-08-30 19:55:32
change: 2026-07-23-rbac-permission-cache
---

# 模块影响分析（Module Impact）— 后端 RBAC 权限缓存（Redis TTL + 整体失效）

## 模块影响矩阵

| 模块 | 影响类型 | 说明 |
|---|---|---|
| backend:core | 新增+配置变更 | 新增 `app/core/permission_cache.py`（5 个 async public API：get/set_cached_permissions、get/set_cached_ppm_scope、invalidate_all_permissions）；`app/core/config.py` 新增 `permission_cache_ttl=300` |
| backend:auth | 逻辑变更 | `app/modules/auth/rbac.py` collect_* 三函数接入缓存读写；collect_permissions_everywhere 读 platform+all 后内存并集（不额外存第三键） |
| backend:ppm | 逻辑变更 | `app/modules/ppm/common/data_scope.py` manager_project_ids/is_super_admin 缓存接入（get 强制还原 uuid set/bool）；`app/modules/ppm/project/service.py` ProjectMemberService 三处成员变更失效 hook |
| backend:admin | 逻辑变更 | `app/modules/admin/roles_service.py`（5 hook）与 `users_service.py`（3 hook）在角色/用户写操作 commit 后调 invalidate_all_permissions |
| backend:workspace | 逻辑变更 | `app/modules/workspace/members_service.py`（4 hook）；`service.py` WorkspaceService.create/scan_generate 建 owner 后失效（D-006） |

## 未匹配文件

| 文件 | 处置说明 |
|---|---|
| backend/tests/core/test_permission_cache.py | 测试文件（17 用例：缓存读写/降级/uuid 类型断言/失效点清空安全），不归属业务模块 |

## 更新结果

| 目标 | 操作 | 状态 |
|------|------|------|
| `_module-map.yaml: core` | main_symbols 补 5 个 permission_cache 公开 API（get/set_cached_permissions、get/set_cached_ppm_scope、invalidate_all_permissions） | done |
| `modules/backend.md` 卡片 | 不存在单文件 backend.md；core/auth 卡片经核对已由 2026-08-18/19 scan 收录 permission_cache 语义（core.md §定位/关键逻辑、auth.md §39），无缺口 | skipped（已同步） |
| auth/ppm/admin/workspace 卡片 | 缓存接入属内部实现变化（不改对外接口），按 sync 规则不更新卡片 | skipped |

## 核对说明

本变更为 2026-07-23 老变更（早于 review.json 注册表与 module-impact 首版机制），archive 期回填。文件清单以 verify-result.md 任务完成度表（10/10 grep 实证）+ 归档期主仓 grep 复核为准：上述 9 个实现文件当前均在主仓存在且含 permission_cache/invalidate_all_permissions 调用。
