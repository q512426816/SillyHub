// tests/spec-pull-swap.test.ts
// ql-20260904-016（会话首响优化）：pullSpecBundle 的 tmp 目录解包 + 原子交换语义单测。
//
//   - 首次拉取：文件就位，无 tmp/trash 残留
//   - 覆盖镜像语义：旧缓存中不在新 bundle 的文件消失（交换后整目录顶替）
//   - 坏 tar（路径穿越）：抛错且**旧缓存完好**（新能力：原 rm 先行实现会打成残缺）
//   - trash 后台异步清理：交换后旧目录最终被清掉（轮询等待）
//   - specDir 为符号链接残留：链接被移除替换为真目录，链接目标内容不被误删
//   - 并行写正确性：多文件内容逐一一致（worker pool 无串数据）
//   - 空 tar：specDir 仍创建（空目录），交换不因零 entry 失败
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。
// homedir 必须在 spec-sync import 前替换（resolveSpecDir → daemonStateDir → homedir）。

import { describe, it, expect, vi, beforeAll } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, rmSync } from 'node:fs';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-spec-pull-swap-home'),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'spec-pull-swap-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

import { pullSpecBundle, resolveSpecDir } from '../src/spec-sync.js';

/** 构造最小合法 ustar tar（对齐 task-09-spec-pull-push.test.ts 的 buildTar）。 */
function buildTar(entries: { name: string; content: string | Buffer; isDir?: boolean }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(e.name, 0, 'utf-8');
    header.write('0000644', 100, 'ascii');
    header[107] = 0;
    header.write('0000000', 108, 'ascii');
    header[115] = 0;
    header.write('0000000', 116, 'ascii');
    header[123] = 0;
    const content = typeof e.content === 'string' ? Buffer.from(e.content, 'utf-8') : e.content;
    const size = e.isDir ? 0 : content.length;
    const sizeBuf = Buffer.alloc(12, 0x20);
    sizeBuf.write(size.toString(8).padStart(11, '0') + '\0', 0, 'ascii');
    header.set(sizeBuf, 124);
    const mtimeBuf = Buffer.alloc(12, 0x20);
    mtimeBuf.write('00000000000\0', 0, 'ascii');
    header.set(mtimeBuf, 136);
    header.write('        ', 148, 'ascii');
    header[156] = e.isDir ? 0x35 : 0x30;
    header.write('ustar', 257, 'ascii');
    header[262] = 0;
    header.write('00', 263, 'ascii');
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
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

/** fake client：getSpecBundle 返回注入 tar；postSpecSync no-op（push_before_pull 容错）。 */
function makeClient(tar: Buffer) {
  return {
    getSpecBundle: vi.fn().mockResolvedValue(tar),
    postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
  };
}

/** specs 根目录（resolveSpecDir 的父目录）。 */
function specsRoot(): string {
  return join(FAKE_HOME, '.sillyhub', 'daemon', 'specs');
}

/** 列出 ${wsId}.tmp-* / .trash-* 残留。 */
async function listScraps(wsId: string): Promise<string[]> {
  const root = specsRoot();
  try {
    const names = await readdir(root);
    return names.filter((n) => n.startsWith(`${wsId}.tmp-`) || n.startsWith(`${wsId}.trash-`));
  } catch {
    return [];
  }
}

/** 轮询等待条件成立（后台 trash 清理是 fire-and-forget，需异步收敛）。 */
async function waitUntil(cond: () => Promise<boolean>, timeoutMs = 5000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await cond()) return true;
    await new Promise((r) => setTimeout(r, 50));
  }
  return await cond();
}

beforeAll(async () => {
  await mkdir(specsRoot(), { recursive: true });
});

describe('pullSpecBundle tmp 交换语义（ql-20260904-016）', () => {
  it('首次拉取：文件就位，无 tmp/trash 残留', async () => {
    const wsId = 'ws-swap-first';
    const tar = buildTar([
      { name: 'docs', isDir: true },
      { name: 'docs/a.md', content: 'hello-spec' },
    ]);
    const specDir = await pullSpecBundle(makeClient(tar) as never, wsId);
    expect(specDir).toBe(resolveSpecDir(wsId));
    expect(await readFile(join(specDir, 'docs', 'a.md'), 'utf-8')).toBe('hello-spec');
    expect(await listScraps(wsId)).toEqual([]);
  });

  it('覆盖镜像语义：旧缓存不在新 bundle 的文件消失（整目录顶替）', async () => {
    const wsId = 'ws-swap-mirror';
    const specDir = resolveSpecDir(wsId);
    // 旧缓存：docs/old.md（带状态文件避免触发 push_before_pull）。
    await mkdir(join(specDir, 'docs'), { recursive: true });
    await writeFile(join(specDir, 'docs', 'old.md'), 'stale');
    await mkdir(join(specDir, '.runtime'), { recursive: true });
    await writeFile(
      join(specDir, '.sillyspec-platform.json'),
      JSON.stringify({ synced_at: new Date().toISOString() }),
    );
    const tar = buildTar([{ name: 'docs/new.md', content: 'fresh' }]);
    await pullSpecBundle(makeClient(tar) as never, wsId);
    expect(existsSync(join(specDir, 'docs', 'new.md'))).toBe(true);
    expect(existsSync(join(specDir, 'docs', 'old.md'))).toBe(false);
  });

  it('坏 tar（路径穿越）：抛错且旧缓存完好，tmp 清理不残留', async () => {
    const wsId = 'ws-swap-badtar';
    const specDir = resolveSpecDir(wsId);
    await mkdir(join(specDir, 'docs'), { recursive: true });
    await writeFile(join(specDir, 'docs', 'keep.md'), 'precious');
    await writeFile(
      join(specDir, '.sillyspec-platform.json'),
      JSON.stringify({ synced_at: new Date().toISOString() }),
    );
    const evilTar = buildTar([{ name: '../escape.txt', content: 'evil' }]);
    await expect(pullSpecBundle(makeClient(evilTar) as never, wsId)).rejects.toThrow(
      /traversal|escapes/,
    );
    // 新能力：解包失败旧缓存原样保留（原 rm 先行实现会打成残缺）。
    expect(await readFile(join(specDir, 'docs', 'keep.md'), 'utf-8')).toBe('precious');
    expect(await listScraps(wsId)).toEqual([]);
  });

  it('trash 后台异步清理：交换后旧目录最终消失', async () => {
    const wsId = 'ws-swap-trash-bg';
    const specDir = resolveSpecDir(wsId);
    await mkdir(join(specDir, 'old'), { recursive: true });
    await writeFile(join(specDir, 'old', 'x.md'), 'x');
    await writeFile(
      join(specDir, '.sillyspec-platform.json'),
      JSON.stringify({ synced_at: new Date().toISOString() }),
    );
    const tar = buildTar([{ name: 'y.md', content: 'y' }]);
    await pullSpecBundle(makeClient(tar) as never, wsId);
    expect(await readFile(join(specDir, 'y.md'), 'utf-8')).toBe('y');
    // 后台 rm trash 是 fire-and-forget：轮询等 tmp/trash 残留清零。
    const cleaned = await waitUntil(async () => (await listScraps(wsId)).length === 0);
    expect(cleaned).toBe(true);
  });

  it('specDir 为符号链接残留：链接被移除替换为真目录，链接目标不被误删', async () => {
    const wsId = 'ws-swap-symlink';
    const specDir = resolveSpecDir(wsId);
    // 链接目标：外部目录带内容（模拟 repo-native junction 残留指向源项目）。
    const linkTarget = join(specsRoot(), 'external-target-dir');
    await mkdir(linkTarget, { recursive: true });
    await writeFile(join(linkTarget, 'source-file.md'), 'source-content');
    // Windows 需 junction/目录符号链接：target 存在时 symlink('junction') 可用。
    await symlink(linkTarget, specDir, 'junction').catch(async () => {
      await symlink(linkTarget, specDir, 'dir');
    });
    const tar = buildTar([{ name: 'pulled.md', content: 'pulled' }]);
    await pullSpecBundle(makeClient(tar) as never, wsId);
    // specDir 现在是真目录（拉取内容就位）。
    expect(await readFile(join(specDir, 'pulled.md'), 'utf-8')).toBe('pulled');
    // 链接目标未被 trash 清理误删。
    expect(await readFile(join(linkTarget, 'source-file.md'), 'utf-8')).toBe('source-content');
  });

  it('并行写正确性：60 文件内容逐一一致', async () => {
    const wsId = 'ws-swap-parallel';
    const entries = Array.from({ length: 60 }, (_, i) => ({
      name: `docs/f${i}.md`,
      content: `content-${i}-${'x'.repeat(i)}`,
    }));
    const tar = buildTar(entries);
    const specDir = await pullSpecBundle(makeClient(tar) as never, wsId);
    for (let i = 0; i < 60; i++) {
      expect(await readFile(join(specDir, 'docs', `f${i}.md`), 'utf-8')).toBe(
        `content-${i}-${'x'.repeat(i)}`,
      );
    }
  });

  it('空 tar（零 entry）：specDir 仍创建为空目录', async () => {
    const wsId = 'ws-swap-empty-tar';
    const tar = buildTar([]);
    const specDir = await pullSpecBundle(makeClient(tar) as never, wsId);
    const names = await readdir(specDir);
    expect(names).toEqual([]);
    expect(await listScraps(wsId)).toEqual([]);
  });

  it('getSpecBundle 404 → 容错建空目录（原语义保留）', async () => {
    const wsId = 'ws-swap-404';
    const client = {
      getSpecBundle: vi.fn().mockRejectedValue(
        Object.assign(new Error('HTTP 404'), { status: 404 }),
      ),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true }),
    };
    const specDir = await pullSpecBundle(client as never, wsId);
    expect(existsSync(specDir)).toBe(true);
  });
});

// 测试后清理 FAKE_HOME（进程退出前 best-effort，防 tmpdir 残留堆积）。
process.on('exit', () => {
  try {
    rmSync(FAKE_HOME, { recursive: true, force: true });
  } catch {
    /* best-effort：tmpdir 由系统回收 */
  }
});
