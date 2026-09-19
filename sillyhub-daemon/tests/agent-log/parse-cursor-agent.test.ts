// tests/agent-log/parse-cursor-agent.test.ts
// task-05（2026-09-19-tool-report-session-replay / FR-02）：cursor-agent
// transcript JSONL 解析器纯函数单测。
//
// fixture 内嵌字符串构造（真实形状按 spike-02 全量 96 份本机 transcript 只读枚举
// 实证：~/.cursor/projects/<ctx>/agent-transcripts/<id>/<id>.jsonl 的行/块键集逐字段
// 对齐），全部脱敏（FIXTURE_ 占位，禁真实路径/业务内容）；测试不依赖该目录存在；
// 解析器为纯函数（content + 预算/窗口/beforeSeq/超时/时钟全注入），零 vi.mock。
//
// spike-02 结论（R-02 前置核对，2026-09-19 实证）：
//   - 块类型全集 user:text / assistant:text / assistant:tool_use，tool_result 不落盘
//     （零样本）且 tool_use 块不带 id（0/4271）→ 解析器不产 tool_result 段、tool_use 不配对；
//   - turn_ended 事件 {type,status,error?}（status ∈ success/error）；顶层无 timestamp / 无 usage。
//
// 覆盖 task-05 acceptance 全项：
//   U1 块类型全集段产出（user text→user_input / assistant text→reply / tool_use→tool_use
//      九字段，tool_use_id 恒 null）
//   U2 spike-02 裁决：零 tool_result 段且 tool_use 段齐全（不配对不伪造）
//   U3 注入前缀（<task-notification>/<system-reminder> → system_event）；白名单外
//      （含实证 <user_query>/<timestamp> 形态）保守归 human（R-06）
//   U4 turn_ended 切轮（轮号自增正确；无事件文件单轮兜底；事件行不产段；error 态不炸）
//   U5 usage 恒 undefined、totalUsage 恒 null、ts 恒 null（不伪造 0）
//   U6 坏行容错（≤50% 跳过计数；>50% → parse_error；全集外形状计坏行）
//   U7 20MB 预算（超限 too_large；恰好等于上限可解析）
//   U8 200 段窗口 + beforeSeq 切片 + truncated/totalSegments
//   U9 5s 超时保护 → parse_error（now 注入，非时钟 mock）

import { describe, it, expect } from 'vitest';
import { parseCursorAgentTranscriptLog } from '../../src/agent-log/parse-cursor-agent-transcript.js';
import { DEFAULT_MAX_SEGMENTS, type NormalizedLogMessage } from '../../src/agent-log/parse-zcode-model-io.js';
import type { AgentLogParser } from '../../src/agent-log/registry.js';

// 签名对齐 registry AgentLogParser（task-06 注册前编译期护栏 + 运行时存在性）。
const parserShape: AgentLogParser = parseCursorAgentTranscriptLog;
expect(typeof parserShape).toBe('function');

// ── fixture 构造（真实形状，脱敏）────────────────────────────────────────────

/** user 对话行（实证行键仅 {role,message}，块键 {type,text}）。 */
const cUser = (text: string): string =>
  JSON.stringify({ role: 'user', message: { content: [{ type: 'text', text }] } });

/** assistant 对话行。 */
const cAsst = (blocks: Array<Record<string, unknown>>): string =>
  JSON.stringify({ role: 'assistant', message: { content: blocks } });

/** assistant text 块。 */
const cText = (text: string): Record<string, unknown> => ({ type: 'text', text });

/** assistant tool_use 块（实证块键仅 {type,name,input}，不带 id）。 */
const cTool = (name: string, input: Record<string, unknown>): Record<string, unknown> => ({
  type: 'tool_use',
  name,
  input,
});

/** turn_ended 事件行（status ∈ success/error；error 态带 error 字段，实证键集）。 */
const cTurnEnd = (status: 'success' | 'error' = 'success', error?: string): string =>
  JSON.stringify(
    error === undefined ? { type: 'turn_ended', status } : { type: 'turn_ended', status, error },
  );

/** 多行拼成 JSONL 文本（尾随换行，真实文件形状）。 */
const jsonl = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** 提取某 kind 的段。 */
const ofKind = (messages: NormalizedLogMessage[], kind: NormalizedLogMessage['kind']): NormalizedLogMessage[] =>
  messages.filter((m) => m.kind === kind);

// ── U1 + U2：块类型全集段产出与 spike-02 裁决 ────────────────────────────────

describe('parseCursorAgentTranscriptLog — 块类型全集段产出（U1/U2 / spike-02）', () => {
  const content = jsonl(
    cUser('列出目录'),
    cAsst([
      cText('我先查一下'),
      cTool('Glob', { pattern: 'FIXTURE/*.md' }),
      cTool('codebase_search', { query: 'FIXTURE_QUERY' }),
      cText('查完了'),
    ]),
  );

  it('user text → user_input、assistant text → reply、tool_use → tool_use 九字段（input 为 JSON.stringify 摘要）', async () => {
    const result = await parseCursorAgentTranscriptLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(0);
    expect(result.messages.map((m) => [m.seq, m.kind, m.text])).toEqual([
      [1, 'user_input', '列出目录'],
      [2, 'reply', '我先查一下'],
      [3, 'tool_use', null],
      [4, 'tool_use', null],
      [5, 'reply', '查完了'],
    ]);
    expect(result.messages[2]).toMatchObject({
      tool_name: 'Glob',
      tool_use_id: null, // spike-02：tool_use 块不落盘 id → 恒 null
      tool_input: '{"pattern":"FIXTURE/*.md"}',
      tool_result: null,
      is_error: null,
    });
  });

  it('spike-02 裁决：tool_result 不落盘 → 零 tool_result 段且 tool_use 段齐全（不配对不伪造结果）', async () => {
    const result = await parseCursorAgentTranscriptLog(content);
    expect(ofKind(result.messages, 'tool_use')).toHaveLength(2);
    expect(ofKind(result.messages, 'tool_result')).toHaveLength(0);
    expect(JSON.stringify(result.messages)).not.toContain('tool_result":"');
  });

  it('未知块类型（全集外形态）防御式跳过，行不计坏行', async () => {
    const exotic = jsonl(cAsst([cText('正文'), { type: 'image', source: 'FIXTURE_DATA' }]));
    const result = await parseCursorAgentTranscriptLog(exotic);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(0);
    expect(result.messages.map((m) => m.kind)).toEqual(['reply']);
  });

  it('空白 text 块跳过不产段；content 空数组行零段产出且不计坏行', async () => {
    const blankish = jsonl(cUser('   '), cUser('正常输入'), cAsst([]));
    const result = await parseCursorAgentTranscriptLog(blankish);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(0);
    expect(result.totalSegments).toBe(1);
    expect(result.messages[0]?.text).toBe('正常输入');
  });
});

// ── U3：注入前缀归一 ─────────────────────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — 注入前缀归一（U3 / D-003@v1 / R-06）', () => {
  it('<task-notification>/<system-reminder> 前缀 → system_event；其余缺省 human', async () => {
    const content = jsonl(
      cUser('真人输入'),
      cUser('<task-notification>\n后台任务完成\n</task-notification>'),
      cUser('<system-reminder>上下文提醒</system-reminder>'),
    );
    const result = await parseCursorAgentTranscriptLog(content);
    expect(ofKind(result.messages, 'user_input').map((m) => [m.text, m.sender])).toEqual([
      ['真人输入', 'human'],
      ['<task-notification>\n后台任务完成\n</task-notification>', 'system_event'],
      ['<system-reminder>上下文提醒</system-reminder>', 'system_event'],
    ]);
  });

  it('白名单外形态（实证 <user_query>/<timestamp> 包裹）保守归 human（R-06 代价不对称）', async () => {
    const content = jsonl(
      cUser('<user_query>真正的问题文本</user_query>'),
      cUser('<timestamp>Wednesday, Sep 16</timestamp>会话恢复上下文'),
    );
    const result = await parseCursorAgentTranscriptLog(content);
    expect(ofKind(result.messages, 'user_input').map((m) => m.sender)).toEqual(['human', 'human']);
  });
});

// ── U4：turn_ended 切轮 ──────────────────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — turn_ended 切轮（U4 / D-005@v1）', () => {
  it('turn_ended 事件自增轮号：事件前各段归当前轮、事件本身不产段、error 态同样切轮', async () => {
    const content = jsonl(
      cUser('第一轮问题'),
      cAsst([cText('第一轮回复')]),
      cTurnEnd(),
      cUser('第二轮问题'),
      cAsst([cTool('Bash', { command: 'FIXTURE_CMD' })]),
      cTurnEnd('error', 'FIXTURE_ERROR_DETAIL'),
      cUser('第三轮问题'),
      cAsst([cText('第三轮回复')]),
    );
    const result = await parseCursorAgentTranscriptLog(content);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(6);
    expect(result.messages.map((m) => [m.kind, m.turn_id])).toEqual([
      ['user_input', '1'],
      ['reply', '1'],
      ['user_input', '2'],
      ['tool_use', '2'],
      ['user_input', '3'],
      ['reply', '3'],
    ]);
    expect(JSON.stringify(result.messages)).not.toContain('FIXTURE_ERROR_DETAIL'); // 事件负载不进输出
  });

  it('无 turn_ended 事件文件 → 整文件单轮兜底（全部段 turn_id 恒 1）不炸', async () => {
    const content = jsonl(cUser('问一'), cAsst([cText('答一')]), cUser('问二'), cAsst([cText('答二')]));
    const result = await parseCursorAgentTranscriptLog(content);
    expect(result.messages.map((m) => m.turn_id)).toEqual(['1', '1', '1', '1']);
  });

  it('仅事件无对话行的文件（实证第 3 份样本形状）→ parsed 零段', async () => {
    const result = await parseCursorAgentTranscriptLog(jsonl(cTurnEnd()));
    expect(result.status).toBe('parsed');
    expect(result.messages).toEqual([]);
    expect(result.totalSegments).toBe(0);
    expect(result.skippedLines).toBe(0);
  });
});

// ── U5：usage / totalUsage / ts 恒空 ─────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — usage/totalUsage/ts 恒空（U5，不伪造）', () => {
  it('全段 usage 缺省、ts 恒 null；totalUsage 恒 null（token 不落盘 → 前端「未知」兜底）', async () => {
    const content = jsonl(cUser('问'), cAsst([cTool('Read', { file_path: 'FIXTURE_PATH' }), cText('答')]));
    const result = await parseCursorAgentTranscriptLog(content);
    for (const message of result.messages) {
      expect(message.usage).toBeUndefined();
      expect(message.ts).toBeNull();
    }
    expect(result.totalUsage).toBeNull();
  });
});

// ── U6：坏行容错 ─────────────────────────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — 坏行容错（U6）', () => {
  it('坏行占比恰 50% → parsed：跳过计 skippedLines、解析不中断', async () => {
    const content = jsonl(
      '{not valid json',
      JSON.stringify({ foo: 1 }), // spike-02 全集外形状（无 type 无 role）
      JSON.stringify({ role: 'user' }), // 对话行缺 message
      JSON.stringify({ role: 'assistant', message: { content: 'not-array' } }), // content 非数组
      cUser('好行一'),
      cUser('好行二'),
      cUser('好行三'),
      cUser('好行四'),
    );
    const result = await parseCursorAgentTranscriptLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(4);
    expect(result.totalSegments).toBe(4);
  });

  it('坏行占比 >50% → parse_error 且 messages 为空', async () => {
    const content = jsonl('{坏行', '{又一坏行', JSON.stringify({ type: 'unknown_event' }), cUser('唯一好行'));
    const result = await parseCursorAgentTranscriptLog(content);
    expect(result.status).toBe('parse_error');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(0);
    expect(result.skippedLines).toBe(3);
  });

  it('空行与尾随换行不计坏行；空内容 → parsed 空 messages', async () => {
    const r1 = await parseCursorAgentTranscriptLog(jsonl(cUser('唯一'), '', '   '));
    expect(r1.status).toBe('parsed');
    expect(r1.skippedLines).toBe(0);
    expect(r1.totalSegments).toBe(1);

    const r2 = await parseCursorAgentTranscriptLog('');
    expect(r2.status).toBe('parsed');
    expect(r2.messages).toEqual([]);
    expect(r2.totalSegments).toBe(0);
  });
});

// ── U7：20MB 预算 ────────────────────────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — 内容预算（U7）', () => {
  it('content 超注入上限 → too_large 且不进入逐行解析', async () => {
    const big = jsonl(cUser('FIXTURE 内容超限'));
    const result = await parseCursorAgentTranscriptLog(big, { maxContentBytes: 16 });
    expect(result.status).toBe('too_large');
    expect(result.messages).toEqual([]);
    expect(result.skippedLines).toBe(0);
  });

  it('byteLength 恰好等于上限（边界）→ 正常进入解析', async () => {
    const exact = jsonl(cUser('ok'));
    const size = Buffer.byteLength(exact, 'utf8');
    const result = await parseCursorAgentTranscriptLog(exact, { maxContentBytes: size });
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(1);
  });
});

// ── U8：200 段窗口与 beforeSeq 切片 ──────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — 段窗口与 beforeSeq（U8）', () => {
  /** 250 条 user 行（250 段，足够超默认 200 段窗口）。 */
  const many = jsonl(...Array.from({ length: 250 }, (_, i) => cUser(`消息 ${i + 1}`)));

  it('总段数 >200 → 最近 200 段 + truncated:true，totalSegments 记全量总数', async () => {
    const result = await parseCursorAgentTranscriptLog(many);
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(DEFAULT_MAX_SEGMENTS);
    expect(result.messages[0]).toMatchObject({ seq: 51, text: '消息 51' });
    expect(result.messages[199]).toMatchObject({ seq: 250, text: '消息 250' });
  });

  it('beforeSeq 切片：返回 seq < beforeSeq 的段后再套窗口', async () => {
    const result = await parseCursorAgentTranscriptLog(many, { beforeSeq: 100 });
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(99);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[98]?.seq).toBe(99);
  });

  it('maxSegments 注入小窗口（9 段 fixture → 最近 3 段）', async () => {
    const nine = jsonl(...Array.from({ length: 9 }, (_, i) => cUser(`第 ${i + 1} 条`)));
    const result = await parseCursorAgentTranscriptLog(nine, { maxSegments: 3 });
    expect(result.totalSegments).toBe(9);
    expect(result.truncated).toBe(true);
    expect(result.messages.map((m) => m.seq)).toEqual([7, 8, 9]);
  });
});

// ── U9：超时保护 ─────────────────────────────────────────────────────────────

describe('parseCursorAgentTranscriptLog — 超时保护（U9）', () => {
  it('超过注入 deadline（每 500 行批处理边界检查）→ parse_error', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => cUser(`u${i}`));
    let calls = 0;
    const result = await parseCursorAgentTranscriptLog(lines.join('\n'), {
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
