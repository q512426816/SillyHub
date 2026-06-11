---
schema_version: 1
doc_type: module-card
module_id: lib-settings
author: qinyi
created_at: 2026-06-10T16:55:00
---

# lib-settings

## 定位
Settings（设置）和 Users（用户管理）API 客户端。

## 契约摘要
- Settings: `listSettings()`、`updateSettings(settings)` — 键值对设置管理
- Users: `listUsers(params?)`、`createUser(data)`、`updateUser(userId, data)`、`deleteUser(userId)` — 用户 CRUD
- 类型：SettingRead、SettingsBulkRead、UserRead、UserCreateRequest、UserUpdateRequest

## 关键逻辑
- Settings 使用 PUT 批量更新，返回 updated 键列表
- Users 支持分页（limit/offset）和状态过滤
- 用户管理包括 is_platform_admin 标志

## 注意事项
- 无特殊注意点

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
