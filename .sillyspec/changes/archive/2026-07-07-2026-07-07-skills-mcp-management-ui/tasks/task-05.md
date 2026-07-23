---
author: qinyi
created_at: 2026-07-07 23:23:00
goal: backend daemon MCP config 端点 GET /api/daemon/mcp/config
implementation: 在 daemon/router.py 新增 GET /api/daemon/mcp/config（daemon token 认证，同 /skills/latest/* 端点）；读 PlatformSetting mcp.platform_default + mcp.whitelist；返回 {platform_default: {mcpServers}, whitelist: [...]} 原值（不遮蔽，daemon 需真实 env）
acceptance: daemon token 认证通；返回平台 MCP 配置 + 白名单原值；无配置时返回空 {mcpServers:{}}/[]
verify: cd backend && uv run pytest tests/modules/daemon/test_mcp_config_endpoint.py
constraints: 认证=daemon token（get_current_principal 同现有 daemon 端点，D-004）；原值不遮蔽（区别 admin GET task-04 的遮蔽）；路径 /api/daemon/mcp/config（无 platform-settings 前缀，daemon 域）
depends_on: [task-04]
covers: [FR-05, D-004]
---

# task-05: backend daemon MCP config 端点

## 验收标准
A. `GET /api/daemon/mcp/config` 返回 `{platform_default: {mcpServers: {...}}, whitelist: [...]}` 原值。
B. daemon token 认证（与 /api/daemon/skills/latest/* 同一认证）。
C. 无配置时返回空 `{mcpServers: {}}` + `[]`，不报错。
