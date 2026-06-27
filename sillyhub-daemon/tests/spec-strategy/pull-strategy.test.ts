// sillyhub-daemon/tests/spec-strategy/pull-strategy.test.ts
// task-13（2026-06-28-daemon-client-spec-sync-strategy）：pullSpecBundle 按 strategy
// 三分支初始化缓存测试。覆盖 platform-managed 回归 / repo-mirrored 单次 fs.cp /
// repo-native junction / rm 防误删（R-01）/ 源项目不存在降级。
//
// 隔离：vi.mock('node:os') 把 homedir 指向临时目录，pullSpecBundle 的 fs 操作全部
// 作用在 tmpdir 下，安全可清理。client.getSpecBundle 用 vi.fn mock。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, readdir, readlink, lstat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// homedir 指向每个测试的临时根，隔离 ~/.sillyhub/daemon/specs/{ws}
let tmpRoot: string;
vi.mock('node:os', async () => {
  const actual = await vi.importActual<typeof import('node:os')>('node:os');
  return { ...actual, homedir: () => tmpRoot };
});

// 被测模块在 mock 之后导入（ESM top-level await 保证 mock 生效）
const { pullSpecBundle, resolveSpecDir } = await import('../../src/spec-sync');

// 真实 platform 由被测代码读 process.platform；junction 分支在 win32 用 'junction'，
// 其他平台用 symlink。本测试在任意平台验证 junction/symlink 建立逻辑（lstat.isSymbolicLink
// 对 Win junction 与 POSIX symlink 均为 true）。

function makeClient(opts: { bundle?: Buffer | (() => Buffer); status?: number }) {
  const getSpecBundle = vi.fn(async () => {
    if (opts.status && opts.status !== 200) {
      throw Object.assign(new Error('http'), { status: opts.status });
    }
    return opts.bundle ? (typeof opts.bundle === 'function' ? opts.bundle() : opts.bundle) : Buffer.alloc(0);
  });
  return { getSpecBundle, postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })) } as never;
}

describe('pullSpecBundle strategy 三分支', () => {
  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'spec-strategy-'));
  });
  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('platform-managed（缺省）：getSpecBundle 404 → mkdir 空目录（现状回归）', async () => {
    const client = makeClient({ status: 404 });
    const specDir = await pullSpecBundle(client, 'ws-pm');
    expect(specDir).toBe(resolveSpecDir('ws-pm'));
    // 空目录已创建
    const entries = await readdir(specDir!);
    expect(entries.length).toBe(0);
    expect(client.getSpecBundle).toHaveBeenCalledWith('ws-pm');
  });

  it('repo-mirrored：缓存空 + 源项目有 .sillyspec → fs.cp 单次复制', async () => {
    // 准备源项目 .sillyspec（含一个文件）
    const src = join(tmpRoot, 'project');
    await mkdir(join(src, '.sillyspec', 'docs'), { recursive: true });
    await writeFile(join(src, '.sillyspec', 'docs', 'a.md'), '# hello');
    const client = makeClient({ status: 200 }); // backend 有 bundle 也不应走（首次缓存空优先复制）
    const specDir = await pullSpecBundle(client, 'ws-mirror', {
      strategy: 'repo-mirrored',
      rootPath: src,
    });
    expect(specDir).toBe(resolveSpecDir('ws-mirror'));
    // 复制成功：缓存含源项目文件
    const copied = await readdir(join(specDir!, 'docs'));
    expect(copied).toContain('a.md');
    // 不污染源项目（源文件仍在）
    const srcStill = await readdir(join(src, '.sillyspec', 'docs'));
    expect(srcStill).toContain('a.md');
  });

  it('repo-native：源项目有 .sillyspec → 建 junction，跳过 getSpecBundle 覆盖', async () => {
    const src = join(tmpRoot, 'project-native');
    await mkdir(join(src, '.sillyspec', 'docs'), { recursive: true });
    await writeFile(join(src, '.sillyspec', 'docs', 'native.md'), '# native');
    const getSpecBundle = vi.fn();
    const client = { getSpecBundle, postSpecSync: vi.fn() } as never;

    const specDir = await pullSpecBundle(client, 'ws-native', {
      strategy: 'repo-native',
      rootPath: src,
    });
    expect(specDir).toBe(resolveSpecDir('ws-native'));
    // 不拉 bundle（D-005：跳过覆盖）
    expect(getSpecBundle).not.toHaveBeenCalled();
    // junction 已建：lstat 是符号链接
    const lst = await lstat(specDir!);
    expect(lst.isSymbolicLink()).toBe(true);
    // junction 指向源项目 .sillyspec
    const target = await readlink(specDir!);
    expect(target).toContain('.sillyspec');
  });

  it('R-01 rm 防误删：repo-native 不调 rm 删除源项目内容', async () => {
    const src = join(tmpRoot, 'project-protect');
    await mkdir(join(src, '.sillyspec', 'docs'), { recursive: true });
    await writeFile(join(src, '.sillyspec', 'docs', 'keep.md'), '# keep');
    const client = { getSpecBundle: vi.fn(), postSpecSync: vi.fn() } as never;

    await pullSpecBundle(client, 'ws-protect', {
      strategy: 'repo-native',
      rootPath: src,
    });
    // 源项目内容未被删除（rm 防误删守卫）
    const still = await readdir(join(src, '.sillyspec', 'docs'));
    expect(still).toContain('keep.md');
  });

  it('repo-native 源项目无 .sillyspec → 降级（不阻塞，走 pull 或空目录）', async () => {
    const src = join(tmpRoot, 'project-empty'); // 无 .sillyspec
    await mkdir(src, { recursive: true });
    const client = makeClient({ status: 404 }); // backend 也无 bundle
    const specDir = await pullSpecBundle(client, 'ws-fallback', {
      strategy: 'repo-native',
      rootPath: src,
    });
    expect(specDir).toBe(resolveSpecDir('ws-fallback'));
    // 降级后建空目录（404 容错），不抛错
    expect(specDir).not.toBeNull();
  });
});
