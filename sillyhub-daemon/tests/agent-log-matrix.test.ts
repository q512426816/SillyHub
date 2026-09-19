// tests/agent-log-matrix.test.ts
// task-07（2026-09-19-tool-report-session-replay / FR-02 + FR-03）：daemon 三
// harness 解析器矩阵交叉验收单测——zcode-model-io / claude-code-jsonl /
// cursor-agent-transcript-jsonl 对同一 NormalizedLogMessage 契约（parse-zcode-
// model-io.ts）与 AgentLogMessagesResult（registry.ts）的一致性。
//
// 与 tests/agent-log/ 下三份专属单测（parse-zcode-model-io.test.ts Z 系列 /
// parse-claude-code.test.ts C 系列 / parse-cursor-agent.test.ts U 系列）分工：
// 专属测试覆盖各解析器细节（合并/坏行/预算/超时/截断/配对……），本矩阵**不重复**，
// 只做跨 harness 交叉断言——同一逻辑会话三份 fixture（真实键集 + FIXTURE_ 占位
// 脱敏，禁真实路径/业务内容/凭证），断言三源归一后的契约一致性：
//   M1 registry 三键分发（getAgentLogParser 命中 / 互异 / 未注册 null）
//   M2 输出形状一致（seq 连续单调、kind 枚举、九基础字段齐备、kind 序列同构）
//   M3 sender 归一矩阵（三家系统注入均 system_event、真人文本语义一致归人）
//   M4 usage / totalUsage 矩阵（zcode+claude-code 附着五项、cursor 恒不附着；
//      totalUsage 按调用去重求和 / cursor 恒 null 不伪造 0 / 早退零新字段）
//   M5 turn 边界矩阵（zcode 行 turnId / claude-code 真人 user 轮号 / cursor
//      turn_ended 轮号——三家第二真人问均切新轮）
//   M6 窗口 / beforeSeq / truncated / totalSegments 三家逐字同口径（Z7/C8/U8）
//
// 全部断言经 registry.getAgentLogParser 分发入口直调（覆盖注册表接线），不直接
// import 解析器函数；fixture 内嵌字符串、零 vi.mock（对齐专属测试风格）。

import { describe, it, expect } from 'vitest';
import { getAgentLogParser, type AgentLogParser, type AgentLogMessagesResult } from '../src/agent-log/registry.js';
import { DEFAULT_MAX_SEGMENTS, type NormalizedLogMessage } from '../src/agent-log/parse-zcode-model-io.js';

// ── registry format 键（与 PARSERS 注册键逐字一致，task-06）──────────────────

const FORMATS = {
  zcode: 'zcode-model-io-jsonl',
  claudeCode: 'claude-code-jsonl',
  cursor: 'cursor-agent-transcript-jsonl',
} as const;

/** 取已注册解析器；未注册直接失败（矩阵前提是三键接线正确）。 */
function parserFor(format: string): AgentLogParser {
  const parser = getAgentLogParser(format);
  if (parser === null) throw new Error(`registry 未注册 format：${format}`);
  return parser;
}

// ── fixture 构造（真实键集 + FIXTURE_ 占位脱敏）──────────────────────────────

/** 多行拼成 JSONL 文本（尾随换行，真实文件形状）。 */
const jsonl = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** 提取某 kind 的段。 */
const ofKind = (messages: NormalizedLogMessage[], kind: NormalizedLogMessage['kind']): NormalizedLogMessage[] =>
  messages.filter((m) => m.kind === kind);

// —— zcode（~/.zcode/cli/rollout/model-io-*.jsonl 行键集，task-01/02 实证）———

const zUser = (text: string): Record<string, unknown> => ({ role: 'user', content: text });

const zAsst = (
  text: string,
  toolCalls: Array<{ id: string; name: string; input: unknown }>,
): Record<string, unknown> => ({ role: 'assistant', content: [{ type: 'text', text }], toolCalls });

const zToolMsg = (id: string, name: string, content: string): Record<string, unknown> => ({
  role: 'tool',
  toolCallId: id,
  toolName: name,
  isError: false,
  content,
});

/** response.usage 五项（camelCase，zcode 落盘原生键集）。 */
const Z_USAGE_A = { inputTokens: 100, outputTokens: 20, totalTokens: 150, cacheReadTokens: 30, cacheWriteTokens: 10 };
const Z_USAGE_B = { inputTokens: 200, outputTokens: 40, totalTokens: 260, cacheReadTokens: 60, cacheWriteTokens: 20 };
/** A+B 四项和（totalUsage 期望，按调用去重各计一次）。 */
const Z_TOTAL_A_PLUS_B = { inputTokens: 300, outputTokens: 60, cacheReadTokens: 90, cacheWriteTokens: 30 };

function zIoLine(opts: {
  messagesKind: 'full' | 'tail';
  offset: number;
  messages: Array<Record<string, unknown>>;
  responseText?: string;
  turnId: string;
  usage: Record<string, unknown>;
  completedAt: string;
}): string {
  return JSON.stringify({
    type: 'model_io',
    request: { messages: opts.messages, messageOffset: opts.offset, messagesKind: opts.messagesKind },
    response: { text: opts.responseText ?? '', toolCalls: [], finishReason: 'stop', usage: opts.usage },
    completedAt: opts.completedAt,
    model: { modelId: 'FIXTURE_MODEL', providerId: 'FIXTURE_PROVIDER' },
    sessionId: 'sess_fixture',
    turnId: opts.turnId,
    durationMs: 1234,
    querySource: 'agent',
  });
}

// —— claude-code（~/.claude/projects/<proj>/<session>.jsonl 行键集，task-04 实证）—

/** claude-code 行级 timestamp。 */
const ccTs = (n: number): string => `2026-09-19T10:00:${String(n).padStart(2, '0')}.000Z`;

/** claude-code 原生 usage 键集（snake_case）。 */
const ccRawUsage = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Record<string, unknown> => ({
  input_tokens: input,
  output_tokens: output,
  cache_read_input_tokens: cacheRead,
  cache_creation_input_tokens: cacheWrite,
});

const ccUser = (content: string | Array<Record<string, unknown>>, ts: string): string =>
  JSON.stringify({ type: 'user', message: { role: 'user', content }, timestamp: ts, sessionId: 'sess_fixture' });

const ccAsst = (
  blocks: Array<Record<string, unknown>>,
  usage: Record<string, unknown>,
  ts: string,
): string =>
  JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: blocks, usage },
    timestamp: ts,
    sessionId: 'sess_fixture',
  });

/** tool_result 块（实证块键 {tool_use_id,type,content,is_error}）。 */
const ccTr = (id: string, content: string): Record<string, unknown> => ({
  type: 'tool_result',
  tool_use_id: id,
  content,
  is_error: false,
});

// —— cursor-agent（~/.cursor/projects/<ctx>/agent-transcripts/<id>/<id>.jsonl，
//    spike-02 实证：对话行 {role,message:{content:[…]}} + 事件行 turn_ended）——

const cUser = (text: string): string =>
  JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text }] } });

const cAsst = (blocks: Array<Record<string, unknown>>): string =>
  JSON.stringify({ role: 'assistant', message: { content: blocks } });

const cText = (text: string): Record<string, unknown> => ({ type: 'text', text });

/** tool_use 块（spike-02：块键仅 {type,name,input}，不带 id）。 */
const cToolUse = (name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: 'tool_use',
  name,
  input,
});

const cTurnEnd = (): string => JSON.stringify({ type: 'turn_ended', status: 'success' });

// ── 同一逻辑会话的三 harness fixture（矩阵共用底座）──────────────────────────
//
// 逻辑会话（三源同构，仅注入形态与轮边界机制不同）：
//   S  系统注入伪 user 文本（zcode/cursor：<task-notification> 前缀；claude-code：
//      【当前用户信息】注入前缀）
//   H1 真人第一问 → R1 回复 + Read 工具调用 → T 工具结果（cursor 不落盘）
//   [轮边界：zcode 换行 turnId / claude-code 真人第二问 / cursor turn_ended]
//   H2 真人第二问 → R2 回复
//
// zcode 期望 7 段（含末行 response 补产 R2）：
//   1 user_input(S) 2 user_input(H1) 3 reply(R1) 4 tool_use 5 tool_result(T)
//   6 user_input(H2) 7 reply(R2 补产)
// claude-code 期望 7 段（tool_result 载体行配对）：
//   1 user_input(S) 2 user_input(H1) 3 reply(R1) 4 tool_use 5 tool_result(T)
//   6 user_input(H2) 7 reply(R2)
// cursor 期望 6 段（spike-02：tool_result 不落盘，同构序列少 tool_result）：
//   1 user_input(S) 2 user_input(H1) 3 reply(R1) 4 tool_use 5 user_input(H2) 6 reply(R2)

const ZCODE_MINI = jsonl(
  zIoLine({
    messagesKind: 'full',
    offset: 0,
    messages: [
      zUser('<task-notification>FIXTURE_BACKGROUND_TASK_DONE</task-notification>'),
      zUser('FIXTURE_HUMAN_QUESTION'),
      zAsst('FIXTURE_REPLY_1', [{ id: 'tc1', name: 'Read', input: { file_path: 'FIXTURE_PATH' } }]),
    ],
    turnId: 'turn-1',
    usage: Z_USAGE_A,
    completedAt: '2026-09-19T10:00:01.000Z',
  }),
  zIoLine({
    messagesKind: 'tail',
    offset: 2, // 滑动尾窗（真实 64 消息窗形态）：含 L0 产的 R1——窗口末 assistant
    // 使 L0 的调用元数据（turn-1/usage A）锚到 R1 槽（产出调用锚定）
    messages: [
      zAsst('FIXTURE_REPLY_1', [{ id: 'tc1', name: 'Read', input: { file_path: 'FIXTURE_PATH' } }]),
      zToolMsg('tc1', 'Read', 'FIXTURE_TOOL_OUTPUT'),
      zUser('FIXTURE_HUMAN_SECOND'),
    ],
    responseText: 'FIXTURE_REPLY_2',
    turnId: 'turn-2',
    usage: Z_USAGE_B,
    completedAt: '2026-09-19T10:00:02.000Z',
  }),
);

const CC_MINI = jsonl(
  ccUser('【当前用户信息】FIXTURE_INJECTED_CONTEXT', ccTs(1)),
  ccUser('FIXTURE_HUMAN_QUESTION', ccTs(2)),
  ccAsst(
    [
      { type: 'text', text: 'FIXTURE_REPLY_1' },
      { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'FIXTURE_PATH' } },
    ],
    ccRawUsage(10, 20, 100, 50),
    ccTs(3),
  ),
  ccUser([ccTr('tu1', 'FIXTURE_TOOL_OUTPUT')], ccTs(4)),
  ccUser('FIXTURE_HUMAN_SECOND', ccTs(5)),
  ccAsst([{ type: 'text', text: 'FIXTURE_REPLY_2' }], ccRawUsage(1, 2), ccTs(6)),
);

const CURSOR_MINI = jsonl(
  cUser('<task-notification>FIXTURE_BACKGROUND_TASK_DONE</task-notification>'),
  cUser('FIXTURE_HUMAN_QUESTION'),
  cAsst([cText('FIXTURE_REPLY_1'), cToolUse('Read', { file_path: 'FIXTURE_PATH' })]),
  cTurnEnd(),
  cUser('FIXTURE_HUMAN_SECOND'),
  cAsst([cText('FIXTURE_REPLY_2')]),
);

/** zcode 老形状行（补字段前无 turnId/model/durationMs/usage）——零 usage 对照。 */
const ZCODE_LEGACY_NO_USAGE = jsonl(
  JSON.stringify({
    type: 'model_io',
    request: { messages: [zUser('FIXTURE_LEGACY_QUESTION')], messageOffset: 0 },
    response: { text: '', toolCalls: [] },
    completedAt: '2026-09-19T10:00:09.000Z',
  }),
);

/** claude-code usage 五项映射期望（snake→camel + totalTokens=输入+输出）。 */
const CC_USAGE_ROW1 = { inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 50 };
const CC_USAGE_ROW2 = { inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 };
/** claude-code totalUsage 期望（两 assistant 行各计一次，四项行级和）。 */
const CC_TOTAL = { inputTokens: 11, outputTokens: 22, cacheReadTokens: 100, cacheWriteTokens: 50 };

// ── M1：registry 三键分发（task-06 接线）─────────────────────────────────────

describe('agent-log 解析器矩阵 — registry 三键分发（M1 / task-06）', () => {
  it('三 harness format 键全部命中且互为不同解析器（防复制粘贴接线错）', () => {
    const z = getAgentLogParser(FORMATS.zcode);
    const c = getAgentLogParser(FORMATS.claudeCode);
    const u = getAgentLogParser(FORMATS.cursor);
    expect(typeof z).toBe('function');
    expect(typeof c).toBe('function');
    expect(typeof u).toBe('function');
    // 两键若误注册同一解析器，后续矩阵断言会静默失效——先钉死互异。
    expect(z).not.toBe(c);
    expect(z).not.toBe(u);
    expect(c).not.toBe(u);
  });

  it('未注册 format（含近义错误串 / 二进制格式 / 空串）→ null（调用方转 unsupported）', () => {
    expect(getAgentLogParser('claude-transcript-jsonl')).toBeNull();
    expect(getAgentLogParser('cursor-agent-transcript')).toBeNull(); // 少 -jsonl 后缀
    expect(getAgentLogParser('screenshot-png')).toBeNull();
    expect(getAgentLogParser('')).toBeNull();
  });
});

// ── M2：输出形状一致（同一契约，三家同口径）──────────────────────────────────

describe('agent-log 解析器矩阵 — 同场景输出形状一致（M2 / FR-02）', () => {
  const KINDS: readonly NormalizedLogMessage['kind'][] = [
    'user_input',
    'reply',
    'thinking',
    'tool_use',
    'tool_result',
  ];

  /**
   * 公共契约断言（三家逐字同口径）：
   * - status=parsed、truncated=false 时 totalSegments === messages.length；
   * - seq 从 1 起连续单调（无空洞重编号）；
   * - kind 全部落在契约枚举内；
   * - 九基础字段（text/tool_name/tool_use_id/tool_input/tool_result/is_error/ts）
   *   恒存在（值为 null 或具体值，不缺键）。
   */
  function expectCommonContract(result: AgentLogMessagesResult): void {
    expect(result.status).toBe('parsed');
    expect(result.truncated).toBe(false);
    expect(typeof result.totalSegments).toBe('number');
    expect(typeof result.skippedLines).toBe('number');
    expect(result.totalSegments).toBe(result.messages.length);
    let prevSeq = 0;
    for (const message of result.messages) {
      expect(message.seq).toBe(prevSeq + 1);
      expect(KINDS).toContain(message.kind);
      for (const field of ['text', 'tool_name', 'tool_use_id', 'tool_input', 'tool_result', 'is_error', 'ts'] as const) {
        expect(Object.hasOwn(message, field)).toBe(true);
      }
      prevSeq = message.seq;
    }
  }

  it('zcode：7 段、公共契约成立、turn_id 取产出调用锚（锚定段透传原文、未锚段 null 不幻影切轮）', async () => {
    const result = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    expectCommonContract(result);
    expect(result.totalSegments).toBe(7);
    expect(result.skippedLines).toBe(0);
    // 段序 S/H1/R1/tool_use/tool_result/H2/R2：R1 与其 tool_use 是 L1 窗口末 assistant
    // （= L0 的响应）→ 锚 L0 的 turn-1；R2 是末行补产段 → turn-2；其余未锚段 null。
    expect(result.messages.map((m) => m.turn_id)).toEqual([
      null, null, 'turn-1', 'turn-1', null, null, 'turn-2',
    ]);
  });

  it('claude-code：7 段、公共契约成立、turn_id 恒 string（会话内轮序）', async () => {
    const result = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    expectCommonContract(result);
    expect(result.totalSegments).toBe(7);
    expect(result.skippedLines).toBe(0);
    for (const message of result.messages) expect(typeof message.turn_id).toBe('string');
  });

  it('cursor：6 段、公共契约成立、turn_id 恒 string（turn_ended 轮号）', async () => {
    const result = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    expectCommonContract(result);
    expect(result.totalSegments).toBe(6);
    expect(result.skippedLines).toBe(0); // turn_ended 是合法事件行，不计坏行
    for (const message of result.messages) expect(typeof message.turn_id).toBe('string');
  });

  it('kind 序列交叉断言：zcode 与 claude-code 完全同构；cursor 同构减 tool_result（spike-02 不落盘）', async () => {
    const z = (await parserFor(FORMATS.zcode)(ZCODE_MINI, {})).messages.map((m) => m.kind);
    const c = (await parserFor(FORMATS.claudeCode)(CC_MINI, {})).messages.map((m) => m.kind);
    const u = (await parserFor(FORMATS.cursor)(CURSOR_MINI, {})).messages.map((m) => m.kind);
    const commonShape = ['user_input', 'user_input', 'reply', 'tool_use', 'tool_result', 'user_input', 'reply'];
    expect(z).toEqual(commonShape);
    expect(c).toEqual(commonShape);
    expect(u).toEqual(['user_input', 'user_input', 'reply', 'tool_use', 'user_input', 'reply']);
  });

  it('ts 口径：zcode 取所属行 completedAt、claude-code 取行 timestamp（均 ISO 字符串）；cursor 恒 null（不落盘不伪造）', async () => {
    const z = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    for (const message of z.messages) expect(typeof message.ts).toBe('string');
    // 段 1..2 由 L0 覆盖（仅 L0 写入）、段 3..5 由 L1 写入（滑动窗重写 R1 槽）、
    // 补产段属 L1——行归属正确（ts 是行级事实，不随锚定改变）。
    expect(z.messages[0]?.ts).toBe('2026-09-19T10:00:01.000Z');
    expect(z.messages[4]?.ts).toBe('2026-09-19T10:00:02.000Z');

    const c = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    for (const message of c.messages) expect(typeof message.ts).toBe('string');

    const u = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    for (const message of u.messages) expect(message.ts).toBeNull();
  });
});

// ── M3：sender 归一矩阵（D-003@v1——伪用户消息归系统事件，仅真人输入作用户气泡）─

describe('agent-log 解析器矩阵 — sender 归一矩阵（M3 / D-003@v1）', () => {
  /** 三家真人 user_input 段（文本以 FIXTURE_HUMAN 开头，与注入段区分）。 */
  async function humanInputs(format: string, content: string): Promise<NormalizedLogMessage[]> {
    const result = await parserFor(format)(content, {});
    return ofKind(result.messages, 'user_input').filter((m) => m.text?.startsWith('FIXTURE_HUMAN'));
  }

  it('系统注入文本三 harness 均 sender=system_event（各按自家规则命中，文本原样保留）', async () => {
    // zcode：<task-notification> 前缀（task-02 规则）。
    const z = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    expect(z.messages[0]).toMatchObject({
      kind: 'user_input',
      text: '<task-notification>FIXTURE_BACKGROUND_TASK_DONE</task-notification>',
      sender: 'system_event',
    });
    // claude-code：注入前缀白名单（【当前用户信息】…；isMeta 路径由 C4 专项覆盖不重复）。
    const c = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    expect(c.messages[0]).toMatchObject({
      kind: 'user_input',
      text: '【当前用户信息】FIXTURE_INJECTED_CONTEXT',
      sender: 'system_event',
    });
    // cursor：<task-notification> 前缀（task-05 规则）。
    const u = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    expect(u.messages[0]).toMatchObject({
      kind: 'user_input',
      text: '<task-notification>FIXTURE_BACKGROUND_TASK_DONE</task-notification>',
      sender: 'system_event',
    });
  });

  it('真人文本三 harness 语义一致归人：sender ∈ {undefined, "human"}，绝无 system_event', async () => {
    // 三家真人段各 2 条（H1/H2）；zcode 缺省不写键、claude-code/cursor 显式 "human"。
    const z = await humanInputs(FORMATS.zcode, ZCODE_MINI);
    const c = await humanInputs(FORMATS.claudeCode, CC_MINI);
    const u = await humanInputs(FORMATS.cursor, CURSOR_MINI);
    for (const group of [z, c, u]) {
      expect(group.map((m) => m.text)).toEqual(['FIXTURE_HUMAN_QUESTION', 'FIXTURE_HUMAN_SECOND']);
      for (const message of group) {
        expect(message.sender === undefined || message.sender === 'human').toBe(true);
      }
    }
    // 表示形态逐家钉死（消费方统一按缺省=human 处理，此处钉住两形态不漂移）：
    expect(z.map((m) => m.sender)).toEqual([undefined, undefined]);
    expect(c.map((m) => m.sender)).toEqual(['human', 'human']);
    expect(u.map((m) => m.sender)).toEqual(['human', 'human']);
  });

  it('非 user_input 段三 harness 均不携带 sender 键（sender 仅 user_input 段有意义）', async () => {
    const results = [
      await parserFor(FORMATS.zcode)(ZCODE_MINI, {}),
      await parserFor(FORMATS.claudeCode)(CC_MINI, {}),
      await parserFor(FORMATS.cursor)(CURSOR_MINI, {}),
    ];
    for (const result of results) {
      for (const message of result.messages) {
        if (message.kind !== 'user_input') expect(message.sender).toBeUndefined();
      }
    }
  });
});

// ── M4：usage / totalUsage 矩阵（D-004@v1——有数据源附着五项，无数据源显式未知）─

describe('agent-log 解析器矩阵 — usage / totalUsage 矩阵（M4 / D-004@v1）', () => {
  it('zcode：usage 附着产出调用锚——锚定段（R1+其 tool_use）带 usage A、末行补产段带 B；未锚段 null 不带 model/duration', async () => {
    const result = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    // 段序 S/H1/R1/tool_use/tool_result/H2/R2：R1 及其 tool_use 锚定到产出调用 L0
    // （usage A / model / duration 同锚）；R2 补产段带末行自身（usage B）。
    expect(result.messages.map((m) => m.usage)).toEqual([
      null, null, Z_USAGE_A, Z_USAGE_A, null, null, Z_USAGE_B,
    ]);
    for (const index of [2, 3, 6]) {
      expect(result.messages[index]?.model).toBe('FIXTURE_MODEL');
      expect(result.messages[index]?.duration_ms).toBe(1234);
    }
    for (const index of [0, 1, 4, 5]) {
      expect(result.messages[index]?.model).toBeNull();
      expect(result.messages[index]?.duration_ms).toBeNull();
    }
  });

  it('claude-code：五项 usage（snake→camel 映射）附着到该 assistant 行全部段；user 行恒不带 usage', async () => {
    const result = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    // 行 3 产 reply(R1)+tool_use 两段共享同一份 usage；行 6 产 reply(R2)。
    expect(result.messages[2]?.usage).toEqual(CC_USAGE_ROW1);
    expect(result.messages[3]?.usage).toEqual(CC_USAGE_ROW1);
    expect(result.messages[6]?.usage).toEqual(CC_USAGE_ROW2);
    // user 行（S/H1/载体/H2，段 1/2/5/6 中 user_input 与 tool_result 载体段）不带。
    for (const index of [0, 1, 4, 5]) expect(result.messages[index]?.usage).toBeUndefined();
  });

  it('cursor：全段恒不带 usage（token 不落盘即未知，不伪造 0），model/duration_ms 同缺省', async () => {
    const result = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    for (const message of result.messages) {
      expect(message.usage).toBeUndefined();
      expect(message.model).toBeUndefined();
      expect(message.duration_ms).toBeUndefined();
    }
  });

  it('totalUsage 按调用去重求和：zcode A+B（4+3 段不放大）、claude-code 两行和（多段不放大）', async () => {
    const z = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    expect(z.totalUsage).toEqual(Z_TOTAL_A_PLUS_B); // 若按段求和会是 4A+3B，非 A+B
    const c = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    expect(c.totalUsage).toEqual(CC_TOTAL); // 若按段求和 input 会是 21（10×2+1）而非 11
  });

  it('无 usage 数据源 → 不伪造：zcode 老形状会话 totalUsage null、cursor 恒 totalUsage null', async () => {
    const z = await parserFor(FORMATS.zcode)(ZCODE_LEGACY_NO_USAGE, {});
    expect(z.status).toBe('parsed');
    expect(z.totalUsage).toBeNull();
    const u = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    expect(u.totalUsage).toBeNull();
  });

  it('totalUsage 与 beforeSeq 切片无关（三家同口径：全会话累计，非当前窗口和）', async () => {
    const z = await parserFor(FORMATS.zcode)(ZCODE_MINI, { beforeSeq: 4 });
    expect(z.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(z.totalUsage).toEqual(Z_TOTAL_A_PLUS_B);

    const c = await parserFor(FORMATS.claudeCode)(CC_MINI, { beforeSeq: 4 });
    expect(c.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(c.totalUsage).toEqual(CC_TOTAL);

    const u = await parserFor(FORMATS.cursor)(CURSOR_MINI, { beforeSeq: 4 });
    expect(u.messages.map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(u.totalUsage).toBeNull();
  });

  it('parse_error 早退零新字段：三家坏行占比 >50% 结果均不带 totalUsage 键', async () => {
    const zBad = await parserFor(FORMATS.zcode)(
      jsonl('{坏行一', '{坏行二', zIoLine({
        messagesKind: 'full',
        offset: 0,
        messages: [zUser('好行')],
        turnId: 'turn-x',
        usage: Z_USAGE_A,
        completedAt: '2026-09-19T10:00:01.000Z',
      })),
      {},
    );
    expect(zBad.status).toBe('parse_error');
    expect('totalUsage' in zBad).toBe(false);

    const cBad = await parserFor(FORMATS.claudeCode)(
      jsonl('{坏行一', '{坏行二', ccUser('好行', ccTs(1))),
      {},
    );
    expect(cBad.status).toBe('parse_error');
    expect('totalUsage' in cBad).toBe(false);

    const uBad = await parserFor(FORMATS.cursor)(jsonl('{坏行一', '{坏行二', cUser('好行')), {});
    expect(uBad.status).toBe('parse_error');
    expect('totalUsage' in uBad).toBe(false);
  });
});

// ── M5：turn 边界矩阵（D-005@v1——三家轮边界机制不同，切轮位置一致）──────────

describe('agent-log 解析器矩阵 — turn 边界矩阵（M5 / D-005@v1）', () => {
  it('zcode：turn_id 取产出调用锚（窗口末 assistant 段锚前驱行 turnId 原文；未锚段 null）', async () => {
    const result = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    expect(result.messages.map((m) => m.turn_id)).toEqual([
      null, null, 'turn-1', 'turn-1', null, null, 'turn-2',
    ]);
  });

  it('claude-code：真人 user_input 自增轮号（注入与 tool_result 载体不切轮；首条真人前归 0 轮）', async () => {
    const result = await parserFor(FORMATS.claudeCode)(CC_MINI, {});
    expect(result.messages.map((m) => m.turn_id)).toEqual([
      '0', // S 注入（system_event 不切轮）
      '1', '1', '1', '1', // H1 → R1/tool_use/载体
      '2', '2', // H2 → R2
    ]);
  });

  it('cursor：turn_ended 事件切轮（轮号 1 起，事件行本身不产段）', async () => {
    const result = await parserFor(FORMATS.cursor)(CURSOR_MINI, {});
    expect(result.messages.map((m) => m.turn_id)).toEqual(['1', '1', '1', '1', '2', '2']);
  });

  it('交叉口径：两轮答复异轮、第二问语义上属第二轮（zcode 未锚段 null 由真人输入切轮兜底）', async () => {
    // claude-code / cursor：h1/h2/r2 均有 turn_id，按原语义直断。
    for (const { format, content } of [
      { format: FORMATS.claudeCode, content: CC_MINI },
      { format: FORMATS.cursor, content: CURSOR_MINI },
    ]) {
      const result = await parserFor(format)(content, {});
      const humans = ofKind(result.messages, 'user_input').filter((m) => m.text?.startsWith('FIXTURE_HUMAN'));
      const [h1, h2] = humans;
      const r2 = [...result.messages].reverse().find((m) => m.kind === 'reply');
      expect(h1?.turn_id).toBeTypeOf('string');
      expect(h1?.turn_id).not.toBe(h2?.turn_id); // 两真人问分属不同轮
      expect(h2?.turn_id).toBe(r2?.turn_id); // 第二问与其答复同轮
    }
    // zcode：H 段不锚定（turn_id null——切轮由前端真人输入判定兜底，见
    // agent-log-turns 测试），以锚定答复段验证轮语义：R1=turn-1 ≠ R2=turn-2。
    const z = await parserFor(FORMATS.zcode)(ZCODE_MINI, {});
    const replies = ofKind(z.messages, 'reply');
    const [r1, r2] = replies;
    expect(r1?.turn_id).toBe('turn-1');
    expect(r2?.turn_id).toBe('turn-2');
    expect(r1?.turn_id).not.toBe(r2?.turn_id);
  });
});

// ── M6：窗口 / beforeSeq / truncated / totalSegments 三家逐字同口径（Z7/C8/U8）─

describe('agent-log 解析器矩阵 — 窗口与 beforeSeq 同口径（M6 / FR-03）', () => {
  /** 250 段会话 × 三 harness（口径对齐 Z7/C8/U8 的 250 user 构造）。 */
  const WINDOW_CASES: Array<{ harness: string; format: string; content: string }> = [
    {
      harness: 'zcode',
      format: FORMATS.zcode,
      content: jsonl(
        zIoLine({
          messagesKind: 'full',
          offset: 0,
          messages: Array.from({ length: 250 }, (_, i) => zUser(`消息 ${i + 1}`)),
          turnId: 'turn-window',
          usage: Z_USAGE_A,
          completedAt: '2026-09-19T10:00:01.000Z',
        }),
      ),
    },
    {
      harness: 'claude-code',
      format: FORMATS.claudeCode,
      content: jsonl(...Array.from({ length: 250 }, (_, i) => ccUser(`消息 ${i + 1}`, ccTs(1)))),
    },
    {
      harness: 'cursor-agent',
      format: FORMATS.cursor,
      content: jsonl(...Array.from({ length: 250 }, (_, i) => cUser(`消息 ${i + 1}`))),
    },
  ];

  it.each(WINDOW_CASES)('$harness：总段数 >200 → 最近 200 段 + truncated:true，totalSegments 记全量', async ({ format, content }) => {
    const result = await parserFor(format)(content, {});
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(DEFAULT_MAX_SEGMENTS);
    expect(result.messages[0]).toMatchObject({ seq: 51, text: '消息 51' });
    expect(result.messages[199]).toMatchObject({ seq: 250, text: '消息 250' });
  });

  it.each(WINDOW_CASES)('$harness：beforeSeq=100 → seq<100 的 99 段且不截断，totalSegments 仍记全量', async ({ format, content }) => {
    const result = await parserFor(format)(content, { beforeSeq: 100 });
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(99);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[98]?.seq).toBe(99);
    expect(result.messages[98]?.text).toBe('消息 99');
  });

  it.each(WINDOW_CASES)('$harness：beforeSeq 超最大 seq → 切片后仍超窗 → 最近 200 段 + truncated:true', async ({ format, content }) => {
    const result = await parserFor(format)(content, { beforeSeq: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0]?.seq).toBe(51);
  });
});
