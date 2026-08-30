---
author: qinyi
created_at: 2026-08-26 14:20:00
id: task-05
title_zh: "daemon三件套拉取层"
title: "daemon fetchMcpBundle（三件套拉取 + 预净化 + 回落）"
priority: P0
depends_on: [task-03]
allowed_paths:
  - sillyhub-daemon/src/mcp-config.ts
  - sillyhub-daemon/tests/mcp-config.test.ts
goal: daemon 侧三件套拉取层：平台默认+白名单+工作区配置一次拉取，非 stdio 预净化，全链路容错回落
acceptance: |
  1. fetchMcpBundle(serverUrl, token, workspaceId?, logger?) 返回 McpBundle {platform, whitelist, workspace}
  2. workspace 配置预净化：非 stdio server 跳过 + warn（不抛错、不阻塞会话创建——D-005@v2）
  3. 回落链：拉取失败/非 200/解析失败 → platform 回落本地 ~/.sillyhub/daemon/mcp.json、workspace 回落空配置、whitelist 空，仅记 warn
  4. workspaceId 为 undefined/null → 不带 query 参数或跳过 workspace 维度（quick-chat/legacy shared 场景，D-007@v2/D-008@v1）
  5. 单测覆盖：成功/预净化剔除/回落三态/workspaceId 缺省（沿用 mcp-config.test.ts 既有 mock fetch 模式）
verify: cd sillyhub-daemon && pnpm exec vitest run tests/mcp-config.test.ts
implementation: mcp-config.ts 新增 fetchMcpBundle（复用 fetchPlatformMcpConfig 范式 + 预净化 + 回落链）
constraints: ["预净化不抛错（D-005@v2）", "失败仅 warn 不阻塞（R-03）", "type 缺省视为 stdio"]
provides:
  - contract: "fetchMcpBundle"
    fields: [McpBundle, platform, whitelist, workspace, 预净化, 回落]
expects_from:
  task-03:
    - contract: "GET /api/daemon/mcp/config?workspace_id="
      needs: [platform_default, whitelist, workspace.mcpServers]
---

# task-05: fetchMcpBundle

## 实现要点

1. 复用既有 `fetchPlatformMcpConfig` 的 fetch 范式（同 base url 拼接、同 Bearer 头、null-on-failure）；`loadPlatformMcpConfigFromBackend` 改为 bundle 版或内部组合。
2. 预净化实现：遍历 `workspace.mcpServers`，`type` 非 undefined 且非 'stdio' → delete + `logger('warn', 'mcp_server_prepurged_non_stdio', ...)`；缺省 type 视为 stdio（与 assertMcpServerType 向后兼容口径一致）。
3. 头注释同步修正（design §5.7）：描述真实链路（bundle 拉取 → 预净化 → provider 合并），删除「未接线」的旧宣称。
