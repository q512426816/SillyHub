---
author: qinyi
created_at: 2026-07-07 23:24:00
goal: frontend /settings/mcp 管理页
implementation: 新建 frontend/src/app/(dashboard)/settings/mcp/page.tsx；JSON 编辑器编辑 platform_default（调 GET/PUT /api/platform-settings/mcp，admin GET 遮蔽 env secret，编辑时可填新值）；白名单编辑器（server 名 list 增删，调 /mcp-whitelist）；zod 校验 mcpServers schema；保存后提示「需重启 daemon 生效」
acceptance: JSON 编辑器 + 白名单 list CRUD 可用（admin）；env secret 遮蔽展示；zod 校验非法 JSON 报错；保存提示重启 daemon；非 admin 只读
verify: cd frontend && pnpm test src/app/\(dashboard\)/settings/mcp + pnpm typecheck
constraints: JSON 编辑器（用户确认）；zod 校验 mcpServers 结构（D-009）；env 遮蔽（D-008 NFR-02）；保存后重启提示（design §5.1 v1 不热推）
depends_on: [task-04]
covers: [FR-10, D-008, D-009, NFR-02]
---

# task-09: frontend /settings/mcp 页

## 验收标准
A. `/settings/mcp` 页：JSON 编辑器（platform_default {mcpServers}）+ 白名单 list 编辑器。
B. env secret（token/key/secret/password 类 key）展示遮蔽；编辑可填新值。
C. zod 校验 mcpServers 结构，非法 JSON 报错不让保存。
D. 保存成功后提示「需重启 daemon 生效」。
E. 非 admin 只读；样式对齐 settings 子页。
