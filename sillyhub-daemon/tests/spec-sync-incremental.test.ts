// tests/spec-sync-incremental.test.ts
// task-08（change 2026-08-13-platform-managed-file-sync）：postSpecSync 增量 diff 行为测试。
//
// 覆盖（design §7 / D-001/D-004/D-005/D-006 / R-03/R-05）：
//   - 首同步（无缓存）走旧 tar client.postSpecSync + 写本地清单缓存
//   - 有缓存：新增→add / 修改→update / 删除→delete / 同 hash 异路径→rename（不重传内容）
//   - op 带 per-file base_version（缓存 version；无缓存 0）
//   - .runtime(有点)/runtime(无点)/worktrees 排除（D-006）
//   - 缓存路径在 ~/.sillyhub/daemon/manifests/{ws}.json（移出 specDir，BL-4/R-03）
//   - 增量 404/失败 → 回退旧 tar；conflict=true → 抛 SpecPushConflict（NFR-02）
//   - new_versions 回写缓存 version
//
// mock 模式：vi.mock('node:os') 把 homedir 指向每测试独立临时根（隔离 manifest 缓存 +
// specDir），参照 spec-transport-tar-sync/spec-sync.test.ts。

import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-spec-sync-incr-home'),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});

// spec-sync 在 homedir mock 就位后 import。
const { postSpecSync, resolveManifestCachePath, SpecPushConflict } =
  await import('../src/spec-sync.js');

// ── helpers ───────────────────────────────────────────────────────────────────

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function makeClient(overrides: {
  postSpecSync?: ReturnType<typeof vi.fn>;
  postSpecSyncIncremental?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    postSpecSync: overrides.postSpecSync ?? vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
    postSpecSyncIncremental:
      overrides.postSpecSyncIncremental ??
      vi.fn().mockResolvedValue({
        ok: true,
        new_versions: {},
        conflict: false,
        server_versions: null,
      }),
  } as never;
}

/** 手工写本地清单缓存（替代首同步写入，直接 seed 指定状态）。 */
async function seedCache(wsId: string, files: Record<string, { hash: string; version: number; mtime: number }>) {
  const p = resolveManifestCachePath(wsId);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ version: 1, files }) + '\n', 'utf-8');
}

/** 写 specDir 文件（自动 mkdir 父目录）。 */
function write(relPath: string, content: string): void {
  const abs = join(scratchDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

let scratchDir: string;

// ── 套件 ──────────────────────────────────────────────────────────────────────

describe('postSpecSync 增量 diff（task-08 / change 2026-08-13-platform-managed-file-sync）', () => {
  let home: string;
  let scratch: string;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'spec-sync-incr-home-'));
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-incr-scratch-'));
    scratchDir = scratch;
    hoisted.homedirMock.mockReturnValue(home);
  });

  afterEach(() => {
    hoisted.homedirMock.mockReset();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it('首同步（无缓存）→ 走旧 tar client.postSpecSync + 写缓存', async () => {
    const wsId = 'ws-first';
    write('docs/a.md', '# A');
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 1 });
    const client = makeClient({ postSpecSync: postSpy });

    const r = await postSpecSync(client as never, wsId, scratch);

    expect(r).toEqual({ ok: true, reparsed: 1 });
    expect(postSpy).toHaveBeenCalledTimes(1);
    expect(postSpy.mock.calls[0][0]).toBe(wsId);
    expect(Buffer.isBuffer(postSpy.mock.calls[0][1])).toBe(true);
    // 缓存已写（路径在 ~/.sillyhub/daemon/manifests/{ws}.json，移出 specDir）
    expect(existsSync(resolveManifestCachePath(wsId))).toBe(true);
  });

  it('有缓存 + 新增文件 → add op（base_version=0）+ postSpecSyncIncremental', async () => {
    const wsId = 'ws-add';
    await seedCache(wsId, { 'docs/keep.md': { hash: sha256('keep'), version: 3, mtime: 1 } });
    write('docs/keep.md', 'keep'); // 已有，未变
    write('docs/new.md', 'new content'); // 新增

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: { 'docs/new.md': 1 },
      conflict: false,
      server_versions: null,
    });
    const postSpy = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client as never, wsId, scratch);

    expect(r).toEqual({ ok: true, reparsed: 0 });
    expect(incrSpy).toHaveBeenCalledTimes(1);
    expect(postSpy).not.toHaveBeenCalled(); // 增量成功不回退旧 tar
    const ops = incrSpy.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'add', path: 'docs/new.md', base_version: 0 });
    expect(ops[0].hash).toBe(sha256('new content'));
  });

  it('有缓存 + 修改文件 → update op（base_version=缓存 version）+ 重传 content', async () => {
    const wsId = 'ws-upd';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 5, mtime: 1 } });
    write('docs/a.md', 'v2'); // 内容变

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: { 'docs/a.md': 6 },
      conflict: false,
      server_versions: null,
    });
    const client = makeClient({ postSpecSyncIncremental: incrSpy });

    await postSpecSync(client as never, wsId, scratch);

    const ops = incrSpy.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'update', path: 'docs/a.md', base_version: 5 });
    expect(ops[0].hash).toBe(sha256('v2'));
    // content 是 base64（update 需重传内容）
    expect(Buffer.from(String(ops[0].content), 'base64').toString('utf-8')).toBe('v2');
  });

  it('有缓存 + 删除文件 → delete op（base_version=缓存 version）', async () => {
    const wsId = 'ws-del';
    await seedCache(wsId, {
      'docs/gone.md': { hash: sha256('gone'), version: 2, mtime: 1 },
      'docs/stay.md': { hash: sha256('stay'), version: 1, mtime: 1 },
    });
    write('docs/stay.md', 'stay'); // 本地保留
    // gone.md 本地已删

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: {},
      conflict: false,
      server_versions: null,
    });
    const client = makeClient({ postSpecSyncIncremental: incrSpy });

    await postSpecSync(client as never, wsId, scratch);

    const ops = incrSpy.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({ op: 'delete', path: 'docs/gone.md', base_version: 2 });
  });

  it('同 hash 异路径 → rename op（不重传 content）+ 只发 rename 不重复 add/delete', async () => {
    const wsId = 'ws-rename';
    await seedCache(wsId, { 'docs/old.md': { hash: sha256('same'), version: 4, mtime: 1 } });
    write('docs/new.md', 'same'); // 新路径同内容，旧路径消失

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: { 'docs/new.md': 5 },
      conflict: false,
      server_versions: null,
    });
    const client = makeClient({ postSpecSyncIncremental: incrSpy });

    await postSpecSync(client as never, wsId, scratch);

    const ops = incrSpy.mock.calls[0][1] as Array<Record<string, unknown>>;
    expect(ops).toHaveLength(1);
    expect(ops[0]).toMatchObject({
      op: 'rename',
      path: 'docs/old.md',
      new_path: 'docs/new.md',
      base_version: 4,
    });
    // rename 不重传内容
    expect(ops[0].content).toBeUndefined();
  });

  it('.runtime(有点)/runtime(无点)/worktrees 排除（D-006）→ 不产生 op', async () => {
    const wsId = 'ws-runtime';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('a'), version: 1, mtime: 1 } });
    write('docs/a.md', 'a');
    write('.runtime/cache.log', 'runtime');
    write('runtime/scan-run.txt', 'nope');
    write('.runtime/worktrees/wt/f.txt', 'x');

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: {},
      conflict: false,
      server_versions: null,
    });
    const client = makeClient({ postSpecSyncIncremental: incrSpy });

    // 本地相对缓存无变化（.runtime 等被排除）→ 不发请求
    const r = await postSpecSync(client as never, wsId, scratch);
    expect(r).toEqual({ ok: true, reparsed: 0 });
    expect(incrSpy).not.toHaveBeenCalled();
  });

  it('缓存路径在 ~/.sillyhub/daemon/manifests/{ws}.json（移出 specDir）', () => {
    const wsId = 'ws-loc';
    expect(resolveManifestCachePath(wsId)).toBe(
      join(home, '.sillyhub', 'daemon', 'manifests', `${wsId}.json`),
    );
  });

  it('增量 404（旧后端无端点）→ 回退旧 tar client.postSpecSync', async () => {
    const wsId = 'ws-404';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 1, mtime: 1 } });
    write('docs/a.md', 'v2'); // 有变化 → 会尝试增量

    const incrSpy = vi.fn().mockRejectedValue(fakeHttpErr(404));
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client as never, wsId, scratch);

    expect(r).toEqual({ ok: true, reparsed: 0 });
    expect(incrSpy).toHaveBeenCalledTimes(1); // 先试增量
    expect(postSpy).toHaveBeenCalledTimes(1); // 再回退旧 tar
    expect(Buffer.isBuffer(postSpy.mock.calls[0][1])).toBe(true);
  });

  it('增量网络失败（5xx）→ 回退旧 tar（不阻塞）', async () => {
    const wsId = 'ws-5xx';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 1, mtime: 1 } });
    write('docs/a.md', 'v2');

    const incrSpy = vi.fn().mockRejectedValue(fakeHttpErr(500, 'boom'));
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client as never, wsId, scratch);
    expect(r).toEqual({ ok: true, reparsed: 0 });
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('client 无 postSpecSyncIncremental（旧 mock/旧客户端）→ 回退旧 tar', async () => {
    const wsId = 'ws-nomethod';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 1, mtime: 1 } });
    write('docs/a.md', 'v2');

    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client = { postSpecSync: postSpy } as never; // 无 postSpecSyncIncremental

    const r = await postSpecSync(client as never, wsId, scratch);
    expect(r).toEqual({ ok: true, reparsed: 0 });
    expect(postSpy).toHaveBeenCalledTimes(1);
  });

  it('conflict=true → 抛 SpecPushConflict（不静默覆盖，NFR-02）', async () => {
    const wsId = 'ws-conflict';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 1, mtime: 1 } });
    write('docs/a.md', 'v2');

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: {},
      conflict: true,
      server_versions: { 'docs/a.md': 9 },
    });
    const postSpy = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    await expect(postSpecSync(client as never, wsId, scratch)).rejects.toBeInstanceOf(
      SpecPushConflict,
    );
    // conflict 不回退旧 tar（人工拍板）
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('new_versions 回写缓存 version（下次 diff 用新 version 作 base_version）', async () => {
    const wsId = 'ws-rev';
    await seedCache(wsId, { 'docs/a.md': { hash: sha256('v1'), version: 1, mtime: 1 } });
    write('docs/a.md', 'v2');

    const incrSpy = vi.fn().mockResolvedValue({
      ok: true,
      new_versions: { 'docs/a.md': 2 },
      conflict: false,
      server_versions: null,
    });
    const client = makeClient({ postSpecSyncIncremental: incrSpy });

    await postSpecSync(client as never, wsId, scratch);

    // 读回缓存：version 已更新为 2
    const cached = JSON.parse(readFileSync(resolveManifestCachePath(wsId), 'utf-8')) as {
      files: Record<string, { hash: string; version: number; mtime: number }>;
    };
    expect(cached.files['docs/a.md'].version).toBe(2);
    expect(cached.files['docs/a.md'].hash).toBe(sha256('v2'));
  });
});

/** 构造 HubHttpError 形状错误（status 属性够 duck-type 判 404/5xx）。 */
function fakeHttpErr(status: number, message = 'boom'): { status: number; message: string } {
  return { status, message };
}
