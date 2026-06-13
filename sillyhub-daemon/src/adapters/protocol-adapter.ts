/**
 * ProtocolAdapter —— 子进程 stdout 的纯解析契约（方案B 核心）。
 *
 * 设计动机（方案B 深化点）：
 * Python 版 `AgentBackend(ABC)` 同时承担「执行子进程」（execute）和
 * 「解析输出」（parse_output）两职。Node 版拆开——
 *   - 子进程执行（spawn / stdin / env / diff 收集）下沉到 TaskRunner 唯一入口；
 *   - adapter 只保留纯解析职责 parse(line) → AgentEvent IR。
 * 新增协议 = 新增一个 parse 实现，零侵入编排层（design.md G-03）。
 *
 * @see design.md §5.1 / §7.2
 */

import type { AgentEvent } from '../types.js';

/**
 * 子进程 stdout 一行的解析契约。协议差异 100% 收敛于此接口。
 *
 * 实现方（task-06~10）：stream_json / json_rpc / jsonl / ndjson / text 各一个
 * 实现。工厂 getBackend(provider)（task-11）按 provider 返回对应实例。
 */
export interface ProtocolAdapter {
  /**
   * provider 标识（claude / codex / copilot / gemini / cursor / ...）。
   * 必须与 PROTOCOL_PROVIDERS（task-11）中注册的 provider 名一致。
   */
  readonly provider: string;

  /**
   * 解析子进程 stdout 的一行，返回 0..N 个 AgentEvent（IR）。
   *
   * 为什么返回数组而非单个：
   *   Python 版 parse_output 返回 AgentEvent | None（单值）。Node 版升级为数组，
   *   因为某些协议一行可产出多个事件——
   *     - stream_json：一个 assistant message 内可能含多段 content block
   *       （text + tool_use 交错）；
   *     - jsonl：某些 provider 的复合行可拆出 session + tool_use；
   *   返回数组让 adapter 一次吐尽，编排层无需二次缓冲。
   *
   * 语义约定：
   *   - 返回 null：该行被识别但主动丢弃（如心跳 / 无业务意义的 keepalive）；
   *   - 返回 []（空数组）：该行已处理但无事件产出（与 null 等价，二者皆合法）；
   *   - 返回非空数组：正常产出事件，编排层逐个 submit_messages。
   *
   * 纯函数约束：parse 不应修改全局/静态状态，不发起 I/O，不抛异常（坏行
   * 应返回 null 或产出 error 事件，见 §边界处理 B-04）。有状态 adapter
   * （需跨行累积，如 jsonl/ndjson/text 的多行拼接）在实例字段维护缓冲，
   * 不污染外部。
   *
   * @param line 子进程 stdout 的一行（已去除换行符，UTF-8 字符串）
   */
  parse(line: string): AgentEvent[] | null;

  /**
   * 可选：对子进程 stdin 的 control_request 应答器。
   *
   * 仅 stream_json 协议（claude / gemini / cursor）需要——子进程输出
   * `control_request`（工具批准 / 权限确认）时，需向 stdin 写应答 JSON
   * 才能继续，否则子进程 hang（风险 R-03）。
   *
   * 其余 4 种协议（json_rpc / jsonl / ndjson / text）不需要 stdin 应答，
   * 故声明为可选方法，缺省即 no-op。
   *
   * 调用时机由 TaskRunner（task-19）在解析到 control 类事件时触发，
   * 传入子进程的 stdin writable stream。
   *
   * @param stdin 子进程的 stdin（NodeJS.WritableStream），adapter 向其 write 应答
   */
  onControl?(stdin: NodeJS.WritableStream): void;
}

/**
 * 子进程执行的通用结果（非 adapter 职责，由 TaskRunner 统一生成）。
 *
 * 此接口声明在 adapter 文件是因为它与 adapter 的产出强相关（TaskRunner
 * 调 adapter.parse 累积事件 → 拼成最终结果），task-19 TaskRunner 与
 * task-11 工厂都会 import 它。放这里避免循环依赖。
 *
 * 注意：这是「执行结果」的简版契约，完整的 TaskResult（含 events 数组 /
 * duration_ms / patch / filesChanged）在 src/types.ts（task-02）定义，
 * TaskRunner 会把 BackendExecResult + diff 合成完整 TaskResult。
 */
export interface BackendExecResult {
  /** 退出状态：completed（exit 0）/ failed（exit !=0）/ timeout（看门狗触发） */
  status: 'completed' | 'failed' | 'timeout';
  /** 累积的 stdout 文本输出（已 strip ANSI / 去除协议噪声后的可读文本） */
  output: string;
  /** 失败或超时时的错误信息（status 为 completed 时应缺省） */
  error?: string;
  /** agent 会话 ID（若协议产出，用于 backend 侧追溯） */
  sessionId?: string;
}
