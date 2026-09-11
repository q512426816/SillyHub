// tests/agent-log/zcode-sqlite-dispatch.test.ts
// task-03（2026-09-10-zcode-session-sqlite-read / FR-03 + FR-04 + D-001@v1 + D-005@v1）：
// host-fs-handler.readAgentLogMessages 的 zcode「先库后文件」分派接线单测——
// 守卫通过后、registry 前，format=zcode-model-io-jsonl 先走 task-02 SQLite 读取器。
//
// 测试策略（混合真实 + spy，两个观察点零模块 mock）：
//   - 库侧：真实 fixture SQLite 库（task-01 createZcodeFixtureDb 造库）+
//     setZcodeSqliteDbPathFactory 模块级工厂注入库路径（产码设计好的测试通道，
//     不 vi.mock read-zcode-sqlite 模块）。工厂仅在 readZcodeSqliteMessages 内部
//     被咨询 → 「工厂调用次数」即「读取器是否被调」的可靠观察点（ZD4/ZD5 断言用）。
//   - 文件侧：vi.mock('node:fs/promises') 部分包装（lstat/readFile 包 vi.fn 透传
//     真实现，repo 先例 tests/interactive/claude-transcript-dir.test.ts 同款）——
//     「lstat/readFile 是否被调」即「是否触文件 IO」的观察点（ZD1 断言零文件 IO）。
//     临时目录/fixture 文件经 node:fs 同步 API 造（不经 promises mock，setup 不
//     污染 spy 计数）。
//   - 双源内容刻意不同（库首段 '帮我排查这个构建失败' vs 文件首段 'list files
//     please'）：断言结果文本即证明数据来自哪一侧（分派方向的强证据）。
//
// 覆盖 task-03 acceptance 全项（四态 + 守卫先行）：
//   ZD1 库成功：parsed 原样回传（status/messages/truncated/totalSegments）+
//      零 lstat/readFile（文件死活与库读取无关——D-001@v1 恒库；含「文件不存在
//      的历史会话」核心回归态）+ beforeSeq 透传读取器
//   ZD2a 库失败（读取器不可用：库文件缺失）+ 文件在 → 回落 parse-zcode-model-io
//      文件解析成功（readFile 被调）
//   ZD2b 库失败（会话不在库）+ 文件在 → 同上回落文件解析成功
//   ZD3 库+文件双失败 → 现状语义 not_found RpcError（lstat 被调证明回落到文件流程）
//   ZD4 claude format（'claude-transcript-jsonl'）：不调读取器（工厂零调用）直走
//      registry 文件流程（未注册 → unsupported，零文件 IO）——路径故意用可提取
//      sess id 的 zcode 命名，证明 format 门先于 sess id 提取
//   ZD5 越界 path（allowed_roots 外）+ zcode format + 库里会话存在 → 守卫仍先拦截
//      forbidden（工厂零调用 = 分派未发生，守卫先于分派）

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

// 文件 IO spy（见文件头「测试策略」）：lstat/readFile 包 vi.fn 透传真实现，
// 其余导出原样 spread。vi.mock 提升到 import 之前——工厂体只引用 importOriginal。
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    lstat: vi.fn(actual.lstat),
    readFile: vi.fn(actual.readFile),
  };
});

// homedir mock（目录门修订配套）：handler 的 zcode rollout 目录门用 homedir()
// 定位 ~/.zcode/cli/rollout——测试指向 mkdtemp root（用例路径造进其 rollout/
// 子目录内过门；ZD6 用 root 下 rollout 外路径验门拦截）。tmpdir 等其余导出保真
// （fixture 造库路径依赖）。
const osMocks = vi.hoisted(() => ({ homedir: vi.fn() }));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: osMocks.homedir };
});

import { lstat, readFile } from 'node:fs/promises';
import { HostFsHandler } from '../../src/host-fs-handler.js';
import {
  createZcodeFixtureDb,
  setZcodeSqliteDbPathFactory,
  ZCODE_FIXTURE_IDS,
  type ZcodeFixtureDb,
} from '../../src/agent-log/read-zcode-sqlite.js';
import { RpcError } from '../../src/ws-client.js';

const lstatSpy = vi.mocked(lstat);
const readFileSpy = vi.mocked(readFile);

const IS_WIN = platform() === 'win32';

/** 与 CLI 上报落库 format 串逐字一致（design §6 / D-002）。 */
const ZCODE_FORMAT = 'zcode-model-io-jsonl';

/** claude format（registry 未注册 → unsupported；ZD4 证明不经 zcode 分派）。 */
const CLAUDE_FORMAT = 'claude-transcript-jsonl';

const MAIN = ZCODE_FIXTURE_IDS.mainSession;

/** 不在 fixture 库中的会话 id（ZD2b/ZD3「会话不在库」用）。 */
const NOT_IN_DB = 'sess_ffffffff-eeee-4ddd-bccc-00000000000f';

/** session.id → 对应 rollout 上报文件名（extractZcodeSessId 的逆映射）。 */
const zcodeFilenameOf = (sessId: string): string => `model-io-${sessId}.jsonl`;

// ── 文件回落侧 fixture（真实 zcode model-io JSONL 形状，与
//    read-agent-log-messages.test.ts 同款构造器；3 段：user_input/tool_result/reply，
//    内容与库 fixture（9 段，首段 '帮我排查这个构建失败'）刻意不同——断言结果
//    文本即证明数据来自文件侧）──────────────────────────────────────────────────

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

const FILE_FIXTURE_LINES: string = [
  modelIoLine({
    messages: [{ role: 'user', content: 'list files please' }],
    messageOffset: 0,
    response: { text: '', toolCalls: [{ id: 't1', name: 'Bash', input: { command: 'ls' } }] },
    completedAt: '2026-09-10T10:00:00Z',
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
    completedAt: '2026-09-10T10:00:05Z',
  }),
].join('\n');

/** 断言 promise reject 为指定 code 的 RpcError（与 read-agent-log-messages.test.ts 同款）。 */
async function expectRpcError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(code);
    return;
  }
  throw new Error(`expected RpcError code=${code}, but resolved`);
}

// ── 用例（ZD1-ZD5）────────────────────────────────────────────────────────────

describe('HostFsHandler — readAgentLogMessages zcode 先库后文件分派（task-03）', () => {
  let root: string;
  let handler: HostFsHandler;
  let fixture: ZcodeFixtureDb;
  /** 工厂调用计数（readZcodeSqliteMessages 每次被调咨询一次 = 分派发生的证据）。 */
  let factoryCalls: number;
  /** rollout 目录（目录门放行域；上报路径造在其内，ZD6 用 rollout 外路径验拦截）。 */
  let rolloutDir: string;
  const pathOf = (rel: string): string => join(rolloutDir, rel);

  beforeEach(async () => {
    vi.clearAllMocks(); // 清 spy 调用计数（vi.fn(真实现) 的实现保留）
    root = mkdtempSync(join(tmpdir(), 'sillyhub-zcode-dispatch-'));
    osMocks.homedir.mockReturnValue(root);
    rolloutDir = join(root, '.zcode', 'cli', 'rollout');
    mkdirSync(rolloutDir, { recursive: true });
    handler = new HostFsHandler({ rootsProvider: () => [root] });
    fixture = await createZcodeFixtureDb();
    factoryCalls = 0;
  });

  afterEach(() => {
    setZcodeSqliteDbPathFactory(null); // 还原默认 ~/.zcode/cli/db/db.sqlite
    fixture.close(); // 释放 Windows 写句柄后 rmSync 才不抛 EBUSY
    rmSync(fixture.dbPath, { force: true });
    rmSync(root, { recursive: true, force: true });
  });

  /** 工厂指向指定库路径并开始计数（库侧观察点）。 */
  function pointFactoryAt(dbPath: string): void {
    factoryCalls = 0;
    setZcodeSqliteDbPathFactory(() => {
      factoryCalls++;
      return dbPath;
    });
  }

  it('ZD1: 库成功 → 原样回传读取器结果（零文件 IO；含文件不存在的历史会话核心回归态）', async () => {
    pointFactoryAt(fixture.dbPath);
    // 核心回归态（目录门修订的直接动因）：rollout 文件已被 zcode 清理（不造文件），
    // 历史会话照样从库读取——原 lstat 存在性门（ql-20260911-003-355a）正是死在
    // 这里（文件不存在 → 门拦 → 回落 → not_found）。
    const logPath = pathOf(zcodeFilenameOf(MAIN));
    lstatSpy.mockClear();
    readFileSpy.mockClear();

    const result = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT);

    // 分派发生（工厂被咨询）且读取器结果原样回传（task-02 R1 同源断言：主会话
    // 9 段、skippedLines 7、首段 user_input 文本来自库 fixture）。
    expect(factoryCalls).toBe(1);
    expect(result.status).toBe('parsed');
    expect(result.truncated).toBe(false);
    expect(result.totalSegments).toBe(9);
    expect(result.skippedLines).toBe(7);
    expect(result.messages.map((m) => m.kind)).toEqual([
      'user_input', 'thinking', 'reply',
      'tool_use', 'tool_result', 'tool_use', 'tool_result', 'tool_use', 'tool_use',
    ]);
    expect(result.messages[0]?.text).toBe('帮我排查这个构建失败');

    // 库成功零文件 IO（D-005@v1 + D-001@v1 恒库）：门已不再 lstat。
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();

    // 文件恰好存在时同样走库（恒库语义：文件在也不读文件）。
    writeFileSync(logPath, FILE_FIXTURE_LINES, 'utf8');
    lstatSpy.mockClear();
    await handler.readAgentLogMessages(logPath, ZCODE_FORMAT);
    expect(factoryCalls).toBe(2);
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();

    // beforeSeq 透传读取器（seq < 5 切片；totalSegments 仍是全量 9）。
    factoryCalls = 0;
    const sliced = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT, 5);
    expect(sliced.status).toBe('parsed');
    expect(sliced.messages.map((m) => m.seq)).toEqual([1, 2, 3, 4]);
    expect(sliced.totalSegments).toBe(9);
    expect(factoryCalls).toBe(1);
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('ZD6: rollout 目录外路径 + zcode format → 目录门拦截（不进库读取器，not_found）', async () => {
    pointFactoryAt(fixture.dbPath);
    // MAIN 会话在 fixture 库中，但上报路径位于 allowed_roots 内、rollout 目录外
    // （自登记任意路径的越权面）——目录门先拦（不咨询库工厂），回落文件流程后
    // lstat ENOENT → not_found（与未上报路径同语义；安全语义保留）。
    const outside = join(root, 'outside');
    mkdirSync(outside, { recursive: true });
    const logPath = join(outside, zcodeFilenameOf(MAIN));

    await expectRpcError(handler.readAgentLogMessages(logPath, ZCODE_FORMAT), 'not_found');
    expect(factoryCalls).toBe(0); // 库读取器未被咨询（门在分派前）
    expect(lstatSpy).toHaveBeenCalledTimes(1); // 回落文件流程的 lstat（门本身零 IO）
  });

  it('ZD2a: 读取器不可用（库文件缺失）+ 文件在 → 回落文件解析成功', async () => {
    pointFactoryAt(pathOf('no-such-db.sqlite')); // existsSync false → 读取器不可用
    const logPath = pathOf(zcodeFilenameOf(MAIN));
    writeFileSync(logPath, FILE_FIXTURE_LINES, 'utf8');

    const result = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT);

    // 回落证据链：分派发生过（工厂被咨询）→ readFile 被调 → 结果是文件 fixture
    // 的 3 段（parse-zcode-model-io 契约），文本来自文件侧而非库侧。
    expect(factoryCalls).toBe(1);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(3);
    expect(result.skippedLines).toBe(0);
    expect(result.messages.map((m) => m.kind)).toEqual(['user_input', 'tool_result', 'reply']);
    expect(result.messages[0]?.text).toBe('list files please');
    expect(result.messages[2]?.text).toBe('Found 2 files.');
  });

  it('ZD2b: 会话不在库 + 文件在 → 回落文件解析成功', async () => {
    pointFactoryAt(fixture.dbPath); // 真实库但 NOT_IN_DB 会话不存在
    const logPath = pathOf(zcodeFilenameOf(NOT_IN_DB));
    writeFileSync(logPath, FILE_FIXTURE_LINES, 'utf8');

    const result = await handler.readAgentLogMessages(logPath, ZCODE_FORMAT);

    expect(factoryCalls).toBe(1);
    expect(readFileSpy).toHaveBeenCalledTimes(1);
    expect(result.status).toBe('parsed');
    expect(result.totalSegments).toBe(3);
    expect(result.messages.map((m) => m.kind)).toEqual(['user_input', 'tool_result', 'reply']);
    expect(result.messages[0]?.text).toBe('list files please');
  });

  it('ZD3: 库+文件双失败 → not_found RpcError（现状语义，lstat 已被调证明回落）', async () => {
    pointFactoryAt(fixture.dbPath); // 会话不在库
    const logPath = pathOf(zcodeFilenameOf(NOT_IN_DB)); // 文件也缺

    // 回落日志必须可见（ql-20260911-005：原 console.debug 在 console-timestamp
    // 包装外全程无痕，排障只能反编译 bundle——升级 info 后本断言锁住可观测性）。
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});

    // 现状语义：路径在 rollout 内过目录门 → 读取器抛「会话不在库」→ 回落文件
    // 流程 lstat ENOENT → toRpcError 抛 not_found（读取器错误不冒泡不伪造结果）。
    await expectRpcError(handler.readAgentLogMessages(logPath, ZCODE_FORMAT), 'not_found');

    expect(infoSpy).toHaveBeenCalledTimes(1);
    expect(String(infoSpy.mock.calls[0]?.[0])).toContain('zcode_sqlite_fallback_to_file');
    infoSpy.mockRestore();

    expect(factoryCalls).toBe(1); // 目录门放行，读取器被咨询后抛「不在库」
    expect(lstatSpy).toHaveBeenCalledTimes(1); // 回落文件流程一次（门零 IO）
    expect(readFileSpy).not.toHaveBeenCalled(); // lstat 已抛，未进 readFile
  });

  it("ZD4: claude format → 不调读取器直走文件流程（registry 未注册 → unsupported）", async () => {
    pointFactoryAt(fixture.dbPath);
    // 路径故意用可提取 sess id 的 zcode 命名（MAIN 在库中，若 format 门失效
    // 误入分派会返回库 9 段 parsed）——证明 format 门先于 sess id 提取（FR-04）。
    const logPath = pathOf(zcodeFilenameOf(MAIN)); // 文件不存在

    const result = await handler.readAgentLogMessages(logPath, CLAUDE_FORMAT);

    // 读取器零调用（工厂零咨询）+ registry 判 null → unsupported（现状零改动）。
    expect(factoryCalls).toBe(0);
    expect(result).toEqual({
      status: 'unsupported',
      messages: [],
      truncated: false,
      totalSegments: 0,
      skippedLines: 0,
    });
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();
  });

  it('ZD5: 越界 path + zcode format + 库里会话存在 → 守卫仍先拦截 forbidden（分派未发生）', async () => {
    pointFactoryAt(fixture.dbPath); // MAIN 在库中：若分派先于守卫会返回 parsed
    const evil = IS_WIN
      ? join('C:\\Windows', zcodeFilenameOf(MAIN))
      : join('/etc', zcodeFilenameOf(MAIN));

    // D-005@v1 守卫先行铁律：assertWithinAllowedRoots 抛 forbidden 先于 zcode
    // 分派（工厂零咨询 = 读取器未被调；库命中也不能绕过越界检查）。
    await expectRpcError(handler.readAgentLogMessages(evil, ZCODE_FORMAT), 'forbidden');

    expect(factoryCalls).toBe(0);
    expect(lstatSpy).not.toHaveBeenCalled();
    expect(readFileSpy).not.toHaveBeenCalled();
  });
});
