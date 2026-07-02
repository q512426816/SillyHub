// tests/task-13-spec-sync.test.ts
// 2026-07-02-workspace-config-flow task-13 / D-012：TaskRunner.runChangeWrite
// kind=spec-sync 分支单测。
//
// 覆盖：
//   1. kind=spec-sync → 不写 changes/<key>/，调 postSpecSync 整树回灌，complete(ok=true, files=[])。
//   2. postSpecSync 抛错 → 回执 ok=false + 向上抛（_executeChangeWrite 兜底回执）。
//   3. kind 缺省（create/edit）→ 走原 change-write 写文件路径（回归守卫）。
//   4. FR-10：不调 spawn / getBackend（kind=spec-sync 同样不启 agent）。
//
// 测试策略：复用 task-11-change-write.test 的 mock 范式（vi.mock spec-sync.js）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hoisted = vi.hoisted(() => {
  const state = { specRoot: '' };
  const postSpecSyncSpy = vi.fn<
    (client: unknown, wsId: string, specRoot: string) => Promise<{ ok: boolean; reparsed: number } | null>
  >(async () => ({ ok: true, reparsed: 3 }));
  const syncSpy = vi.fn(async () => undefined);
  const spawnSpy = vi.fn(() => null as unknown);
  const getBackendSpy = vi.fn(() => ({ provider: 'claude' }));
  const resolveSpecDirSpy = vi.fn((_wsId: string) => state.specRoot);
  return { state, postSpecSyncSpy, syncSpy, spawnSpy, getBackendSpy, resolveSpecDirSpy };
});

vi.mock('../src/spec-sync.js', () => ({
  resolveSpecDir: hoisted.resolveSpecDirSpy,
  pullSpecBundle: vi.fn(async () => null),
  postSpecSync: hoisted.postSpecSyncSpy,
  syncSpecTreeIfNeeded: hoisted.syncSpy,
}));

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return { ...actual, spawn: hoisted.spawnSpy };
});
vi.mock('../src/adapters/index.js', () => ({ getBackend: hoisted.getBackendSpy }));

import { TaskRunner, type ChangeWriteCtx } from '../src/task-runner.js';

function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({}),
    completeLease: vi.fn().mockResolvedValue({}),
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
  return new TaskRunner(client as never, workspace as never, cred as never, undefined);
}

function makeCtx(overrides: Partial<ChangeWriteCtx> = {}): ChangeWriteCtx {
  return {
    taskId: 'cw-spec-1',
    changeKey: 'spec-sync',
    workspaceId: 'ws-1',
    claimToken: 'tok-abc',
    files: [{ path: 'workspace_id.json', content: '{"workspace_id":"ws-1"}' }],
    ...overrides,
  };
}

describe('task-13 runChangeWrite kind=spec-sync', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'spec-sync-'));
    hoisted.state.specRoot = tmpRoot;
    hoisted.postSpecSyncSpy.mockClear();
    hoisted.postSpecSyncSpy.mockResolvedValue({ ok: true, reparsed: 3 });
    hoisted.syncSpy.mockClear();
    hoisted.spawnSpy.mockClear();
    hoisted.getBackendSpy.mockClear();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true }).catch(() => undefined);
  });

  it('spec-sync: calls postSpecSync整树回灌, completes ok=true files=[], no changes/<key>/ write', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({ kind: 'spec-sync' });

    const res = await runner.runChangeWrite(ctx);

    // postSpecSync 被调（整树回灌）
    expect(hoisted.postSpecSyncSpy).toHaveBeenCalledTimes(1);
    // 入参：client + workspaceId + specRoot（resolveSpecDir 返回的 tmpRoot）
    const callArgs = hoisted.postSpecSyncSpy.mock.calls[0];
    expect(callArgs?.[1]).toBe('ws-1');
    expect(callArgs?.[2]).toBe(tmpRoot);

    // complete 回执 ok=true, files=[]
    expect(client.completeChangeWrite).toHaveBeenCalledWith('cw-spec-1', 'tok-abc', {
      ok: true,
      files: [],
    });

    // 不触发 change-write 专用 sync（spec-sync 用 postSpecSync 而非 syncSpecTreeIfNeeded）
    expect(hoisted.syncSpy).not.toHaveBeenCalled();

    // 返回值
    expect(res.ok).toBe(true);
    expect(res.files).toEqual([]);

    // 不写 changes/<key>/ 文件（spec-sync 跳过文件写入）
    const { stat } = await import('node:fs/promises');
    await expect(stat(join(tmpRoot, 'changes', 'spec-sync'))).rejects.toThrow();
  });

  it('spec-sync: postSpecSync failure reports ok=false and rethrows', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    hoisted.postSpecSyncSpy.mockRejectedValueOnce(new Error('HTTP 500 sync failed'));

    await expect(runner.runChangeWrite(makeCtx({ kind: 'spec-sync' }))).rejects.toThrow(
      /HTTP 500 sync failed/,
    );

    // 回执 ok=false
    expect(client.completeChangeWrite).toHaveBeenCalledWith(
      'cw-spec-1',
      'tok-abc',
      expect.objectContaining({ ok: false, error: expect.stringContaining('HTTP 500') }),
    );
  });

  it('FR-10: spec-sync does NOT spawn agent / call getBackend', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);

    await runner.runChangeWrite(makeCtx({ kind: 'spec-sync' }));

    expect(hoisted.spawnSpy).not.toHaveBeenCalled();
    expect(hoisted.getBackendSpy).not.toHaveBeenCalled();
    expect(client.startLease).not.toHaveBeenCalled();
    expect(client.submitMessages).not.toHaveBeenCalled();
  });

  it('kind default (create) still writes changes/<key>/ files (regression guard)', async () => {
    const client = makeMockClient();
    const runner = makeRunner(client);
    const ctx = makeCtx({
      kind: 'create',
      changeKey: '2026-07-02-demo',
      files: [{ path: 'proposal.md', content: '# hi\n' }],
    });

    await runner.runChangeWrite(ctx);

    // 不调 postSpecSync（create 走原路径）
    expect(hoisted.postSpecSyncSpy).not.toHaveBeenCalled();
    // 写了文件 + 触发 syncSpecTreeIfNeeded
    expect(hoisted.syncSpy).toHaveBeenCalledTimes(1);
    // 文件落地
    const { readFile } = await import('node:fs/promises');
    const f = await readFile(join(tmpRoot, 'changes', '2026-07-02-demo', 'proposal.md'), 'utf-8');
    expect(f).toBe('# hi\n');
  });
});
