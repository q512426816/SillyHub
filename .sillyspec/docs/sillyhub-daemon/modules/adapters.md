---
schema_version: 1
doc_type: module-card
module_id: adapters
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 输出协议适配公共层（adapters）

## 定位
agent 输出协议适配层的公共层，一模块两文件：`index.ts`（协议映射 + 工厂）与 `protocol-adapter.ts`（纯解析契约接口）。把「6 种子进程输出协议 × 12 个 provider」的差异收敛到统一入口 `getBackend(provider)`；TaskRunner / interactive 只面对 `ProtocolAdapter` 接口，不感知具体协议。方案 B 核心：Python AgentBackend 同时执行子进程 + 解析输出，Node 版彻底拆开——子进程执行下沉 TaskRunner 唯一一处，本层只解析。新增协议 = 新增一个 parse 实现，零侵入编排层。

## 契约摘要
`ProtocolAdapter` 接口（protocol-adapter.ts）：
- `provider: string` —— 必须与映射表注册名逐字一致。
- `parse(line): AgentEvent[] | null` —— 必选核心。解析 stdout 一行产出 0..N 个 IR 事件（Python 单值升级为数组，因 stream_json/jsonl 一行可含多事件）；null 与空数组等价（无产出）。纯函数约束：不抛异常（坏行返回 null 或 error 事件）、不发 I/O；需跨行累积的 adapter 在实例字段维护缓冲。
- `onControl?(line, stdin)` —— 可选，control_request 应答入口（实际仅 stream_json 需要）。
- `buildArgs?(opts)` / `buildInput?(prompt)` —— 可选，spawn 参数与 stdin 初始数据构造；未实现 buildInput 时 TaskRunner 默认写 `${prompt}\n`。
- `buildHandshake?(opts)` / `buildTurnStart?(opts)` —— 可选，json_rpc 协议专用（被动 server 需 daemon 主动发 initialize/thread.start 才开始执行）。
- `BackendExecResult` —— 子进程执行结果简版契约（status: completed/failed/timeout + output + error + sessionId），声明在此避免 TaskRunner ↔ 工厂循环依赖。

工厂与映射（index.ts）：
- `PROTOCOL_PROVIDERS`：6 协议 → 12 provider 冻结映射。stream_json: claude/gemini/cursor；json_rpc: codex/hermes/kimi/kiro；jsonl: copilot；ndjson: opencode/openclaw；pi_json: pi；text: antigravity。
- `getProtocol(provider)`：provider → 协议 O(1) 反查（模块加载时由正向映射预构建扁平表），未命中抛 Error（错误信息含已知 12 provider 列表，便于诊断拼写错误）。
- `getBackend(provider)`：反查协议 → 按协议实例化 adapter，每次返回**新实例**。

## 关键逻辑
```text
getBackend(provider):
  protocol = PROVIDER_TO_PROTOCOL[provider]   # 未命中 → Error(含 12 provider 列表)
  return PROTOCOL_ADAPTER_FACTORIES[protocol](provider)
    # stream_json/json_rpc/ndjson 接收 provider 注入构造器
    # jsonl/pi_json/text 硬编码单 provider，忽略入参
  # 每次返回新实例（adapter 有状态，不可跨 lease 复用）

模块加载即自检：ALL_PROVIDERS.length === 12 且无重复，否则 throw
```

## 注意事项
- adapter 有状态（session id / 序列号 / 输出缓冲 / usage），**禁止跨 lease 复用实例**——工厂每次 new；TaskRunner 重试 attempt 间另有 `resetAccumulator` 鸭子类型重置（见各 adapter 卡）。
- 新增 provider：若属已有协议只需在对应协议数组追加（工厂按协议分发，不看 provider）；新增协议则 `ProtocolType` 联合 + 映射 + 工厂三处补全（TS 编译器强制补全 Record）。
- provider 名全小写、大小写敏感；与 agent-detector 的 PROVIDER_SPECS key 同名，两处需同步注册。
- 与 Python 版差异：Python get_backend 返回类、调用方实例化；Node 直接返回实例（实例化收进工厂）。Node 无需 importlib 懒加载（ES module 无循环导入问题）。
- 方案 B 红线：本层不执行子进程（spawn/stdin/超时归 TaskRunner）。

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
