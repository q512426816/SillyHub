/**
 * `agent-log/registry.ts` —— agent 日志解析器注册表（format → parser 映射）。
 *
 * task-02（2026-08-23-agent-log-conversation-view / FR-02 + D-002@v1）：host_fs.
 * read_agent_log_messages RPC 的格式分发层。key 是 CLI 上报落库的 format 串
 * （design §6，与 platform_agent_logs.format 逐字一致），value 是对应解析器。
 *
 * task-06（2026-09-19-tool-report-session-replay / FR-02 + D-006@v1）自单键
 * `'zcode-model-io-jsonl'` 扩展为三键——新增 `'claude-code-jsonl'`（task-04
 * 解析器）与 `'cursor-agent-transcript-jsonl'`（task-05 解析器；2026-09-19 双实现
 * 对撞深读裁决：格式串统一取 -jsonl 后缀族形态为正典——与 'zcode-model-io-jsonl'
 * /'claude-code-jsonl' 命名一致；sillyspec 上报层当前仅发射 zcode 格式串，cursor
 * 报告未来落地时以此串为准）。未注册 format 查询返回 null，由调用方
 * （host-fs-handler.readAgentLogMessages）转 `status:'unsupported'`——
 * 'unsupported' 是本层的判定，解析器自身只产 parsed / parse_error / too_large
 * （task-01 契约），两个职责不混。
 *
 * 本模块不 import RpcError / ws-client / fs（错误与文件 IO 都是 host-fs-handler
 * 的职责，注册表只做纯映射查询）。
 *
 * @module agent-log/registry
 */

import { parseClaudeCodeJsonlLog } from './parse-claude-code-jsonl.js';
import { parseCursorAgentTranscriptLog } from './parse-cursor-agent-transcript.js';
import type { NormalizedLogMessage } from './parse-zcode-model-io.js';
import { parseZcodeModelIoLog } from './parse-zcode-model-io.js';

// ── 类型定义（design §7.1 RPC 返回形状，与 host-fs-handler 共用）──────────────

/**
 * read_agent_log_messages 返回 status 联合（design §7.1）。
 *
 * 'unsupported' 由注册表层（调用方判 null 后叠加）；'too_large' 可由 handler
 * lstat 预判或解析器内部预算产出；其余由解析器产出。
 */
export type AgentLogMessagesStatus = 'parsed' | 'unsupported' | 'parse_error' | 'too_large';

/**
 * read_agent_log_messages 返回结构（外层 camelCase 对齐 design §7.1 与
 * host-fs-handler 命名惯例；messages 内层 NormalizedLogMessage snake_case
 * 原样透传，backend task-03 做 snake_case schema 逐字对齐）。
 */
export interface AgentLogMessagesResult {
  status: AgentLogMessagesStatus;
  /** 仅 status=parsed 非空。 */
  messages: NormalizedLogMessage[];
  /** 切片（beforeSeq）后段数超窗口 → true。 */
  truncated: boolean;
  /** 全量段总数（窗口截断前、beforeSeq 切片前的总数；仅 parsed 有意义）。 */
  totalSegments: number;
  /** 坏行计数。 */
  skippedLines: number;
  /**
   * 全会话累计 token 用量（四项计数，全 number）。可选——老 daemon / 无数据源
   * 缺省 null；由解析器全量过一遍后顺带求和返回（求和逻辑归
   * 2026-09-19-tool-report-session-replay task-02~05，本契约先行钉死形状）。
   */
  totalUsage?: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
  } | null;
}

/**
 * 已注册解析器的统一签名：透传 content + beforeSeq（解析器是纯函数，全部
 * 参数注入——task-01 契约），返回统一结果形状。
 */
export type AgentLogParser = (
  content: string,
  options: { beforeSeq?: number | null },
) => Promise<AgentLogMessagesResult>;

// ── 注册表（三 harness：task-02 D-002 + task-06 D-006）───────────────────────

/**
 * format → parser 静态注册表。key 与 CLI 上报落库 format 串逐字一致（design
 * §6）：`'zcode-model-io-jsonl'`（task-01）/ `'claude-code-jsonl'`（task-04，
 * claude-code 会话 JSONL）/ `'cursor-agent-transcript-jsonl'`（task-05，
 * cursor-agent transcript JSONL）；后续多格式经此 Map 增键，调用方零改动。
 */
const PARSERS: ReadonlyMap<string, AgentLogParser> = new Map<string, AgentLogParser>([
  ['zcode-model-io-jsonl', parseZcodeModelIoLog],
  ['claude-code-jsonl', parseClaudeCodeJsonlLog],
  ['cursor-agent-transcript-jsonl', parseCursorAgentTranscriptLog],
]);

/**
 * 按 format 查询解析器。
 *
 * @returns 已注册返回对应 parser；未注册（含二进制格式串透传到达时）返回
 *          null，由调用方转 `status:'unsupported'`（不进解析器）。
 */
export function getAgentLogParser(format: string): AgentLogParser | null {
  return PARSERS.get(format) ?? null;
}
