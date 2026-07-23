---
author: qinyi
created_at: 2026-07-07 13:35:00
goal: 新建 daemon mcp-config 合并平台默认 + workspace .mcp.json 并在 spawn claude 时注入白名单校验后的配置
implementation: 新增 sillyhub-daemon/src/mcp-config.ts；读取平台默认 MCP（admin 全局配置）+ workspace 级 specDir/docs/<ws>/.mcp.json（mcpServers 字典）；按 admin 白名单（NFR-03）过滤后合并为单一配置；spawn claude 时写 worktree .claude/.mcp.json 或传 --mcp-config <临时 path>（task-02 spawn 处接线注入）
acceptance: 合并后 mcpServers 含平台默认 + workspace 自定义且过白名单；非白名单 MCP server 被剔除并记日志；spawn claude 时配置生效（claude 能加载 MCP）
verify: cd sillyhub-daemon && pnpm test（mcp-config 合并 + 白名单过滤单测）
constraints: MCP server 白名单由 admin 控制（NFR-03 防恶意 MCP）；配置位置对齐 D-003（平台默认 + workspace .mcp.json specDir）；与 task-02 的 spawn 改造解耦（task-05 只产配置 + 注入入口，task-02 spawn 时调用）
depends_on: []
covers: [FR-05, D-003@V1, NFR-03]
---

# task-05: daemon mcp-config 新建（合并注入 + 白名单）

## 验收标准

A. 新增 sillyhub-daemon/src/mcp-config.ts，实现读取平台默认 MCP 配置（admin 全局）与 workspace 级 specDir .mcp.json，按 admin 白名单过滤后合并为单一 mcpServers 配置。
B. 非白名单的 MCP server 被剔除并记录告警日志（不静默放行，也不崩 daemon）；合并产物供 task-02 spawn claude 时通过 .mcp.json 或 --mcp-config 注入，claude 启动后白名单内 MCP servers 可用。
C. sillyhub-daemon `pnpm test` 全绿，单测覆盖"仅平台默认""仅 workspace""两者合并去重""非白名单被剔除"四条路径，且 daemon 既有启动/spawn 流程零回归。
