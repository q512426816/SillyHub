---
schema_version: 1
doc_type: module-card
module_id: backends
author: qinyi
created_at: 2026-06-10T16:55:00
---

# backends

## 定位
Agent 协议适配层（adapters）。定义纯解析接口 `ProtocolAdapter`（只负责 `parse(line) → AgentEvent[]`）、协议到 provider 的映射表、以及 ESM 动态 `import()` 工厂。**方案 B 核心深化点**：Python 版 `AgentBackend(ABC)` 同时负责执行子进程和解析输出，Node 版彻底拆分——子进程执行下沉到 TaskRunner 唯一一处，本层只做解析。`AgentEvent` IR 统一移至 `types.ts`。

目录由 Python 版 `backends/` 改名为 `adapters/`。模块 id `backends` 保持不变。

## 契约摘要
- `ProtocolAdapter`（接口，定义于 `protocol-adapter.ts`）
  - `provider: ProviderName` — adapter 服务的 provider
  - `parse(line: string): AgentEvent[]` — 解析单行输出，可能返回 0/1/多个事件
  - `onControl?(msg): void` — 可选：stream-json 的 control_request 自动应答钩子
- `AgentEvent` / `AgentEventType` — IR 类型，**实现在 `types.ts`**，本层仅 re-export
- `PROTOCOL_PROVIDERS` — 协议到 provider 列表映射（stream-json / json-rpc / jsonl / ndjson / text）
- `getBackend(provider): ProtocolAdapter` — 工厂，返回 adapter **实例**（非类）

## 关键逻辑
```
getBackend(provider)
  protocol = lookupProtocolByProvider(provider)  // 反查 PROTOCOL_PROVIDERS
  module = await import(`./adapters/${protocolToModule(protocol)}.js`)
  return new module.default()   // 返回实例，纯解析器
```

## 注意事项
- 工厂使用 ESM 动态 `import()`（替代 Python importlib），adapter 子模块只在首次使用时加载
- `PROTOCOL_PROVIDERS` 是协议到 provider 列表的正向映射，新增 provider 需在此注册
- `getBackend` 返回 **实例**（Python 版返回类），调用方无需再实例化
- 新增协议类型需同时：1) 实现 `adapters/<protocol>.ts` 2) 注册到 PROTOCOL_PROVIDERS
- `AgentEvent.type` 值域：text / tool_use / tool_result / error / complete（thinking/status 合并到 text 或 error）
- 子进程执行职责在 TaskRunner，本层不要执行子进程
- 依赖 types 模块（IR 定义）

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
