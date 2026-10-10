---
author: qinyi
created_at: 2026-10-10T23:56:00
---
# 提案书（Proposal）— 2026-10-10-all-engines-mcp-injection

## 动机

任务原话转写：平台会话中 PI 不支持 MCP 上传文件到平台（claude code 可以上传）。排查结论：daemon 侧主控 MCP 注入谓词硬编码 claude-only（sillyhub-daemon/src/cli.ts:993-997），且 pi 基线 0.81.1 时代 pi 官方无 MCP（sillyhub-daemon/src/interactive/providers.ts:243-245 如实标记暂缺）。PI 1.0（2026-10-01）已原生支持 MCP，用户拍板路线 A（升级 pi 基线用原生 MCP）且范围扩大：不只 claude/pi，codex/cursor 等所有引擎一起打通平台 MCP 注入（编排工具 + 上传文件到平台）。

## 关键问题

1. **pi 基线升级的兼容性未知**：daemon 的 PiRpcDriver 与 vendored 扩展是对 pi 0.81.1 协议写的（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:221 版本脆弱性注释），pi 1.0 的 rpc 事件流/ExtensionAPI/MCP 消费形态三项均不可离线验证，直接翻值可能破坏既有 pi 会话功能——需要 SPIKE 前置 + 量化截断预案。
2. **各引擎 MCP 配置通道形态各异**：claude 走 SDK options.mcpServers（现成），codex 需 config.toml `[mcp_servers.*]` 托管段扩展（且 app-server 协议模式下是否生效未证），cursor 无 per-session CLI 通道且 headless 审批是上游已知坑——三通道必须各自按引擎官方机制落地，并允许独立截断。
3. **能力矩阵三端一致性**：caps 翻值若只改 daemon 单源而产物不刷新，backend/frontend 行为与 daemon 漂移（守卫测试存在的意义）；翻值必须与实测证据绑定，禁止预翻。

## 变更范围

daemon 侧为主：注入谓词能力化（sillyhub-daemon/src/cli.ts）+ 三引擎 driver/settings 消费通道（sillyhub-daemon/src/pi-settings.ts、sillyhub-daemon/src/interactive/pi-rpc-driver.ts、sillyhub-daemon/src/codex-settings.ts、sillyhub-daemon/src/interactive/codex-app-server-driver.ts、sillyhub-daemon/src/interactive/cursor-driver.ts）+ 能力矩阵翻值（sillyhub-daemon/src/interactive/providers.ts）。backend/frontend 仅生成产物同步（backend/app/modules/agent/provider_caps.py、frontend/src/lib/provider-caps.ts，脚本自动更新）。SPIKE 前置（pi 1.0 兼容总探 / codex app-server 生效性 / cursor headless 审批）产截断预案，任一引擎失败不影响其余收口。

## 不在范围内（显式清单）

- 不做分身（mission_worker）会话的引擎放开（循既有决策 D-008@v1 维持 claude-only，另议另立变更）
- 不做非 MCP 的能力矩阵缺口补齐（codex multimodal/attachments、cursor multimodal 等）
- 不做 daemon↔backend 协议、backend 端点/schema、frontend 手写 UI 的任何改动
- 不做 MCP SDK 锁线变动（backend `mcp>=1.29,<2` 与 daemon `@modelcontextprotocol/sdk ^1.29.0` 联动条款维持）
- 不做宿主机器 pi 二进制的自动安装/升级（daemon 只做版本检测 + 能力降级 + 部署指引）

## 成功标准（可验证）

1. sillyhub-daemon/tests/mcp-config.test.ts 注入矩阵：caps.mcp=true 引擎 × stage∈{'',orchestrator} 注入成立；mission_worker 全引擎不注入；caps.mcp=false 引擎与未知 provider 不注入（行为与现状一致）。
2. pi/codex 各有新增 settings 写盘单测（NEW sillyhub-daemon/tests/pi-settings-mcp.test.ts / sillyhub-daemon/tests/codex-settings-mcp.test.ts）全绿；cursor 按 SPIKE-02 结论落到代码或注释留档（三要素：实测证据/坑点/复评条件）。
3. backend/app/modules/agent/tests/test_provider_caps_alignment.py 全绿（三端 caps 一致）。
4. daemon 既有 MCP 契约与 driver 测试全绿（sillyhub-daemon/tests/mcp-server.test.ts、sillyhub-daemon/tests/mcp-config.test.ts、各 driver 既有测试）。
5. 端到端：每翻值引擎平台会话内 MCP 工具可见 + upload_file 上传文件成功（验收记录留档本变更目录 acceptance-e2e.md）。
