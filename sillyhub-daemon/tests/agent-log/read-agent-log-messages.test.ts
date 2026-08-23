// tests/agent-log/read-agent-log-messages.test.ts
// task-02（2026-08-23-agent-log-conversation-view / FR-02 + D-001@v1 + D-006@v1）：
// host_fs.read_agent_log_messages 第 10 方法 + 解析器注册表单测。
//
// 风格对齐 tests/host-fs-handler.test.ts：mkdtemp 真实临时目录 + 真实 fs 写
// fixture 文件（零 vi.mock——readAgentLogMessages 不跑 git/child_process，文件
// 读写全走真实 fs）。fixture 是真实 zcode model-io JSONL 形状（design §5.1
// 实证键集，与 task-01 parse-zcode-model-io.test.ts 同款构造器）。
//
// 覆盖 task-02 acceptance 全项：
//   AL1 白名单 happy path：真实 zcode 形状文件 → parsed + 外层 camelCase 字段
//      （status/messages/truncated/totalSegments/skippedLines）+ messages 内层
//      snake_case 九字段断言
//   AL2 越界路径 → throw RpcError code='forbidden'（与 readFile 同通道）
//   AL3 文件不存在 → throw RpcError code='not_found'（与 readFile 同通道）
//   AL4 未注册 format → unsupported（messages 空；用坏内容文件证明未进解析器——
//      进了会 parse_error）
//   AL5 文件超 20MB → too_large（lstat 预判不读全文；真实写 20MB+1 字节文件）
//   AL6 beforeSeq 透传解析器 → seq < beforeSeq 窗口切片（加载更早）
//   AL7 registry 单测：zcode-model-io-jsonl 已注册 / 未知 format 返回 null

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';
import { HostFsHandler } from '../../src/host-fs-handler.js';
import { getAgentLogParser } from '../../src/agent-log/registry.js';
import { DEFAULT_MAX_CONTENT_BYTES } from '../../src/agent-log/parse-zcode-model-io.js';
import { RpcError } from '../../src/ws-client.js';

const IS_WIN = platform() === 'win32';

/** 与 CLI 上报落库 format 串逐字一致（design §6 / D-002）。 */
const ZCODE_FORMAT = 'zcode-model-io-jsonl';

// ── fixture 构造（真实 zcode model-io JSONL 形状，design §5.1）────────────────

/** 单行 model_io 记录：request.messages + messageOffset + response + completedAt。 */
function modelIoLine(line: {
  messages: Array<Record<string, unknown>>;
  messageOffset: number;
  response?: Record<string, unknown> | null;
  completedAt?: string;
}): string {
  return JSON.stringify({
    type: 'model_io',
    request: { messages: line.messages, messageOffset: line.messageOffset },
    response: line.response ?? {},
    completedAt: line.completedAt ?? null,
  });
}

/**
 * 两行真实形状 fixture（task-02 蓝图 happy path）：
 *   行1（offset 0）：user 请求 → response 带 toolCalls（Bash t1）
 *   行2（offset 1）：tool 结果消息 + assistant 文本回复
 *
 * 预期段产出（task-01 解析器契约）：
 *   seq1 user_input 'list files please'（ts=行1 completedAt）
 *   seq2 tool_result（Bash/t1，content 原文，is_error:false）
 *   seq3 reply 'Found 2 files.'（ts=行2 completedAt；末行 response 同文 → 去重不补产）
 */
const FIXTURE_LINES: string = [
  modelIoLine({
    messages: [{ role: 'user', content: 'list files please' }],
    messageOffset: 0,
    response: { text: '', toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    completedAt: '2026-08-23T10:00:00Z',
  }),
  modelIoLine({
    messages: [
      {
        role: 'tool',
        toolCallId: 't1',
        toolName: 'Bash',
        isError: false,
        content: 'a.txt\nb.txt',
      },
      { role: 'assistant', content: [{ type: 'text', text: 'Found 2 files.' }] },
    ],
    messageOffset: 1,
    response: { text: 'Found 2 files.' },
    completedAt: '2026-08-23T10:00:05Z',
  }),
].join('\n');

/** 构造临时根目录 + 写一个 zcode 形状 fixture 文件，返回 handler + 文件绝对路径。 */
async function makeRootWithFixture(): Promise<{
  root: string;
  handler: HostFsHandler;
  logPath: string;
  pathOf: (rel: string) => string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-agent-log-'));
  const pathOf = (rel: string): string => join(root, rel);
  const logPath = pathOf('model-io-test.jsonl');
  await writeFile(logPath, FIXTURE_LINES, 'utf8');
  const handler = new HostFsHandler({ rootsProvider: () => [root] });
  return { root, handler, logPath, pathOf };
}

/** 断言 promise reject 为指定 code 的 RpcError（与 host-fs-handler.test.ts 同款）。 */
async function expectRpcError(
  p: Promise<unknown>,
  code: string,
): Promise<RpcError> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    const err = e as RpcError;
    expect(err.code).toBe(code);
    return err;
  }
  throw new Error(`expected RpcError code=${code}, but resolved`);
}

// ── HostFsHandler.readAgentLogMessages（AL1~AL6）──────────────────────────────

describe('HostFsHandler — readAgentLogMessages（task-02）', () => {
  let root: string;
  let handler: HostFsHandler;
  let logPath: string;
  let pathOf: (rel: string) => string;

  beforeEach(async () => {
    const r = await makeRootWithFixture();
    root = r.root;
    handler = r.handler;
    logPath = r.logPath;
    pathOf = r.pathOf;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('AL1: 白名单内真实 zcode 形状文件 → parsed + 外层 camelCase 字段 + 内层 snake_case 消息', async () => {
    const result = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT);

    // 外层字段（design §7.1：status/messages/truncated/totalSegments/skippedLines）。
    expect(result.status).toBe('parsed');
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(3);
    expect(result.skippedLines).toBe(0);
    expect(result.messages).toHaveLength(3);

    // seq1 user_input：九字段齐全（snake_case），ts 为所属行 completedAt。
    expect(result.messages[0]?.seq).toBe(1);
    expect(result.messages[0]?.kind).toBe('user_input');
    expect(result.messages[0]?.text).toBe('list files please');
    expect(result.messages[0]?.tool_name).toBeNull();
    expect(result.messages[0]?.tool_use_id).toBeNull();
    expect(result.messages[0]?.tool_input).toBeNull();
    expect(result.messages[0]?.tool_result).toBeNull();
    expect(result.messages[0]?.is_error).toBeNull();
    expect(result.messages[0]?.ts).toBe('2026-08-23T10:00:00Z');

    // seq2 tool_result：消息级 toolCallId/toolName/isError/content 键集透传。
    expect(result.messages[1]?.seq).toBe(2);
    expect(result.messages[1]?.kind).toBe('tool_result');
    expect(result.messages[1]?.tool_name).toBe('Bash');
    expect(result.messages[1]?.tool_use_id).toBe('t1');
    expect(result.messages[1]?.tool_result).toBe('a.txt\nb.txt');
    expect(result.messages[1]?.is_error).toBe(false);

    // seq3 reply：末行 response 同文去重（G 尾部 assistant 已产，不重复补产）。
    expect(result.messages[2]?.seq).toBe(3);
    expect(result.messages[2]?.kind).toBe('reply');
    expect(result.messages[2]?.text).toBe('Found 2 files.');
    expect(result.messages[2]?.ts).toBe('2026-08-23T10:00:05Z');
  });

  it('AL2: 越界路径 → throw RpcError forbidden（与 readFile 同通道）', async () => {
    const evil = IS_WIN ? 'C:\\Windows\\System32\\config' : '/etc/passwd';
    await expectRpcError(
      handler.readAgentLogMessages(evil, ZCODE_FORMAT),
      'forbidden',
    );
  });

  it('AL3: 文件不存在 → throw RpcError not_found（与 readFile 同通道）', async () => {
    await expectRpcError(
      handler.readAgentLogMessages(pathOf('missing.jsonl'), ZCODE_FORMAT),
      'not_found',
    );
  });

  it('AL4: 未注册 format → unsupported（messages 空，不进解析器）', async () => {
    // 用坏内容文件（非 JSONL）证明未进解析器：进了会是 parse_error（坏行 100%），
    // 返回 unsupported 说明 registry 分发在解析之前拦截（含二进制格式串兜底）。
    const badPath = pathOf('bad.jsonl');
    await writeFile(badPath, 'not a json line at all\n', 'utf8');

    const result = await handler.readAgentLogMessages(badPath, 'some-binary-format');
    expect(result).toEqual({
      status: 'unsupported',
      messages: [],
      truncated: false,
      totalSegments: 0,
      skippedLines: 0,
    });
  });

  it('AL5: 文件超 20MB → too_large（lstat 预判，不读全文）', async () => {
    const bigPath = pathOf('big.jsonl');
    // 真实写超预算 1 字节的文件（内容无需有效——lstat 预判发生在解析之前）。
    await writeFile(bigPath, Buffer.alloc(DEFAULT_MAX_CONTENT_BYTES + 1, 0x78));

    const result = await handler.readAgentLogMessages(bigPath, ZCODE_FORMAT);
    expect(result).toEqual({
      status: 'too_large',
      messages: [],
      truncated: false,
      totalSegments: 0,
      skippedLines: 0,
    });
  });

  it('AL6: beforeSeq 透传解析器 → 返回 seq < beforeSeq 的窗口切片', async () => {
    const result = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT, 3);

    // 切片后只剩 seq1/seq2（加载更早）；totalSegments 仍是全量段总数（切片前）。
    expect(result.status).toBe('parsed');
    expect(result.messages.map((m) => m.seq)).toEqual([1, 2]);
    expect(result.totalSegments).toBe(3);
    expect(result.truncated).toBe(false);

    // beforeSeq=1 → 空（没有更早的段），totalSegments 不变。
    const empty = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT, 1);
    expect(empty.status).toBe('parsed');
    expect(empty.messages).toEqual([]);
    expect(empty.totalSegments).toBe(3);
  });
});

// ── registry（AL7：format → parser 查询）──────────────────────────────────────

describe('agent-log registry — getAgentLogParser（task-02）', () => {
  it('AL7a: zcode-model-io-jsonl 已注册（返回解析函数）', () => {
    const parser = getAgentLogParser(ZCODE_FORMAT);
    expect(typeof parser).toBe('function');
  });

  it('AL7b: 未知 format / 二进制格式串 → null（由调用方转 unsupported）', () => {
    expect(getAgentLogParser('claude-transcript-jsonl')).toBeNull();
    expect(getAgentLogParser('screenshot-png')).toBeNull();
    expect(getAgentLogParser('')).toBeNull();
  });

  it('AL7c: 已注册 parser 直调 = parseZcodeModelIoLog 契约（beforeSeq 注入）', async () => {
    const parser = getAgentLogParser(ZCODE_FORMAT);
    if (parser === null) throw new Error('parser should be registered');
    const result = await parser(FIXTURE_LINES, { beforeSeq: 2 });
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(3);
    expect(result.messages.map((m) => m.seq)).toEqual([1]);
  });
});
