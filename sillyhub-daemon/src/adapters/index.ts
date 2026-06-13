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
import { StreamJsonAdapter, type StreamJsonProvider } from './stream-json.js';
import { JsonRpcAdapter, type JsonRpcProvider } from './json-rpc.js';
import { JsonlAdapter } from './jsonl.js';
import { NdjsonAdapter, type NdjsonProvider } from './ndjson.js';
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
      providers.map((provider) => [provider, protocol as ProtocolType] as const),
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
 * protocol → adapter 实例化 thunk 映射。模块级常量，构建一次复用。
 * 每个 thunk 接收 provider 字符串，new 一个新实例——adapter 的 provider 字段由构造器注入
 * （StreamJsonAdapter/JsonRpcAdapter/NdjsonAdapter 的 constructor 签名要求 provider；
 *  JsonlAdapter/TextAdapter 的 provider 硬编码单值，thunk 忽略入参）。
 * 对应 Python __init__.py:124-130 _PROTOCOL_MODULES（Python 存 module path + class name 元组
 * 用于 importlib 懒加载；Node 直接存 thunk，省去动态 import 并把 provider 注入收进工厂）。
 */
const PROTOCOL_ADAPTER_FACTORIES: Readonly<
  Record<ProtocolType, (provider: string) => ProtocolAdapter>
> = Object.freeze({
  stream_json: (p) => new StreamJsonAdapter(p as StreamJsonProvider),
  json_rpc: (p) => new JsonRpcAdapter(p as JsonRpcProvider),
  jsonl: () => new JsonlAdapter(),
  ndjson: (p) => new NdjsonAdapter(p as NdjsonProvider),
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
  return factory(provider); // provider 注入构造器，每次返回新实例（满足 AC-09：实例.provider === 入参）
}
