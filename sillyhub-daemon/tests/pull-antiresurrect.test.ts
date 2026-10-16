// tests/pull-antiresurrect.test.ts
// 2026-10-16-daemon-pull-antiresurrect：daemon 侧 pullSpecBundle 防复活抑制单测。
//
// 背景（坑 docs/sillyspec/spec-sync-tree-pull-resurrect-and-verify-carry-orphans.md 缺陷一
// daemon 侧移植；CLI 侧同款修复 = sillyspec 仓 da8d2449）：
//   hasUnsyncedLocalChanges 的 mtime/pending_push 信号漏判「纯删除」（删除不产生新 mtime）——
//   「按 spec_version 自动取新」（心跳预取/lease/batch 三入口共用 pullSpecBundle）在删除 op
//   未上行窗口内整树覆盖（swap / in-place 兜底），把已删文件写回=复活。
//
// 覆盖（flow start 成功标准逐条）：
//   1. 抑制核心：LocalManifest 有/盘面无/属同步面 → 解包产物命中文件不落地（不复活）。
//   2. 无基线：manifest 缺失/首拉 → 全量落地（既有行为不变）。
//   3. 恢复通道：opts.restoreDeleted / env SILLYHUB_DAEMON_RESTORE_DELETED=1 → 跳过抑制。
//   4. 排除口径：isUploadExcludedPath 命中的 manifest 残留行（projects/ 等）不进抑制面。
//   5. 窗口内重建保护（2026-10-17-audit-risk-followup）：下载窗口内重建的同名文件
//      不进抑制面（抑制面 pre_swap 后现算）——不删本地、不并回陈旧条目。
//   6. 越界键防线（2026-10-17-audit-risk-followup）：manifest 越界键（../）跳过 rm 并告警。
//
// vitest.config.ts: globals=false → 显式 import；HOME/USERPROFILE 覆盖让 specDir 落 tmp。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import {
  pullSpecBundle,
  applyResurrectSuppress,
  resolveSpecDir,
  resolveManifestCachePath,
} from '../src/spec-sync.js';

/** 最小合法 ustar（对齐 test_pull_before_push.test.ts 的 buildTar）。 */
function buildTar(entries: { name: string; content: string }[]): Buffer {
  const chunks: Buffer[] = [];
  for (const e of entries) {
    const header = Buffer.alloc(512, 0);
    header.write(e.name, 0, 'utf-8');
    header.write('0000644', 100, 'ascii');
    const content = Buffer.from(e.content, 'utf-8');
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

const WS = 'ws-antiresurrect';

/** 种本地清单缓存（模拟「上次成功同步的文件全集」基线）。 */
async function seedManifest(files: string[]): Promise<void> {
  const entries: Record<string, { hash: string; version: number; mtime: number }> = {};
  for (const p of files) entries[p] = { hash: `h-${p}`, version: 1, mtime: 0 };
  await mkdir(dirname(resolveManifestCachePath(WS)), { recursive: true });
  await writeFile(
    resolveManifestCachePath(WS),
    JSON.stringify({ version: 1, files: entries }),
    'utf-8',
  );
}

describe('pullSpecBundle 防复活抑制（2026-10-16-daemon-pull-antiresurrect）', () => {
  let tmpHome: string;
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    tmpHome = await mkdtemp(join(tmpdir(), 'pull-antiresurrect-home-'));
    process.env.HOME = tmpHome;
    process.env.USERPROFILE = tmpHome; // Windows
    delete process.env.SILLYHUB_DAEMON_RESTORE_DELETED;
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(async () => {
    warnSpy.mockRestore();
    delete process.env.HOME;
    delete process.env.USERPROFILE;
    delete process.env.SILLYHUB_DAEMON_RESTORE_DELETED;
    await rm(tmpHome, { recursive: true, force: true });
  });

  /** 盘面预置：specDir 下只留 present 列表里的文件（其余=已删除不在盘面）。 */
  async function seedDisk(present: Record<string, string>): Promise<string> {
    const specDir = resolveSpecDir(WS);
    for (const [rel, content] of Object.entries(present)) {
      await mkdir(dirname(join(specDir, rel)), { recursive: true });
      await writeFile(join(specDir, rel), content, 'utf-8');
    }
    return specDir;
  }

  function makeClient(bundle: Buffer) {
    return {
      getSpecBundle: vi.fn().mockResolvedValue(bundle),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true }),
    } as never;
  }

  it('用例1（核心）：manifest 有/盘面无/同步面 → 解包产物不落地（不复活）+ warn 点名', async () => {
    // 上次同步面含 a.md/b.md；本地删除了 b.md（盘面仅剩 a.md，且 mtime 信号漏判删除——
    // unsyncedChecker 注入 false 即该缺陷场景）；bundle（服务器旧快照）仍携带 b.md。
    const specDir = await seedDisk({ 'docs/a.md': 'local-a' });
    await seedManifest(['docs/a.md', 'docs/b.md']);
    const bundle = buildTar([
      { name: 'docs/a.md', content: 'server-a' },
      { name: 'docs/b.md', content: 'server-b' },
    ]);

    const out = await pullSpecBundle(makeClient(bundle), WS, {
      unsyncedChecker: async () => false,
    });

    expect(out).toBe(specDir);
    // a.md 正常更新；b.md 被抑制不复活。
    expect(await readFile(join(specDir, 'docs/a.md'), 'utf-8')).toBe('server-a');
    await expect(readFile(join(specDir, 'docs/b.md'), 'utf-8')).rejects.toThrow();
    // warn 点名（宁可吵不可静默复活）。
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).toContain('防复活抑制');
    expect(warned).toContain('docs/b.md');
    // 持久性（评审 P2 修复）：落地重建后 manifest 基线仍含被抑制行（delete op 链保活），
    // 第二次自动 pull（bundle 仍携带）依旧抑制——抑制跨 pull 不失效。
    const manifestAfter = JSON.parse(
      await readFile(resolveManifestCachePath(WS), 'utf-8'),
    ) as { files: Record<string, unknown> };
    expect(manifestAfter.files['docs/b.md']).toBeTruthy();
    expect(manifestAfter.files['docs/a.md']).toBeTruthy();
    const bundle2 = buildTar([
      { name: 'docs/a.md', content: 'server-a-2' },
      { name: 'docs/b.md', content: 'server-b-2' },
    ]);
    await pullSpecBundle(makeClient(bundle2), WS, { unsyncedChecker: async () => false });
    expect(await readFile(join(specDir, 'docs/a.md'), 'utf-8')).toBe('server-a-2');
    await expect(readFile(join(specDir, 'docs/b.md'), 'utf-8')).rejects.toThrow();
  });

  it('用例2：manifest 缺失（首拉）= 无抑制面，全量落地（既有行为不变）', async () => {
    // 不种 manifest（首拉）；盘面空。
    const bundle = buildTar([
      { name: 'x.md', content: 'x' },
      { name: 'docs/b.md', content: 'b' },
    ]);

    const specDir = await pullSpecBundle(makeClient(bundle), WS, {
      unsyncedChecker: async () => false,
    });

    expect(specDir).not.toBeNull();
    expect(await readFile(join(specDir as string, 'x.md'), 'utf-8')).toBe('x');
    expect(await readFile(join(specDir as string, 'docs/b.md'), 'utf-8')).toBe('b');
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toContain('防复活抑制');
  });

  it('用例3：restoreDeleted（opts / env）= 显式恢复，跳过抑制', async () => {
    // opts.restoreDeleted=true：被删文件按 bundle 落地（用户显式意志优先）。
    await seedManifest(['docs/b.md']);
    const bundle = buildTar([{ name: 'docs/b.md', content: 'server-b' }]);
    const client = makeClient(bundle);

    const specDir1 = await pullSpecBundle(client, WS, {
      unsyncedChecker: async () => false,
      restoreDeleted: true,
    });
    expect(await readFile(join(specDir1 as string, 'docs/b.md'), 'utf-8')).toBe('server-b');

    // env SILLYHUB_DAEMON_RESTORE_DELETED=1 同效（清盘重摆后下一次 pull）。
    await rm(resolveSpecDir(WS), { recursive: true, force: true });
    process.env.SILLYHUB_DAEMON_RESTORE_DELETED = '1';
    const specDir2 = await pullSpecBundle(client, WS, {
      unsyncedChecker: async () => false,
    });
    expect(await readFile(join(specDir2 as string, 'docs/b.md'), 'utf-8')).toBe('server-b');
  });

  it('用例4：排除口径——manifest 残留行命中 isUploadExcludedPath（projects/）不进抑制面', async () => {
    // projects/ 属上传排除面（成员机器本地信息）：manifest 残留行不进抑制面，
    // bundle 携带即落地（对齐 buildFullManifest/packSpecDir 同一排除口径）。
    await seedDisk({ 'keep.md': 'keep' });
    await seedManifest(['keep.md', 'projects/x.yaml']);
    const bundle = buildTar([
      { name: 'keep.md', content: 'keep-server' },
      { name: 'projects/x.yaml', content: 'proj' },
    ]);

    const specDir = await pullSpecBundle(makeClient(bundle), WS, {
      unsyncedChecker: async () => false,
    });

    expect(await readFile(join(specDir as string, 'projects/x.yaml'), 'utf-8')).toBe('proj');
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toContain('projects/x.yaml');
  });

  it('用例5（窗口内重建保护）：下载窗口内重建的同名文件不进抑制面——不删本地、不并回陈旧条目（2026-10-17-audit-risk-followup）', async () => {
    // T0：manifest 有 docs/b.md、盘面无（已删未上行）。旧实现在 getSpecBundle 之前
    // 一次性算出抑制面；下载在途时 agent/用户重建 b.md（getSpecBundle mock 内写盘
    // 模拟窗口写入）——修复后抑制面在 pre_swap 之后现算，b.md 盘面存在 → 自动退出
    // 抑制面。旧实现该场景：重建文件被 swap 进 trash 删除 + 陈旧条目并回 manifest
    // → 下轮 push 生成 delete op 把服务器刚留底的重建内容一并软删（双侧丢失）。
    const specDir = await seedDisk({ 'docs/a.md': 'local-a' });
    await seedManifest(['docs/a.md', 'docs/b.md']);
    const bundle = buildTar([
      { name: 'docs/a.md', content: 'server-a' },
      { name: 'docs/b.md', content: 'server-b' },
    ]);
    const client = {
      getSpecBundle: vi.fn().mockImplementation(async () => {
        // 下载在途：窗口内重建（T0 时盘面无，此刻重建）。
        await mkdir(dirname(join(specDir, 'docs/b.md')), { recursive: true });
        await writeFile(join(specDir, 'docs/b.md'), 'rebuilt-b', 'utf-8');
        return bundle;
      }),
      postSpecSync: vi.fn().mockResolvedValue({ ok: true }),
    } as never;

    const out = await pullSpecBundle(client, WS, { unsyncedChecker: async () => false });

    expect(out).toBe(specDir);
    // 不抑制不删除：b.md 落地（bundle 旧内容；重建内容已在服务器留底，下跳心跳
    // 拉齐自愈——对齐既有「窗口写入」语义，本地与服务器两侧均无丢失）。
    expect(await readFile(join(specDir, 'docs/b.md'), 'utf-8')).toBe('server-b');
    // 不并回陈旧条目：manifest 行来自落地树现算（hash 非 T0 陈旧值 'h-docs/b.md'）。
    const manifestAfter = JSON.parse(
      await readFile(resolveManifestCachePath(WS), 'utf-8'),
    ) as { files: Record<string, { hash: string }> };
    expect(manifestAfter.files['docs/b.md']).toBeTruthy();
    expect(manifestAfter.files['docs/b.md'].hash).not.toBe('h-docs/b.md');
    // 无抑制面 → 不触发抑制 warn。
    const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
    expect(warned).not.toContain('防复活抑制');
  });

  it('用例6（越界键防线）：applyResurrectSuppress 对越界键（../）跳过 rm 并告警——dir 外文件幸存', async () => {
    // manifest 键受信边界含服务端 new_versions 回写与本地半写损坏；旧实现直接
    // join+rm，越界键可把 rm -r 打到 dir 之外（含性校验对齐 extractTar Tar Slip 防线）。
    const dir = await mkdtemp(join(tmpdir(), 'suppress-containment-'));
    const victimRel = '../suppress-containment-victim.md';
    const victimPath = join(dir, victimRel);
    try {
      await writeFile(victimPath, 'victim', 'utf-8');
      await writeFile(join(dir, 'inside.md'), 'x', 'utf-8');

      const skipped = await applyResurrectSuppress(dir, new Set(['inside.md', victimRel]));

      // 正常键照删、越界键跳过且点名。
      expect(skipped).toEqual(['inside.md']);
      await expect(readFile(join(dir, 'inside.md'), 'utf-8')).rejects.toThrow();
      expect(await readFile(victimPath, 'utf-8')).toBe('victim');
      const warned = warnSpy.mock.calls.map((c) => String(c[0])).join('\n');
      expect(warned).toContain('越界');
      expect(warned).toContain(victimRel);
    } finally {
      await rm(dir, { recursive: true, force: true });
      await rm(victimPath, { force: true }).catch(() => {});
    }
  });
});
