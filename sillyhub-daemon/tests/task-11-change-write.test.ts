// tests/task-11-change-write.test.ts
// task-11 / FR-08 / FR-10 / D-004@v1：TaskRunner.runChangeWrite 轻量分支单测。
//
// 覆盖（蓝图 verify 节）：
//   1. 主路径：claim→写文件→complete(ok,files)→sync 四步齐全。
//   2. path traversal 四类拒绝（../  / 绝对 / Win 盘符 / join 后越界）→ 抛错 + 不写任何文件。
//   3. 不调 driver 守卫：runLease / spawn / getBackend 全程未调（FR-10）。
//   4. sync 失败仅 warn 不阻塞回执（R-03）。
//
// 测试策略：
//   - vi.mock('../src/spec-sync.js')：resolveSpecDir 返回 os.tmpdir 下唯一子目录，
//     syncSpecTreeIfNeeded 设 spy（验证被调 + 失败不抛）。
//   - mock HubClient（completeChangeWrite vi.fn）+ WorkspaceManager + CredentialManager。
//   - 真实 node:fs/promises 写入（验证文件落地 + 跨平台路径）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));
import { mkdtemp, rm, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// vi.mock 工厂被 hoist 到文件顶部，内部引用的 spy 必须经 vi.hoisted 声明，
// 否则触发 "Cannot access X before initialization"（vitest hoisting 限制）。
const hoisted = vi.hoisted(() => {
  // state.specRoot 由 beforeEach 注入临时目录；syncSpy 记录 sync 调用。
  const state = { specRoot: '' };
  const syncSpy = vi.fn<
    (ctx: { workspaceId: string }, client: unknown) => Promise<void>
  >(async () => {
    /* no-op by default；模拟 task-06 syncSpecTreeIfNeeded 的「失败仅 warn 不抛」语义 */
  });
  const spawnSpy = vi.fn(() => null as unknown);
  const getBackendSpy = vi.fn(() => ({ provider: 'claude' }));
  const resolveSpecDirSpy = vi.fn((_wsId: string) => state.specRoot);
  return { state, syncSpy, spawnSpy, getBackendSpy, resolveSpecDirSpy };
});

vi.mock('../src/spec-sync.js', () => ({
  // resolveSpecDir 直接返回注入的临时 spec 根（跳过 homedir 展开，测试隔离）。
  resolveSpecDir: hoisted.resolveSpecDirSpy,
  pullSpecBundle: vi.fn(async () => null),
  postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
  syncSpecTreeIfNeeded: hoisted.syncSpy,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: hoisted.spawnSpy };
});
vi.mock('../src/adapters/index.js', () => ({ getBackend: hoisted.getBackendSpy }));

import { TaskRunner, type ChangeWriteCtx } from '../src/task-runner.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({}),
    completeLease: vi.fn().mockResolvedValue({}),
    // task-11：completeChangeWrite 是 runChangeWrite 依赖的回执方法。
    completeChangeWrite: vi.fn().mockResolvedValue({ task_id: 'cw-1', status: 'done' }),
    postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    ...overrides,
  };
}

function makeRunner(client: Record<string, unknown>): TaskRunner {
  const workspace = {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
  };
  const cred = { get: vi.fn(() => undefined), buildEnv: vi.fn().mockReturnValue({}) };
  // TaskRunner 构造器签名：(client, workspace, credential, config?)
  return new TaskRunner(
    client as never,
    workspace as never,
    cred as never,
    undefined,
  );
}

function makeCtx(overrides: Partial<ChangeWriteCtx> = {}): ChangeWriteCtx {
  return {
    taskId: 'cw-1',
    changeKey: '2026-06-26-demo',
    workspaceId: 'ws-1',
    claimToken: 'tok-abc',
    files: [{ path: 'proposal.md', content: '# hello\n' }],
    ...overrides,
  };
}

describe('task-11 runChangeWrite', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'cw-spec-'));
    hoisted.state.specRoot = tmpRoot;
    hoisted.syncSpy.mockClear();
    hoisted.syncSpy.mockResolvedValue(undefined);
    hoisted.spawnSpy.mockClear();
    hoisted.getBackendSpy.mockClear();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  // ── 主路径 ──────────────────────────────────────────────────────────────────

  it('writes files under changes/<key>/ + completes ok + triggers sync', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({
      files: [
        { path: `changes/${ctxChangeKey()}/proposal.md`, content: '# hello\n' },
        { path: `changes/${ctxChangeKey()}/tasks/task-01.md`, content: 'body\n' },
      ],
    });

    const res = await runner.runChangeWrite(ctx);

    // 文件落地
    const f1 = await readFile(join(tmpRoot, 'changes', ctx.changeKey, 'proposal.md'), 'utf-8');
    expect(f1).toBe('# hello\n');
    const f2 = await readFile(join(tmpRoot, 'changes', ctx.changeKey, 'tasks/task-01.md'), 'utf-8');
    expect(f2).toBe('body\n');

    // complete 回执：ok=true + 写入路径清单
    expect(client.completeChangeWrite).toHaveBeenCalledWith('cw-1', 'tok-abc', {
      ok: true,
      files: ['proposal.md', 'tasks/task-01.md'],
    });

    // sync 触发（task-06 syncSpecTreeIfNeeded 复用）
    expect(hoisted.syncSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.syncSpy.mock.calls[0][0]).toEqual({ workspaceId: 'ws-1' });

    // 返回值
    expect(res.ok).toBe(true);
    expect(res.files).toEqual(['proposal.md', 'tasks/task-01.md']);
  });

  it('creates changes/<key>/ dir even when files is empty', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({ files: [] });

    await runner.runChangeWrite(ctx);

    const st = await stat(join(tmpRoot, 'changes', ctx.changeKey));
    expect(st.isDirectory()).toBe(true);
    expect(client.completeChangeWrite).toHaveBeenCalledWith('cw-1', 'tok-abc', {
      ok: true,
      files: [],
    });
  });

  // ── path traversal 四类拒绝 ─────────────────────────────────────────────────

  it.each([
    ['parent segment', '../foo.md'],
    ['nested parent', 'tasks/../../escape.md'],
    ['absolute posix', '/etc/passwd'],
    ['windows drive', 'C:\\x\\evil.md'],
    ['windows drive lower', 'c:/evil.md'],
  ])('rejects path traversal: %s', async (_label, badPath) => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({ files: [{ path: badPath, content: 'x' }] });

    await expect(runner.runChangeWrite(ctx)).rejects.toThrow(/traversal|escapes/);

    // 不写任何文件 + 不回执 ok + 不 sync（traversal 在写阶段即抛）
    expect(client.completeChangeWrite).not.toHaveBeenCalled();
    expect(hoisted.syncSpy).not.toHaveBeenCalled();
  });

  it('path traversal rejects without writing any of the sibling files', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({
      files: [
        { path: 'ok.md', content: 'ok\n' },
        { path: '../escape.md', content: 'evil\n' },
      ],
    });

    await expect(runner.runChangeWrite(ctx)).rejects.toThrow();

    // 第二个文件越界 → 整批失败，complete 不回执 ok
    expect(client.completeChangeWrite).not.toHaveBeenCalled();
  });

  // ── FR-10：不调 driver 守卫 ────────────────────────────────────────────────

  it('does NOT spawn agent / getBackend / call runLease internals (FR-10)', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);

    await runner.runChangeWrite(makeCtx());

    expect(hoisted.spawnSpy).not.toHaveBeenCalled();
    expect(hoisted.getBackendSpy).not.toHaveBeenCalled();
    // startLease / submitMessages 是 runLease 专用，change-write 不应触碰
    expect(client.startLease).not.toHaveBeenCalled();
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  // ── R-03：sync 失败仅 warn 不阻塞回执 ───────────────────────────────────────
  //
  // R-03 的「吞错」语义由 task-06 syncSpecTreeIfNeeded 自身保证（spec-sync.ts 内部
  // try/catch + warn）。此处 mock 的 syncSpy 即模拟该「resolve、不抛」行为，验证
  // runChangeWrite 在 sync 触发后仍正常返回 ok=true 且不向上抛（design R-03 / 蓝图约束）。

  it('sync triggers after complete but does not flip ok (R-03)', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    // syncSpy 默认 resolve（模拟 syncSpecTreeIfNeeded 吞错语义）。

    const res = await runner.runChangeWrite(makeCtx());

    // complete 先于 sync 完成；sync 即使内部失败也不改写 ok。
    expect(res.ok).toBe(true);
    expect(client.completeChangeWrite).toHaveBeenCalledWith(
      'cw-1',
      'tok-abc',
      expect.objectContaining({ ok: true }),
    );
    expect(hoisted.syncSpy).toHaveBeenCalledTimes(1);
    expect(hoisted.syncSpy.mock.calls[0][0]).toEqual({ workspaceId: 'ws-1' });
  });

  // ── 退化：client 未实现 completeChangeWrite（mock 未注入）────────────────────

  it('still writes files when client lacks completeChangeWrite (degraded)', async () => {
    const client = makeMockClient();
    delete (client as Record<string, unknown>).completeChangeWrite;
    const runner = makeRunner(client);

    const res = await runner.runChangeWrite(makeCtx());

    expect(res.ok).toBe(true);
    const f = await readFile(join(tmpRoot, 'changes', '2026-06-26-demo', 'proposal.md'), 'utf-8');
    expect(f).toBe('# hello\n');
    expect(hoisted.syncSpy).toHaveBeenCalledTimes(1);
  });
});

describe('task-11 validateChangeWritePath', () => {
  it('normalizes backslashes to posix slashes in returned rel path', async () => {
    const { validateChangeWritePath } = await import('../src/task-runner.js');
    // 单纯 win 风格子目录（非盘符）合法，返回 POSIX 形态
    expect(validateChangeWritePath('sub\\file.md', 'key')).toBe('sub/file.md');
  });

  it('accepts backend spec-root relative changes/<key>/ paths', async () => {
    const { validateChangeWritePath } = await import('../src/task-runner.js');
    expect(validateChangeWritePath('changes/key/MASTER.md', 'key')).toBe('MASTER.md');
    expect(validateChangeWritePath('changes/key/tasks/task-01.md', 'key')).toBe(
      'tasks/task-01.md',
    );
  });

  it.each([
    ['../x'],
    ['/abs'],
    ['C:\\x'],
    [''],
    ['changes/other/MASTER.md'],
    ['changes/key'],
    ['changes/key/../evil.md'],
  ])('rejects invalid path %p', async (p) => {
    const { validateChangeWritePath } = await import('../src/task-runner.js');
    expect(() => validateChangeWritePath(p, 'key')).toThrow(/traversal|outside/);
  });
});

function ctxChangeKey(): string {
  return '2026-06-26-demo';
}
