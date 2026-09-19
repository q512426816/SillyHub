// tests/agent-log/parse-claude-code.test.ts
// task-04（2026-09-19-tool-report-session-replay / FR-02 + FR-03）：claude-code
// 会话 JSONL 解析器纯函数单测。
//
// fixture 内嵌字符串构造（真实形状按 2026-09-19 本机 5 份真实会话逐键实证：
// ~/.claude/projects/<proj>/<session>.jsonl 的行/块/usage 键集逐字段对齐），
// 全部脱敏（FIXTURE_ 占位，禁真实路径/业务内容）；测试不依赖该目录存在；
// 解析器为纯函数（content + 预算/窗口/beforeSeq/超时/时钟全注入），零 vi.mock。
//
// 覆盖 task-04 acceptance 全项：
//   C1 行过滤（非对话行零段产出且计入 skippedLines，不计坏行占比）
//   C2 assistant 块形状段产出（thinking 正文在 thinking 键 / text / tool_use 九字段）
//   C3 usage 透传（映射 + 0/0 行不附着 + 附着到该行全部段）与 totalUsage 调用级求和
//   C4 user 行归一（isMeta / 白名单前缀 → system_event；缺省 human；tool_result
//      载体配对与失配孤儿；text 块载体）
//   C5 turn_id 会话内轮序（真人 user_input 自增，system_event 不切）
//   C6 坏行容错（≤50% 跳过计数；>50% → parse_error；非对话行不进占比）与结构不符行
//   C7 20MB 预算（超限 too_large；恰好等于上限可解析）
//   C8 200 段窗口 + beforeSeq 切片 + truncated/totalSegments
//   C9 5s 超时保护 → parse_error（now 注入，非时钟 mock）
//   C10 ts 为行级 timestamp；缺失时 null

import { describe, it, expect } from 'vitest';
import { parseClaudeCodeJsonlLog } from '../../src/agent-log/parse-claude-code-jsonl.js';
import { DEFAULT_MAX_SEGMENTS, type NormalizedLogMessage } from '../../src/agent-log/parse-zcode-model-io.js';
import type { AgentLogParser } from '../../src/agent-log/registry.js';

// 签名对齐 registry AgentLogParser（task-06 注册前编译期护栏 + 运行时存在性）。
const parserShape: AgentLogParser = parseClaudeCodeJsonlLog;
expect(typeof parserShape).toBe('function');

// ── fixture 构造（真实形状，脱敏）────────────────────────────────────────────

/** 行级 timestamp（ISO 字符串，秒级递增便于断言）。 */
const TS = (n: number): string => `2026-09-19T10:00:${String(n).padStart(2, '0')}.000Z`;

/** claude-code 原始 usage 字段名（snake_case，实证键集子集）。 */
const RAW_USAGE = (input: number, output: number, cacheRead = 0, cacheWrite = 0): Record<string, unknown> => ({
  input_tokens: input,
  output_tokens: output,
  ...(cacheRead > 0 || cacheWrite > 0
    ? { cache_read_input_tokens: cacheRead, cache_creation_input_tokens: cacheWrite }
    : {}),
});

/** assistant 行（旁路键集对齐真实日志：parentUuid/cwd/sessionId/version 等）。 */
function asstLine(
  blocks: Array<Record<string, unknown>>,
  opts: { usage?: Record<string, unknown>; timestamp?: string | null } = {},
): string {
  return JSON.stringify({
    parentUuid: 'p_fixture',
    isSidechain: false,
    type: 'assistant',
    message: {
      id: 'msg_fixture',
      role: 'assistant',
      model: 'FIXTURE_MODEL',
      content: blocks,
      ...(opts.usage !== undefined ? { usage: opts.usage } : {}),
    },
    ...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : { timestamp: TS(1) }),
    sessionId: 'sess_fixture',
    version: '2.x',
    cwd: 'FIXTURE_CWD',
    gitBranch: 'FIXTURE_BRANCH',
  });
}

/** user 行（content 字符串或块数组；isMeta 注入标记）。 */
function userLine(
  content: string | Array<Record<string, unknown>>,
  opts: { isMeta?: boolean; timestamp?: string | null } = {},
): string {
  return JSON.stringify({
    parentUuid: 'p_fixture',
    type: 'user',
    message: { role: 'user', content },
    ...(opts.isMeta !== undefined ? { isMeta: opts.isMeta } : {}),
    ...(opts.timestamp !== undefined ? { timestamp: opts.timestamp } : { timestamp: TS(0) }),
    sessionId: 'sess_fixture',
    cwd: 'FIXTURE_CWD',
  });
}

/** 非对话行（type 全集实证子集）。 */
function nonDialogLine(type: string): string {
  return JSON.stringify({ type, subtype: 'fixture', timestamp: TS(0), content: 'FIXTURE_NON_DIALOG_PAYLOAD' });
}

/** tool_result 块（实证块键 {tool_use_id,type,content,is_error}）。 */
const TR_BLOCK = (
  toolUseId: string,
  content: string | Array<Record<string, unknown>>,
  isError = false,
): Record<string, unknown> => ({ type: 'tool_result', tool_use_id: toolUseId, content, is_error: isError });

/** 多行拼成 JSONL 文本（尾随换行，真实文件形状）。 */
const jsonl = (...lines: string[]): string => `${lines.join('\n')}\n`;

/** 提取某 kind 的段。 */
const ofKind = (messages: NormalizedLogMessage[], kind: NormalizedLogMessage['kind']): NormalizedLogMessage[] =>
  messages.filter((m) => m.kind === kind);

// ── C1 + C2 + C10：行过滤与 assistant 段产出 ─────────────────────────────────

describe('parseClaudeCodeJsonlLog — 行过滤与 assistant 块形状（C1/C2/C10）', () => {
  const content = jsonl(
    nonDialogLine('mode'),
    nonDialogLine('file-history-snapshot'),
    nonDialogLine('system'),
    nonDialogLine('attachment'),
    nonDialogLine('last-prompt'),
    nonDialogLine('queue-operation'),
    nonDialogLine('ai-title'),
    userLine('真人提问：实现功能', { timestamp: TS(2) }),
    asstLine(
      [
        { type: 'thinking', thinking: '先读任务卡', signature: 'FIXTURE_SIG' },
        { type: 'text', text: '我看下文件' },
        { type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'FIXTURE_PATH/a.md' } },
        { type: 'tool_use', id: 'tu2', name: 'Bash', input: { command: 'FIXTURE_CMD' } },
      ],
      { timestamp: TS(3) },
    ),
  );

  it('非对话行零段产出且计入 skippedLines（mode/snapshot/system/attachment/last-prompt/queue-operation/ai-title）', async () => {
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(7);
    expect(result.totalSegments).toBe(5); // user_input + thinking + reply + 2×tool_use
    expect(JSON.stringify(result.messages)).not.toContain('FIXTURE_NON_DIALOG_PAYLOAD');
  });

  it('assistant 块形状：thinking 正文取 thinking 键、text→reply、tool_use 九字段（input 为 JSON.stringify 摘要）', async () => {
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.messages.map((m) => [m.seq, m.kind, m.text])).toEqual([
      [1, 'user_input', '真人提问：实现功能'],
      [2, 'thinking', '先读任务卡'],
      [3, 'reply', '我看下文件'],
      [4, 'tool_use', null],
      [5, 'tool_use', null],
    ]);
    expect(result.messages[3]).toMatchObject({
      tool_name: 'Read',
      tool_use_id: 'tu1',
      tool_input: '{"file_path":"FIXTURE_PATH/a.md"}',
      tool_result: null,
      is_error: null,
    });
    expect(result.messages[4]).toMatchObject({ tool_name: 'Bash', tool_use_id: 'tu2' });
  });

  it('ts 为行级 timestamp（各段独立取所属行；timestamp 缺失时为 null）', async () => {
    const withMissingTs = jsonl(
      JSON.stringify({ type: 'user', message: { role: 'user', content: '无时间戳行' } }),
      asstLine([{ type: 'text', text: '回复' }], { timestamp: TS(5) }),
    );
    const result = await parseClaudeCodeJsonlLog(withMissingTs);
    expect(result.messages[0]?.ts).toBeNull();
    expect(result.messages[1]?.ts).toBe(TS(5));
  });
});

// ── C3：usage 透传与 totalUsage ──────────────────────────────────────────────

describe('parseClaudeCodeJsonlLog — usage 透传与 totalUsage（C3）', () => {
  const content = jsonl(
    // 三段共享同一次调用的 usage（input=10/output=20/cache 100/50）。
    asstLine(
      [
        { type: 'thinking', thinking: '思考' },
        { type: 'text', text: '答复一' },
        { type: 'tool_use', id: 'tu9', name: 'Grep', input: { pattern: 'x' } },
      ],
      { usage: RAW_USAGE(10, 20, 100, 50) },
    ),
    // 无 cache 字段的 usage（实证旧行形状）→ cache 两项缺省 0。
    asstLine([{ type: 'text', text: '答复二' }], { usage: RAW_USAGE(1, 2) }),
    // 0/0 行（实证 376/1795）→ 跳过不附着。
    asstLine([{ type: 'text', text: '空用量行' }], { usage: RAW_USAGE(0, 0) }),
    // 无 usage 对象行 → 不附着。
    asstLine([{ type: 'text', text: '无用量行' }]),
  );

  it('五项映射（snake→camel + totalTokens=输入+输出）附着到该行全部段', async () => {
    const result = await parseClaudeCodeJsonlLog(content);
    const [thinking, reply, toolUse] = result.messages;
    const expected = { inputTokens: 10, outputTokens: 20, totalTokens: 30, cacheReadTokens: 100, cacheWriteTokens: 50 };
    expect(thinking?.usage).toEqual(expected);
    expect(reply?.usage).toEqual(expected);
    expect(toolUse?.usage).toEqual(expected);
    expect(result.messages[3]?.usage).toEqual({ inputTokens: 1, outputTokens: 2, totalTokens: 3, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });

  it('0/0 行与无 usage 行不附着（字段缺省）；totalUsage 按调用（行）去重求和——同行多段不重复计', async () => {
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.messages[4]?.usage).toBeUndefined();
    expect(result.messages[5]?.usage).toBeUndefined();
    expect(result.totalUsage).toEqual({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 100, cacheWriteTokens: 50 });
  });

  it('无任何 usage 数据的会话 → totalUsage 为零值四项（不伪造 null/未知）', async () => {
    const result = await parseClaudeCodeJsonlLog(jsonl(userLine('问'), asstLine([{ type: 'text', text: '答' }])));
    expect(result.totalUsage).toEqual({ inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 });
  });
});

// ── C4：user 行归一（sender / tool_result 载体配对）──────────────────────────

describe('parseClaudeCodeJsonlLog — user 行归一（C4 / D-003@v1 / R-06）', () => {
  it('isMeta=true 与白名单前缀（【当前用户信息】/<command-name>/Caveat:）→ system_event；其余缺省 human', async () => {
    const content = jsonl(
      userLine('真人输入'),
      userLine('<local-command-stdout>命令输出</local-command-stdout>', { isMeta: true }),
      userLine('【当前用户信息】用户配置注入'),
      userLine('<command-name>/deploy</command-name>'),
      userLine('Caveat: The messages below were generated by the user'),
    );
    const result = await parseClaudeCodeJsonlLog(content);
    expect(ofKind(result.messages, 'user_input').map((m) => [m.text, m.sender])).toEqual([
      ['真人输入', 'human'],
      ['<local-command-stdout>命令输出</local-command-stdout>', 'system_event'],
      ['【当前用户信息】用户配置注入', 'system_event'],
      ['<command-name>/deploy</command-name>', 'system_event'],
      ['Caveat: The messages below were generated by the user', 'system_event'],
    ]);
  });

  it('白名单外未识别注入保守归 human（R-06 代价不对称：错标系统事件会隐藏真人输入）', async () => {
    const content = jsonl(userLine('<unknown-injection>未知形态注入'));
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.messages[0]?.sender).toBe('human');
  });

  it('纯 tool_result 载体行 → tool_result 段按 tool_use_id 配对前置 assistant 工具名，不产 user_input', async () => {
    const content = jsonl(
      userLine('触发工具'),
      asstLine([{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'FIXTURE_PATH' } }]),
      userLine([
        TR_BLOCK('tu1', '文件内容第一行\n文件内容第二行'),
        TR_BLOCK('tu1b', [{ type: 'text', text: '块数组结果A' }, { type: 'text', text: '块数组结果B' }], true),
      ]),
    );
    const result = await parseClaudeCodeJsonlLog(content);
    const toolResults = ofKind(result.messages, 'tool_result');
    expect(toolResults).toHaveLength(2);
    expect(toolResults[0]).toMatchObject({ tool_name: 'Read', tool_use_id: 'tu1', tool_result: '文件内容第一行\n文件内容第二行', is_error: false });
    // text 块数组 content 按序拼接（实证 33/982 形态）。
    expect(toolResults[1]).toMatchObject({ tool_use_id: 'tu1b', tool_result: '块数组结果A块数组结果B', is_error: true });
    expect(ofKind(result.messages, 'user_input').map((m) => m.text)).toEqual(['触发工具']);
  });

  it('失配孤儿 tool_result（前置无对应 tool_use）→ 照产保留 id，tool_name 为 null', async () => {
    const content = jsonl(userLine([TR_BLOCK('orphan-1', '迟到/失配的结果')]));
    const result = await parseClaudeCodeJsonlLog(content);
    const orphan = ofKind(result.messages, 'tool_result')[0];
    expect(orphan).toMatchObject({ tool_name: null, tool_use_id: 'orphan-1', tool_result: '迟到/失配的结果' });
  });

  it('user 数组含 text 块 → user_input 段（text 原文 + sender 归一），不因数组形状丢弃', async () => {
    const content = jsonl(
      userLine([{ type: 'text', text: '数组携带的真人输入' }], { isMeta: false }),
      userLine([{ type: 'text', text: 'Base directory for this skill:' }], { isMeta: true }),
    );
    const result = await parseClaudeCodeJsonlLog(content);
    expect(ofKind(result.messages, 'user_input').map((m) => [m.text, m.sender])).toEqual([
      ['数组携带的真人输入', 'human'],
      ['Base directory for this skill:', 'system_event'],
    ]);
  });
});

// ── C5：turn_id 会话内轮序 ───────────────────────────────────────────────────

describe('parseClaudeCodeJsonlLog — turn_id 轮序（C5 / D-005@v1）', () => {
  it('真人 user_input 自增轮号；system_event / tool_result 载体不切轮；首条真人输入前归 0 轮', async () => {
    const content = jsonl(
      userLine('<command-name>/init</command-name>'), // system_event → 0 轮
      asstLine([{ type: 'text', text: '初始化回复' }]), // 0 轮
      userLine('真人第一问'), // → 1 轮
      asstLine([
        { type: 'text', text: '第一问回复' },
        { type: 'tool_use', id: 'tu5', name: 'Grep', input: { pattern: 'FIXTURE' } },
      ]), // 1 轮 ×2 段
      userLine([TR_BLOCK('tu5', '工具结果')]), // 载体 → 仍 1 轮
      userLine('【当前用户信息】续注入'), // system_event → 仍 1 轮
      asstLine([{ type: 'text', text: '继续回复' }]), // 1 轮
      userLine('真人第二问'), // → 2 轮
      asstLine([{ type: 'text', text: '第二问回复' }]), // 2 轮
    );
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.totalSegments).toBe(10);
    expect(result.messages.map((m) => [m.kind, m.turn_id])).toEqual([
      ['user_input', '0'],
      ['reply', '0'],
      ['user_input', '1'],
      ['reply', '1'],
      ['tool_use', '1'],
      ['tool_result', '1'],
      ['user_input', '1'],
      ['reply', '1'],
      ['user_input', '2'],
      ['reply', '2'],
    ]);
  });
});

// ── C6：坏行容错（含非对话行不进占比）───────────────────────────────────────

describe('parseClaudeCodeJsonlLog — 坏行容错（C6）', () => {
  it('坏行占比恰 50% → parsed：跳过计 skippedLines、解析不中断', async () => {
    const content = jsonl(
      '{not valid json',
      JSON.stringify({ type: 'user' }), // user 行缺 message
      JSON.stringify({ type: 'assistant', message: { content: 42 } }), // content 形状不符
      JSON.stringify([1, 2, 3]), // 非 object 行
      userLine('好行一'),
      userLine('好行二'),
      userLine('好行三'),
      userLine('好行四'),
    );
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(4);
    expect(result.totalSegments).toBe(4);
  });

  it('坏行占比 >50% → parse_error 且 messages 为空', async () => {
    const content = jsonl('{坏行', '{又一坏行', JSON.stringify({ type: 'user' }), userLine('唯一好行'));
    const result = await parseClaudeCodeJsonlLog(content);
    expect(result.status).toBe('parse_error');
    expect(result.messages).toEqual([]);
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(0);
    expect(result.skippedLines).toBe(3);
  });

  it('非对话行占大头（>50%）但零坏行 → 仍 parsed（快照类真实文件不误判）', async () => {
    const lines = [
      ...Array.from({ length: 10 }, () => nonDialogLine('file-history-snapshot')),
      userLine('少量对话'),
      asstLine([{ type: 'text', text: '回复' }]),
    ];
    const result = await parseClaudeCodeJsonlLog(jsonl(...lines));
    expect(result.status).toBe('parsed');
    expect(result.skippedLines).toBe(10);
    expect(result.totalSegments).toBe(2);
  });

  it('空行与尾随换行不计坏行；空内容 → parsed 空 messages', async () => {
    const r1 = await parseClaudeCodeJsonlLog(jsonl(userLine('唯一'), '', '   '));
    expect(r1.status).toBe('parsed');
    expect(r1.skippedLines).toBe(0);
    expect(r1.totalSegments).toBe(1);

    const r2 = await parseClaudeCodeJsonlLog('');
    expect(r2.status).toBe('parsed');
    expect(r2.messages).toEqual([]);
    expect(r2.totalSegments).toBe(0);
  });
});

// ── C7：20MB 预算 ────────────────────────────────────────────────────────────

describe('parseClaudeCodeJsonlLog — 内容预算（C7）', () => {
  it('content 超注入上限 → too_large 且不进入逐行解析', async () => {
    const big = jsonl(userLine('FIXTURE 内容超限'));
    const result = await parseClaudeCodeJsonlLog(big, { maxContentBytes: 16 });
    expect(result.status).toBe('too_large');
    expect(result.messages).toEqual([]);
    expect(result.skippedLines).toBe(0);
  });

  it('byteLength 恰好等于上限（边界）→ 正常进入解析', async () => {
    const exact = jsonl(userLine('ok'));
    const size = Buffer.byteLength(exact, 'utf8');
    const result = await parseClaudeCodeJsonlLog(exact, { maxContentBytes: size });
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(1);
  });
});

// ── C8：200 段窗口与 beforeSeq 切片 ──────────────────────────────────────────

describe('parseClaudeCodeJsonlLog — 段窗口与 beforeSeq（C8）', () => {
  /** 250 条真人 user 行（250 段，足够超默认 200 段窗口）。 */
  const many = jsonl(...Array.from({ length: 250 }, (_, i) => userLine(`消息 ${i + 1}`)));

  it('总段数 >200 → 最近 200 段 + truncated:true，totalSegments 记全量总数', async () => {
    const result = await parseClaudeCodeJsonlLog(many);
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(DEFAULT_MAX_SEGMENTS);
    expect(result.messages[0]).toMatchObject({ seq: 51, text: '消息 51' });
    expect(result.messages[199]).toMatchObject({ seq: 250, text: '消息 250' });
  });

  it('beforeSeq 切片：返回 seq < beforeSeq 的段后再套窗口', async () => {
    const result = await parseClaudeCodeJsonlLog(many, { beforeSeq: 100 });
    expect(result.totalSegments).toBe(250);
    expect(result.truncated).toBe(false);
    expect(result.messages).toHaveLength(99);
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[98]?.seq).toBe(99);
  });

  it('beforeSeq 大于最大 seq → 切片后仍超窗 → 最近 200 段 + truncated:true', async () => {
    const result = await parseClaudeCodeJsonlLog(many, { beforeSeq: 1000 });
    expect(result.truncated).toBe(true);
    expect(result.messages).toHaveLength(200);
    expect(result.messages[0]?.seq).toBe(51);
  });

  it('maxSegments 注入小窗口（9 段 fixture → 最近 3 段）', async () => {
    const nine = jsonl(...Array.from({ length: 9 }, (_, i) => userLine(`第 ${i + 1} 条`)));
    const result = await parseClaudeCodeJsonlLog(nine, { maxSegments: 3 });
    expect(result.totalSegments).toBe(9);
    expect(result.truncated).toBe(true);
    expect(result.messages.map((m) => m.seq)).toEqual([7, 8, 9]);
  });
});

// ── C9：超时保护 ─────────────────────────────────────────────────────────────

describe('parseClaudeCodeJsonlLog — 超时保护（C9）', () => {
  it('超过注入 deadline（每 500 行批处理边界检查）→ parse_error', async () => {
    const lines = Array.from({ length: 600 }, (_, i) => userLine(`u${i}`));
    let calls = 0;
    const result = await parseClaudeCodeJsonlLog(lines.join('\n'), {
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
