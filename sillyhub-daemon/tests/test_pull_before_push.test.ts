// tests/test_pull_before_push.ts
// task-12 (2026-07-02-workspace-config-flow) D-008：pullSpecBundle 前回灌本地改动单测。
//
// 验收（task-12.md）：
//   - 本地有未回灌改动时 pull 前先 push（mock pending_push 标记）。
//   - 回灌失败不覆盖本地（保留本地改动）。
//
// 注：TaskCard allowed_path 指定文件名 tests/test_pull_before_push.ts（非 .test.ts 后缀），
// vitest `run <explicit-path>` 显式传文件路径时不受 include glob（tests/**/*.test.ts）约束。
// vitest.config.ts: globals=false → 显式 import；environment=node。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  pullSpecBundle,
  resolveSpecDir,
  hasUnsyncedLocalChanges,
  SpecPushBeforePullError,
} from '../src/spec-sync.js';

/** mock client：getSpecBundle 返回预置 tar，postSpecSync 可配 reject/resolve。 */
function makeClient(overrides: {
  bundle?: Buffer;
  getSpecBundle?: ReturnType<typeof vi.fn>;
  postSpecSync?: ReturnType<typeof vi.fn>;
} = {}) {
  return {
    getSpecBundle:
      overrides.getSpecBundle ??
      vi.fn().mockResolvedValue(overrides.bundle ?? Buffer.alloc(0)),
    postSpecSync:
      overrides.postSpecSync ??
      vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
  } as never;
}

/** 构造最小合法 ustar tar（对齐 spec-pull-swap.test.ts 的 buildTar）。 */
function buildTar(entries: { name: string; content: string | Buffer }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(e.name, 0, 'utf-8');
    header.write('0000644', 100, 'ascii');
    const content = typeof e.content === 'string' ? Buffer.from(e.content, 'utf-8') : e.content;
    const sizeBuf = Buffer.alloc(12, 0x20);
    sizeBuf.write(content.length.toString(8).padStart(11, '0') + '\0', 0, 'ascii');
    header.set(sizeBuf, 124);
    header.write('        ', 148, 'ascii');
    header[156] = 0x30;
    header.write('ustar', 257, 'ascii');
    header.write('00', 263, 'ascii');
    let sum = 0;
    for (let i = 0; i < 512; i++) sum += header[i];
    header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
    chunks.push(header);
    chunks.push(content);
    const padLen = (512 - (content.length % 512)) % 512;
    if (padLen > 0) chunks.push(Buffer.alloc(padLen, 0));
  }
  chunks.push(Buffer.alloc(1024, 0));
  return Buffer.concat(chunks);
}

/**
 * 用临时 homedir 覆盖 resolveSpecDir 输出：vi.mock node:os 的 homedir 让 spec 落到 tmp。
 *
 * vitest 的 vi.mock 提升到文件顶部执行；这里改用 monkey-patch process.env / 直接传 specDir
 * 走 unsyncedChecker 注入更直接。本套件不依赖 homedir，pullSpecBundle 的 specDir 由
 * resolveSpecDir(homedir)/.../specs/<wsId> 决定——为隔离副作用，测试用 unsyncedChecker
 * 注入判定（task-12 的可注入设计），并断言 specDir 出现在 checker 入参。
 */

describe('pullSpecBundle D-008: push before pull (task-12)', () => {
  let tmpHome: string;

  beforeEach(async () => {
    // 真实 specDir 落在临时 homedir，避免污染本机 ~/.sillyhub。
    tmpHome = await mkdtemp(join(tmpdir(), 'pull-before-push-home-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome; // Windows
  });

  afterEach(async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('本地有未回灌改动（pending_push 标记）→ pull 前先调 postSpecSync 回灌', async () => {
    const wsId = 'ws-pending-push-trigger';
    const specDir = resolveSpecDir(wsId);
    // 预置本地 spec 目录 + .runtime/pending_push 标记
    await mkdir(join(specDir, 'docs'), { recursive: true });
    await writeFile(join(specDir, 'docs', 'index.md'), '# local change');
    await mkdir(join(specDir, '.runtime'), { recursive: true });
    await writeFile(join(specDir, '.runtime', 'pending_push'), '');

    const postSpecSync = vi.fn().mockResolvedValue({ ok: true, reparsed: 1 });
    const client = makeClient({ postSpecSync });

    await pullSpecBundle(client, wsId, {
      // 显式用默认判定器（验证真实 pending_push 标记路径）
      unsyncedChecker: hasUnsyncedLocalChanges,
    });

    // postSpecSync 在 getSpecBundle 之前被调（回灌优先）。ql-20260909-002：checker
    // 现在评估两次（pull 起点 + swap 前），但真实回灌成功即清 pending_push 标记，
    // swap 前检查恒干净 → client.postSpecSync 仅 1 次（防重复推送的既定语义）。
    expect(postSpecSync).toHaveBeenCalledTimes(1);
    expect(postSpecSync).toHaveBeenCalledWith(wsId, expect.any(Buffer), undefined);
    expect(client.getSpecBundle).toHaveBeenCalled();
  });

  it('回灌失败 → abort pull（getSpecBundle 不被调），保留本地改动', async () => {
    const wsId = 'ws-push-fail-abort';
    const specDir = resolveSpecDir(wsId);
    await mkdir(join(specDir, 'docs'), { recursive: true });
    await writeFile(join(specDir, 'docs', 'local.md'), 'must survive');
    await mkdir(join(specDir, '.runtime'), { recursive: true });
    await writeFile(join(specDir, '.runtime', 'pending_push'), '');

    const postSpecSync = vi.fn().mockRejectedValue(new Error('backend 500'));
    const getSpecBundle = vi.fn();
    const client = makeClient({ getSpecBundle, postSpecSync });

    // pullSpecBundle 应抛 SpecPushBeforePullError，不调 getSpecBundle（不覆盖本地）
    await expect(
      pullSpecBundle(client, wsId, { unsyncedChecker: hasUnsyncedLocalChanges }),
    ).rejects.toMatchObject({ name: 'SpecPushBeforePullError' });

    expect(getSpecBundle).not.toHaveBeenCalled();
    expect(postSpecSync).toHaveBeenCalledTimes(1);

    // 本地改动仍在（未 rm/未覆盖）
    const survived = await readFile(join(specDir, 'docs', 'local.md'), 'utf-8');
    expect(survived).toBe('must survive');
  });

  it('无未回灌改动 → 不调 postSpecSync，直接 pull（兼容旧行为）', async () => {
    const wsId = 'ws-clean-pull';
    // 不预置本地 spec / 不写 pending_push → 默认判定器返回 false
    const postSpecSync = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client = makeClient({ postSpecSync });

    await pullSpecBundle(client, wsId, {
      unsyncedChecker: hasUnsyncedLocalChanges,
    });

    // 本地无内容 → 默认判定器返回 false → 不回灌；getSpecBundle 走 404 容错分支（空 buf）
    expect(postSpecSync).not.toHaveBeenCalled();
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
  });

  it('注入 unsyncedChecker=true + postSpecSync 成功 → 回灌后继续 pull（双步骤都跑）', async () => {
    const wsId = 'ws-injected-checker';
    const postSpecSync = vi.fn().mockResolvedValue({ ok: true, reparsed: 2 });
    const client = makeClient({ postSpecSync });

    // checker 抛错应被吞（保守不阻塞 pull）—— 此例返回 true 验证注入生效
    const checker = vi.fn().mockResolvedValue(true);

    await pullSpecBundle(client, wsId, { unsyncedChecker: checker });

    // ql-20260909-002：checker 评估两次（pull 起点 + swap 前）。注入恒 true 时第二次
    // 回灌仍执行，但真实 postSpecSync 走增量 diff——首推后清单已写、无新变化 →
    // ops=0 不发网络请求（幂等），client.postSpecSync 仅 1 次。
    expect(checker).toHaveBeenCalledTimes(2);
    expect(postSpecSync).toHaveBeenCalledTimes(1);
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1);
  });

  it('unsyncedChecker 抛错 → 不阻塞 pull（保守，宁可多拉不中断）', async () => {
    const wsId = 'ws-checker-throw';
    const postSpecSync = vi.fn();
    const client = makeClient({ postSpecSync });
    const checker = vi.fn().mockRejectedValue(new Error('stat boom'));

    await pullSpecBundle(client, wsId, { unsyncedChecker: checker });

    // ql-20260909-002：两处检查都吞掉判定器异常，pull 照常
    expect(checker).toHaveBeenCalledTimes(2);
    expect(postSpecSync).not.toHaveBeenCalled(); // 检测失败不触发回灌
    expect(client.getSpecBundle).toHaveBeenCalledTimes(1); // 但 pull 继续
  });
});

describe('ql-20260909-002: swap 前二次回灌（下载窗口内在途写入保护）', () => {
  let tmpHome: string;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'preswap-push-home-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome; // Windows
  });

  afterEach(async () => {
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    await rm(tmpHome, { recursive: true, force: true });
  });

  it('pull 起点干净、下载窗口内新写入（第二次检查 dirty）→ swap 前回灌后照常交换', async () => {
    const wsId = 'ws-preswap-push';
    const specDir = resolveSpecDir(wsId);
    // 模拟：起点无未回灌改动；getSpecBundle 下载期间 agent 写入 spec → swap 前变 dirty
    const checker = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const postSpecSync = vi.fn().mockResolvedValue({ ok: true, reparsed: 1 });
    const tar = buildTar([{ name: 'docs/from-server.md', content: 'server' }]);
    const client = makeClient({ bundle: tar, postSpecSync });

    const out = await pullSpecBundle(client, wsId, { unsyncedChecker: checker });

    expect(out).toBe(specDir);
    expect(checker).toHaveBeenCalledTimes(2);
    expect(postSpecSync).toHaveBeenCalledTimes(1); // 仅 swap 前那次（窗口内写入回灌留底）
    expect(postSpecSync).toHaveBeenCalledWith(wsId, expect.any(Buffer), undefined);
    expect(await readFile(join(specDir, 'docs', 'from-server.md'), 'utf-8')).toBe('server'); // 交换落地
  });

  it('swap 前回灌失败 → abort（SpecPushBeforePullError），本地改动保留、不交换', async () => {
    const wsId = 'ws-preswap-push-fail';
    const specDir = resolveSpecDir(wsId);
    await mkdir(join(specDir, 'docs'), { recursive: true });
    await writeFile(join(specDir, 'docs', 'local.md'), 'must survive');
    const checker = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const postSpecSync = vi.fn().mockRejectedValue(new Error('backend 500'));
    const tar = buildTar([{ name: 'docs/from-server.md', content: 'server' }]);
    const client = makeClient({ bundle: tar, postSpecSync });

    await expect(
      pullSpecBundle(client, wsId, { unsyncedChecker: checker }),
    ).rejects.toMatchObject({ name: 'SpecPushBeforePullError' });

    // 本地改动仍在（未交换/未覆盖），bundle 文件未落地
    expect(await readFile(join(specDir, 'docs', 'local.md'), 'utf-8')).toBe('must survive');
    await expect(readFile(join(specDir, 'docs', 'from-server.md'), 'utf-8')).rejects.toThrow();
  });
});

describe('hasUnsyncedLocalChanges (task-12 默认判定器)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'unsynced-check-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('无 pending_push 且本地空 → false', async () => {
    // 目录存在但空内容
    await mkdir(join(dir, 'empty'), { recursive: true });
    expect(await hasUnsyncedLocalChanges(join(dir, 'empty'))).toBe(false);
  });

  it('pending_push 标记存在 → true', async () => {
    await mkdir(join(dir, '.runtime'), { recursive: true });
    await writeFile(join(dir, '.runtime', 'pending_push'), '');
    expect(await hasUnsyncedLocalChanges(dir)).toBe(true);
  });

  it('有本地内容但无状态文件 → true（首次初始化前手改；D-001@v1）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'a.md'), 'x');
    expect(await hasUnsyncedLocalChanges(dir)).toBe(true);
  });

  it('specDir 不存在 → false（无本地改动可丢）', async () => {
    expect(await hasUnsyncedLocalChanges(join(dir, 'nope-does-not-exist'))).toBe(false);
  });
});

describe('SpecPushBeforePullError (task-12)', () => {
  it('携带 workspaceId / specDir / cause', () => {
    const cause = new Error('backend 500');
    const err = new SpecPushBeforePullError('ws-1', '/tmp/spec', cause);
    expect(err.name).toBe('SpecPushBeforePullError');
    expect(err.workspaceId).toBe('ws-1');
    expect(err.specDir).toBe('/tmp/spec');
    expect((err as { cause?: unknown }).cause).toBe(cause);
    expect(err.message).toContain('ws-1');
  });
});
