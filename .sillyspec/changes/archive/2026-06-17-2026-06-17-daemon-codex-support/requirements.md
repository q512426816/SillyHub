---
author: qinyi
created_at: 2026-06-17T22:50:00
---

# Requirements — daemon codex provider 完整支持

## 功能需求

### FR-01 codex quick chat 可用
用户在 /runtimes 页选 Codex provider 发送消息，daemon 应在 60s 内返回 agent 响应（含 thread_id / usage），不超时。

**验收**：手动在 /runtimes 发送 "say hello"，daemon 日志含 `[SYSTEM:init] cwd=...` → `[TOOL_USE]` / `[ASSISTANT]` 响应 → `[complete]` 事件；前端收到完整 message。

### FR-02 codex scan 可用
workspace 详情页 Bootstrap → scan run 用 codex provider 跑 sillyspec scan，应正常完成 10 步产出 7 文档。

**验收**：触发 scan run，daemon 日志显示 codex app-server 启动 + thread/start + turn/start + 完整事件流；scan_run 状态为 success 或 completed_with_warnings。

### FR-03 codex task 可用
change-center 的 task 用 codex provider 执行，应正常完成。

**验收**：触发 task run，daemon 日志显示完整 codex 事件流；task 状态为 completed。

### FR-04 ProtocolAdapter 接口扩展
ProtocolAdapter 新增 `buildHandshake?(opts): string[]` 与 `buildTurnStart?(opts): string` 可选方法。

**验收**：
- 接口扩展不破坏现有 5 adapter 编译
- stream-json/jsonl/ndjson/text 不实现这两个方法（undefined → TaskRunner 跳过）
- 仅 JsonRpcAdapter 实现

### FR-05 TaskRunner 握手序列集成
TaskRunner._spawnAndStream 在 buildInput 后增加 buildHandshake 写入；_handleLine 检测 thread/start response（id=2，result.thread.id 存在）后调 adapter.buildTurnStart 写 turn/start request。

**验收**：
- codex lease 跑完，daemon 日志含完整 4 条握手 request（initialize/initialized/thread.start/turn.start）
- claude lease 跑完，行为与现有完全一致（无 buildHandshake 调用）

### FR-06 其他协议启动参数补全
- copilot buildArgs: `['--output-format', 'json']`
- opencode/openclaw/pi buildArgs: `['run', '--format', 'json', '--dangerously-skip-permissions', prompt]`（prompt 在 args，buildInput 不调用）
- antigravity buildArgs: 占位 `[]`（agent-detector 应已标 offline）

**验收**：jsonl.test.ts / ndjson.test.ts 新增 buildArgs 单元测试覆盖。

### FR-07 claude 不回归
现有 claude provider 行为完全保持，task-runner.test.ts / stream-json.test.ts / claude 集成测试全部通过。

**验收**：`pnpm test` 全套通过。

## 非功能需求

### NFR-01 协议健壮性
- codex app-server 推送的无关 notification（remoteControl/status/changed / mcpServer/startupStatus/updated）不破坏 daemon 解析
- thread/start response 字段缺失时不 crash（warn 日志 + 终止 lease）

### NFR-02 测试覆盖
- json-rpc.test.ts: buildHandshake / buildTurnStart 各 3+ 用例
- task-runner-provider-dispatch.test.ts: codex 端到端 mock 测试

## 决策记录

- **D-01@v1 codex 走 JSON-RPC 完整握手**（不是 codex exec --json）：与模块文档 backend-json-rpc.md 设计一致，保留多轮/审批/session_id 能力
- **D-02@v1 实现优先级**：codex（必做）> copilot/opencode/openclaw/pi（文档化+最小实现）> hermes/kimi/kiro/antigravity（仅文档化）
- **D-03@v1 buildHandshake 是可选方法**：不破坏现有 5 adapter，仅 json_rpc 实现
- **D-04@v1 threadId 延迟绑定**：buildHandshake 只返回 initialize/initialized/thread.start；turn/start 在 TaskRunner._handleLine 收到 thread/start response 后用真实 threadId 调 buildTurnStart

## 剩余风险

- **R-01 copilot/opencode/openclaw/pi 启动参数未实测**：基于文档/源码注释，execute 阶段需要实测验证（可能需要微调 args/flags）
- **R-02 codex turn/start instructions 字段格式**：实测用 `instructions: [<prompt>]`（数组），若 codex 期待其他格式需调整
- **R-03 hermes/kimi/kiro/antigravity 文档化**：用户期望这些 provider 可用，但实现层不交付（无 CLI 二进制）
