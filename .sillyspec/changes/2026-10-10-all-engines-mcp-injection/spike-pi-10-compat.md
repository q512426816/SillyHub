# SPIKE-00 留档：pi 1.0+ 升级兼容性总探（task-01）

- 实测日期：2026-10-11
- 宿主引擎：pi 1.1.0（`pi --version`，npm 全局 @earendil-works/pi-coding-agent@1.1.0）
- 对照基线：pi 0.81.1（sillyhub-daemon/src/interactive/pi-rpc-driver.ts:221 vendored 注释基线）
- 结论：**形态①（原生配置）裁定成立，零截断**——pi 1.1.0 原生内置 MCP，无需 pi-mcp-adapter（形态②作废）、无需自写桥接扩展（形态③作废）

## 实测①：rpc 协议兼容性 — PASS

- spawn `pi --mode rpc --session-dir <tmp>`（对齐 pi-rpc-driver.ts:817 spawn 形态）
- 发送 `{"type":"get_state"}`（driver.ts:1018 启动握手命令）
- 响应：`{"type":"response","command":"get_state","success":true,"data":{model:{...},...}}`——response envelope 形状与 0.81.1 基线一致（type/command 回显/success/data 四要素齐）
- fork 命令说明：1.1.0 `--help` 已列原生 `--fork <path|id>` 参数（fork 语义保留）；rpc 内 `{"type":"fork"}` 命令走同一 response envelope 通道（envelope 兼容已证），fork 端到端行为在 task-05 集成与 task-09 端到端验收覆盖

## 实测②：vendored 扩展装载 — PASS

- `pi --mode rpc --extension <path> --session-dir <tmp>` 分别加载 vendor/pi-extensions/ask-user/index.ts 与 subagent/index.ts（worktree 副本）
- 两者均启动无 error、`get_state` 正常响应（probe 脚本输出：两扩展 get_state ok: true, total events: 1）
- ExtensionAPI registerTool + jiti/virtualModules import 解析在 1.1.0 下向后兼容

## 实测③：MCP 消费形态 — 原生配置（形态①）

- `pi --help`：`pi mcp <command>` 子命令 + `--no-mcp`（"Disable built-in MCP support"）+ `--tools` 的 `mcp__` 命名空间——**原生内置 MCP 客户端**
- 配置读取位置：`~/.pi/agent/mcp.json`（全局）与 `.pi/mcp.json`（trusted 项目级）
- **PI_CODING_AGENT_DIR 重定向实测（关键）**：设 `PI_CODING_AGENT_DIR=<dir>` 后，`pi mcp list` 提示读取 `<dir>\mcp.json`（重定向后 pi root 直接对应 agent 层，无 agent 子层）——**per-session 隔离成立**，daemon 写 `<PI_CODING_AGENT_DIR>/mcp.json` 即可，宿主全局 ~/.pi 零污染
- 配置格式（与 codex 风格一致）：
  ```json
  { "mcpServers": { "<name>": { "command": "node", "args": ["..."], "env": { "MCP_SESSION_ID": "..." } } } }
  ```
- 端到端连接实测：临时 stdio MCP server（@modelcontextprotocol/sdk@1.29.0 registerTool API）→ `pi mcp list --json` 返回 `state: "connected"`、`tools: ["spike_echo"]`——连接 + 工具枚举闭环
- env 透传：`pi mcp add --env KEY=VALUE` 参数与 mcp.json 条目 env 字段存在——per-server env（MCP_SESSION_ID）可经配置条目透传（符合 conventions「env 必须放 mcpServers 条目 env 字段」）
- 工具命名空间：`mcp__<server>__<tool>`（--tools 参数文档证实），rpc 会话内模型可发现调用

## 量化裁定（design Phase 0 阈值对照）

| 阈值 | 触发？ | 依据 |
|---|---|---|
| ① rpc 协议需 driver 全量重写 | 否 | get_state envelope 兼容，仅增量适配面（task-05 集成验证兜底） |
| ② ≥2 个 vendored 扩展需重写 | 否 | ask-user/subagent 零改动装载成功 |
| ③ MCP 消费形态三档全不可用 | 否 | 形态①原生配置全链路连通 |

裁定：**不截断，pi 通道按形态①实现**（task-05）：daemon 在 per-session 目录写 `<PI_CODING_AGENT_DIR>/mcp.json`（引擎无关 mcpServers 配置表直映），宿主版本检测用 `pi --version` 解析主版本 ≥1。

## 实测产物与环境说明

- probe 脚本与临时目录：/tmp/pi-spike/（probe-rpc.mjs、probe-ext.mjs、echo-mcp.mjs、agentdir/mcp.json）
- 宿主 ~/.pi 未被写入（全部隔离在 PI_CODING_AGENT_DIR 临时目录）
- echo server 注意点（task-05 无关但留痕）：@modelcontextprotocol/sdk 1.29 高级 API 为 `registerTool(name, {description, inputSchema: ZodRawShape}, handler)`——`tool()` 旧三参形状在 1.29 已不兼容
