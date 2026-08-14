---
author: qinyi
created_at: 2026-08-14 16:50:00
status: active
---

# SillySpec CLI 的 MCP 探测必失败：缺 initialize/session 握手 + clientInfo 缺 version

## 现象
`sillyspec dispatch probe` 报 `SillyHub 不可用：daemon-unreachable`，但平台后端 MCP 端点本身完全正常（agent/Claude Code 直连可用，python 直连 tools/list 返回 12 个 tool）。

根因分三层（2026-08-14 逐层实测定位，`sillyspec/src/sillyhub-mcp/client.js`）：

1. **`local.yaml` 的 `mcp.url` 多带 `/mcp` 后缀** → client.js 拼 `${url}/mcp/` 成 `/mcp/mcp/` → 404。url 应为**平台根**（接口地图 §1），client 自己拼 `/mcp/`。
2. **client.js 完全不实现 MCP streamable HTTP 的 `initialize` + session**：直接发 `tools/call`/`tools/list` 不带 `Mcp-Session-Id` → FastMCP v1.29 强制 session → 400 `Missing session ID`。修：惰性 `_ensureSession`（initialize 拿 header `mcp-session-id`）+ 请求带 session + 400 过期重连。
3. **initialize 后未消费响应 body**：FastMCP 在 initialize 的 SSE 流未读完时 session 未就绪，后续带 session 的请求被误判 `-32602 Invalid request parameters`。修：无论 header 有无 session 都 `await res.text()` 读完。
4. **`clientInfo` 缺 `version`**：MCP 2025-11-25 协议要求 `clientInfo` 必含 `name` + `version`，缺 version FastMCP 直接回 `-32602`（连 initialize 都失败）。修：`clientInfo: { name: 'sillyspec-cli', version: getVersion() }`（`src/version.js`）。

## 修复（工具侧，sillyspec 仓库已改未发布）
`sillyspec/src/sillyhub-mcp/client.js` 三处改动（session 字段 + `_sendRpc` 重构 + `_initialize`/`_ensureSession`/`_rpcOnce`），配套 `local.yaml` 两段注释已同步（url 不带 /mcp + token 须真实用户签发）。

验证：`sillyspec dispatch probe` 从 `daemon-unreachable` → `✅ SillyHub 可用`；`list_agent_profiles` 返回真实 profiles。回归：path-a-probe/execute-dispatch-integration/strategy 全绿（仅 4/3/2 个 no-config 预存失败——sillyspec 仓库自己 `.sillyspec/local.yaml` 有 mcp 段污染 no-config 用例，与本改动无关，stash 基线实证同因）。

## 使用侧（当前安装版 3.26.6 未含修复时的坑）
- `local.yaml` `mcp.url` 必须写**平台根**（`http://127.0.0.1:8001`），别写 `/mcp` 后缀；
- McpToken 必须由**真实用户**签发（creator user 决定 dispatch actor），system 签发会报 `MCP token has no creator user to act as the dispatch actor`；
- 修复前 CLI 探测必失败不影响 agent 直连——Claude Code 等成熟 client 走完整 MCP 协议，业务派发（create_mission/dispatch_worker）本来就能用。

## 关联
接口地图 `platform-interface-map.md` §3（client.js 现在做 initialize 握手）。token 派生细节见记忆 `local-yaml-mcp-platform-config`。
