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
   * 可选：对子进程 stdin 的 control_request 应答器（R-03 核心）。
   *
   * 仅 stream_json 协议（claude / gemini / cursor）需要——子进程输出
   * `control_request`（工具批准 / 权限确认）时，需向 stdin 写应答 JSON
   * 才能继续，否则子进程 hang（风险 R-03）。
   *
   * 其余 4 种协议（json_rpc / jsonl / ndjson / text）不需要 stdin 应答，
   * 故声明为可选方法，缺省即 no-op。
   *
   * 调用时机由 TaskRunner（task-19）在解析到 control 类行时触发，
   * 传入触发应答的原始行 + 子进程的 stdin writable stream。
   *
   * @param line 触发 control_request 的原始 stdout 行（adapter 自行 JSON.parse）
   * @param stdin 子进程的 stdin（NodeJS.WritableStream），adapter 向其 write 应答
   */
  onControl?(line: string, stdin: NodeJS.WritableStream): void | Promise<void>;

  /**
   * 可选：构造子进程 spawn 命令的参数列表（不含 cmdPath 本身）。
   *
   * 下沉自 Python StreamJsonBackend._build_args / _build_input（task-19 方案B
   * 把「执行子进程」从 backend 下沉到 TaskRunner，cmd 构造随之归 adapter）。
   * TaskRunner 用 `[cmdPath, ...adapter.buildArgs(opts)]` 启动 spawn。
   *
   * 若 adapter 未实现（如 text adapter 可能不需要参数），返回空数组等价 no-op。
   *
   * @param opts 模型 / 会话 ID / 恢复会话 ID / prompt 等透传参数
   *             （prompt 仅供 ndjson 协议把 prompt 作为 args 位置参数使用）
   */
  buildArgs?(opts: {
    model?: string;
    sessionId?: string;
    resumeSessionId?: string;
    prompt?: string;
    toolConfig?: {
      mode?: string;
      allowed_tools?: string[];
      max_turns?: number;
    };
  }): string[];

  /**
   * 可选：构造写入子进程 stdin 的 prompt 数据。
   *
   * 下沉自 Python StreamJsonBackend._build_input。stream_json 协议需要把
   * prompt 包成 `{type:"user",message:{content:[{type:"text",text:prompt}]}}` JSON
   * + `\n`，而 text 协议可能直接写 `prompt + "\n"`。TaskRunner 调本方法拿到
   * 最终 stdin 数据并 write。
   *
   * 若 adapter 未实现，TaskRunner 默认用 `${prompt}\n`（对齐 Python text backend）。
   *
   * @param prompt 任务 prompt 文本
   */
  buildInput?(prompt: string): string | Buffer;

  /**
   * 可选：spawn 后需立即写到 stdin 的协议握手 request 序列。
   *
   * 仅 json_rpc 协议（codex/hermes/kimi/kiro）需要——这些 CLI 是被动 server，
   * daemon 必须主动发 initialize/thread.start 等握手 request 才会开始执行。
   *
   * stream_json/jsonl/ndjson/text 协议不需要握手（buildInput 写 prompt 即可触发执行）。
   *
   * 调用时机（TaskRunner spawn 后）：
   *   1. adapter.buildInput(prompt) 写到 stdin（若实现）
   *   2. adapter.buildHandshake(opts) 逐行写到 stdin（每行尾加 \n）
   *   3. TaskRunner 监听 stdout，检测 thread/start response 后调
   *      adapter.buildTurnStart(threadId, prompt) 写 turn/start request
   *
   * ql-20260617-008：codex app-server 协议要求 initialize/initialized/thread.start
   * 三条 request 才能进入 turn 处理。thread/start response 含 thread.id，
   * 后续 turn/start 由 buildTurnStart 单独构造。
   *
   * @param opts cwd（spawn 工作目录）/ prompt（用户输入）/ model（可选）
   * @returns string[] 每元素一行 JSON-RPC request（无尾换行，TaskRunner 加 \n 分隔）
   *         返回空数组或 undefined 表示无需握手。
   */
  buildHandshake?(opts: {
    cwd: string;
    prompt: string;
    model?: string;
  }): string[];

  /**
   * 可选：构造 turn/start JSON-RPC request（json_rpc 协议专用）。
   *
   * TaskRunner 在收到 thread/start response（含 result.thread.id）后调用本方法，
   * 用真实 threadId 构造 turn/start request 并 write 到 stdin。
   *
   * 与 buildHandshake 分离的原因：threadId 在 spawn 前未知，必须等 thread/start
   * response 才能拿到。
   *
   * @param opts threadId（来自 thread/start response）/ prompt / model
   * @returns 完整的 turn/start JSON-RPC request 字符串（无尾换行）
   */
  buildTurnStart?(opts: {
    threadId: string;
    prompt: string;
    model?: string;
  }): string;
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
