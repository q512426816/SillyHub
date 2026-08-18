---
schema_version: 1
doc_type: module-card
module_id: lib-settings
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台设置客户端（lib-settings）

## 定位

平台级 key/value 设置的 API 客户端，仅两个函数。**只管设置项**——用户管理已整体
迁至 `/api/admin/users`（见 `@/lib/admin`），本模块不再含任何用户 CRUD。

## 契约摘要

- `listSettings(): Promise<SettingsBulkRead>` — `GET /api/settings`。
- `updateSettings(settings: Record<string, string>): Promise<SettingsUpdateResponse>` —
  `PUT /api/settings`，body `{ settings }` 整体提交键值对。
- 类型 `SettingRead` / `SettingsBulkRead` / `SettingsUpdateResponse` 全部从
  OpenAPI 生成的 `@/lib/api-types` 取（后端 `backend/app/modules/settings/schema.py`），
  禁止手写漂移。

## 关键逻辑

```
listSettings:   apiFetch("/api/settings")
updateSettings: apiFetch("/api/settings", { method: PUT, json: { settings } })
```

## 注意事项

- **边界**：凡是用户/角色/组织 CRUD 一律走 `lib-admin`，别往这里加回来；
  文件头注释亦明确此分工。
- 后端 settings schema 有改动时须 `pnpm gen:types` 重新生成 api-types.ts。
- 生产消费方为 `app/(dashboard)/settings/page.tsx`（设置页读写平台配置）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
