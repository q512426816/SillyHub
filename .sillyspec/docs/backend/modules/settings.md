---
schema_version: 1
doc_type: module-card
module_id: settings
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:09:00
---
# settings

## 定位
平台设置与用户管理域。两块功能：(1) 平台级 key-value 配置的读取/批量 upsert；(2) 用户 CRUD、会话管理、审计查询、工作区查询、重置密码。service 层委托 `admin.users_service.UserService`，router 内联编排。

## 契约摘要
- `GET /api/settings` — 列全部平台设置；`PUT /api/settings` — 批量 upsert
- `GET /api/users` — 用户分页列表（?status= 过滤）
- `POST /api/users` — 创建用户；`PATCH /api/users/{id}` — 更新；`DELETE /api/users/{id}` — 软删除
- `GET /api/users/{id}/sessions` — 列会话；`DELETE .../sessions/{sid}` — 撤销单会话；`POST .../sessions/revoke-all` — 撤销全部
- `GET /api/users/{id}/audit` — 该用户审计；`GET /api/users/{id}/workspaces` — 该用户工作区
- `POST /api/users/{id}/reset-password` — 重置密码
- `PlatformSetting`（platform_settings 表，key 为主键 ≤100 字符，value 字符串）

## 关键逻辑
```
PUT /settings:
  for key, value in payload.settings.items():
    row = session.get(PlatformSetting, key)
    if row: row.value = value; row.updated_by/updated_at = ...
    else: insert PlatformSetting(key, value)
  commit; return {updated: [...keys]}

POST /users:
  hash = password_hasher.hash(payload.password)
  user = User(email=lower+strip, password_hash=hash, display_name=...)
  session.add; commit; refresh; return _enrich(user)
```

## 注意事项
- service 层已委托 `admin.users_service.UserService`（`settings/service.py` 仅 re-export 做向后兼容），用户管理实质逻辑在 admin 模块
- schema 也 import admin.schema；settings 与 admin 双向耦合（admin.used_by 含 settings）
- 平台设置为无命名空间 key-value，复杂值需 JSON 序列化；无分组机制，靠 key 命名约定（如 `feature_xxx.enabled`）
- 用户删除为软删除（`deleted_at` + `status="deleted"`），非物理删除
- 端点仅要求登录（`get_current_user`），细粒度权限校验在 admin 域/中间件层；密码最小长度 8（schema 校验）
- `_enrich` 在返回前补充用户关联关系（角色/组织等），统一 UserRead 结构

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
