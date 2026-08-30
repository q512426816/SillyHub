---
id: task-03
title: skills router relax permission to any logged-in user
title_zh: skills router 权限从 SETTINGS_ADMIN 放宽到任意登录用户
author: qinyi
created_at: 2026-07-31 22:40:05
priority: P1
depends_on: [task-01]
blocks: [task-04]
requirement_ids: [FR-03]
decision_ids: [D-003]
allowed_paths:
  - backend/app/modules/skills/router.py
---

## 目标
`/api/custom-skills` 所有端点依赖从 `SettingsAdminUser`（SETTINGS_ADMIN 鉴权）放宽到任意登录用户（复用 `get_current_user` / `CurrentUser`），同时为后续 task-04 service 隔离铺好 user.id 透传。

## 实现要点
- 现状：`router.py:43` `SettingsAdminUser = Annotated[User, Depends(require_permission_any(Permission.SETTINGS_ADMIN))]`，list/create/get/update/delete 全用此依赖（`:74 :89 :105 :117 :132`）。
- 改为复用 `app/core/auth_deps.py:56` 现成的 `get_current_user`（design D-003 + Explore 确认存在）：`CurrentUser = Annotated[User, Depends(get_current_user)]`，删除原 `SettingsAdminUser` 别名与 `require_permission_any` / `Permission.SETTINGS_ADMIN` import。
- `create_custom_skill`（`:89`）已透传 `user.id`（`:96`），保持；其余端点把 `_user: SettingsAdminUser` 改为 `user: CurrentUser`（不用 `_` 前缀，后续 task-04 要在 router 层把 user.id 传给 service）。
- 端点路径/方法/response_model 全部不变；仅依赖类型替换。
- 更新模块 docstring（`:1-17`）：把「权限 SETTINGS_ADMIN」段改写为「任意登录用户（D-003），per-user 隔离见 service」。

## 验收
- 非管理员（无 SETTINGS_ADMIN）登录用户能调 list / create / get / update / delete 不被 403。
- router 现有测试（test_router）跑过；若有断言 SETTINGS_ADMIN 的用例需调整为登录用户（注意：禁止为躲测试改回手写权限）。
- mypy 过；无未用 import 残留（`require_permission_any` / `Permission` 若仅 router 用则清掉）。
