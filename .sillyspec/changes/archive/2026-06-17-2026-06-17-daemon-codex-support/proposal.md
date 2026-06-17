---
author: qinyi
created_at: 2026-06-17T22:50:00
---

# Proposal — daemon codex provider 完整支持

## 问题

用户在 /runtimes quick chat 选 Codex provider 发送消息，请求超时；claude provider 正常。

**根因**：sillyhub-daemon 5 协议 12 provider 中，仅 stream_json（claude/gemini/cursor）的 buildArgs/buildInput 完整实现。json_rpc 协议（codex/hermes/kimi/kiro）虽然 buildArgs 已在 ql-20260617-006 补了 codex 的 `app-server --listen stdio://`，但：
1. **缺 JSON-RPC 握手**：daemon 写到 codex stdin 的只是裸 prompt 文本，不是合法的 `initialize` / `thread/start` / `turn/start` JSON-RPC request。codex app-server 等不到指令 → daemon readline 等不到响应 → lease 超时
2. **Python 版 json_rpc.py 已删除**：迁 Node 时只迁移了 parse 部分，握手代码丢失
3. **模块文档声称已下沉**：backend-json-rpc.md:36 写"JSON-RPC 传输下沉到 TaskRunner"，但 TaskRunner 实际没实现

**审计发现**：除 stream_json 外，jsonl (copilot) / ndjson (opencode/openclaw/pi) / text (antigravity) 的 buildArgs/buildInput 也全部缺失，daemon 实际只支持 claude。

## 方案

走 JSON-RPC 完整握手协议（方案 A，详见 design.md）：

1. **ProtocolAdapter 接口扩展**：新增可选 `buildHandshake(opts)` 方法，返回 spawn 后需立即写到 stdin 的 JSON-RPC request 序列
2. **TaskRunner 集成**：spawn 后写 buildHandshake；监听 thread/start response 后调 adapter.buildTurnStart(threadId, prompt) 写 turn/start request
3. **JsonRpcAdapter 实现**：
   - buildHandshake: 返回 initialize + initialized + thread/start 三条 request
   - buildTurnStart: 返回 turn/start request（含真实 threadId）
4. **其他协议 buildArgs/buildInput 补全**：
   - copilot: `['--output-format', 'json']` + 默认 buildInput
   - opencode/openclaw/pi: `['run', '--format', 'json', '--dangerously-skip-permissions', prompt]`
   - antigravity: 文档化为待实现（无 CLI 二进制）

## 范围

- **核心**：codex provider 在 daemon 中可用（quick chat + scan + task 三入口）
- **附属**：copilot/opencode/openclaw/pi 启动参数补全（基于文档/源码注释，execute 阶段实测验证）
- **不在范围**：hermes/kimi/kiro/antigravity 仅文档化（当前无可用 CLI 二进制）；frontend 不动

## 价值

- daemon 真正支持多 provider 路由（之前只是 agent-detector 检测到，但实际跑不起来）
- 用户可在 /runtimes 选 codex 作 provider 跑 scan/task/quick-chat
- 长期：其他 provider（copilot/opencode 等）也有 baseline 启动参数，未来实测时仅需微调
