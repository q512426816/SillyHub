---
schema_version: 1
doc_type: module-card
module_id: mcp-config
author: qinyi
created_at: 2026-08-18 01:45:00
---

# MCP 配置合并与过滤（mcp-config）

## 定位

MCP 配置合并 + 白名单过滤 + daemon 内置 MCP server 配置工厂。把「平台默认 MCP
（admin 全局）」与「workspace 级 .mcp.json」按白名单过滤后合并，spawn agent 时写
临时 .mcp.json 注入（`--mcp-config`）；并构造 daemon 内置 stdio MCP server
（sillyhub-daemon）的启动配置。

## 契约摘要

- 配置源：
  - `loadPlatformMcpConfig()`：本地 `~/.sillyhub/daemon/mcp.json`（不存在/损坏 →
    空配置不报错）。
  - `fetchPlatformMcpConfig(serverUrl, token)`：backend
    `GET /api/daemon/mcp/config`（Bearer）；非 200/网络失败/解析失败 → null。
  - `loadPlatformMcpConfigFromBackend()`：先 backend（admin UI 配置源）后本地文件
    fallback。
- `validateMcpServers(servers, whitelist)`：白名单过滤，剔除项进 rejected + warn
  日志（不静默不崩）。
- `mergeMcpConfigs(whitelist, ...configs)`（旧式）/ `mergeMcpConfigs(whitelist,
  mcpRefs, ...configs)`（新式重载，mcpRefs 只能收紧）→ `MergedMcpResult
  { config, rejected }`。
- `hasAnyMcpServers(...configs)`：快速判定是否需要注入。
- `DAEMON_MCP_SERVER_NAME = 'sillyhub-daemon'`（与 mcp-server.ts 同名常量对齐）。
- `buildDaemonMcpServerConfig(backendUrl, token, serverModulePath?, apiKey?)`：
  产出 `{ command: 'node', args: [<dist/mcp-server.js 绝对路径>], env }`。

## 关键逻辑

```
mergeMcpConfigs 四步:
  1 合并（configs 按优先级低→高，同名后者覆盖）+ 逐个 type 校验（非 stdio 抛错）
  2 白名单 = 传入 whitelist ∪ configs[0]（平台默认位）server 名（隐式允许）
  3 白名单过滤 → validated / rejected
  4 mcpRefs 非空时 validated ∩ mcpRefs（profile 限定第三层，只能收紧）
buildDaemonMcpServerConfig env:
  MCP_SERVER_BACKEND_URL（backend 根 URL 去尾斜杠）
  MCP_SERVER_DAEMON_TOKEN（Bearer 回落）
  MCP_SERVER_DAEMON_API_KEY（可选；有则 mcp-server 优先走 X-API-Key 路径）
```

## 注意事项

- `McpServerConfig.type` 仅允许 `'stdio'`（D-017，防 SSE/HTTP 型 MCP server 打通
  SSRF 通道）；缺省视为 stdio（向后兼容旧配置）；非 stdio **抛错** fail-loud，
  不静默跳过。
- dist/mcp-server.js 路径用 import.meta.url 推导（本文件与 mcp-server.ts 同在
  src/，编译后同在 dist/，相对位置稳定）；测试可经 serverModulePath 覆盖避免依赖
  dist/。Node 20 不支持原生 TS，必须用 tsc 编译产物。
- daemon 内置 server 放 platform 位即自动入白名单，无需额外改白名单逻辑。
- apiKey 与 token 分开两个 env（security-audit task-09 P0）：旧实现把 apiKey 当
  Bearer 发，backend Bearer 路径只解 JWT → 401。空值仍构造配置（server 启动后
  tool 调用返回结构化错误便于诊断）。
- 旧式/新式调用靠第二参数类型区分（string[] = mcpRefs；McpConfig 对象 = 首个
  config），行为向后兼容。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
