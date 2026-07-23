---
author: qinyi
created_at: 2026-07-07 23:24:00
goal: secret 脱敏 + 权限门控 + 双校验贯通
implementation: 横切验证：①backend admin GET（task-04 mcp + 自定义 skills 列表）env/敏感字段遮蔽 helper 统一（抽 _redact_mcp_env 工具）；②CRUD 端点全 require_permission(MANAGE_PLATFORM)；③frontend zod schema + backend pydantic schema 对齐（mcpServers 结构）；④单测覆盖脱敏 + 权限 + 双校验路径
acceptance: 脱敏 helper 统一 + 单测；所有 CRUD 端点权限门控单测；zod/pydantic schema 对齐（前端拦 + 后端校）
verify: cd backend && uv run pytest tests/modules/skills + tests/modules/settings（脱敏+权限）；cd frontend && pnpm test（zod 校验）
constraints: 横切任务，依赖 task-02/04 就绪后贯通；不新建独立文件（抽 helper + 补测）
depends_on: [task-02, task-04]
covers: [NFR-01, NFR-02, NFR-03]
---

# task-11: 脱敏 + 权限 + 校验贯通

## 验收标准
A. MCP env secret 脱敏 helper（`_redact_mcp_env`，token/key/secret/password 类 key 遮蔽）统一抽取 + 单测。
B. 所有 CRUD 端点（custom-skills + mcp + whitelist）`require_permission(MANAGE_PLATFORM)` 门控，单测覆盖非 admin 403。
C. zod（前端）+ pydantic（后端）mcpServers schema 对齐，双校验单测。
