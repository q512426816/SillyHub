---
schema_version: 1
doc_type: module-card
module_id: settings
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 平台设置聚合（settings）

## 定位

平台级 KV 设置存储 + MCP server 白名单管理 + 用户管理端点聚合。三个子域共用一张
`platform_settings` KV 表：通用设置读写、MCP server 白名单（KV 存 JSON 数组；
旧「平台默认 MCP 配置」`mcp.platform_default` KV 与 GET/PUT
`/api/platform-settings/mcp` 两端点已随 mcp_registry 中央资产库上线移除，change
2026-09-10-mcp-central-registry task-13 / D-003）、用户 CRUD（服务层已迁 admin
模块，本模块保留路由与 DTO re-export）。

## 契约摘要

- `GET /api/settings` / `PUT /api/settings`（bulk upsert）—— `require_permission_any(SETTINGS_ADMIN)`
- `GET|PUT /api/platform-settings/mcp-whitelist` —— key=`mcp.whitelist`，value=JSON 数组
- `/api/users` 全家（`require_platform_admin`）：list / create / patch / delete、
  sessions 列表 + 单吊销 + revoke-all、audit、workspaces、reset-password
- 表 `platform_settings`：PK=`key`（String(100)），`value` 文本，`updated_by` / `updated_at`

## 关键逻辑

```
读: session.get(PlatformSetting, key) → json.loads（缺失/解析失败 → default）
写: upsert row + json.dumps + 手工审计 AuditLog + commit
```

- `_read_setting_json` / `_write_setting_json`：`mcp.whitelist` 的 JSON 编解码 +
  upsert 封装（daemon `GET /api/daemon/mcp/config` 白名单位消费同款读取）
- `_redact_mcp_env`（env secret 深拷贝遮蔽 `<set>`）：旧 admin GET /mcp 端点移除后
  仅剩跨模块复用方 workspace/skills_view_service（workspace mcp-config 脱敏视图）；
  mcp_registry/schema 的 DTO 脱敏与之同源双向一致
- daemon 侧 `GET /api/daemon/mcp/config`（daemon/router/daemon_rpc.py）platform 位
  数据源已换 registry 渲染（mcp_registry/render.py），whitelist 仍读本模块 KV
- `_audit_platform_setting_write`：`platform_settings` PK 为 String 非 UUID，挂 ORM
  audit hooks 会被跳过，写路径手工插 `AuditLog`（action 常量引用 workflow.model 的
  `PLATFORM_SETTING_CREATE/UPDATE`，区分 create/update），随同次 commit 落库
- UserService 已迁 `admin.users_service`；本模块 service.py 仅 re-export，router 内
  lazy import 规避 settings↔admin 模块加载期循环引用

## 注意事项

- schema.py 大量 re-export admin 模块用户 DTO（历史 import 兼容），新代码直接从
  `admin.schema` / `admin.users_service` import
- KV value 理论上可被绕过 PUT 的路径写成坏 JSON，读取端自带容错（解析失败回
  default）；残留 `mcp.platform_default` 脏行无害不清（D-003）
- 新增 setting key 的写端点必须照抄手工审计范式（hooks 跳过非 UUID PK 是结构性原因）
- 审计 action 常量集中定义在 workflow/model.py（D-005），不设 DELETE 常量——全仓
  settings 无删除端点
- 平台设置是无命名空间 KV，复杂值靠 key 命名约定（`mcp.*`）+ JSON 序列化，无分组机制

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
