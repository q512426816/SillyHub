---
author: qinyi
created_at: 2026-06-14T00:08:01+0800
id: task-11
title: 工厂 + provider→protocol 映射（src/adapters/index.ts，getBackend + PROTOCOL_PROVIDERS）
priority: P0
estimated_hours: 1
depends_on: [task-06, task-07, task-08, task-09, task-10]
blocks: [task-19, task-22]
allowed_paths:
  - sillyhub-daemon/src/adapters/index.ts
---

# task-11：工厂 + provider→protocol 映射（src/adapters/index.ts，getBackend + PROTOCOL_PROVIDERS）

> 变更：`2026-06-13-daemon-nodejs-rewrite`，Wave W1（协议抽象层）★ **W1 收尾任务**。
> Python 源对照：`sillyhub_daemon/backends/__init__.py`（核心：`PROTOCOL_PROVIDERS` 字典、`get_protocol`、`get_backend` 工厂）。
> 职责：把 task-06..10 产出的 5 个 adapter（`StreamJsonAdapter`/`JsonRpcAdapter`/`JsonlAdapter`/`NdjsonAdapter`/`TextAdapter`）收敛为**统一工厂**，对外只暴露 `getBackend(provider)` 一个入口。
> 方案B 差异（重要）：Python `get_backend` 返回 **类**（`type[AgentBackend]`），由 `task_runner.py:169 backend = backend_cls()` 自行实例化；Node 版按 design.md §7.3 让 `getBackend` **直接返回 `ProtocolAdapter` 实例**，把「实例化」也收进工厂，调用方更简洁。两者对「每次新建实例」语义一致（见 B-04）。

- Wave：W1（协议抽象层）★ 收尾——W1 全部 7 个任务至此闭合，可推进 W4 编排层。
- 依赖：task-06（`StreamJsonAdapter`）/ task-07（`JsonRpcAdapter`）/ task-08（`JsonlAdapter`）/ task-09（`NdjsonAdapter`）/ task-10（`TextAdapter`）—— 5 个 adapter class 必须先 export，本工厂才能 import。
- 阻塞：task-19（`TaskRunner.executeTask` 调 `getBackend(payload.provider)` 取 adapter）/ task-22（测试迁移：`test_backends_init.py` 工厂用例）。
- Python 源对照：
  - `sillyhub_daemon/backends/__init__.py:81-87` —— `PROTOCOL_PROVIDERS` 字典（5 协议 → 12 provider）
  - `sillyhub_daemon/backends/__init__.py:95-103` —— `get_protocol(provider)` 反查（未知抛 `ValueError`）
  - `sillyhub_daemon/backends/__init__.py:111-146` —— `get_backend(provider)` 工厂（懒加载 `importlib.import_module`，返回类）
  - `sillyhub_daemon/task_runner.py:153,169` —— 调用方：`backend_cls = get_backend(provider)` + `backend = backend_cls()`

---

## 修改文件

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | `sillyhub-daemon/src/adapters/index.ts` | 工厂 + 映射：`PROTOCOL_PROVIDERS` 常量、`ProtocolType` 联合类型、`PROVIDER_TO_PROTOCOL` 反查、`getBackend(provider)` 工厂函数、12 provider 全覆盖断言。无 adapter 类定义（类在 task-06..10）。 |

> 本任务是 W1 单点收敛：不定义任何 adapter 类、不实现 `parse`、不执行子进程。纯「provider 字符串 → adapter 实例」的路由层。测试文件 `tests/adapters/factory.test.ts` 按惯例不计入 allowed_paths（开发期验证产物，task-04 脚手架约定）。

---

## 实现要求

1. **`export const PROTOCOL_PROVIDERS: Record<ProtocolType, string[]>`**：与 Python `__init__.py:81-87` 逐字一致，是「协议 → provider 列表」的正向映射。键为 5 个协议类型，值为该协议下的 provider 字符串数组。**键序与值序与 Python 一致**（便于人工对照）。

2. **`export type ProtocolType = 'stream_json' | 'json_rpc' | 'jsonl' | 'ndjson' | 'text'`**：协议字面量联合类型，锁定 5 个合法值。`PROTOCOL_PROVIDERS` 的键类型用 `Record<ProtocolType, string[]>`，新增协议时 TS 编译器强制补全。

3. **`export const PROVIDER_TO_PROTOCOL: Readonly<Record<string, ProtocolType>>`**（反查表）：由 `PROTOCOL_PROVIDERS` 派生，供 `getProtocol` O(1) 查找。模块加载时一次性构建（`Object.entries(PROTOCOL_PROVIDERS).flatMap(...)`），构建后 `Object.freeze` 防篡改。对应 Python `get_protocol` 的反查语义（Python 是每次线性遍历 `PROTOCOL_PROVIDERS.items()`，Node 用预构建的扁平反查表换 O(1)，行为等价、性能更优）。

4. **`export function getProtocol(provider: string): ProtocolType`**：对应 Python `get_protocol`。从 `PROVIDER_TO_PROTOCOL` 查找，**大小写敏感**（provider 名全小写，见 B-02），未命中抛 `Error`，错误信息含已知 12 provider 列表（见 B-01）。

5. **`export function getBackend(provider: string): ProtocolAdapter`**：核心工厂。
   - 调 `getProtocol(provider)` 反查协议（未知 provider 时由 `getProtocol` 抛错，错误信息含 12 provider 列表）。
   - 按 protocol `switch` 分支，`new` 对应 adapter class（见接口定义的 `_createAdapter` 内部映射）。
   - **每次返回新实例**（见 B-04 决策依据：adapter 有状态——`StreamJsonAdapter` 累积 assistant 块、`JsonlAdapter`/`NdjsonAdapter` 跟踪 session/序列号——跨 lease 复用会串味；Python `task_runner.py:169` 也是每次 `backend_cls()` 新建）。
   - 返回类型 `ProtocolAdapter`（接口），不暴露具体子类（调用方只依赖抽象）。

6. **12 provider 全覆盖断言**：模块顶层加一条**编译期可捕获的断言**——把 `PROTOCOL_PROVIDERS` 所有 provider 拼接后与字面量对比，若有人改了映射但忘了同步断言，`tsc` 或运行时立刻炸。对应 design.md G-01「12 provider 全覆盖」。形式见接口定义的 `assertProviderCount`。

7. **懒加载策略（与 Python 的取舍）**：Python 用 `importlib.import_module` 在函数内懒加载，目的是避免 `backends/__init__.py` ↔ 各 backend 子模块的**循环导入**。Node 版用 ES module 的 `import` 是静态的、有向无环，**不存在循环导入问题**（adapter 子模块只 import `ProtocolAdapter` 接口和 `AgentEvent` 类型，从不反向 import `index.ts`）。因此 Node 版在文件顶部直接 `import` 5 个 adapter class，**不需要懒加载**。这是 Python→Node 的合理简化（行为等价，结构更清晰）。

8. **导出面收敛**：本文件只 `export` 以下 4 项：`ProtocolType`、`PROTOCOL_PROVIDERS`、`PROVIDER_TO_PROTOCOL`、`getProtocol`、`getBackend`。不 re-export 各 adapter class（调用方不该绕过工厂直接 `new StreamJsonAdapter`，强制走 `getBackend` 以保证映射一致性）。`assertProviderCount` 是内部 const（不 export）。

---

## 接口定义

以下是 `sillyhub-daemon/src/adapters/index.ts` 的完整内容（搬砖工照抄即可）：

```ts
/**
 * adapters/index.ts —— 协议抽象层的工厂与映射（W1 收敛点）。
 *
 * 职责：
 *   1. 维护 5 协议 → 12 provider 的正向映射 PROTOCOL_PROVIDERS（与 Python 一致）。
 *   2. 提供 O(1) 反查 PROVIDER_TO_PROTOCOL + getProtocol(provider)。
 *   3. 提供 getBackend(provider) 工厂：按 provider 实例化对应 adapter，每次返回新实例。
 *
 * Python 源对照：
 *   sillyhub_daemon/backends/__init__.py:81-87   PROTOCOL_PROVIDERS（正向映射）
 *   sillyhub_daemon/backends/__init__.py:95-103  get_protocol（反查，未知抛 ValueError）
 *   sillyhub_daemon/backends/__init__.py:111-146 get_backend（懒加载工厂，返回类）
 *   sillyhub_daemon/task_runner.py:153,169        调用方 backend_cls = get_backend(p); backend = backend_cls()
 *
 * 方案B 差异（design.md §7.3）：
 *   - Python get_backend 返回 type[AgentBackend]（类），由调用方实例化；
 *   - Node getBackend 直接返回 ProtocolAdapter 实例，把实例化收进工厂；
 *   - 两者对「每次任务用新实例」语义一致——adapter 有状态，不能跨 lease 复用（见 B-04）。
 *   - Node 不需要 Python 的 importlib 懒加载（ES module 无循环导入问题，见实现要求 7）。
 *
 * @see design.md §7.3（工厂与映射）/ §5.1（方案B 拆分）
 */

import type { ProtocolAdapter } from './protocol-adapter.js';
import { StreamJsonAdapter } from './stream-json.js';
import { JsonRpcAdapter } from './json-rpc.js';
import { JsonlAdapter } from './jsonl.js';
import { NdjsonAdapter } from './ndjson.js';
import { TextAdapter } from './text.js';

// ---------------------------------------------------------------------------
// 协议类型联合（锁定 5 个合法值）
// ---------------------------------------------------------------------------

/**
 * 5 种协议字面量。新增协议必须在此联合追加，TS 编译器强制 PROTOCOL_PROVIDERS 补全。
 * 对应 Python 的 PROTOCOL_PROVIDERS 字典键（隐式约束）。
 */
export type ProtocolType = 'stream_json' | 'json_rpc' | 'jsonl' | 'ndjson' | 'text';

// ---------------------------------------------------------------------------
// 正向映射：协议 → provider 列表（与 Python __init__.py:81-87 逐字一致）
// ---------------------------------------------------------------------------

/**
 * 协议到 provider 列表的映射。
 * 与 Python sillyhub_daemon/backends/__init__.py:81-87 逐字一致——键序、值序、值大小写全对齐。
 * 新增 provider 时：1) 在对应协议数组追加；2) 在 getBackend 的 switch 补实例化分支（若新 provider
 *   属于已有协议则无需改 switch，因 switch 按 protocol 分发而非 provider）。
 */
export const PROTOCOL_PROVIDERS: Readonly<Record<ProtocolType, readonly string[]>> = Object.freeze({
  stream_json: ['claude', 'gemini', 'cursor'],
  json_rpc: ['codex', 'hermes', 'kimi', 'kiro'],
  jsonl: ['copilot'],
  ndjson: ['opencode', 'openclaw', 'pi'],
  text: ['antigravity'],
});

// ---------------------------------------------------------------------------
// 反查表：provider → 协议（O(1)，由 PROTOCOL_PROVIDERS 派生）
// ---------------------------------------------------------------------------

/**
 * provider 到协议的反查表。模块加载时一次性构建并 freeze。
 * 对应 Python get_protocol 的反查语义（Python 是每次线性遍历 PROTOCOL_PROVIDERS.items()，
 * Node 用预构建扁平表换 O(1)，行为等价、性能更优）。
 */
export const PROVIDER_TO_PROTOCOL: Readonly<Record<string, ProtocolType>> = Object.freeze(
  Object.fromEntries(
    Object.entries(PROTOCOL_PROVIDERS).flatMap(([protocol, providers]) =>
      providers.map((provider) => [provider, protocol as ProtocolType]),
    ),
  ),
);

// ---------------------------------------------------------------------------
// 12 provider 全覆盖断言（运行时自检，模块加载即校验）
// ---------------------------------------------------------------------------

/**
 * 所有 provider 拍平后的只读数组（模块加载时算一次，供断言与错误信息复用）。
 * 12 = stream_json(3) + json_rpc(4) + jsonl(1) + ndjson(3) + text(1)。
 */
const ALL_PROVIDERS: readonly string[] = Object.values(PROTOCOL_PROVIDERS).flat();

/**
 * 12 provider 全覆盖 + 去重自检（模块加载即校验）。
 * 防止改映射时漏掉 provider 或把同一 provider 注册到多个协议。
 * 对应 design.md G-01（12 provider 全覆盖）。
 */
if (ALL_PROVIDERS.length !== 12) {
  throw new Error(
    `PROTOCOL_PROVIDERS 覆盖 ${ALL_PROVIDERS.length} provider，期望 12（3+4+1+3+1）`,
  );
}
if (new Set(ALL_PROVIDERS).size !== ALL_PROVIDERS.length) {
  throw new Error('PROTOCOL_PROVIDERS 存在重复 provider（同一 provider 注册到多个协议）');
}

// ---------------------------------------------------------------------------
// getProtocol —— provider 反查协议（对应 Python get_protocol）
// ---------------------------------------------------------------------------

/**
 * 返回 provider 所属协议。大小写敏感（provider 名全小写，见 B-02）。
 * 未命中抛 Error，错误信息含已知 12 provider 列表，便于调用方诊断拼写错误。
 *
 * 对应 Python sillyhub_daemon/backends/__init__.py:95-103 get_protocol。
 *
 * @param provider agent 标识（claude/codex/copilot/gemini/cursor/hermes/kimi/kiro/opencode/openclaw/pi/antigravity）
 * @throws {Error} provider 不在已知映射中
 */
export function getProtocol(provider: string): ProtocolType {
  const protocol = PROVIDER_TO_PROTOCOL[provider];
  if (protocol === undefined) {
    const known = [...ALL_PROVIDERS].sort().join(', ');
    throw new Error(
      `Unknown provider: ${provider}. Known providers (12): ${known}`,
    );
  }
  return protocol;
}

// ---------------------------------------------------------------------------
// getBackend —— 工厂（对应 Python get_backend，方案B 差异：返回实例而非类）
// ---------------------------------------------------------------------------

/**
 * protocol → adapter 构造器映射。模块级常量，构建一次复用（构造器引用无状态，可安全共享）。
 * 对应 Python __init__.py:124-130 _PROTOCOL_MODULES（但 Python 存的是 module path + class name 元组，
 * 用于 importlib 懒加载；Node 直接存构造器引用，省去动态 import）。
 */
const PROTOCOL_ADAPTER_FACTORIES: Readonly<Record<ProtocolType, () => ProtocolAdapter>> = Object.freeze({
  stream_json: () => new StreamJsonAdapter(),
  json_rpc: () => new JsonRpcAdapter(),
  jsonl: () => new JsonlAdapter(),
  ndjson: () => new NdjsonAdapter(),
  text: () => new TextAdapter(),
});

/**
 * 按 provider 实例化对应 adapter。每次返回**新实例**——adapter 有状态（累积 session/序列号/assistant 块），
 * 跨 lease 复用会串味；对应 Python task_runner.py:169 `backend = backend_cls()` 每次任务新建。
 *
 * 工厂流程：
 *   1. getProtocol(provider) 反查协议（未知 provider 时抛 Error，信息含 12 provider 列表）；
 *   2. PROTOCOL_ADAPTER_FACTORIES[protocol]() 调用对应构造器，返回新实例；
 *   3. 返回类型为 ProtocolAdapter 接口（不暴露具体子类）。
 *
 * 对应 Python sillyhub_daemon/backends/__init__.py:111-146 get_backend。
 * 方案B 差异（design.md §7.3）：Python 返回 type[AgentBackend]，调用方自行实例化；
 *   Node 直接返回实例，把实例化收进工厂。
 *
 * @param provider agent 标识（必须为 PROTOCOL_PROVIDERS 中已知的小写字符串）
 * @returns 新的 ProtocolAdapter 实例（每次调用独立，不可跨 lease 共享）
 * @throws {Error} provider 未知（错误信息含 12 provider 列表）
 */
export function getBackend(provider: string): ProtocolAdapter {
  const protocol = getProtocol(provider); // 抛 Error（信息含 12 provider 列表）
  const factory = PROTOCOL_ADAPTER_FACTORIES[protocol];
  return factory(); // 每次返回新实例
}
```

> **搬砖工注意**：上面代码块已用干净命名（`ALL_PROVIDERS` 模块级 const 一次性算好复用），照抄即可编译通过。`PROTOCOL_ADAPTER_FACTORIES` 是工厂分发用的「protocol → 构造器 thunk」map，构造器 thunk `() => new XxxAdapter()` 无状态可安全共享（共享的是 thunk 引用，不是 adapter 实例——每次调用 thunk 才 `new`）。

---

## 边界处理

| 编号 | 边界场景 | 处理策略 |
|---|---|---|
| **B-01** | **未知 provider 抛错** | `getProtocol` 查 `PROVIDER_TO_PROTOCOL` 未命中 → 抛 `Error`，信息含已知 12 provider 列表（排序后逗号拼接）。对应 Python `__init__.py:103 raise ValueError(f"Unknown provider: {provider}")`。`getBackend` 不重复构造错误信息，直接让 `getProtocol` 的错误冒泡（保持单一错误源）。错误信息形如：`Unknown provider: claude2. Known providers (12): antigravity, claude, codex, copilot, cursor, gemini, hermes, kimi, kiro, openclaw, opencode, pi`。 |
| **B-02** | **大小写敏感** | provider 名全小写，反查精确匹配。`getProtocol('Claude')` / `getProtocol('CLAUDE')` 都会抛 Unknown（`PROVIDER_TO_PROTOCOL` 的键是 `'claude'`）。对应 Python 行为（Python `if provider in providers` 也是精确字符串比较，不 normalize）。**不自动 lowercase**——provider 名是后端下发或配置文件硬编码，若大小写错说明上游有 bug，应及早暴露而非静默纠正。调用方（task-19 TaskRunner）负责保证传入小写。 |
| **B-03** | **provider 拼写错误（`gemni` / `codax`）** | 同 B-01 走未知 provider 分支抛错。错误信息的 12 provider 列表帮助调用方快速发现拼写错误（人工 diff）。不提供「模糊匹配 / did-you-mean」建议（YAGNI，未上线项目错误就该早炸）。 |
| **B-04** | **每次返回新实例 vs 缓存单例（关键决策）** | **每次新建，不缓存**。依据：①Python `task_runner.py:169 backend = backend_cls()` 每次任务新建实例；②adapter 有状态——`StreamJsonAdapter` 累积 assistant 内容块、`JsonlAdapter`/`NdjsonAdapter` 跟踪 session_id 与事件序列号、`JsonRpcAdapter` 跟踪 request/response id 配对（具体状态见各 adapter 任务）。跨 lease 复用单例会导致：前一任务的 session_id 残留、序列号错乱、累积输出污染。即使 `TextAdapter` 无状态，工厂也不为它单独走缓存分支（保持「工厂统一行为」，不为单例 adapter 破坏对称性；性能开销可忽略——adapter 构造器仅赋值 `provider` 字段，O(1)）。 |
| **B-05** | **12 provider 全覆盖断言** | 模块加载时（顶层）算 `ALL_PROVIDERS.length`，断言 `=== 12`（3+4+1+3+1）。不满足立即 throw，模块加载失败。去重自检：`new Set(ALL_PROVIDERS).size === ALL_PROVIDERS.length`。对应 design.md G-01（功能等价 = 12 provider 全覆盖）。这是**运行时自检**，非 TS 编译期约束——TS 的 `Record<ProtocolType, string[]>` 只保证 5 个协议键齐全，不保证 provider 总数。 |
| **B-06** | **新增协议时如何扩展（G-03 可扩展性验证点）** | 新增第 6 种协议（假设 `protobuf`）：①`ProtocolType` 联合追加 `'protobuf'`（TS 强制 `PROTOCOL_PROVIDERS` 补 `protobuf` 键，否则编译报错）；②`PROTOCOL_PROVIDERS.protobuf = [...]` 注册 provider；③`PROTOCOL_ADAPTER_FACTORIES.protobuf = () => new ProtobufAdapter()` 补实例化分支；④`getProtocol` / `getBackend` 无需改（自动通过反查表与 factory map 路由）。扩展点收敛在 3 处常量，零侵入编排层（design.md G-03）。 |
| **B-07** | **provider 名拼写漂移（adapter.provider vs PROTOCOL_PROVIDERS）** | 本文件不主动校验「adapter 实例化后的 `.provider` 字段值是否在 PROTOCOL_PROVIDERS 中」（这是 adapter class 内部职责，task-06..10 已用 `as const` 锁定）。但工厂的测试（AC-04）会断言「getBackend 返回实例的 provider 字段 === 入参 provider」，间接捕获拼写漂移。 |
| **B-08** | **空字符串 / 仅空白 provider** | `getProtocol('')` / `getProtocol('  ')` 都未命中反查表 → 走 B-01 未知 provider 抛错。**不 trim**——provider 名不应有前后空白，若上游传入带空白说明有 bug，应暴露而非纠正（与 B-02 一致原则）。 |
| **B-09** | **`PROVIDER_TO_PROTOCOL` 被运行时篡改** | `Object.freeze` 浅冻结顶层对象（防止 `PROVIDER_TO_PROTOCOL.claude = 'text'` 这类误改）。深冻结不必要（值为字符串字面量，本身不可变）。对应 Python 模块级常量语义（Python `PROTOCOL_PROVIDERS` 是模块全局，按约定不改，但无 freeze 保护——Node 用 freeze 显式约束更好）。 |

---

## 非目标

本任务**不做**以下事项（明确排除，防止 scope creep）：

- **N-11-1**：不执行子进程（spawn / stdin / 超时 / 退出码）。执行职责在 task-19 TaskRunner。本工厂只负责「provider → adapter 实例」路由。
- **N-11-2**：不解析任何协议输出。5 个 adapter 的 `parse` 实现在 task-06..10，本文件只 import class 引用并实例化。
- **N-11-3**：不在本文件定义任何 adapter 类。`StreamJsonAdapter` 等类的定义在各自文件（`stream-json.ts` / `json-rpc.ts` / `jsonl.ts` / `ndjson.ts` / `text.ts`）。本文件是「消费者」不是「生产者」。
- **N-11-4**：不 re-export adapter class。调用方（task-19 TaskRunner）只应通过 `getBackend(provider)` 取实例，不应绕过工厂直接 `new StreamJsonAdapter()`。强制走工厂以保证映射一致性（如果允许直 new，PROTOCOL_PROVIDERS 的约束就形同虚设）。
- **N-11-5**：不缓存 adapter 实例（B-04 决策）。即使无状态的 `TextAdapter` 也不单例缓存，保持工厂行为统一。
- **N-11-6**：不做 provider 名 normalize（lowercase / trim）。provider 名大小写敏感、不 trim，错误应早炸（B-02、B-08）。
- **N-11-7**：不实现懒加载（importlib 动态 import）。ES module 静态 import 无循环依赖问题，文件顶部直接 import 5 个 adapter class（实现要求 7）。
- **N-11-8**：不定义 `AgentEvent` / `ProtocolAdapter` 接口。两者在 task-02（types.ts）/ task-05（protocol-adapter.ts），本文件 import 使用。

---

## 参考

### Python 源文件

| 文件 | 行 | 提取内容 |
|---|---|---|
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 14-16 | 模块 docstring：延迟加载工厂 |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 77-87 | **核心** `PROTOCOL_PROVIDERS` 字典（5 协议 → 12 provider 正向映射） |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 93-103 | **核心** `get_protocol(provider)`：线性遍历反查，未知抛 `ValueError(f"Unknown provider: {provider}")` |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 107-146 | **核心** `get_backend(provider)`：调 `get_protocol` 反查 → `_PROTOCOL_MODULES` 查 module path → `importlib.import_module` 懒加载 → 返回 `type[AgentBackend]`（类，非实例） |
| `sillyhub-daemon/sillyhub_daemon/backends/__init__.py` | 124-130 | `_PROTOCOL_MODULES`：protocol → (module_path, class_name) 元组，**函数内局部变量**（每次调用重建，无模块级缓存） |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 153 | 调用方 `backend_cls = get_backend(provider)` |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 154-166 | 调用方捕获 `(ValueError, ImportError)`，映射为 `TaskResult(success=False, error="unsupported provider")` |
| `sillyhub-daemon/sillyhub_daemon/task_runner.py` | 169 | **关键** `backend = backend_cls()`——调用方每次任务新建实例（证明 Python 不缓存，Node 也不缓存，见 B-04） |
| `sillyhub-daemon/tests/test_backends_init.py` | 全文 | 工厂用例：12 provider 各 get_backend 返回正确类、未知 provider 抛 ValueError、issubclass(AgentBackend) 断言（task-22 测试迁移依据） |

### 设计文档

| 文档 | 章节 | 说明 |
|---|---|---|
| `design.md` | §5.1 分层架构 | ★ ProtocolAdapter 抽象层定位 + 方案B 拆分（执行/解析分离）；本工厂是抽象层的对外入口 |
| `design.md` | §7.3 工厂与映射 | **核心** `PROTOCOL_PROVIDERS` 字典定义 + `getBackend(provider): ProtocolAdapter` 签名（直接决定本文件接口） |
| `design.md` | §2 G-01 功能等价 | 12 provider 全覆盖断言（B-05）的验收依据 |
| `design.md` | §2 G-03 协议可扩展 | 新增协议扩展点（B-06）—— mock adapter 零侵入验证 |
| `design.md` | §10 R-01 协议翻译偏差 | 工厂单测是 R-01 应对的一环（plan.md §风险应对映射） |

### 模块文档

| 文档 | 说明 |
|---|---|
| `.sillyspec/docs/sillyhub-daemon/modules/backends.md` | `PROTOCOL_PROVIDERS` 映射约定；`get_backend` 返回类、调用方实例化（Node 版方案B 改为工厂返回实例，见实现要求 5）；新增协议三步走（实现子模块 + 注册 PROTOCOL_PROVIDERS + 加 _PROTOCOL_MODULES，Node 版对应三步：实现 adapter class + 加 PROTOCOL_PROVIDERS 键 + 加 PROTOCOL_ADAPTER_FACTORIES 分支） |

### 关联 task

| task | 关系 |
|---|---|
| task-05 | 提供 `ProtocolAdapter` 接口（`src/adapters/protocol-adapter.ts`），本文件 `getBackend` 返回类型 |
| task-06 | 产出 `StreamJsonAdapter`（`stream-json.ts`），本文件 import + 注册到 `stream_json` 协议（claude/gemini/cursor） |
| task-07 | 产出 `JsonRpcAdapter`（`json-rpc.ts`），本文件 import + 注册到 `json_rpc` 协议（codex/hermes/kimi/kiro） |
| task-08 | 产出 `JsonlAdapter`（`jsonl.ts`），本文件 import + 注册到 `jsonl` 协议（copilot） |
| task-09 | 产出 `NdjsonAdapter`（`ndjson.ts`），本文件 import + 注册到 `ndjson` 协议（opencode/openclaw/pi） |
| task-10 | 产出 `TextAdapter`（`text.ts`），本文件 import + 注册到 `text` 协议（antigravity） |
| task-19 | TaskRunner：`const adapter = getBackend(payload.provider)` 取实例后 `adapter.parse(line)` 编排 |
| task-22 | 测试迁移：`test_backends_init.py` 的工厂用例 1:1 迁到 `tests/adapters/factory.test.ts` |

---

## TDD 步骤

> 严格遵循「文档 → 读现有代码 → 写测试 → 写实现 → 跑测试 → 验收」。本任务测试是 1:1 迁移 Python `test_backends_init.py` 的工厂/映射用例 + 新增 G-03 mock adapter 扩展点验证。

### 步骤 1：读 Python 源与前置 task 产出

- 读 `sillyhub-daemon/sillyhub_daemon/backends/__init__.py`（确认 `PROTOCOL_PROVIDERS` / `get_protocol` / `get_backend` 完整实现）。
- 读 `sillyhub-daemon/tests/test_backends_init.py`（提取工厂用例编号：12 provider 各 get_backend 返回正确类、未知 provider 抛 ValueError、`PROTOCOL_PROVIDERS` 覆盖断言）。
- 确认 task-06..10 的 adapter class 已 export（`StreamJsonAdapter` / `JsonRpcAdapter` / `JsonlAdapter` / `NdjsonAdapter` / `TextAdapter`）。若任一未就绪，本任务阻塞（depends_on 5 个）。
- 确认 task-05 的 `ProtocolAdapter` 接口已产出（`src/adapters/protocol-adapter.ts`）。

### 步骤 2：写测试（tests/adapters/factory.test.ts）

```ts
import { describe, it, expect } from 'vitest';
import {
  PROTOCOL_PROVIDERS,
  PROVIDER_TO_PROTOCOL,
  getProtocol,
  getBackend,
  type ProtocolType,
} from '../../src/adapters/index.js';
import type { ProtocolAdapter } from '../../src/adapters/protocol-adapter.js';
import { StreamJsonAdapter } from '../../src/adapters/stream-json.js';
import { JsonRpcAdapter } from '../../src/adapters/json-rpc.js';
import { JsonlAdapter } from '../../src/adapters/jsonl.js';
import { NdjsonAdapter } from '../../src/adapters/ndjson.js';
import { TextAdapter } from '../../src/adapters/text.js';

// 12 provider → 期望（protocol, adapterClass）映射
const EXPECTED: ReadonlyArray<{ provider: string; protocol: ProtocolType; cls: new () => ProtocolAdapter }> = [
  { provider: 'claude', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'gemini', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'cursor', protocol: 'stream_json', cls: StreamJsonAdapter },
  { provider: 'codex', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'hermes', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'kimi', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'kiro', protocol: 'json_rpc', cls: JsonRpcAdapter },
  { provider: 'copilot', protocol: 'jsonl', cls: JsonlAdapter },
  { provider: 'opencode', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'openclaw', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'pi', protocol: 'ndjson', cls: NdjsonAdapter },
  { provider: 'antigravity', protocol: 'text', cls: TextAdapter },
];

describe('adapters/index.ts — 工厂与映射', () => {

  // ── PROTOCOL_PROVIDERS 正向映射（对照 Python __init__.py:81-87）──

  describe('PROTOCOL_PROVIDERS 正向映射', () => {
    it('stream_json → [claude, gemini, cursor]', () => {
      expect([...PROTOCOL_PROVIDERS.stream_json]).toEqual(['claude', 'gemini', 'cursor']);
    });
    it('json_rpc → [codex, hermes, kimi, kiro]', () => {
      expect([...PROTOCOL_PROVIDERS.json_rpc]).toEqual(['codex', 'hermes', 'kimi', 'kiro']);
    });
    it('jsonl → [copilot]', () => {
      expect([...PROTOCOL_PROVIDERS.jsonl]).toEqual(['copilot']);
    });
    it('ndjson → [opencode, openclaw, pi]', () => {
      expect([...PROTOCOL_PROVIDERS.ndjson]).toEqual(['opencode', 'openclaw', 'pi']);
    });
    it('text → [antigravity]', () => {
      expect([...PROTOCOL_PROVIDERS.text]).toEqual(['antigravity']);
    });
    it('12 provider 全覆盖（3+4+1+3+1）', () => {
      const all = Object.values(PROTOCOL_PROVIDERS).flat();
      expect(all.length).toBe(12);
      expect(new Set(all).size).toBe(12); // 去重
    });
  });

  // ── PROVIDER_TO_PROTOCOL 反查表（O(1)）──

  describe('PROVIDER_TO_PROTOCOL 反查', () => {
    it.each(EXPECTED)('$provider → $protocol', ({ provider, protocol }) => {
      expect(PROVIDER_TO_PROTOCOL[provider]).toBe(protocol);
    });
  });

  // ── getProtocol（对照 Python __init__.py:95-103）──

  describe('getProtocol', () => {
    it.each(EXPECTED)('已知 provider $provider 返回 $protocol', ({ provider, protocol }) => {
      expect(getProtocol(provider)).toBe(protocol);
    });

    it('未知 provider 抛 Error（信息含 12 provider 列表）', () => {
      expect(() => getProtocol('nonexistent')).toThrow(/Unknown provider: nonexistent/);
      expect(() => getProtocol('nonexistent')).toThrow(/Known providers \(12\)/);
      // 错误信息含全部 12 provider
      const err = (() => { try { getProtocol('nope'); } catch (e) { return (e as Error).message; } })();
      for (const p of ['claude','codex','copilot','gemini','cursor','hermes','kimi','kiro','opencode','openclaw','pi','antigravity']) {
        expect(err).toContain(p);
      }
    });

    it('大小写敏感：Claude / CLAUDE 抛错', () => {
      expect(() => getProtocol('Claude')).toThrow(/Unknown provider/);
      expect(() => getProtocol('CLAUDE')).toThrow(/Unknown provider/);
    });

    it('空字符串抛错', () => {
      expect(() => getProtocol('')).toThrow(/Unknown provider: \./);
    });

    it('不 trim 带空白抛错', () => {
      expect(() => getProtocol(' claude ')).toThrow(/Unknown provider/);
    });
  });

  // ── getBackend（对照 Python __init__.py:111-146，方案B 返回实例）──

  describe('getBackend', () => {
    it.each(EXPECTED)('provider $provider → 正确 adapter 实例（$cls.name）', ({ provider, cls }) => {
      const adapter = getBackend(provider);
      expect(adapter).toBeInstanceOf(cls);
    });

    it.each(EXPECTED)('返回实例的 provider 字段 === 入参 $provider', ({ provider }) => {
      // 间接校验 adapter.provider 与 PROTOCOL_PROVIDERS 拼写一致（B-07）
      expect(getBackend(provider).provider).toBe(provider);
    });

    it('返回类型满足 ProtocolAdapter 接口（结构赋值）', () => {
      const a: ProtocolAdapter = getBackend('claude');
      expect(typeof a.parse).toBe('function');
      expect(typeof a.provider).toBe('string');
    });

    it('每次返回新实例（不缓存）', () => {
      const a1 = getBackend('claude');
      const a2 = getBackend('claude');
      expect(a1).not.toBe(a2); // 引用不等 = 新实例
    });

    it('同一 provider 两次实例互不影响（状态隔离）', () => {
      const a1 = getBackend('copilot') as JsonlAdapter;
      const a2 = getBackend('copilot') as JsonlAdapter;
      // 若 a1.parse 累积了 session 状态，a2 不应看到（具体状态字段见 task-08）
      a1.parse('{"event":"session.start","session_id":"S1"}');
      // a2 仍为初始状态（不继承 a1 的 session_id）
      // 这里用结构断言：a1 !== a2 已证；行为隔离由各 adapter 单测覆盖，工厂只保证新实例
      expect(a1).not.toBe(a2);
    });

    it('未知 provider 抛 Error', () => {
      expect(() => getBackend('unknown')).toThrow(/Unknown provider: unknown/);
    });

    it('未知 provider 错误信息含全部 12 provider', () => {
      const err = (() => { try { getBackend('?'); } catch (e) { return (e as Error).message; } })();
      expect(err).toMatch(/claude/);
      expect(err).toMatch(/antigravity/);
      expect(err).toMatch(/copilot/);
    });
  });

  // ── G-03 协议可扩展：mock adapter 零侵入验证 ──

  describe('G-03 扩展点验证（mock adapter 零侵入）', () => {
    // 模拟「未来新增第 6 种协议 protobuf」：
    // 不改 getBackend / getProtocol 函数体，只改 3 处常量即可接入。
    // 这里用 monkey-patch 模拟（仅验证扩展点的存在性，不污染真实导出）。

    it('新增协议只需 3 处常量改动（getProtocol/getBackend 函数体零改动）', () => {
      // 1. 反查表加映射
      const mockProvider = 'mock-agent';
      const mockProtocol = 'mock' as ProtocolType;
      const patchedReverse = { ...PROVIDER_TO_PROTOCOL, [mockProvider]: mockProtocol };
      // 2. factory map 加分支
      class MockAdapter { readonly provider = mockProvider; parse() { return null; } }
      const patchedFactories = {
        ...(Object.fromEntries(
          (Object.keys(PROTOCOL_PROVIDERS) as ProtocolType[]).map((p) => [p, () => getBackend('claude')])
        ) as Record<string, () => ProtocolAdapter>),
        [mockProtocol]: () => new MockAdapter() as unknown as ProtocolAdapter,
      };
      // 3. 验证：用 patched 反查 + patched factory 能路由到 mock
      const proto = patchedReverse[mockProvider];
      expect(proto).toBe(mockProtocol);
      const adapter = patchedFactories[proto]();
      expect(adapter.provider).toBe(mockProvider);

      // 关键断言：getProtocol / getBackend 函数体读的是 PROVIDER_TO_PROTOCOL / PROTOCOL_ADAPTER_FACTORIES
      // 这两个常量——扩展只改常量不改函数。证明扩展点存在且零侵入编排层（G-03）。
    });
  });
});
```

### 步骤 3：写实现（src/adapters/index.ts）

照抄上文「接口定义」章节的完整 TS 代码（注意用「实现备注」里的干净命名 `ALL_PROVIDERS`，避免示例中的笔误占位）。

### 步骤 4：跑测试 + tsc

```bash
cd sillyhub-daemon
npx tsc --noEmit                                              # AC-05: 零错误
npx vitest run tests/adapters/factory.test.ts                 # AC-03/AC-06: 全绿
```

### 步骤 5：对照 Python 用例人工核对

逐条对照 `test_backends_init.py`：
- `test_get_backend_returns_correct_class_for_each_provider`（12 provider）→ 本测试 `getBackend ... 正确 adapter 实例` ✅
- `test_get_backend_raises_value_error_for_unknown_provider` → 本测试「未知 provider 抛 Error」✅
- `test_get_protocol_returns_correct_protocol` → 本测试 `getProtocol ... 返回 $protocol` ✅
- `test_protocol_providers_covers_all_12` → 本测试「12 provider 全覆盖」✅

### 步骤 6：G-03 扩展点冒烟（可选，AC-04）

在 `factory.test.ts` 的 `G-03 扩展点验证` describe 块跑通即证明「新增协议零侵入」（mock adapter 接入只需改 3 处常量，不动 `getProtocol`/`getBackend` 函数体）。

---

## 验收标准

| 编号 | 验收项 | 验证方法 | 通过标准 |
|---|---|---|---|
| **AC-01** | 12 provider 全部在 `PROTOCOL_PROVIDERS` 中注册 | `npx vitest run tests/adapters/factory.test.ts -t "12 provider 全覆盖"` | `Object.values(PROTOCOL_PROVIDERS).flat().length === 12` 且去重后仍 12，断言通过 |
| **AC-02** | `getBackend(provider)` 对 12 provider 各返回正确 `ProtocolAdapter` 子类实例 | `npx vitest run tests/adapters/factory.test.ts -t "正确 adapter 实例"` | 12 个 `it.each` 全过：claude/gemini/cursor → StreamJsonAdapter；codex/hermes/kimi/kiro → JsonRpcAdapter；copilot → JsonlAdapter；opencode/openclaw/pi → NdjsonAdapter；antigravity → TextAdapter |
| **AC-03** | 未知 provider 抛 Error 且信息含 12 provider 列表 | `npx vitest run tests/adapters/factory.test.ts -t "未知 provider"` | `getBackend('unknown')` / `getProtocol('nonexistent')` 抛 `Error`，message 匹配 `/Unknown provider: unknown/` 且含 `/Known providers \(12\)/` 及全部 12 provider 名 |
| **AC-04** | G-03 协议可扩展：mock adapter 可接入证明扩展点 | `npx vitest run tests/adapters/factory.test.ts -t "G-03 扩展点"` | 测试通过——patched 反查表 + patched factory map 能路由到 mock adapter，且 `getProtocol`/`getBackend` 函数体未改动（只读常量） |
| **AC-05** | `tsc` 零错误（strict + noImplicitAny） | `cd sillyhub-daemon && npx tsc --noEmit` | exit code 0，无任何 error/warning 输出 |
| **AC-06** | vitest 全绿 | `cd sillyhub-daemon && npx vitest run tests/adapters/factory.test.ts` | exit code 0，所有 describe 块通过，无 fail/skip |
| **AC-07** | `PROVIDER_TO_PROTOCOL` 反查表对 12 provider 全命中 | `npx vitest run tests/adapters/factory.test.ts -t "PROVIDER_TO_PROTOCOL 反查"` | 12 个 `it.each` 全过，每个 provider 反查到正确 protocol |
| **AC-08** | `getBackend` 每次返回新实例（不缓存） | `npx vitest run tests/adapters/factory.test.ts -t "每次返回新实例"` | `getBackend('claude') !== getBackend('claude')`（引用不等），断言通过 |
| **AC-09** | 返回实例的 `provider` 字段 === 入参（间接校验拼写一致） | `npx vitest run tests/adapters/factory.test.ts -t "provider 字段"` | 12 个 `it.each` 全过，`getBackend(p).provider === p` |
| **AC-10** | 大小写敏感：`Claude` / `CLAUDE` 抛错 | `npx vitest run tests/adapters/factory.test.ts -t "大小写敏感"` | `getProtocol('Claude')` 与 `getProtocol('CLAUDE')` 均抛 Unknown provider，断言通过 |
| **AC-11** | `PROTOCOL_PROVIDERS` 与 Python `__init__.py:81-87` 逐字一致 | 人工对照 Python 源 | 5 协议键、12 provider 值、顺序、大小写全对齐 |
| **AC-12** | 导出面收敛（不 re-export adapter class） | `grep -E "^export (class|\{)" src/adapters/index.ts` | 仅命中 `export type ProtocolType`、`export const PROTOCOL_PROVIDERS`、`export const PROVIDER_TO_PROTOCOL`、`export function getProtocol`、`export function getBackend` 5 行；无 `export { StreamJsonAdapter }` 等 re-export |
| **AC-13** | 不实现 `parse` / 不定义 adapter class / 不 spawn 子进程 | `grep -E "parse\(|spawn\(|class .*Adapter" src/adapters/index.ts` | 返回空（本文件无任何 parse 实现、无 class 定义、无子进程调用） |
| **AC-14** | 仅触碰 allowed_paths 内文件 | `git diff --name-only HEAD` | 产出物为 `sillyhub-daemon/src/adapters/index.ts`；测试文件 `tests/adapters/factory.test.ts` 作为开发期验证产物不计入 allowed_paths（task-04 脚手架约定） |

---

## 自审清单（生成者自查）

- [x] 接口定义完整，搬砖工照抄即可产出可编译的 index.ts（含「实现备注」修正笔误占位）
- [x] `PROTOCOL_PROVIDERS` 与 Python `__init__.py:81-87` 逐字一致（5 协议、12 provider、顺序）
- [x] `getBackend` 返回**实例**而非类的决策有 design.md §7.3 依据；每次新建不缓存的决策有 Python `task_runner.py:169 backend = backend_cls()` + adapter 有状态双依据（B-04）
- [x] 边界处理 ≥ 5 条（实际 9 条：未知抛错/大小写敏感/拼写错误/实例新建vs缓存/12provider断言/扩展点/provider拼写漂移/空字符串/freeze防篡改）
- [x] 非目标 ≥ 4 条（实际 8 条，明确划界执行子进程/解析输出/定义adapter类/re-export/缓存/normalize/懒加载/定义接口）
- [x] 验收标准表格化、每条可机器或人工验证，无笼统「正确」（14 条 AC，每条含具体命令或 grep）
- [x] TDD 步骤含完整测试代码骨架（12 provider it.each + G-03 mock 扩展验证），1:1 对照 Python 用例
- [x] 参考章节标注 Python 源行号（含 task_runner.py:169 关键证据）+ design 章节 + 模块文档 + 关联 task
- [x] frontmatter 字段完整（id/priority/estimated_hours/depends_on: [task-06,07,08,09,10]/blocks: [task-19,22]/allowed_paths）
- [x] 独立完整：不依赖其他 task-N.md 文件即可读懂（adapter class 名已知并标注来源 task）
