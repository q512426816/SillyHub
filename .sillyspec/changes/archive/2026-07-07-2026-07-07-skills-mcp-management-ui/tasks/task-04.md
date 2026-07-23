---
author: qinyi
created_at: 2026-07-07 23:22:00
goal: MCP 平台配置/白名单 CRUD（扩 settings/router，存 PlatformSetting）
implementation: 扩 backend/app/modules/settings/router.py：GET/PUT /api/platform-settings/mcp（读写 PlatformSetting key=mcp.platform_default，value=JSON{mcpServers}）；GET/PUT /api/platform-settings/mcp-whitelist（key=mcp.whitelist value=JSON[name list]）；admin GET 返回遮蔽 env secret（token/key/secret/password 类 key 遮蔽值）；pydantic McpServersSchema 校验
acceptance: 4 端点通；admin only；JSON schema 非法 422；env secret 遮蔽（admin GET）；PUT 后落 PlatformSetting
verify: cd backend && uv run pytest tests/modules/settings/test_mcp_settings.py
constraints: 复用 PlatformSetting + settings/router 批量模式（D-003）；pydantic 校验 mcpServers 结构（D-009 NFR-03）；遮蔽逻辑（D-008 NFR-02）
depends_on: []
covers: [FR-03, FR-04, D-003, D-008, D-009, NFR-01, NFR-02, NFR-03]
---

# task-04: backend MCP 平台配置/白名单 CRUD

## 验收标准
A. `GET/PUT /api/platform-settings/mcp`（平台默认 {mcpServers} JSON）+ `GET/PUT /api/platform-settings/mcp-whitelist`（name list）四端点。
B. 全部 admin only（MANAGE_PLATFORM）。
C. pydantic 校验 `{mcpServers: {name: {command, args, env?}}}` 结构，非法 422。
D. admin GET 遮蔽 mcpServers.*.env 中 token/key/secret/password 类 key 的值；PUT 接收原值存储。
