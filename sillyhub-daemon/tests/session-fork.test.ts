// tests/session-fork.test.ts
// session-fork task-06（2026-09-22-session-fork-continuation / FR-03 / FR-04 /
// D-008 / D-011 / D-012 / D-013 / R-07）：daemon fork 透传全链单测。
//
// 覆盖（任务卡 implementation/acceptance 对齐）：
//   A. execPayload 四键解析：claim payload snake_case fork 键组
//      （resume_at_uuid/fork_session/fork_anchor_entry_id/fork_mode，
//      backend context.py task-05 白名单单源）→ daemon 归一化 →
//      SessionManager.create（CreateSessionInput 四键）；缺省 → 四键 undefined
//      （零回归）。模式照搬 tests/daemon-resume-input.test.ts（helper 自包含
//      复制，不改既有测试文件）。
//   B. SessionManager.create → driverOpts 组装：四键进 spec →
//      _buildDriverOptions **独立转发分支**（R-07 验收：不带 systemPrompt 的
//      fork 创建 forkSession 照常转发，与人格热切换守卫互不触发）；缺省 →
//      driverOpts 无 fork 键（零回归）。
//   C. claude-sdk-driver：resumeSessionAt+forkSession 透传 SDK options +
//      **禁传 resumeDropsTurn 断言**（D-008：undefined 序列化 null 硬崩 CLI，
//      options 对象不得出现该键）；consume() assistant 帧 raw uuid →
//      AgentEvent.metadata.engineAnchor 补挂（D-011）。
//   D. pi-rpc-driver：fork 前置两态命令形态（rpc_fork → {type:'fork',entryId} /
//      clone → {type:'clone'}，经短命 RPC 预 fork，B 以新分支文件 --session
//      启动，临时进程回收）；consume() 轮首 user 消息 → get_fork_messages 回查
//      entryId → 后续内容事件 metadata.engineAnchor 补挂（D-011——wire 帧不携
//      带 entryId，见 driver _fetchTurnUserEntryId 注释）。
//
// 用 tests/helpers/fake-child.ts 驱动 pi spawn 的 stdin/stdout；SDK 一律 mock
// （vi.mock），不连真实二进制/网络。

import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';

// mock node:child_process.spawn —— pi driver / daemon 意外 spawn 点统一 FakeChild。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(),
  };
});

// mock claude-agent-sdk：仅 query 一个值导出（claude-sdk-driver.ts:53 单点消费）。
const { mockQuery } = vi.hoisted(() => ({
  mockQuery: vi.fn(
    (
      _params: {
        prompt: string | AsyncIterable<unknown>;
        options?: Record<string, unknown>;
      },
    ): unknown =>
      ({
        [Symbol.asyncIterator]: () => (async function* () {})(),
        interrupt: async () => {},
      }) as unknown,
  ),
}));
vi.mock('@anthropic-ai/claude-agent-sdk', () => ({
  query: mockQuery,
}));

import { spawn } from 'node:child_process';
import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { MSG } from '../src/protocol.js';
import type { WsClientCallbacks } from '../src/ws-client.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';
import { SessionManager } from '../src/interactive/session-manager.js';
import { ClaudeSdkDriver } from '../src/interactive/claude-sdk-driver.js';
import type { ClaudeDriverHandle } from '../src/interactive/claude-sdk-driver.js';
import { PiRpcDriver, PI_SUBAGENT_EXTENSION_ENV, PI_ASK_USER_EXTENSION_ENV, type PiRpcHandle } from '../src/interactive/pi-rpc-driver.js';
import type { AgentEvent } from '../src/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  UserTurnInput,
} from '../src/interactive/driver.js';
import {
  createFakeChild,
  type FakeChild,
} from './helpers/fake-child.js';

// ── 公共工具 ────────────────────────────────────────────────────────────────

let tmpSessionDir: string;
let prevSubagentExtEnv: string | undefined;
let prevAskUserExtEnv: string | undefined;

beforeEach(async () => {
  vi.clearAllMocks();
  // pi spawn 参数面精确断言：默认关闭 vendored 扩展装载（pi-rpc-driver.test.ts 同款）。
  prevSubagentExtEnv = process.env[PI_SUBAGENT_EXTENSION_ENV];
  process.env[PI_SUBAGENT_EXTENSION_ENV] = 'off';
  prevAskUserExtEnv = process.env[PI_ASK_USER_EXTENSION_ENV];
  process.env[PI_ASK_USER_EXTENSION_ENV] = 'off';
  // spawn 默认回落**真实 spawn**（daemon preflight 等启动路径真用 spawn——返回
  // FakeChild 会把其版本探测 await 挂死）；pi 用例内自行 override 为 FakeChild。
  const actual =
    await vi.importActual<typeof import('node:child_process')>('node:child_process');
  vi.mocked(spawn).mockImplementation(actual.spawn as never);
});

afterEach(async () => {
  if (prevSubagentExtEnv === undefined) delete process.env[PI_SUBAGENT_EXTENSION_ENV];
  else process.env[PI_SUBAGENT_EXTENSION_ENV] = prevSubagentExtEnv;
  prevSubagentExtEnv = undefined;
  if (prevAskUserExtEnv === undefined) delete process.env[PI_ASK_USER_EXTENSION_ENV];
  else process.env[PI_ASK_USER_EXTENSION_ENV] = prevAskUserExtEnv;
  prevAskUserExtEnv = undefined;
  if (tmpSessionDir) {
    await rm(tmpSessionDir, { recursive: true, force: true }).catch(() => {});
    tmpSessionDir = '';
  }
});

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(
  cond: () => boolean,
  { timeout = 3000, interval = 15 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(interval);
  }
  throw new Error('waitFor: 条件在超时内未满足');
}

/** 从 FakeChild stdin 解析出所有已写入的 JSON 行。 */
function readStdinJson(child: FakeChild): Record<string, unknown>[] {
  const text = (child as unknown as { _stdinChunks?: Buffer[] })._stdinChunks ?? [];
  return Buffer.concat(text)
    .toString('utf8')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('{'))
    .map((l) => JSON.parse(l) as Record<string, unknown>);
}

/** 给 stdout 推一个 pi 事件行。 */
function emitEvent(child: FakeChild, evt: Record<string, unknown>): void {
  child.stdout.push(JSON.stringify(evt) + '\n');
}

/** 应答 stdin 里指定 type 的命令（response 按 id 关联；rpc.md:23-26）。 */
function respond(
  child: FakeChild,
  cmdType: string,
  resp: { success?: boolean; data?: unknown; error?: string } = {},
): void {
  const lines = readStdinJson(child);
  const req = [...lines]
    .reverse()
    .find((l) => l.type === cmdType && typeof l.id === 'string');
  if (!req) throw new Error(`respond: stdin 无待应答 ${cmdType} 命令`);
  child.stdout.push(
    JSON.stringify({
      id: req.id,
      type: 'response',
      command: cmdType,
      success: resp.success !== false,
      ...(resp.data !== undefined ? { data: resp.data } : {}),
      ...(resp.error !== undefined ? { error: resp.error } : {}),
    }) + '\n',
  );
}

/** 等待 stdin 出现指定 type 命令后应答（fork 前置命令时序驱动）。 */
async function respondWhen(
  child: FakeChild,
  cmdType: string,
  resp: { success?: boolean; data?: unknown; error?: string },
): Promise<Record<string, unknown>> {
  await waitFor(() => readStdinJson(child).some((l) => l.type === cmdType && typeof l.id === 'string'));
  const req = readStdinJson(child).find((l) => l.type === cmdType && typeof l.id === 'string')!;
  respond(child, cmdType, resp);
  return req;
}

// ── A. daemon execPayload 四键解析（daemon-resume-input.test.ts 同款夹具）────

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-fork',
  profile: 'default',
  workspace_dir: '/tmp/ws-fork',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
  allowed_roots: [tmpdir()],
};

function createMockClient() {
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rid-1' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({
      claim_token: 'token-default',
      payload: { prompt: 'hi', provider: 'claude' },
    })),
    startLease: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({
      agent_run_id: 'run-default',
      claude_md: '',
    })),
    close: vi.fn(),
  };
}

function createMockTaskRunner() {
  return {
    runLease: vi.fn(async () => ({
      success: true,
      exitCode: 0,
      status: 'completed',
      patch: '',
      filesChanged: 0,
      insertions: 0,
      deletions: 0,
      output: 'ok',
      error: '',
      durationMs: 10,
      sessionId: '',
      metadata: {},
    })),
  };
}

function createMockSessionManager(): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((_sid: string) => undefined as Readonly<SessionState> | undefined),
  };
  return sm as unknown as SessionManager;
}

function createMockWsClient() {
  let callbacks: WsClientCallbacks = {};
  return {
    connect: vi.fn(() => {
      callbacks.onConnected?.();
    }),
    close: vi.fn(() => {
      callbacks.onDisconnected?.(1000, 'test_close');
    }),
    send: vi.fn(() => true),
    registerRpcHandler: vi.fn(),
    _injectMessage(msg: { type: string; payload: unknown }): void {
      callbacks.onMessage?.(msg as never);
    },
    _setCallbacks(cb: WsClientCallbacks): void {
      callbacks = cb;
    },
  };
}

function buildDaemon(opts: { sessionManager?: SessionManager | null } = {}) {
  const client = createMockClient();
  const taskRunner = createMockTaskRunner();
  const sessionManager =
    opts.sessionManager === undefined
      ? createMockSessionManager()
      : opts.sessionManager;
  const detector = {
    detectAgents: vi.fn(async () => [
      {
        provider: 'claude',
        path: 'C:\\bin\\claude.exe',
        version: '1.0.0',
        protocol: 'stream_json',
        status: 'available' as const,
        versionWarning: null,
      },
    ]),
  };
  const wsClientMock = createMockWsClient();
  const wsClientFactory = vi.fn((o: { callbacks: WsClientCallbacks }) => {
    wsClientMock._setCallbacks(o.callbacks);
    return wsClientMock;
  });
  const ctorOpts: Record<string, unknown> = { detector, wsClientFactory };
  if (opts.sessionManager !== undefined) {
    ctorOpts.sessionManager = sessionManager;
  }
  const daemon = new Daemon(
    mockConfig,
    client as never,
    taskRunner as never,
    ctorOpts as never,
  );
  return { daemon, client, sessionManager, wsClientMock };
}

async function driveInteractiveClaim(
  claimPayload: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const sessionManager = createMockSessionManager();
  const { daemon, client, wsClientMock } = buildDaemon({ sessionManager });
  trackedDaemons.push(daemon);
  await daemon.start();
  client.claimLease.mockResolvedValueOnce({
    claim_token: 'token-fork',
    payload: claimPayload,
  });
  wsClientMock._injectMessage({
    type: MSG.TASK_AVAILABLE,
    payload: {
      leaseId: 'lease-fork',
      kind: 'interactive',
      prompt: 'hi',
      agentSessionId: 'sess-fork',
      agentRunId: 'run-fork',
      rootPath: tmpdir(),
    },
  });
  const createSpy = sessionManager.create as ReturnType<typeof vi.fn>;
  await waitFor(() => createSpy.mock.calls.length > 0);
  await daemon.stop().catch(() => undefined);
  return createSpy.mock.calls[0]![0] as Record<string, unknown>;
}

let trackedDaemons: Daemon[] = [];

describe('session-fork task-06：execPayload fork 四键解析（D-012/D-013）', () => {
  afterEach(async () => {
    for (const d of trackedDaemons) {
      if (d.isRunning) await d.stop().catch(() => undefined);
    }
    trackedDaemons = [];
  });

  it('interactive claim payload snake_case fork 键组 → CreateSessionInput 四键', async () => {
    const createArg = await driveInteractiveClaim({
      kind: 'interactive',
      prompt: 'hi',
      provider: 'claude',
      agent_session_id: 'sess-fork',
      agent_run_id: 'run-fork',
      root_path: tmpdir(),
      // 既有键（fork 时 resume=源 SDK 会话 id，经 resume_session_id 既有链承载）
      resume_session_id: 'src-sdk-sess-001',
      // session-fork task-05 白名单下发的 fork 键组（snake_case 单源）
      resume_at_uuid: 'u-9019fe24',
      fork_session: true,
      fork_anchor_entry_id: 'ent-308df55d',
      fork_mode: 'resume_at',
    });
    expect(createArg['resume']).toBe('src-sdk-sess-001');
    expect(createArg['resumeAtUuid']).toBe('u-9019fe24');
    expect(createArg['forkSession']).toBe(true);
    expect(createArg['forkAnchorEntryId']).toBe('ent-308df55d');
    expect(createArg['forkMode']).toBe('resume_at');
  });

  it('camelCase 键形态同样归一化（防御兜底，对齐 thinkingLevel 惯例）', async () => {
    // provider 用 claude（detector 夹具只探测 claude；本用例只验证键归一化，
    // pi 档位的 driver 侧行为在 D 组直测）。
    const createArg = await driveInteractiveClaim({
      kind: 'interactive',
      prompt: 'hi',
      provider: 'claude',
      agent_session_id: 'sess-fork-camel',
      agent_run_id: 'run-fork-camel',
      root_path: tmpdir(),
      resumeSessionId: 'src-sess',
      resumeAtUuid: 'u-1',
      forkSession: true,
      forkAnchorEntryId: 'ent-9',
      forkMode: 'rpc_fork',
    });
    expect(createArg['resumeAtUuid']).toBe('u-1');
    expect(createArg['forkSession']).toBe(true);
    expect(createArg['forkAnchorEntryId']).toBe('ent-9');
    expect(createArg['forkMode']).toBe('rpc_fork');
  });

  it('缺省（非 fork lease）→ 四键均 undefined（零回归）', async () => {
    const createArg = await driveInteractiveClaim({
      kind: 'interactive',
      prompt: 'hi',
      provider: 'claude',
      agent_session_id: 'sess-plain',
      agent_run_id: 'run-plain',
      root_path: tmpdir(),
    });
    expect(createArg['resumeAtUuid']).toBeUndefined();
    expect(createArg['forkSession']).toBeUndefined();
    expect(createArg['forkAnchorEntryId']).toBeUndefined();
    expect(createArg['forkMode']).toBeUndefined();
  });
});

// ── B. SessionManager.create → driverOpts（R-07 独立转发分支）────────────────

interface CapturedStart {
  input: AsyncIterable<UserTurnInput>;
  opts: Record<string, unknown>;
}

/** 捕获 driver.start 入参 opts 的 fake driver（session-manager-driver-registry 同款）。 */
function makeOptCapturingDriver(
  provider: 'claude' | 'pi',
): { driver: InteractiveDriver; startCalls: CapturedStart[] } {
  const startCalls: CapturedStart[] = [];
  const handle: InteractiveDriverHandle = {
    provider,
    processId: 42_001,
    close: vi.fn(async () => {}),
  };
  const driver: InteractiveDriver = {
    start: vi.fn(async (input: AsyncIterable<UserTurnInput>, opts: unknown) => {
      startCalls.push({ input, opts: opts as Record<string, unknown> });
      return handle;
    }),
    consume: vi.fn(async () => {}),
    interrupt: vi.fn(async () => true),
  };
  return { driver, startCalls };
}

function makeSmDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const smBaseInput = {
  sessionId: 'sess-fork-1',
  leaseId: 'lease-1',
  claimToken: 'token-1',
  firstPrompt: 'fork hi',
  firstRunId: 'run-1',
  cwd: '/tmp',
  pathToClaudeCodeExecutable: '/fake/claude',
};

describe('session-fork task-06：create → driverOpts 组装（R-07 解耦验收）', () => {
  it('claude 形态：resumeAtUuid/forkSession/forkMode 进 driverOpts；无 systemPrompt 时 forkSession 仍转发（R-07：fork 分支不触发 systemPrompt 守卫路径）', async () => {
    const { driver, startCalls } = makeOptCapturingDriver('claude');
    const sm = new SessionManager({ drivers: { claude: driver }, ...makeSmDeps() }, {});
    await sm.create({
      ...smBaseInput,
      provider: 'claude',
      resume: 'src-sdk-sess-001',
      resumeAtUuid: 'u-9019fe24',
      forkSession: true,
      forkMode: 'resume_at',
    });
    expect(startCalls).toHaveLength(1);
    const opts = startCalls[0]!.opts;
    expect(opts['resume']).toBe('src-sdk-sess-001');
    expect(opts['resumeAtUuid']).toBe('u-9019fe24');
    expect(opts['forkSession']).toBe(true);
    expect(opts['forkMode']).toBe('resume_at');
    // R-07 验收点：本次创建**未传 systemPrompt**——driverOpts 不含 systemPrompt 键
    //（守卫路径未触发），fork 参数仍全量转发（旧 forkSession 转发点嵌在守卫内，
    // 解耦后不依赖 systemPrompt 存在）。
    expect('systemPrompt' in opts).toBe(false);
  });

  it('pi 形态：forkMode/forkAnchorEntryId 进 driverOpts', async () => {
    const { driver, startCalls } = makeOptCapturingDriver('pi');
    const sm = new SessionManager({ drivers: { pi: driver }, ...makeSmDeps() }, {});
    await sm.create({
      ...smBaseInput,
      provider: 'pi',
      resume: 'src-pi-sess',
      forkMode: 'rpc_fork',
      forkAnchorEntryId: 'ent-308df55d',
    });
    const opts = startCalls[0]!.opts;
    expect(opts['forkMode']).toBe('rpc_fork');
    expect(opts['forkAnchorEntryId']).toBe('ent-308df55d');
    expect(opts['resume']).toBe('src-pi-sess');
    // claude 档专属键不随 pi 形态误挂（缺省穿透）。
    expect(opts['resumeAtUuid']).toBeUndefined();
    expect(opts['forkSession']).toBeUndefined();
  });

  it('缺省（非 fork 创建）→ driverOpts 无 fork 键（零回归）', async () => {
    const { driver, startCalls } = makeOptCapturingDriver('claude');
    const sm = new SessionManager({ drivers: { claude: driver }, ...makeSmDeps() }, {});
    await sm.create({ ...smBaseInput, provider: 'claude' });
    const opts = startCalls[0]!.opts;
    expect('resumeAtUuid' in opts).toBe(false);
    expect('forkSession' in opts).toBe(false);
    expect('forkAnchorEntryId' in opts).toBe(false);
    expect('forkMode' in opts).toBe(false);
  });

  it('fork 创建 resume 损伤不降级（防静默丢截断历史）', async () => {
    const { driver, startCalls } = makeOptCapturingDriver('claude');
    // start 抛 resume 损伤形态错误 → 旧逻辑会清 resume fresh 重建一次（两次 start）；
    // fork 创建必须原样上抛（首次 start 已记录，无第二次重建调用）。
    (driver.start as ReturnType<typeof vi.fn>).mockImplementation(
      async (input: AsyncIterable<UserTurnInput>, opts: unknown) => {
        startCalls.push({ input, opts: opts as Record<string, unknown> });
        throw new Error('No conversation found to resume');
      },
    );
    const sm = new SessionManager({ drivers: { claude: driver }, ...makeSmDeps() }, {});
    await expect(
      sm.create({
        ...smBaseInput,
        provider: 'claude',
        resume: 'src-sess',
        resumeAtUuid: 'u-1',
        forkSession: true,
        forkMode: 'resume_at',
      }),
    ).rejects.toThrow(/No conversation found/);
    expect(startCalls).toHaveLength(1);
  });

  it('firstPrompt 为空（native fork B）不挂 10s 空消息兜底——首轮由用户首问 inject 驱动（24h 审查 H-2）', async () => {
    const { driver } = makeOptCapturingDriver('claude');
    const sm = new SessionManager({ drivers: { claude: driver }, ...makeSmDeps() }, {});
    // native fork：lease metadata prompt=""（backend create 对 fork 豁免空首句，
    // 且空载荷 SESSION_INJECT 已不再下发）。挂 10s 兜底会在超时后 push 空用户
    // 消息（claude 档空串仍发送），污染 B 的首轮——空串无信息量，不挂即等 inject。
    await sm.create({
      ...smBaseInput,
      sessionId: 'sess-fork-empty-first',
      firstPrompt: '',
      provider: 'claude',
      resume: 'src-sdk-sess-empty',
      forkSession: true,
      forkMode: 'resume_at',
    });
    expect(sm._pendingFirstPrompt.has('sess-fork-empty-first')).toBe(false);
    // inject 消费路径对缺键天然 no-op（turn-control get→undefined），B 等用户
    // 首问经 SESSION_INJECT 正常驱动。

    // 对照：非空首句仍挂兜底（零回归）；测试内清 timer 防悬挂。
    await sm.create({
      ...smBaseInput,
      sessionId: 'sess-fork-nonempty-first',
      provider: 'claude',
    });
    expect(sm._pendingFirstPrompt.has('sess-fork-nonempty-first')).toBe(true);
    const pending = sm._pendingFirstPrompt.get('sess-fork-nonempty-first');
    if (pending) clearTimeout(pending.timer);
  });
});

// ── C. claude-sdk-driver：options 透传 + engineAnchor 补挂 ──────────────────

describe('session-fork task-06：claude driver fork options（D-008）', () => {
  it('resumeSessionAt+forkSession 透传 SDK options；resumeDropsTurn 键不得出现（禁传断言）', async () => {
    const driver = new ClaudeSdkDriver();
    async function* src(): AsyncGenerator<UserTurnInput, void> {}
    await driver.start(src, {
      pathToClaudeCodeExecutable: process.execPath, // 真实存在的非 wrapper 路径
      cwd: '/tmp',
      resume: 'src-sdk-sess-001',
      resumeAtUuid: 'u-9019fe24',
      forkSession: true,
    } as Parameters<ClaudeSdkDriver['start']>[1]);
    expect(mockQuery).toHaveBeenCalledTimes(1);
    const options = (mockQuery.mock.calls[0]![0] as {
      options: Record<string, unknown>;
    }).options;
    expect(options['resume']).toBe('src-sdk-sess-001');
    expect(options['resumeSessionAt']).toBe('u-9019fe24');
    expect(options['forkSession']).toBe(true);
    // D-008 v1 实现约束：options 对象自始至终不出现 resumeDropsTurn 键——
    // CLI 2.1.216 不支持该旗标，undefined 也会序列化成 null 硬崩进程。
    expect('resumeDropsTurn' in options).toBe(false);
    expect((options as Record<string, unknown>)['resumeDropsTurn']).toBeUndefined();
  });

  it('consume：assistant 帧 raw 顶层 uuid → 事件 metadata.engineAnchor 补挂（D-011）；无 uuid 帧不挂', async () => {
    const driver = new ClaudeSdkDriver();
    const events: AgentEvent[] = [];
    async function* gen(): AsyncGenerator<Record<string, unknown>, void> {
      yield {
        type: 'assistant',
        uuid: 'u-anchor-1',
        message: { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
        parent_tool_use_id: null,
        session_id: 'sess',
      };
      // user 帧（tool_result 载体形态，流式 uuid 恒无——spike 实测）→ 不挂锚。
      yield {
        type: 'user',
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] },
        parent_tool_use_id: null,
        session_id: 'sess',
      };
      yield {
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'done',
        session_id: 'sess',
        usage: { input_tokens: 1, output_tokens: 1 },
      } as unknown as Record<string, unknown>;
    }
    const fakeQuery = { [Symbol.asyncIterator]: () => gen() } as never;
    const handle = {
      provider: 'claude',
      query: fakeQuery,
      close: () => {},
    } as unknown as ClaudeDriverHandle;
    const callbacks: InteractiveDriverCallbacks = {
      onTurnMessage: (envelope) => {
        for (const ev of envelope.events) events.push(ev);
      },
    };
    await driver.consume(handle, callbacks);
    const anchored = events.filter(
      (ev) => ev.type === 'text' && ev.metadata?.['engineAnchor'] === 'u-anchor-1',
    );
    expect(anchored.length).toBeGreaterThan(0);
    // 无 uuid 的 user 帧事件不携带 engineAnchor 键（错值比 NULL 糟，D-008）。
    const userDerived = events.filter((ev) => ev.type === 'tool_result');
    for (const ev of userDerived) {
      expect(ev.metadata?.['engineAnchor']).toBeUndefined();
    }
  });
});

// ── D. pi-rpc-driver：fork 前置两态 + engineAnchor 补挂 ─────────────────────

function piSpawnCalls(): FakeChild[] {
  return vi.mocked(spawn).mock.results.map((r) => r.value as FakeChild);
}

async function waitSpawnCount(n: number): Promise<void> {
  await waitFor(() => vi.mocked(spawn).mock.calls.length >= n);
}

async function makePiDriver(): Promise<PiRpcDriver> {
  tmpSessionDir = await mkdtemp(join(tmpdir(), 'pi-fork-test-'));
  // pi 用例专属：spawn → FakeChild（覆盖 beforeEach 的真实 spawn 默认）。
  vi.mocked(spawn).mockImplementation(() => createFakeChild() as never);
  return new PiRpcDriver({
    sessionDir: tmpSessionDir,
    requestTimeoutMs: 3000,
    handshakeTimeoutMs: 3000,
  });
}

function piInputQueue(): AsyncIterable<UserTurnInput> {
  async function* gen(): AsyncGenerator<UserTurnInput, void> {}
  return gen();
}

describe('session-fork task-06：pi fork 前置（D-008/D-012 短命 RPC 预 fork）', () => {
  it('rpc_fork：temp RPC 发 {type:"fork",entryId} → B 以新分支文件 --session 启动，temp 进程回收', async () => {
    const driver = await makePiDriver();
    const startPromise = driver.start(piInputQueue(), {
      cwd: '/tmp/pi-ws',
      pathToAgentExecutable: '/usr/local/bin/pi',
      resume: 'src-pi-sess-001',
      forkMode: 'rpc_fork',
      forkAnchorEntryId: 'ent-308df55d',
    });
    await waitSpawnCount(1);
    const temp = piSpawnCalls()[0]!;
    // 1. temp 握手 get_state（源会话加载确认）。
    await respondWhen(temp, 'get_state', {
      data: { sessionId: 'src-pi-sess-001', sessionFile: '/sd/src.jsonl', isStreaming: false },
    });
    // 2. fork 命令形态断言（rpc.md:613-639：wire 参数只有 entryId）。
    const forkReq = await respondWhen(temp, 'fork', {
      data: { text: '被截去的用户消息原文', cancelled: false },
    });
    expect(forkReq['type']).toBe('fork');
    expect(forkReq['entryId']).toBe('ent-308df55d');
    expect(typeof forkReq['id']).toBe('string');
    // 3. fork 后 get_state 读新分支会话文件。
    await respondWhen(temp, 'get_state', {
      data: { sessionId: 'branch-1', sessionFile: '/sd/branch-1.jsonl', isStreaming: false },
    });
    await startPromise;
    // 4. temp 进程被回收（短命）。
    expect(temp.killed).toBe(true);
    // 5. B 以新分支文件启动（第二个 spawn），非源会话文件。
    await waitSpawnCount(2);
    const mainArgs = vi.mocked(spawn).mock.calls[1]![1] as string[];
    expect(mainArgs).toContain('--mode');
    expect(mainArgs).toContain('rpc');
    expect(mainArgs[mainArgs.indexOf('--session') + 1]).toBe('/sd/branch-1.jsonl');
    // temp spawn 参数：--session 指向源会话（预 fork 加载源）。
    const tempArgs = vi.mocked(spawn).mock.calls[0]![1] as string[];
    expect(tempArgs[tempArgs.indexOf('--session') + 1]).toBe('src-pi-sess-001');
  });

  it('clone：temp RPC 发 {type:"clone"}（无 entryId，全量复制）→ B 以新文件启动', async () => {
    const driver = await makePiDriver();
    const startPromise = driver.start(piInputQueue(), {
      cwd: '/tmp/pi-ws',
      pathToAgentExecutable: '/usr/local/bin/pi',
      resume: 'src-pi-sess-002',
      forkMode: 'clone',
    });
    await waitSpawnCount(1);
    const temp = piSpawnCalls()[0]!;
    await respondWhen(temp, 'get_state', {
      data: { sessionId: 'src-pi-sess-002', sessionFile: '/sd/src2.jsonl', isStreaming: false },
    });
    const cloneReq = await respondWhen(temp, 'clone', {
      data: { cancelled: false },
    });
    expect(cloneReq['type']).toBe('clone');
    expect('entryId' in cloneReq).toBe(false);
    await respondWhen(temp, 'get_state', {
      data: { sessionId: 'branch-2', sessionFile: '/sd/branch-2.jsonl', isStreaming: false },
    });
    await startPromise;
    await waitSpawnCount(2);
    const mainArgs = vi.mocked(spawn).mock.calls[1]![1] as string[];
    expect(mainArgs[mainArgs.indexOf('--session') + 1]).toBe('/sd/branch-2.jsonl');
  });

  it('rpc_fork 缺 resume → start 拒绝（fail 会话，不静默降级）', async () => {
    const driver = await makePiDriver();
    await expect(
      driver.start(piInputQueue(), {
        cwd: '/tmp/pi-ws',
        pathToAgentExecutable: '/usr/local/bin/pi',
        forkMode: 'rpc_fork',
        forkAnchorEntryId: 'ent-x',
      }),
    ).rejects.toThrow(/requires source session/);
  });

  it('fork 被 pi 拒绝（success:false）→ start 原样上抛（create 失败 → run failed）', async () => {
    const driver = await makePiDriver();
    const startPromise = driver.start(piInputQueue(), {
      cwd: '/tmp/pi-ws',
      pathToAgentExecutable: '/usr/local/bin/pi',
      resume: 'src-pi-sess-003',
      forkMode: 'rpc_fork',
      forkAnchorEntryId: 'ent-bad',
    });
    await waitSpawnCount(1);
    const temp = piSpawnCalls()[0]!;
    await respondWhen(temp, 'get_state', {
      data: { sessionId: 'src-pi-sess-003', sessionFile: '/sd/src3.jsonl', isStreaming: false },
    });
    await respondWhen(temp, 'fork', { success: false, error: 'Invalid entry ID for forking' });
    await expect(startPromise).rejects.toThrow(/Invalid entry ID for forking/);
    // 失败路径 temp 进程同样被回收（finally close）。
    expect(temp.killed).toBe(true);
  });
});

/** 可控 input queue（push/close；单订阅语义对齐真实 InputQueue，pi-rpc-driver.test.ts 同款）。 */
function makeInputQueue(): {
  queue: AsyncIterable<UserTurnInput>;
  close: () => void;
} {
  const pending: UserTurnInput[] = [];
  let closed = false;
  let waiter: (() => void) | null = null;
  const queue: AsyncIterable<UserTurnInput> = {
    [Symbol.asyncIterator]() {
      return {
        async next(): Promise<IteratorResult<UserTurnInput>> {
          if (pending.length > 0) return { value: pending.shift()!, done: false };
          if (closed) return { value: undefined, done: true };
          await new Promise<void>((resolve) => {
            waiter = resolve;
          });
          waiter = null;
          if (pending.length > 0) return { value: pending.shift()!, done: false };
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    queue,
    close() {
      closed = true;
      if (waiter) waiter();
    },
  };
}

describe('session-fork task-06：pi engineAnchor 补挂（D-011）', () => {
  it('轮首 user message_end → get_fork_messages 回查 entryId → 后续内容事件 metadata.engineAnchor', async () => {
    const driver = await makePiDriver();
    const input = makeInputQueue();
    const startPromise = driver.start(input.queue, {
      cwd: '/tmp/pi-ws',
      pathToAgentExecutable: '/usr/local/bin/pi',
    });
    await waitSpawnCount(1);
    const child = piSpawnCalls()[0]!;
    const handle = (await startPromise) as unknown as PiRpcHandle;
    const events: AgentEvent[] = [];
    const callbacks: InteractiveDriverCallbacks = {
      onTurnMessage: (envelope) => {
        for (const ev of envelope.events) events.push(ev);
      },
    };
    const consumePromise = driver.consume(handle, callbacks);
    await waitFor(() => readStdinJson(child).some((l) => l.type === 'get_state'));
    // 握手。
    respond(child, 'get_state', {
      data: { sessionId: 'sess-anchor', sessionFile: '/sd/a.jsonl', isStreaming: false },
    });
    await sleep(60);
    // 推一轮：agent_start → 轮首 user 消息（wire 帧无 entryId）→ 驱动回查命令。
    emitEvent(child, { type: 'agent_start' });
    emitEvent(child, {
      type: 'message_end',
      message: { role: 'user', content: [{ type: 'text', text: 'Q1' }] },
    });
    const lookup = await respondWhen(child, 'get_fork_messages', {
      data: { messages: [{ entryId: 'ent-Q1', text: 'Q1' }] },
    });
    expect(lookup['type']).toBe('get_fork_messages');
    // 回查响应经 stdout data 事件异步落地（pending resolve → then 写 turnUserEntryId），
    // 让一拍再推后续帧，锚对 A1 事件的补挂才是确定性的。
    await sleep(80);
    // 回查落地后，assistant 收尾全文事件应带轮锚。
    emitEvent(child, {
      type: 'message_end',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'A1' }],
        stopReason: 'stop',
      },
    });
    emitEvent(child, { type: 'turn_end', message: { stopReason: 'stop' } });
    emitEvent(child, { type: 'agent_settled' });
    await waitFor(() =>
      events.some((ev) => ev.type === 'text' && ev.override === true && ev.content === 'A1'),
    );
    const anchored = events.filter(
      (ev) => ev.type === 'text' && ev.content === 'A1' && ev.metadata?.['engineAnchor'] === 'ent-Q1',
    );
    expect(anchored.length).toBeGreaterThan(0);
    // 回查前先到的事件不伪造锚（有锚也只能是回查命中的值）。
    for (const ev of events) {
      if (ev.metadata?.['engineAnchor'] !== undefined) {
        expect(ev.metadata['engineAnchor']).toBe('ent-Q1');
      }
    }
    // 收尾：关输入队列让 consume 自然退出（finally 自会 close handle）。
    input.close();
    await consumePromise.catch(() => undefined);
  });
});
