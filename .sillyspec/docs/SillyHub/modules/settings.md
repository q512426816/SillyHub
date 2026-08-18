---
schema_version: 1
doc_type: module-card
module_id: settings
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台配置中心（settings）

## 定位
平台级「键值配置中心」+ 用户/会话运维聚合入口 + 平台 MCP 默认配置载体。管理 `platform_settings` 表（key/value 键值）；router 同时复用承载用户 CRUD、会话吊销、密码重置等运维端点（转发 admin 模块的 UserService）。是「平台配置」「账号管理」「MCP 接入配置」三类操作的统一 REST 入口，历史聚合形态，新功能宜分流。

## 契约摘要
- 平台设置（`SETTINGS_ADMIN` 权限，tag=settings）：
  - `GET /settings` 批量读全部键值（`SettingsBulkRead`）
  - `PUT /settings` 批量更新（upsert 语义，返回 updated/created/skipped 计数）
- 平台 MCP 配置（`SETTINGS_ADMIN`）：
  - `GET /platform-settings/mcp`：读平台默认 `mcpServers` 配置，env 内 secret 键（按 key 名标记词判定）遮蔽为占位值
  - `PUT /platform-settings/mcp`：写配置，**接收原值存储不脱敏**，返回遮蔽视图
  - `GET|PUT /platform-settings/mcp-whitelist`：MCP server 白名单（server 名列表；PUT 请求体为顶层 JSON 数组）
- 用户/会话管理（`require_platform_admin`，转发 `admin.users_service.UserService`）：
  - `GET|POST /users` 列表（搜索/筛选/分页/排序）与创建；`PATCH|DELETE /users/{id}` 更新与软删
  - `GET /users/{id}/sessions`、`DELETE .../sessions/{sid}`、`POST .../sessions/revoke-all`
  - `GET /users/{id}/audit` 用户审计日志、`GET /users/{id}/workspaces` 所属工作区+角色
  - `POST /users/{id}/reset-password` 重置密码（不传则后端生成随机强密码，明文返回一次）
- 数据：`PlatformSetting`（`key` String(100) 主键、value 字符串、updated_by、updated_at）；结构化值（如 MCP 配置）由调用方 JSON 序列化后整串存 value
- `service.py` 仅向后兼容 re-export `UserService`，无真实逻辑；settings/MCP 端点逻辑内联 router

## 关键逻辑
```
读 JSON 配置: _read_setting_json(key, default)
  → session.get(PlatformSetting, key) → json.loads（缺失/坏 JSON → default）
写 JSON 配置: _write_setting_json(key, value, actor)
  → upsert 行（value=json.dumps）+ 手工审计一条 + commit
用户端点: _svc(session, actor_id) → UserService
  （lazy import 防 settings↔admin 循环引用）
_enrich(user) → 复用 admin.router._user_with_relations 补角色/组织关联
```

## 注意事项
- `platform_settings` 主键是 String 非 UUID，core 审计钩子会跳过它，故 router 写路径**手工插 AuditLog**（`PLATFORM_SETTING_CREATE/UPDATE`，resource_id 用占位符；2026-08-14-audit-system-completion D-004）
- 用户管理与 admin 模块实质同源（同一 UserService），规则改动勿两处分叉；新用户域功能宜直接进 admin router
- MCP 配置 PUT 存原值（含明文 secret）、GET 才遮蔽——前端编辑回显时注意别把遮蔽占位值当原值写回
- 密码重置返回明文是因为暂无邮件服务，管理员需人工转达
- 平台设置 value 统一存字符串，key 用点分命名空间（如 `ppm.xxx`）；MCP 配置用模块内专用 key 常量
- 会话吊销/全撤会强制用户重新登录，属敏感运维操作

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
