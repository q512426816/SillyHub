---
schema_version: 1
doc_type: module-card
module_id: mcp_registry
author: qinyi
created_at: 2026-09-10 12:00:00
---

# MCP 中央资产库（mcp_registry）

## 定位

MCP server 定义的**中央资产库**：取代旧 `PlatformSetting(key=mcp.platform_default)`
KV 存储（D-003 零迁移，旧 KV/端点已移除），三表建模平台共享库（owner=NULL，admin
管理、全员可见）与用户私有库（owner=user，个人 token 不外泄，D-001）。secret 类
env 键逐键 `CredentialCipher` 加密入 `encrypted_env`（明文永不入 ORM）；注入集渲染
（platform binding 全集 ∪ 该用户 user binding）供 daemon 拉取端点换源消费；附
JSON 粘贴 / workspace 扫描两路导入、模板（6 预置惰性 seed + 存为模板）、平台注入
集诊断预检五项。白名单治理仍留 settings 模块（D-007），不在本模块。

## 契约摘要

13 端点（design REST 清单口径——解绑按 `{scope_type}[/scope_ref]` 可选尾段计一），
全部挂 `/api` 前缀、tag `mcp-registry`：

- CRUD/绑定（读与我的库：任意登录用户 `get_current_user`；平台库写 service 层
  `_require_admin` 同 `SETTINGS_ADMIN` 判定链抛 403）：
  - `GET /api/mcp-servers`（`?scope=platform|mine|visible` + search/tag，env 脱敏
    + 绑定态 + 诊断徽标）
  - `POST /api/mcp-servers`（201；scope=platform 需 admin、stdio-only、secret 键
    抽列加密）
  - `GET|PATCH|DELETE /api/mcp-servers/{server_id}`（跨用户私有 404 防存在性
    枚举；DELETE 204，binding 级联）
  - `POST /api/mcp-servers/{server_id}/bindings`（204）、
    `DELETE /api/mcp-servers/{server_id}/bindings/{scope_type}[/{scope_ref}]`
    （platform 绑定/解绑需 admin；user binding scope_ref 须为归属者本人或平台
    共享 server，否则 422）
- 导入（scope 在请求体的两端点 router 侧先落同 admin 门
  `_require_admin_for_platform_scope`，再惰性委托 importer）：`POST
  /api/mcp-servers/import-json`（`{json_text, scope}→{imported, skipped, renamed}`；
  mcpServers/servers/mcp 三包装探测，未命中 400，逐条容错 skipped）、`POST
  /api/mcp-servers/workspace-scan`（只读候选 + 三态判定 new/duplicate/renamed，
  零写库）、`POST /api/mcp-servers/workspace-import-apply`（apply 才落库，重读
  workspace 原文件取明文，幂等）
- 模板：`GET /api/mcp-servers/templates`（平台预置 + 本人自存；首调惰性幂等 seed
  6 个公知 stdio 预置——fetch/context7/playwright/sequentialthinking/memory/git）、
  `POST /api/mcp-servers/templates`（201，`from_server_id | server_config` 双形态
  互斥；secret 键剥除，密文绝不入模板表）
- 诊断：`GET /api/mcp-servers/diagnostics`（`SettingsAdminUser`；D-011 五项——
  decrypt_failed / bound_but_disabled / invalid_type_defensive /
  platform_name_shadow / workspace_out_of_whitelist）
- 表三张：`mcp_servers`（函数唯一索引 `COALESCE(owner_user_id, 全零 sentinel)+name`
  ——平台位同名互斥、跨 owner 放行；`encrypted_env` 为
  `{键: {ct: base64密文, key_id}}` 信封）、`mcp_server_bindings`（partial unique
  ×2：platform 按 server_id / user 按 (server_id, scope_ref)；FK CASCADE）、
  `mcp_templates`（is_preset + owner_user_id NULL=预置）

## 关键逻辑

```
注入集渲染 render_injection_set(session, user_id):
  platform binding 全集 ∪ user binding(scope_ref=user_id) → enabled 过滤
  → 非 stdio 条目剔除 → encrypted_env 逐键解密回填 env
  解密失败不炸渲染: 该 server 降级为无 secret 形态继续输出
  (标记走日志 + 诊断 decrypt_failed; 输出形状钉死 {"mcpServers": {...}})
user_id=None 时仅 platform 位 == 旧 KV platform_default 语义（旧 daemon 零感知）
```

- 加密读写（Grill CC-03/R-04）：secret 键判定与 schema 脱敏同源
  （`schema._SECRET_KEY_MARKERS`——token/key/secret/password 子串，与 settings 旧
  `_redact_mcp_env` 双向一致）；写路径 env 逐键 `encrypt(str)→(ct, key_id)` 入
  `encrypted_env`、`server_config.env` 只留非 secret 明文键；读路径
  `decrypt_server_env` 逐键还原，key 失配抛 `CipherKeyMismatch` 留给渲染/诊断降级
- stdio-only（D-005）：Create/Update 无 server_type 字段，类型取
  `server_config["type"]`（缺省 stdio），声明非 stdio 422；http/sse 仅建模预留
- 导入分层铁律：importer/templates **禁止**触碰 get_cipher/CredentialCipher，落库
  一律经 `McpRegistryService.create_server`（secret 判定/加密收敛 service）；
  workspace 路径 `dedup_key = ws:<workspace_id>:<原名>` 锚定三态；cmd `/c` 包装
  剥离归一化比对（env 只比键集合不比值——密文不可逆）
- 诊断五项（Grill B-03 重定义版，不做 will_be_rejected 预测）：前两项对**全部
  platform-bound** server 探测（禁用/非 stdio 病灶启用前暴露；whitelist 判定方向
  与 daemon mcp-config 一致——有效白名单 = KV 白名单 ∪ platform 渲染集名，只过滤
  workspace 位）；后两项读各 workspace `specDir/.mcp.json`（定位与
  daemon_rpc._read_mcp_config_raw 同源）；全程容错不抛错
- 消费方：daemon `GET /api/daemon/mcp/config` platform 位换源
  `render_injection_set`（+可选 `user_id`=platform ∪ user 注入集，lease 归属双
  校验 404，D-010；渲染抛错 503 保 daemon 本地回落链）；whitelist 读取不动
  （settings KV）

## 注意事项

- 路由顺序铁律：静态段（/import-json、/workspace-scan、/workspace-import-apply、
  /templates、/diagnostics）必须声明在 `/{server_id}` 参数路由之前，否则被 UUID
  解析吞成 422（tests/test_router.py 路由序断言钉死）
- 跨用户私有库一律 404 与「不存在」同码（对齐 skills 先例）；平台库读不设 admin
  门槛，写（create scope=platform / 平台 server 改删 / platform binding）403
- `McpServerCreate`/`McpServerUpdate` 的 name 合法性 `^[a-z0-9][a-z0-9-]{1,99}$`
  在 schema 层，DB 只管长度；导入路径 name 归一化（小写 + 非 [a-z0-9-] 合并连字符）
- 模板 seed 惰性幂等：库内无任何 is_preset 行才 bootstrap 一次，删单个预置不复
  活、全清空才随下次 GET 重建；触发点收敛 `list_templates` 首调，不动 main.py
- 密钥轮换依赖每键自带 `key_id`（信封格式）；换 key 后旧行解密失败走
  decrypt_failed 诊断不炸渲染——存量密文重加密无批量工具（未上线无此需求）
- 旧 `mcp.platform_default` KV 行残留无害不清（D-003）；旧 GET/PUT
  `/api/platform-settings/mcp` 端点与前端旧客户端已移除（本 change task-13）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
