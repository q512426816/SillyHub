---
schema_version: 1
doc_type: module-card
module_id: lib-settings
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:02:25
---
# lib-settings

## 定位
全局系统设置（key-value）的前端 API 客户端，全局域。仅做设置的批量读取与批量更新。用户管理已迁移至 `/api/admin/users`（见 `lib-admin`），本模块不再含用户 CRUD。

## 契约摘要
| 函数 | 语义 | HTTP |
|---|---|---|
| `listSettings()` | 取全部设置项 | GET `/api/settings` |
| `updateSettings(settings)` | 批量更新设置（key→value 映射） | PUT `/api/settings` |

类型：
- `SettingRead`：`{ key, value, updated_at }`。
- `SettingsBulkRead`：`{ settings: SettingRead[] }`。
- `SettingsUpdateResponse`：`{ updated: string[] }`（成功更新的 key 列表）。

## 关键逻辑
```
updateSettings 入参为 Record<string,string>，整体 PUT
返回实际被更新的 key 名数组，供前端提示
```

## 注意事项
- 源码顶部注释明确：用户管理已移到 `lib-admin`（`/api/admin/users`），勿在本模块找用户函数。
- 设置 value 统一为字符串，前端按需自行反序列化（布尔/数字等）。
- `_module-map.yaml` 的 `main_symbols` 列了 listUsers/createUser 等，那是历史残留；当前实现只有 listSettings/updateSettings。
- 仅依赖 `lib-api`。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
