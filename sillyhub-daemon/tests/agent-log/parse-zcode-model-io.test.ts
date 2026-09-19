// tests/agent-log/parse-zcode-model-io.test.ts
// task-01（2026-08-23-agent-log-conversation-view / FR-01 + FR-02）：zcode model-io
// JSONL 解析器纯函数单测。
//
// fixture 内嵌字符串构造（真实形状按 design §5.1 两份真实日志实证事实：
// ~/.zcode/cli/rollout/model-io-*.jsonl 的 request/response/消息键集逐字段对齐），
// 测试不依赖该目录存在；解析器为纯函数（content + 预算/窗口/beforeSeq/超时/时钟
// 全注入），零 vi.mock。
//
// 覆盖 task-01 acceptance 全项：
//   Z1 full/delta(len=0)/tail 交错统一 offset 对齐合并（后写覆盖取最新）
//   Z2 真实消息形状段产出（user 字符串 content / assistant text+reasoning 块 +
//      消息级 toolCalls / assistant 空字符串 content / tool 消息级键集 → 九字段）
//   Z3 role=system 与 <system-reminder> 剥离（剥后空丢弃，R-04 铁律）
//   Z4 末行 response 补尾 + 与 G 尾部同文去重（中间行 response 不补产）
//   Z5 坏行容错（≤50% 跳过计数不中断；>50% → parse_error；空行不计坏行）
//   Z6 20MB 预算（超限 too_large；恰好等于上限可解析）
//   Z7 200 段窗口 + beforeSeq 切片 + truncated/totalSegments
//   Z8 5s 超时保护 → parse_error（now 注入，非时钟 mock）
//   Z9 窗口空洞跳过 + seq 重编号
//   Z10 tool_input 2KB / tool_result 4KB 截断；ts 为所属行 completedAt
//   Z11（2026-09-19-tool-report-session-replay task-02）行顶层 turnId/model/durationMs
//      + response.usage 附着到该行产出的全部段（G 合并段 + 末行补产段共用同一份，
//      同一次调用多段共享 usage）；model 对象形态 {"modelId",…} 取 modelId
//   Z12 老形状行（新字段全无）→ 段新字段 null + totalUsage null（不伪造 0）；
//      形状漂移（model 非字符串非对象 / usage 五项全缺 / durationMs 非数）同置 null；
//      usage 部分缺项按 0 计（部分上报不整段丢弃）
//   Z13 totalUsage 按「调用」去重（每个有效行只计一次）且与窗口截断 / beforeSeq
//      切片无关；parse_error / too_large 早退结果零新字段（不带 totalUsage）
//   Z14 sender 归一（D-003@v1）：段正文以 <task-notification> 开头 → system_event；
//      混合 reminder+真人正文 / 普通文本 → 缺省不写（视为 human）；非 user_input 段不写

import { describe, it, expect } from 'vitest';
import {
  parseZcodeModelIoLog,
  DEFAULT_MAX_SEGMENTS,
  type NormalizedLogMessage,
} from '../../src/agent-log/parse-zcode-model-io.js';

// ── fixture 构造（真实形状）───────────────────────────────────────────────────

/** user 消息：content 恒为纯字符串（§5.1 实证）。 */
const USER = (text: string): Record<string, unknown> => ({ role: 'user', content: text });

/** system 消息（真实日志存在，段产出时跳过）。 */
const SYS: Record<string, unknown> = { role: 'system', content: 'You are ZCode, an interactive coding agent' };

/** assistant 消息：content 为块数组（text/reasoning 两种）+ 消息级 toolCalls。 */
const ASST_BLOCKS = (
  blocks: Array<{ type: 'text' | 'reasoning'; text: string }>,
  toolCalls?: Array<{ id: string; name: string; input: unknown }>,
): Record<string, unknown> => ({
  role: 'assistant',
  content: blocks,
  modelRef: 'glm-4.6',
  ...(toolCalls ? { toolCalls } : {}),
});

/** assistant 消息：content 为空字符串 + 消息级 toolCalls（真实日志形状）。 */
const ASST_EMPTY_CONTENT = (
  toolCalls: Array<{ id: string; name: string; input: unknown }>,
): Record<string, unknown> => ({ role: 'assistant', content: '', modelRef: 'glm-4.6', toolCalls });

/** tool 消息：消息级 {toolCallId, toolName, isError, content 纯字符串}。 */
const TOOL = (
  toolCallId: string,
  toolName: string,
  content: string,
  isError = false,
): Record<string, unknown> => ({ role: 'tool', toolCallId, toolName, isError, content });

/**
 * 构造一行 model_io JSONL（键集对齐真实日志，含解析器不消费的旁路字段）。
 * 2026-09-19 task-02 起顶层 turnId/model/durationMs 与 response.usage 为被消费
 * 字段：model 按 2026-09-19 实证对象形态 `{"modelId":…,"providerId":…}` 构造、
 * usage 五项齐全（缺项场景经 usage 覆盖注入）。
 */
function ioLine(opts: {
  kind: 'full' | 'delta' | 'tail';
  offset: number;
  messages: Array<Record<string, unknown>>;
  responseText?: string;
  responseToolCalls?: Array<{ id: string; name: string; input: unknown }>;
  completedAt?: string;
  turnId?: string;
  modelId?: string;
  durationMs?: number;
  usage?: Record<string, unknown>;
}): string {
  return JSON.stringify({
    type: 'model_io',
    request: {
      messages: opts.messages,
      messageOffset: opts.offset,
      // 真实日志语义：会话消息总数（tail 行 offset+windowLen）；解析器不依赖此字段。
      messageCount: opts.offset + opts.messages.length,
      messagesKind: opts.kind,
      body: { model: 'glm-4.6', tools: [{ name: 'Read' }] },
      headers: { 'x-request-id': 'req_fixture' },
      maxOutputTokens: 4096,
    },
    response: {
      text: opts.responseText ?? '',
      toolCalls: opts.responseToolCalls ?? [],
      finishReason: 'stop',
      usage:
        opts.usage ??
        { inputTokens: 100, outputTokens: 20, totalTokens: 150, cacheReadTokens: 30, cacheWriteTokens: 10 },
    },
    attempt: 1,
    startedAt: '2026-08-23T11:59:59.000Z',
    completedAt: opts.completedAt ?? '2026-08-23T12:00:00.000Z',
    model: { modelId: opts.modelId ?? 'glm-4.6', providerId: 'provider_fixture' },
    sessionId: 'sess_fixture',
    requestId: 'req_fixture',
    turnId: opts.turnId ?? 'turn_fixture',
    durationMs: opts.durationMs ?? 1234,
    querySource: 'agent',
  });
}

/**
 * 老形状行（2026-09-19 补字段之前的旁路字段全无）：顶层无 turnId/model/durationMs、
 * response 无 usage——新字段缺省（Z12）与 totalUsage null 的对照组。
 */
function legacyIoLine(opts: {
  offset: number;
  messages: Array<Record<string, unknown>>;
  responseText?: string;
  completedAt?: string;
}): string {
  return JSON.stringify({
    type: 'model_io',
    request: { messages: opts.messages, messageOffset: opts.offset },
    response: { text: opts.responseText ?? '', toolCalls: [] },
    completedAt: opts.completedAt ?? '2026-08-23T12:00:00.000Z',
  });
}

/** 多行拼成 JSONL 文本（尾随换行，真实文件形状）。 */
function jsonl(...lines: string[]): string {
  return `${lines.join('\n')}\n`;
}

/** 提取某 kind 的段（便于断言）。 */
function ofKind(messages: NormalizedLogMessage[], kind: NormalizedLogMessage['kind']): NormalizedLogMessage[] {
  return messages.filter((m) => m.kind === kind);
}

// ── Z1 + Z2 + Z10（部分）：full/delta(len=0)/tail 交错合并与段产出 ────────────

describe('parseZcodeModelIoLog — 统一 offset 对齐合并（Z1/Z2/Z10）', () => {
  // 会话全局序列（G 下标）：
  //   G0 system / G1 user / G2 assistant(reasoning+text+toolCalls tc1)
  //   G3 tool(tc1 结果) / G4 assistant(text 中间响应 + toolCalls tc2) / G5 tool(tc2 错误结果)
  // 行设计：L0 full(0..2) → L1 delta(3, 旧结果) → L2 delta(offset=4, len=0, response 中间响应)
  //        → L3 tail(3..4, 覆盖 G3 为新结果) → L4 tail(2..5, 收口)
  // 末行 L4 response「最终回答」不在任何窗口 → 补产。
  const content = jsonl(
    ioLine({
      kind: 'full',
      offset: 0,
      messages: [
        SYS,
        USER('读一下 tasks/task-01.md 并实现'),
        ASST_BLOCKS(
          [
            { type: 'reasoning', text: '思考一：先读任务卡' },
            { type: 'text', text: '我先看文件' },
          ],
          [{ id: 'tc1', name: 'Read', input: { file_path: '/a/task-01.md' } }],
        ),
      ],
      completedAt: '2026-08-23T12:00:01.000Z',
    }),
    ioLine({
      kind: 'delta',
      offset: 3,
      messages: [TOOL('tc1', 'Read', '旧结果')],
      completedAt: '2026-08-23T12:00:02.000Z',
    }),
    // delta len=0：本次调用无新消息、仅记录 response（§5.1 实证形状）。
    // 其 response「中间响应」不是末行 → 不直接补产，经 L3 窗口进 G。
    ioLine({
      kind: 'delta',
      offset: 4,
      messages: [],
      responseText: '中间响应',
      completedAt: '2026-08-23T12:00:03.000Z',
    }),
    ioLine({
      kind: 'tail',
      offset: 3,
      messages: [
        TOOL('tc1', 'Read', '新结果'),
        ASST_BLOCKS([{ type: 'text', text: '中间响应' }], [
          { id: 'tc2', name: 'Bash', input: { command: 'ls' } },
        ]),
      ],
      completedAt: '2026-08-23T12:00:04.000Z',
    }),
    ioLine({
      kind: 'tail',
      offset: 2,
      messages: [
        ASST_BLOCKS(
          [
            { type: 'reasoning', text: '思考一：先读任务卡' },
            { type: 'text', text: '我先看文件' },
          ],
          [{ id: 'tc1', name: 'Read', input: { file_path: '/a/task-01.md' } }],
        ),
        TOOL('tc1', 'Read', '新结果'),
        ASST_BLOCKS([{ type: 'text', text: '中间响应' }], [
          { id: 'tc2', name: 'Bash', input: { command: 'ls' } },
        ]),
        TOOL('tc2', 'Bash', '命令失败', true),
      ],
      responseText: '最终回答',
      completedAt: '2026-08-23T12:00:05.000Z',
    }),
  );

  it('三 kind 交错经绝对 offset 对齐合并后产出 9 段（G 序列正确，seq 连续重编号）', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(9);
    expect(result.messages.map((m) => [m.seq, m.kind, m.text, m.tool_name, m.tool_use_id])).toEqual([
      [1, 'user_input', '读一下 tasks/task-01.md 并实现', null, null],
      [2, 'thinking', '思考一：先读任务卡', null, null],
      [3, 'reply', '我先看文件', null, null],
      [4, 'tool_use', null, 'Read', 'tc1'],
      // tool_result 的正文在 tool_result 字段（design §7.1），text 恒 null。
      [5, 'tool_result', null, 'Read', 'tc1'],
      [6, 'reply', '中间响应', null, null],
      [7, 'tool_use', null, 'Bash', 'tc2'],
      [8, 'tool_result', null, 'Bash', 'tc2'],
      [9, 'reply', '最终回答', null, null],
    ]);
  });

  it('后写覆盖取最新：G3 取 tail 覆盖后的「新结果」，旧值不残留', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(JSON.stringify(result.messages)).not.toContain('旧结果');
    expect(ofKind(result.messages, 'tool_result')[0]?.tool_result).toBe('新结果');
  });

  it('ts 为所属行 completedAt（仅 L0 full 覆盖过的 G1 保留 T0，其余取最后写入行 T4）', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(result.messages[0]?.ts).toBe('2026-08-23T12:00:01.000Z');
    expect(result.messages[1]?.ts).toBe('2026-08-23T12:00:05.000Z');
    expect(result.messages[8]?.ts).toBe('2026-08-23T12:00:05.000Z'); // 末行 response 补产段
  });

  it('消息形状段产出：tool_use 九字段（input 为 JSON.stringify 摘要）、tool_result is_error', async () => {
    const result = await parseZcodeModelIoLog(content);
    const toolUse = ofKind(result.messages, 'tool_use')[0];
    expect(toolUse).toMatchObject({
      kind: 'tool_use',
      text: null,
      tool_name: 'Read',
      tool_use_id: 'tc1',
      tool_input: '{"file_path":"/a/task-01.md"}',
      tool_result: null,
      is_error: null,
    });
    const toolResults = ofKind(result.messages, 'tool_result');
    expect(toolResults[0]).toMatchObject({ tool_name: 'Read', tool_use_id: 'tc1', tool_result: '新结果', is_error: false });
    expect(toolResults[1]).toMatchObject({ tool_name: 'Bash', tool_use_id: 'tc2', tool_result: '命令失败', is_error: true });
  });

  it('assistant content 为空字符串 + 消息级 toolCalls（真实形状）→ 仅产 tool_use，不产空 reply', async () => {
    const single = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [
          USER('列出文件'),
          ASST_EMPTY_CONTENT([{ id: 't1', name: 'Bash', input: { command: 'ls' } }]),
          TOOL('t1', 'Bash', 'a.txt\nb.txt'),
        ],
      }),
    );
    const result = await parseZcodeModelIoLog(single);
    expect(result.messages.map((m) => m.kind)).toEqual(['user_input', 'tool_use', 'tool_result']);
  });
});

// ── Z3：system 与 system-reminder 剥离（R-04）────────────────────────────────

describe('parseZcodeModelIoLog — system / system-reminder 剥离（Z3 / R-04）', () => {
  it('user 混合 reminder：剥块后仅保留正文（多块全剥）', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [
          USER('<system-reminder>\nAs you answer, context: AGENTS.md secret-body\n</system-reminder>\n\n真实问题：实现解析器'),
          USER('<system-reminder>第一块</system-reminder>中段文本<system-reminder>第二块</system-reminder>'),
        ],
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parsed');
    expect(ofKind(result.messages, 'user_input').map((m) => m.text)).toEqual([
      '真实问题：实现解析器',
      '中段文本',
    ]);
  });

  it('user 纯 reminder（剥后为空）→ 整消息丢弃，任何输出字段不残留 reminder 内容', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [
          USER('<system-reminder>\nonly reminder context\n</system-reminder>'),
          USER('<system-reminder>未闭合标签也整段丢弃'),
          USER('可见输入'),
        ],
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(1);
    expect(result.messages[0]?.text).toBe('可见输入');
    const serialized = JSON.stringify(result.messages);
    expect(serialized).not.toContain('system-reminder');
    expect(serialized).not.toContain('only reminder context');
    expect(serialized).not.toContain('未闭合标签也整段丢弃');
  });

  it('role=system 消息永不产出段（系统提示词不进任何输出字段）', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [SYS, USER('问题'), { role: 'system', content: 'The following skills are available' }],
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(1);
    expect(JSON.stringify(result.messages)).not.toContain('You are ZCode');
    expect(JSON.stringify(result.messages)).not.toContain('skills are available');
  });
});

// ── Z4：末行 response 补尾 + 同文去重 ────────────────────────────────────────

describe('parseZcodeModelIoLog — 末行 response 补尾与同文去重（Z4）', () => {
  it('末行 response 补产 reply + tool_use 段（G 无对应内容时）', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('hi')],
        responseText: '总结：完成',
        responseToolCalls: [{ id: 'tc9', name: 'Grep', input: { pattern: 'x' } }],
        completedAt: '2026-08-23T12:10:00.000Z',
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(3);
    expect(result.messages[1]).toMatchObject({
      kind: 'reply',
      text: '总结：完成',
      ts: '2026-08-23T12:10:00.000Z',
    });
    expect(result.messages[2]).toMatchObject({
      kind: 'tool_use',
      tool_name: 'Grep',
      tool_use_id: 'tc9',
      tool_input: '{"pattern":"x"}',
    });
  });

  it('G 尾部 assistant 段同文 reply → 补产被去重跳过', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('hi'), ASST_BLOCKS([{ type: 'text', text: '完成' }])],
        responseText: '完成',
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(2);
    expect(ofKind(result.messages, 'reply').map((m) => m.text)).toEqual(['完成']);
  });

  it('G 尾部 assistant 段同 id tool_use → 补产被去重跳过', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('hi'), ASST_EMPTY_CONTENT([{ id: 'tc1', name: 'Read', input: { file_path: '/a' } }])],
        responseToolCalls: [{ id: 'tc1', name: 'Read', input: { file_path: '/a' } }],
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(ofKind(result.messages, 'tool_use').map((m) => m.tool_use_id)).toEqual(['tc1']);
  });

  it('中间行 response 不直接补产（经后续行窗口进 G，同文只出现一次）', async () => {
    const content = jsonl(
      ioLine({ kind: 'full', offset: 0, messages: [USER('hi')], responseText: '第一响应' }),
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('hi'), ASST_BLOCKS([{ type: 'text', text: '第一响应' }])],
        responseText: '第二响应',
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(ofKind(result.messages, 'reply').map((m) => m.text)).toEqual(['第一响应', '第二响应']);
    expect(result.totalSegments).toBe(3);
  });
});

// ── Z5：坏行容错 ─────────────────────────────────────────────────────────────

describe('parseZcodeModelIoLog — 坏行容错（Z5 / R-01）', () => {
  /** 8 种结构不符变体（JSON.parse 失败 / type 不符 / 缺 request / messages 非数组 / offset 非法）。 */
  const BAD_LINES: string[] = [
    '{not valid json',
    JSON.stringify({ type: 'other_event', data: 1 }),
    JSON.stringify({ type: 'model_io' }), // 缺 request
    JSON.stringify({ type: 'model_io', request: {} }), // 缺 messages
    JSON.stringify({ type: 'model_io', request: { messages: 'not-array', messageOffset: 0 } }),
    JSON.stringify({ type: 'model_io', request: { messages: [], messageOffset: -1 } }), // 负 offset
    JSON.stringify({ type: 'model_io', request: { messages: [], messageOffset: 1.5 } }), // 非整数
    JSON.stringify([1, 2, 3]), // 非 object 行
  ];

  function goodLine(i: number): string {
    return ioLine({ kind: 'full', offset: 0, messages: [USER(`好行 ${i}`)] });
  }

  it('坏行占比恰 50%（边界，不 >50%）→ parsed：跳过计 skippedLines、解析不中断', async () => {
    const content = jsonl(...BAD_LINES, ...[0, 1, 2, 3, 4, 5, 6, 7].map(goodLine));
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(8);
    // 好行照常产出（8 行 full 互相覆盖 G0，最终为最后一行 + 末行 response 为空不补产）
    expect(result.totalSegments).toBe(1);
    expect(result.messages[0]?.text).toBe('好行 7');
  });

  it('坏行占比 >50% → status parse_error 且 messages 为空', async () => {
    const content = jsonl('{再来一个坏行', ...BAD_LINES, ...[0, 1, 2, 3, 4, 5, 6].map(goodLine));
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parse_error');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(0);
    expect(result.skippedLines).toBe(9);
  });

  it('空行与尾随换行不计坏行；空内容 → parsed 空 messages', async () => {
    const blankish = jsonl(ioLine({ kind: 'full', offset: 0, messages: [USER('唯一')] }), '', '   ');
    const r1 = await parseZcodeModelIoLog(blankish);
    expect(r1.status).toBe('parsed');
    expect(r1.skippedLines).toBe(0);
    expect(r1.totalSegments).toBe(1);

    const r2 = await parseZcodeModelIoLog('');
    expect(r2.status).toBe('parsed');
    expect(r2.messages).toEqual([]);
    expect(r2.totalSegments).toBe(0);
  });
});

// ── Z6：20MB 预算 ────────────────────────────────────────────────────────────

describe('parseZcodeModelIoLog — 内容预算（Z6 / R-02）', () => {
  it('content 超注入上限 → too_large 且 messages 为空（不进入逐行解析）', async () => {
    const big = jsonl(ioLine({ kind: 'full', offset: 0, messages: [USER('x'.repeat(64))] }));
    const result = await parseZcodeModelIoLog(big, { maxContentBytes: 32 });
    expect(result.status).toBe('too_large');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(0);
    expect(result.skippedLines).toBe(0);
  });

  it('byteLength 恰好等于上限（边界）→ 正常进入解析', async () => {
    const exact = jsonl(ioLine({ kind: 'full', offset: 0, messages: [USER('ok')] }));
    const size = Buffer.byteLength(exact, 'utf8');
    const result = await parseZcodeModelIoLog(exact, { maxContentBytes: size });
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(1);
  });
});

// ── Z7：200 段窗口与 beforeSeq 切片 ──────────────────────────────────────────

describe('parseZcodeModelIoLog — 段窗口与 beforeSeq（Z7 / FR-05）', () => {
  /** 250 个 user 消息（单行 full 窗口承载，足够超默认 200 段窗口）。 */
  const many = jsonl(
    ioLine({
      kind: 'full',
      offset: 0,
      messages: Array.from({ length: 250 }, (_, i) => USER(`消息 ${i + 1}`)),
    }),
  );

  it('总段数 >200 → 仅返回最近 200 段且 truncated:true，totalSegments 记全量总数', async () => {
    const result = await parseZcodeModelIoLog(many);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(DEFAULT_MAX_SEGMENTS);
    expect(result.messages[0]).toMatchObject({ seq: 51, text: '消息 51' });
    expect(result.messages[199]).toMatchObject({ seq: 250, text: '消息 250' });
  });

  it('beforeSeq 切片：返回 seq < beforeSeq 的段后再套窗口（99 段不超窗）', async () => {
    const result = await parseZcodeModelIoLog(many, { beforeSeq: 100 });
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(99);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[98]?.seq).toBe(99);
  });

  it('beforeSeq 大于最大 seq → 切片后仍超窗 → 最近 200 段 + truncated:true', async () => {
    const result = await parseZcodeModelIoLog(many, { beforeSeq: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0]?.seq).toBe(51);
  });

  it('maxSegments 注入小窗口（9 段 fixture → 最近 3 段）', async () => {
    const nine = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: Array.from({ length: 9 }, (_, i) => USER(`第 ${i + 1} 条`)),
      }),
    );
    const result = await parseZcodeModelIoLog(nine, { maxSegments: 3 });
    expect(result.totalSegments).toBe(9);
    expect(result.truncated).toBe(true);
    expect(result.messages.map((m) => m.seq)).toEqual([7, 8, 9]);
  });
});

// ── Z8：超时保护 ─────────────────────────────────────────────────────────────

describe('parseZcodeModelIoLog — 超时保护（Z8 / R-02）', () => {
  it('超过注入 deadline（每 500 行批处理边界检查）→ parse_error', async () => {
    const lines: string[] = [];
    for (let i = 0; i < 600; i++) {
      lines.push(ioLine({ kind: 'delta', offset: i, messages: [USER(`u${i}`)] }));
    }
    let calls = 0;
    const result = await parseZcodeModelIoLog(lines.join('\n'), {
      timeoutMs: 5000,
      // 第 1 次调用（算 deadline）返回基线；之后返回超远未来 → 第一个批处理边界即超时。
      now: () => {
        calls += 1;
        return calls === 1 ? 1_000 : 999_999;
      },
    });
    expect(result.status).toBe('parse_error');
    expect(result.messages).toEqual([]);
  });
});

// ── Z9：窗口空洞跳过重编号 ───────────────────────────────────────────────────

describe('parseZcodeModelIoLog — 窗口空洞（Z9 / R-03）', () => {
  it('tail 窗口留洞（G2 未覆盖）→ 跳过空洞 index，seq 无空洞重编号', async () => {
    const content = jsonl(
      ioLine({ kind: 'full', offset: 0, messages: [SYS, USER('第一问')] }),
      ioLine({ kind: 'tail', offset: 3, messages: [TOOL('tc9', 'Read', '迟到的结果')] }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(2);
    expect(result.messages.map((m) => [m.seq, m.kind])).toEqual([
      [1, 'user_input'],
      [2, 'tool_result'],
    ]);
    expect(result.messages[1]?.tool_use_id).toBe('tc9');
  });
});

// ── Z10：tool_input / tool_result 截断 ───────────────────────────────────────

describe('parseZcodeModelIoLog — 摘要截断（Z10 / design §7.1）', () => {
  it('tool_input JSON.stringify 后首 2KB 截断；tool_result 首 4KB 截断', async () => {
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [
          USER('跑个大命令'),
          ASST_EMPTY_CONTENT([{ id: 't1', name: 'Bash', input: { command: 'x'.repeat(5000) } }]),
          TOOL('t1', 'Bash', 'y'.repeat(5000)),
        ],
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    const toolUse = ofKind(result.messages, 'tool_use')[0];
    const toolResult = ofKind(result.messages, 'tool_result')[0];
    expect(toolUse?.tool_input).toHaveLength(2048);
    expect(toolUse?.tool_input?.startsWith('{"command":"xxxx')).toBe(true);
    expect(toolResult?.tool_result).toHaveLength(4096);
    expect(toolResult?.tool_result).toBe('y'.repeat(4096));
  });
});

// ── Z11：行级调用元数据附着（2026-09-19 task-02 / FR-02 + FR-03）──────────────

describe('parseZcodeModelIoLog — 行级元数据附着（Z11 / FR-02+FR-03）', () => {
  // 两行两次调用：L0（turn_A/glm-4.6/1234，默认 usage A）产 G 段；L1
  // （turn_B/glm-5.3/5678，usage B）既是 G 尾行又是末行——补产段必须带 turn_B 元数据。
  const USAGE_A = { inputTokens: 100, outputTokens: 20, totalTokens: 150, cacheReadTokens: 30, cacheWriteTokens: 10 };
  const USAGE_B = { inputTokens: 200, outputTokens: 40, totalTokens: 260, cacheReadTokens: 60, cacheWriteTokens: 20 };
  const content = jsonl(
    ioLine({
      kind: 'full',
      offset: 0,
      messages: [
        USER('补字段场景问题'),
        ASST_BLOCKS(
          [
            { type: 'reasoning', text: '先分析再动手' },
            { type: 'text', text: '开始处理' },
          ],
          [{ id: 'tcA', name: 'Read', input: { file_path: '/a/spec.md' } }],
        ),
      ],
      turnId: 'turn_A',
      modelId: 'glm-4.6',
      durationMs: 1234,
    }),
    ioLine({
      kind: 'tail',
      offset: 2, // 尾随追加（不覆盖 L0 的 assistant 槽位 1）
      messages: [TOOL('tcA', 'Read', '结果A')],
      responseText: '最终答复B',
      responseToolCalls: [{ id: 'tcB', name: 'Grep', input: { pattern: 'x' } }],
      turnId: 'turn_B',
      modelId: 'glm-5.3',
      durationMs: 5678,
      usage: USAGE_B,
    }),
  );

  it('G 合并段元数据取产出调用锚——尾窗无 assistant 的 G 段全 null（未知优于错值）、末行补产段带末行自身元数据', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(7);
    expect(result.messages.map((m) => [m.kind, m.turn_id, m.model, m.duration_ms])).toEqual([
      // L1 尾窗（offset 2）无 assistant → L0 的响应不在任何后续窗口里，锚未落
      // ——G 段全部未知（null），不再取「最后一次覆盖行的」错值（后写覆盖口径已替换）。
      ['user_input', null, null, null],
      ['thinking', null, null, null],
      ['reply', null, null, null],
      ['tool_use', null, null, null],
      ['tool_result', null, null, null],
      ['reply', 'turn_B', 'glm-5.3', 5678], // 末行 response 补产段（产出调用=末行自身）
      ['tool_use', 'turn_B', 'glm-5.3', 5678], // 末行 response 补产段
    ]);
  });

  it('usage 附着：G 段未获锚定全 null、末行补产段带 usage B；同调用多段共享同一份', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(result.messages.slice(0, 5).map((m) => m.usage)).toEqual(
      Array.from({ length: 5 }, () => null),
    );
    expect(result.messages.slice(5).map((m) => m.usage)).toEqual([USAGE_B, USAGE_B]);
    // 「共享同一份」= 同一引用（前端按调用去重聚合的依据）。
    expect(result.messages[5]?.usage).toBe(result.messages[6]?.usage);
  });

  it('产出调用锚定：行 N 窗口末 assistant 锚行 N-1 元数据（滑动窗下用量归属产出调用而非后写覆盖行）', async () => {
    const anchored = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('问1')],
        responseText: '答1',
        turnId: 'turn_A',
        modelId: 'glm-4.6',
        durationMs: 1234,
        usage: USAGE_A,
      }),
      ioLine({
        kind: 'full',
        offset: 1,
        messages: [ASST_BLOCKS([{ type: 'text', text: '答1' }]), USER('问2')],
        responseText: '答2',
        turnId: 'turn_B',
        modelId: 'glm-5.3',
        durationMs: 5678,
        usage: USAGE_B,
      }),
    );
    const result = await parseZcodeModelIoLog(anchored);
    expect(result.totalSegments).toBe(4);
    expect(result.messages.map((m) => [m.kind, m.turn_id, m.usage])).toEqual([
      ['user_input', null, null], // user 槽不获锚定（锚只落窗口末 assistant）
      // 「答1」是 L0 的响应、出现在 L1 窗口末 → 锚 L0 的元数据（turn_A/usage_A）。
      // 旧后写覆盖口径此处会是 turn_B/usage_B（L1 是最后写入行）——错值，已替换。
      ['reply', 'turn_A', USAGE_A],
      ['user_input', null, null],
      ['reply', 'turn_B', USAGE_B], // 末行补产段带末行自身
    ]);
  });
});

// ── Z12：老形状行缺省 + 形状漂移防御（task-02 约束：新字段可选缺省）──────────

describe('parseZcodeModelIoLog — 老形状与形状漂移（Z12 / 兼容硬约束）', () => {
  it('老形状行（无 turnId/model/durationMs/usage）→ 全部段新字段 null、totalUsage null（不伪造 0）', async () => {
    const content = jsonl(
      legacyIoLine({
        offset: 0,
        messages: [USER('老形状真人问题'), ASST_BLOCKS([{ type: 'text', text: '老形状答复' }])],
        responseText: '老形状末行补产',
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(3); // user_input + reply(G) + reply(补产)
    for (const message of result.messages) {
      expect(message.turn_id).toBeNull();
      expect(message.model).toBeNull();
      expect(message.duration_ms).toBeNull();
      expect(message.usage).toBeNull();
    }
    expect(result.totalUsage).toBeNull();
  });

  /** 顶层/usage 字段注入漂移形状（其余键集与 legacyIoLine 同）。 */
  function rawLine(overrides: Record<string, unknown>): string {
    return JSON.stringify({
      type: 'model_io',
      request: { messages: [{ role: 'user', content: '漂移场景' }], messageOffset: 0 },
      response: { text: '', toolCalls: [] },
      ...overrides,
    });
  }

  it('形状漂移逐项置 null：model 数字 / 缺 modelId 对象 / durationMs 字符串 / turnId 数字', async () => {
    for (const line of [
      rawLine({ model: 123 }),
      rawLine({ model: { providerId: 'p_fixture' } }),
      rawLine({ durationMs: '1234' }),
      rawLine({ turnId: 42 }),
    ]) {
      const result = await parseZcodeModelIoLog(jsonl(line));
      expect(result.messages[0]?.turn_id).toBeNull();
      expect(result.messages[0]?.model).toBeNull();
      expect(result.messages[0]?.duration_ms).toBeNull();
      expect(result.messages[0]?.usage).toBeNull();
      expect(result.totalUsage).toBeNull();
    }
  });

  it('model 字符串形态（老日志）直用；usage 五项全缺 → null；部分缺项按 0 计', async () => {
    // 单行会话的 G 段（首行无前驱）不获锚定——元数据断言落在末行 response 补产段
    //（产出调用=末行自身，恒携带本行元数据）。
    const legacyStringModel = await parseZcodeModelIoLog(
      jsonl(rawLine({ model: 'glm-legacy', response: { text: '答', toolCalls: [] } })),
    );
    expect(legacyStringModel.messages.at(-1)?.model).toBe('glm-legacy');

    const emptyUsage = await parseZcodeModelIoLog(
      jsonl(rawLine({ response: { text: '答', toolCalls: [], usage: {} } })),
    );
    expect(emptyUsage.messages.at(-1)?.usage).toBeNull();
    expect(emptyUsage.totalUsage).toBeNull();

    const partialUsage = await parseZcodeModelIoLog(
      jsonl(rawLine({ response: { text: '答', toolCalls: [], usage: { inputTokens: 5 } } })),
    );
    expect(partialUsage.messages.at(-1)?.usage).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      totalTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(partialUsage.totalUsage).toEqual({
      inputTokens: 5,
      outputTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
  });
});

// ── Z13：totalUsage 按「调用」去重 + 与切片/窗口无关（D-004@v1）──────────────

describe('parseZcodeModelIoLog — totalUsage 累计口径（Z13 / D-004@v1）', () => {
  /** 单次调用（一行）产 3 个 user 段，usage A——多段共享不得按段翻倍。 */
  const single = jsonl(
    ioLine({
      kind: 'full',
      offset: 0,
      messages: [USER('第一问'), USER('第二问'), USER('第三问')],
    }),
  );
  const SINGLE_USAGE = {
    inputTokens: 100,
    outputTokens: 20,
    cacheReadTokens: 30,
    cacheWriteTokens: 10,
  };

  it('按「调用」去重：3 段共享同一 usage，totalUsage 只计一次（非 3 倍）', async () => {
    const result = await parseZcodeModelIoLog(single);
    expect(result.messages).toHaveLength(3);
    expect(result.totalUsage).toEqual(SINGLE_USAGE);
  });

  it('与段窗口截断无关：maxSegments 截走 2 段后 totalUsage 不变', async () => {
    const result = await parseZcodeModelIoLog(single, { maxSegments: 2 });
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(2);
    expect(result.totalUsage).toEqual(SINGLE_USAGE);
  });

  it('与 beforeSeq 切片无关：切片后 totalUsage 仍是全量调用累计', async () => {
    const result = await parseZcodeModelIoLog(single, { beforeSeq: 2 });
    expect(result.messages.map((m) => m.seq)).toEqual([1]);
    expect(result.totalUsage).toEqual(SINGLE_USAGE);
  });

  it('多次调用各计一次：两行 usage A+B → 四项和（5 段不放大）', async () => {
    // 与 Z11 同构的两行 fixture（usage A + usage B）。
    const content = jsonl(
      ioLine({
        kind: 'full',
        offset: 0,
        messages: [USER('问一'), ASST_BLOCKS([{ type: 'text', text: '答一' }], [
          { id: 't1', name: 'Read', input: { file_path: '/a' } },
        ])],
      }),
      ioLine({
        kind: 'tail',
        offset: 2, // 尾随追加（不覆盖 L0 的 assistant 槽位 1）
        messages: [TOOL('t1', 'Read', '结果')],
        responseText: '收尾',
        usage: { inputTokens: 200, outputTokens: 40, totalTokens: 260, cacheReadTokens: 60, cacheWriteTokens: 20 },
      }),
    );
    const result = await parseZcodeModelIoLog(content);
    expect(result.totalSegments).toBe(5);
    expect(result.totalUsage).toEqual({
      inputTokens: 300,
      outputTokens: 60,
      cacheReadTokens: 90,
      cacheWriteTokens: 30,
    });
  });

  it('parse_error / too_large 早退结果零新字段（不带 totalUsage 键）', async () => {
    const parseError = await parseZcodeModelIoLog(
      jsonl('{坏行一', '{坏行二', legacyIoLine({ offset: 0, messages: [USER('唯一好行')] })),
    );
    expect(parseError.status).toBe('parse_error');
    expect('totalUsage' in parseError).toBe(false);

    const tooLarge = await parseZcodeModelIoLog('x'.repeat(64), { maxContentBytes: 32 });
    expect(tooLarge.status).toBe('too_large');
    expect('totalUsage' in tooLarge).toBe(false);
  });
});

// ── Z14：sender 归一（D-003@v1 / FR-02）──────────────────────────────────────

describe('parseZcodeModelIoLog — 伪用户消息归一 sender（Z14 / D-003@v1）', () => {
  const content = jsonl(
    ioLine({
      kind: 'full',
      offset: 0,
      messages: [
        USER('<task-notification>后台任务完成：构建产物已生成</task-notification>'),
        USER('  <task-notification>\n带前导空白的通知  '),
        USER('<system-reminder>提醒块</system-reminder>\n\n真人追问：为什么这么慢'),
        USER('普通真人输入'),
        ASST_BLOCKS([{ type: 'text', text: '答复正文' }]),
      ],
    }),
  );

  it('task-notification 开头 → system_event（正文保留完整通知文本）；普通/混合正文缺省不写 sender', async () => {
    const result = await parseZcodeModelIoLog(content);
    expect(result.messages.map((m) => m.kind)).toEqual([
      'user_input', 'user_input', 'user_input', 'user_input', 'reply',
    ]);
    // 通知文本原样保留（task-notification 无剥离逻辑，仅归一 sender）。
    expect(result.messages[0]).toMatchObject({
      text: '<task-notification>后台任务完成：构建产物已生成</task-notification>',
      sender: 'system_event',
    });
    // 前导空白 trim 后仍以通知前缀开头 → system_event。
    expect(result.messages[1]).toMatchObject({
      text: '<task-notification>\n带前导空白的通知',
      sender: 'system_event',
    });
    // 混合消息：reminder 块剥掉后正文是真人追问 → 缺省不写（视为 human——
    // 错标系统事件会隐藏真人输入，代价不对称，design R-06 原则）。
    expect(result.messages[2]).toMatchObject({ text: '真人追问：为什么这么慢' });
    expect(Object.hasOwn(result.messages[2] as object, 'sender')).toBe(false);
    // 普通真人文本同样缺省不写。
    expect(result.messages[3]).toMatchObject({ text: '普通真人输入' });
    expect(result.messages[3]?.sender).toBeUndefined();
    // 非 user_input 段不写 sender。
    expect(result.messages[4]?.sender).toBeUndefined();
  });
});
