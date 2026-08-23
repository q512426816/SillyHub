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

/** 构造一行 model_io JSONL（键集对齐真实日志，含解析器不消费的旁路字段）。 */
function ioLine(opts: {
  kind: 'full' | 'delta' | 'tail';
  offset: number;
  messages: Array<Record<string, unknown>>;
  responseText?: string;
  responseToolCalls?: Array<{ id: string; name: string; input: unknown }>;
  completedAt?: string;
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
      usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120 },
    },
    attempt: 1,
    startedAt: '2026-08-23T11:59:59.000Z',
    completedAt: opts.completedAt ?? '2026-08-23T12:00:00.000Z',
    model: 'glm-4.6',
    sessionId: 'sess_fixture',
    requestId: 'req_fixture',
    turnId: 'turn_fixture',
    durationMs: 1234,
    querySource: 'agent',
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
