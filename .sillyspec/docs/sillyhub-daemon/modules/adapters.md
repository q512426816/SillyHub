---
schema_version: 1
doc_type: module-card
module_id: adapters
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:10:13
---
# adapters

## 定位
Agent 协议适配层（`adapters/` 目录）。定义纯解析接口 `ProtocolAdapter`（只负责把子进程 stdout 一行解析成 AgentEvent IR）、5 协议→12 provider 的映射表、以及同步工厂 `getBackend`。**方案 B 核心深化点**：Python `AgentBackend(ABC)` 同时执行子进程 + 解析输出，Node 版彻底拆分——子进程执行下沉到 TaskRunner 唯一一处，本层只解析。AgentEvent IR 定义在 types.ts。目录由 Python `backends/` 改名 `adapters/`。

## 契约摘要
- `ProtocolAdapter`（接口，protocol-adapter.ts）：
  - `provider`：adapter 服务的 provider 名。
  - `parse(line): AgentEvent[] | null`：解析单行 → 0..N 事件（Python 单值升级为数组）；纯函数，不修改全局状态、不发 I/O、不抛异常（坏行返回 null）。
  - `onControl?(line, stdin)`：可选，control_request 自动应答钩子（stream-json 用）。
  - `buildArgs?(opts)`：可选，构造 spawn 参数。
  - `buildHandshake?/buildTurnStart?`：可选，json-rpc 双向消息构造。
  - 累加器方法：`resetAccumulator?`、`getSessionId?`、`getOutput?` 等（供 TaskRunner 取 sessionId/stats）。
- `ProtocolType`：`'stream_json'|'json_rpc'|'jsonl'|'ndjson'|'text'`。
- `PROTOCOL_PROVIDERS`：协议→provider 列表正向映射（与 Python 逐字一致）：
  - stream_json: claude/gemini/cursor；json_rpc: codex/hermes/kimi/kiro；jsonl: copilot；ndjson: opencode/openclaw/pi；text: antigravity。
- `PROVIDER_TO_PROTOCOL`：provider→协议反查表（O(1)，模块加载时构建）。
- `getProtocol(provider)` / `getBackend(provider): ProtocolAdapter`：工厂返回**新实例**（非类）。

## 关键逻辑
```
// 模块加载即自检：12 provider 全覆盖 + 去重（不满足直接 throw）
getBackend(provider):
  protocol = PROVIDER_TO_PROTOCOL[provider]   // 未命中 throw（信息含 12 provider 列表）
  return PROTOCOL_ADAPTER_FACTORIES[protocol](provider)
    // stream_json/json_rpc/ndjson 接收 provider 注入构造器
    // jsonl/text 硬编码单 provider，忽略入参
    // 每次返回新实例（adapter 有状态，不可跨 lease 复用，B-04）
```

## 注意事项
- 工厂返回**实例**（Python 返回类由调用方实例化），实例化收进工厂；每次新实例语义一致。
- adapter 有状态（累积 session/序列号/assistant 块/usage），**不可跨 lease 复用**，TaskRunner 每次 runLease 都 getBackend 新建。
- 新增 provider：1) 在对应协议数组追加；2) 若属已有协议无需改 switch（switch 按 protocol 分发）；3) PROTOCOL_PROVIDERS 自检会强制 12 全覆盖。
- 新增协议：实现 `adapters/<protocol>.ts` + 在 ProtocolType 联合追加 + PROTOCOL_ADAPTER_FACTORIES 补 thunk。
- 方案 B：本层不要执行子进程（spawn/stdin/超时归 TaskRunner）。
- 依赖 types（IR 定义）。被 task-runner、daemon 及 5 个具体 adapter 使用。

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->
