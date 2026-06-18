// tests/task-09-spec-pull-push.test.ts
// task-09 / D-006@v1：TaskRunner runLease 的 spec bundle pull + sync push。
//
// 对照蓝图 task-09.md §8 第 2/3 步测试骨架 + AC-04~AC-14。
// 触发条件（§4.3）：ctx.workspaceId 非空 && ctx.specRoot 为空（execution-context 对
// daemon-client 透传空 spec_root）→ 调 HubClient.getSpecBundle → 解包到
// ~/.sillyhub/daemon/specs/{wsId} → agent 执行 → 整树打包 → HubClient.postSpecSync。
// server-local（无 workspaceId 或 specRoot 非空）→ 跳过，零回归（design §9 关键不变式）。
//
// 策略：
//   - mock node:os.homedir 固定 spec_dir 父目录，断言解包目标路径正确。
//   - mock HubClient 的 getSpecBundle / postSpecSync（vi.fn）。
//   - 真实写 tar 文件到 os.tmpdir() 临时目录（手工 ustar 实现 + round-trip 验证）。
//   - 用 createFakeChild 驱动 runLease 编排链；waitForNextSpawn 显式等 spawn 调用增加
//     （spec pull 是 async，spawn 比 prepareWorkspace 晚一拍，waitForSpawn 在并发测试池
//     下不可靠，会立即返回导致 exit emit 早于 spawn → 死锁）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── hoisted mocks ────────────────────────────────────────────────────────────
// node:os.homedir 必须在 task-runner import 前替换。
// vi.hoisted 工厂不能有副作用（mkdtempSync 在 ESM 顶层时序问题），先 hoist 占位容器，
// 在模块顶层赋值真实 dir 与 mock 实现。
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-task09-home'),
  fakeHomeDir: '/nonexistent-task09-home' as string,
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return {
    ...actual,
    homedir: hoisted.homedirMock,
  };
});

// 模块顶层初始化真实临时 home 目录（vi.mock 已 hoist，homedirMock 此时是占位；
// 下行赋值后真正指向 fakeHomeDir。TaskRunner 等模块 import 在更下方，调用 homedir()
// 时已是真实路径）。
const fakeHomeDir: string = mkdtempSync(join(tmpdir(), 'sillyhub-task09-home-'));
hoisted.fakeHomeDir = fakeHomeDir;
hoisted.homedirMock.mockImplementation(() => fakeHomeDir);

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { TaskRunner } from '../src/task-runner.js';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

function defaultMockAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    provider: 'claude',
    parse: vi.fn((line: string): AgentEvent[] | null => {
      if (line.startsWith('hello') || line.includes('"text"')) {
        return [{ type: 'text', content: line.startsWith('hello') ? line : 'parsed' }];
      }
      return null;
    }),
    buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    ...overrides,
  };
}

/**
 * task-09 用鸭子类型访问 workspaceId / specRoot（task-07 未合并到 types.ts）。
 * 用 LooseLeaseCtx 绕过 TS 类型检查。
 */
interface LooseLeaseCtx extends LeaseCtx {
  workspaceId?: string;
  specRoot?: string;
}

function makeLease(overrides: Partial<LooseLeaseCtx> = {}): LooseLeaseCtx {
  return {
    leaseId: 'lease-task09',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

interface SpecClient {
  startLease: ReturnType<typeof vi.fn>;
  submitMessages: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  leaseHeartbeat?: ReturnType<typeof vi.fn>;
  getSpecBundle: ReturnType<typeof vi.fn>;
  postSpecSync: ReturnType<typeof vi.fn>;
}

function makeMockClient(overrides: Partial<SpecClient> = {}): SpecClient {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({}),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    getSpecBundle: vi.fn().mockResolvedValue(Buffer.alloc(0)),
    postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    ...overrides,
  };
}

function makeMockWorkspace(): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/task09'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/ws/task09'),
  };
}

function makeMockCred(): Record<string, unknown> {
  return { get: vi.fn(() => undefined), buildEnv: vi.fn().mockReturnValue({}) };
}

function makeNoRetryConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://localhost:8000',
    token: null,
    runtime_id: 'rt-test',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 0,
    ...overrides,
  };
}

function setupRunner(opts: {
  client?: SpecClient;
  adapter?: Record<string, unknown>;
  config?: DaemonConfig;
}): {
  runner: TaskRunner;
  client: SpecClient;
} {
  const client = opts.client ?? makeMockClient();
  const workspace = makeMockWorkspace();
  const cred = makeMockCred();
  mockAdapter = opts.adapter ?? defaultMockAdapter();
  const config = opts.config ?? makeNoRetryConfig();
  const runner = new TaskRunner(client as never, workspace as never, cred as never, config);
  return { runner, client };
}

function mockSpawnReturn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child as never);
}

/**
 * 等到 spawn 被调用一次（calls 数量 > baseline）。
 * spec pull 是 async（fetch + tar 解包），spawn 比 prepareWorkspace 晚一拍；
 * helpers/fake-child.waitForSpawn 检查 calls>0，但若前序测试已调过 spawn 且
 * clearAllMocks 时序有 race（forks 池下观察到），会立即返回导致 exit emit 早于 spawn
 * → 死锁。本 helper 显式等 calls 增加，对单/多 lease 都稳健。
 */
async function waitForNextSpawn(baseline = 0): Promise<void> {
  for (let i = 0; i < 2000; i++) {
    if (vi.mocked(spawn).mock.calls.length > baseline) {
      // 多让一拍让 listener 注册完成（对齐 waitForSpawn 行为）
      await new Promise<void>((r) => setImmediate(r));
      return;
    }
    await new Promise<void>((r) => setImmediate(r));
  }
  // 超时兜底
  await new Promise<void>((r) => setImmediate(r));
}

/** 构造一个最小合法 tar Buffer（手工 ustar），含给定文件。 */
function buildTar(entries: { name: string; content: string | Buffer; isDir?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(e.name, 0, 'utf-8');
    header.write('0000644', 100, 'ascii'); header[107] = 0;
    header.write('0000000', 108, 'ascii'); header[115] = 0;
    header.write('0000000', 116, 'ascii'); header[123] = 0;
    const content = typeof e.content === 'string' ? Buffer.from(e.content, 'utf-8') : e.content;
    const size = e.isDir ? 0 : content.length;
    const sizeBuf = Buffer.alloc(12, 0x20); // 11 octal + NUL
    sizeBuf.write(size.toString(8).padStart(11, '0') + '\0', 0, 'ascii');
    header.set(sizeBuf, 124);
    const mtimeBuf = Buffer.alloc(12, 0x20);
    mtimeBuf.write('00000000000\0', 0, 'ascii');
    header.set(mtimeBuf, 136);
    // chksum 暂填 8 个空格
    header.write('        ', 148, 'ascii');
    // typeflag
    header[156] = e.isDir ? 0x35 : 0x30;
    // magic + version
    header.write('ustar', 257, 'ascii'); header[262] = 0;
    header.write('00', 263, 'ascii');

    // checksum：其余字段就位后按 unsigned byte sum（chksum 字段视为 8 空格）
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

    chunks.push(header);
    if (!e.isDir && size > 0) {
      chunks.push(content);
      const padLen = (512 - (size % 512)) % 512;
      if (padLen > 0) chunks.push(Buffer.alloc(padLen, 0));
    }
  }
  // 结尾 2×512 zero block
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

/** 解析 tar Buffer，返回所有 entry name（去掉结尾 /）。 */
function parseTarEntryNames(tarBuf: Buffer): string[] {
  const names: string[] = [];
  let off = 0;
  while (off + 512 <= tarBuf.length) {
    const hdr = tarBuf.subarray(off, off + 512);
    if (hdr.every((b) => b === 0)) break;
    const nul = hdr.indexOf(0, 0);
    const name = hdr.subarray(0, nul < 0 ? 100 : nul).toString('utf-8').replace(/\/$/, '');
    const sizeOct = hdr.subarray(124, 136).toString('ascii').replace(/\0.*$/, '').trim();
    const size = sizeOct ? parseInt(sizeOct, 8) : 0;
    if (name) names.push(name);
    off += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter = defaultMockAdapter();
  vi.mocked(spawn).mockReturnValue(null as never);
});
afterEach(() => {
  vi.useRealTimers();
});

// ── 1. _pullSpecBundle 触发条件 ──────────────────────────────────────────────

describe('task-09 pull 触发条件', () => {
  it('ctx 无 workspaceId → 不调 getSpecBundle（server-local 兼容）', async () => {
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-no-ws', workspaceId: undefined }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(client.getSpecBundle).not.toHaveBeenCalled();
    expect(client.postSpecSync).not.toHaveBeenCalled();
    expect(result.success).toBe(true);
  });

  it('ctx.specRoot 非空 → 跳过 pull（execution-context 已带 spec_root）', async () => {
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(
      makeLease({ leaseId: 'lease-has-root', workspaceId: 'ws-has-root', specRoot: '/some/path' }),
    );
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });

  it('client 未实现 getSpecBundle（旧 mock）→ 不抛错，跳过 pull', async () => {
    // 故意构造缺 getSpecBundle 的 client（鸭子类型守卫）
    const clientNoSpec = {
      startLease: vi.fn().mockResolvedValue({}),
      submitMessages: vi.fn().mockResolvedValue({}),
      completeLease: vi.fn().mockResolvedValue({}),
      leaseHeartbeat: vi.fn().mockResolvedValue({}),
      // 无 getSpecBundle / postSpecSync
    };
    const { runner } = setupRunner({ client: clientNoSpec as never });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-no-method', workspaceId: 'ws-no-method' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });
});

// ── 2. pull 解包路径 + 触发 getSpecBundle ────────────────────────────────────

describe('task-09 pull 解包到 ~/.sillyhub/daemon/specs/{wsId}', () => {
  it('ctx.workspaceId 非空 + specRoot 空 → 调 getSpecBundle + 解包到 spec_dir', async () => {
    const tarBuf = buildTar([
      { name: 'README.md', content: '# spec' },
      { name: 'docs/a.md', content: 'doc a' },
    ]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-pull-happy', workspaceId: 'ws-pull-happy' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(client.getSpecBundle).toHaveBeenCalledWith('ws-pull-happy');
    const specDir = join(fakeHomeDir, '.sillyhub', 'daemon', 'specs', 'ws-pull-happy');
    expect(existsSync(join(specDir, 'README.md'))).toBe(true);
    expect(readFileSync(join(specDir, 'README.md'), 'utf-8')).toBe('# spec');
    expect(existsSync(join(specDir, 'docs', 'a.md'))).toBe(true);
    expect(readFileSync(join(specDir, 'docs', 'a.md'), 'utf-8')).toBe('doc a');
  });

  it('spec_dir 已存在旧文件 → pull 后旧文件清空、新文件就位（rm -rf + 解包）', async () => {
    const specDir = join(fakeHomeDir, '.sillyhub', 'daemon', 'specs', 'ws-overwrite');
    mkdirSync(join(specDir, 'oldsub'), { recursive: true });
    writeFileSync(join(specDir, 'OLD.md'), 'stale');
    writeFileSync(join(specDir, 'oldsub', 'x.md'), 'stale');

    const tarBuf = buildTar([{ name: 'NEW.md', content: 'fresh' }]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-ow', workspaceId: 'ws-overwrite' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(existsSync(join(specDir, 'OLD.md'))).toBe(false);
    expect(existsSync(join(specDir, 'oldsub'))).toBe(false);
    expect(existsSync(join(specDir, 'NEW.md'))).toBe(true);
  });

  it('tar 含 ../ 路径穿越 entry → 抛错被 catch，agent 仍 success', async () => {
    const tarBuf = buildTar([{ name: '../evil.txt', content: 'pwn' }]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-trav', workspaceId: 'ws-trav' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    // pull 失败被 catch → 仅 warn，agent 仍正常
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    // evil 文件未解到 spec_dir 之外
    expect(existsSync(join(fakeHomeDir, 'evil.txt'))).toBe(false);
  });

  it('tar 含绝对路径 entry（/etc/x）→ 抛错被 catch', async () => {
    const tarBuf = buildTar([{ name: '/etc/evil.txt', content: 'pwn' }]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-abs', workspaceId: 'ws-abs' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    // spec_dir 应未创建任何文件（或仅空目录）
    const specDir = join(fakeHomeDir, '.sillyhub', 'daemon', 'specs', 'ws-abs');
    expect(existsSync(join(specDir, 'etc', 'evil.txt'))).toBe(false);
  });

  it('getSpecBundle 抛 HubHttpError(404) → runLease 仍 success（不阻塞）', async () => {
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockRejectedValue(new Error('HTTP 404 GET .../bundle')),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-404', workspaceId: 'ws-404' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    // pull 失败 → push 不应触发（specRoot=null）
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });
});

// ── 3. push 收尾（specRoot 非空时触发 postSpecSync）──────────────────────────

describe('task-09 push 收尾', () => {
  it('pull 成功 → collectDiff 之后调 postSpecSync（整树打包回传）', async () => {
    const tarBuf = buildTar([{ name: 'a.md', content: 'spec-a' }]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 2 }),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-push', workspaceId: 'ws-push' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(client.postSpecSync).toHaveBeenCalledOnce();
    const [wsId, syncBuf] = client.postSpecSync.mock.calls[0]!;
    expect(wsId).toBe('ws-push');
    expect(Buffer.isBuffer(syncBuf)).toBe(true);
    // sync 返回的 tar 应能被服务器解出 a.md（round-trip 验证）
    expect(syncBuf.length).toBeGreaterThan(1024); // 至少结尾 zero block
  });

  it('server-local（specRoot=null）→ postSpecSync 未调用', async () => {
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-nopush-srv', workspaceId: undefined }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('client 未实现 postSpecSync → 跳过 push，不抛错', async () => {
    const tarBuf = buildTar([{ name: 'a.md', content: 'x' }]);
    const clientNoPush: SpecClient = {
      startLease: vi.fn().mockResolvedValue({}),
      submitMessages: vi.fn().mockResolvedValue({}),
      completeLease: vi.fn().mockResolvedValue({}),
      leaseHeartbeat: vi.fn().mockResolvedValue({}),
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
      // 无 postSpecSync
    };
    const { runner } = setupRunner({ client: clientNoPush });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-nopush', workspaceId: 'ws-nopush' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
  });

  it('postSpecSync 抛错（413）→ runLease 仍按 agent 结果 _finish（不被改写为 failed）', async () => {
    const tarBuf = buildTar([{ name: 'a.md', content: 'x' }]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(tarBuf),
      postSpecSync: vi.fn().mockRejectedValue(new Error('HTTP 413 POST .../sync')),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-413', workspaceId: 'ws-413' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    // agent exit=0 → success=true，sync 失败不影响
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(client.postSpecSync).toHaveBeenCalledOnce();
  });

  it('_packSpecDir 排除 .runtime 子目录（tar 内无 .runtime 路径）', async () => {
    // 通过 pull 把"原始 tar"解出来（含 .runtime/），然后断言 push 时打包的 tar 不含 .runtime
    const sourceTar = buildTar([
      { name: 'doc.md', content: 'd' },
      { name: '.runtime/', content: '', isDir: true },
      { name: '.runtime/state.json', content: '{"x":1}' },
      { name: 'sub/.runtime/', content: '', isDir: true },
      { name: 'sub/.runtime/cache', content: 'c' },
    ]);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(sourceTar),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-rt', workspaceId: 'ws-rt' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(client.postSpecSync).toHaveBeenCalledOnce();
    const syncBuf = client.postSpecSync.mock.calls[0]![1] as Buffer;
    const names = parseTarEntryNames(syncBuf);
    // 不含任何 .runtime 段
    const runtimeHits = names.filter((n) => n.split(/[\\/]/).includes('.runtime'));
    expect(runtimeHits).toEqual([]);
    // 正常文件保留
    expect(names).toContain('doc.md');
  });
});

// ── 4. tar round-trip：pull 解包后 push 打包 tar 内含全部文件（字段一致）─────

describe('task-09 pack/extract round-trip', () => {
  it('复杂文件树 pull → extract → pack：子目录 / 二进制 / 空文件', async () => {
    // 第一轮：sourceTar 含复杂树 → pull 解包到 spec_dir → push 打包整树。
    // 断言：(1) spec_dir 内文件内容与 source 一致（解包正确）；
    //       (2) push 的 tarBuf 解析出的 entry name 集合与 source 一致（打包正确）。
    // 这样单 lease 即可覆盖 round-trip（避免多 lease spawn 时序问题）。
    const sourceEntries = [
      { name: 'top.md', content: 'top content' },
      { name: 'sub/a.md', content: 'a content' },
      { name: 'sub/deep/bin.bin', content: Buffer.from([0, 1, 2, 3, 255, 0xfe]) },
      { name: 'sub/deep/empty.txt', content: '' },
    ];
    const sourceTar = buildTar(sourceEntries);
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(sourceTar),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-roundtrip', workspaceId: 'ws-roundtrip-x' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    await p;

    // (1) spec_dir 文件内容与 source 一致
    const rtDir = join(fakeHomeDir, '.sillyhub', 'daemon', 'specs', 'ws-roundtrip-x');
    expect(readFileSync(join(rtDir, 'top.md'), 'utf-8')).toBe('top content');
    expect(readFileSync(join(rtDir, 'sub', 'a.md'), 'utf-8')).toBe('a content');
    expect(Array.from(readFileSync(join(rtDir, 'sub', 'deep', 'bin.bin')))).toEqual([0, 1, 2, 3, 255, 0xfe]);
    expect(statSync(join(rtDir, 'sub', 'deep', 'empty.txt')).size).toBe(0);

    // (2) push 打包的 tar 内 entry 集合与 source 一致（含子目录路径）
    expect(client.postSpecSync).toHaveBeenCalledOnce();
    const syncBuf = client.postSpecSync.mock.calls[0]![1] as Buffer;
    const names = parseTarEntryNames(syncBuf);
    for (const e of sourceEntries) {
      expect(names).toContain(e.name);
    }
  });
});

// ── 5. _resolveSpecDir 路径注入防护 ───────────────────────────────────────────

describe('task-09 _resolveSpecDir 路径注入防护', () => {
  it('wsId 含 / → pull 抛错被 catch（agent 仍 success）', async () => {
    const client = makeMockClient({
      getSpecBundle: vi.fn().mockResolvedValue(buildTar([])),
    });
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-slash', workspaceId: 'a/b' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    // getSpecBundle 不会被调（_resolveSpecDir 在 getSpecBundle 之前）
    expect(client.getSpecBundle).not.toHaveBeenCalled();
    // 未在 home 之外创建目录
    expect(existsSync(join(fakeHomeDir, '.sillyhub', 'daemon', 'specs', 'a'))).toBe(false);
  });

  it('wsId 含 \\ → pull 抛错被 catch', async () => {
    const client = makeMockClient();
    const { runner } = setupRunner({ client });
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const p = runner.runLease(makeLease({ leaseId: 'lease-bslash', workspaceId: 'a\\b' }));
    await waitForNextSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.success).toBe(true);
    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });
});
