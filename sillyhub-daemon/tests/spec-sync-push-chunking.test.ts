// tests/spec-sync-push-chunking.test.ts
// 2026-11-04-daemon-spec-sync-chunking：daemon 增量推送分批化（对齐 CLI 侧 sillyspec
// 仓同日修复）。生产实证：15 天积压 2436 ops/45.7MB 单批推送双超 + 失败回退整包 tar
// 的恶性循环；分批后每块独立提交、已落地块保留、下轮 diff 断点续传。
//
// 覆盖：
//   - chunkOpsForPush 纯逻辑边界（单 op/恰好阈值/超出阈值/字节阈值/双约束/超限单 op
//     独占一块/保序/空数组）
//   - 多块全落地：postSpecSyncIncremental 逐块调用（≤env 块上限）、响应合并无 conflict、
//     不回退旧 tar、onProgress 按块累计 files_processed
//   - 中途块失败（已有块落地）：原始错误上抛、**不回退旧 tar**（断点续传语义）
//   - 首块失败（零落地）：维持既有 tar 回退（旧后端兼容）
//
// mock 模式：vi.mock('node:os') homedir 指向独立临时根，参照 spec-sync-incremental.test.ts。

import { createHash } from 'node:crypto';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-spec-sync-chunk-home'),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});

const { postSpecSync, resolveManifestCachePath, chunkOpsForPush } =
  await import('../src/spec-sync.js');

// ── helpers ───────────────────────────────────────────────────────────────────

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

async function seedCache(
  wsId: string,
  files: Record<string, { hash: string; version: number; mtime: number }>,
) {
  const p = resolveManifestCachePath(wsId);
  await mkdir(dirname(p), { recursive: true });
  await writeFile(p, JSON.stringify({ version: 1, files }) + '\n', 'utf-8');
}

let scratchDir: string;

function write(relPath: string, content: string): void {
  const abs = join(scratchDir, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content);
}

// ── A. chunkOpsForPush 纯逻辑 ────────────────────────────────────────────────

describe('chunkOpsForPush 双约束切块（2026-11-04-daemon-spec-sync-chunking）', () => {
  const mkOp = (path: string, contentLen = 0): Record<string, unknown> => ({
    op: 'add',
    path,
    base_version: 0,
    content: 'x'.repeat(contentLen),
  });

  it('单 op 单块；恰好等于阈值=1 块；超出阈值 3+1 切块', () => {
    expect(chunkOpsForPush([mkOp('a')], { maxOps: 4, maxBytes: 1024 })).toHaveLength(1);
    expect(
      chunkOpsForPush([mkOp('a'), mkOp('b'), mkOp('c')], { maxOps: 3, maxBytes: 1 << 20 }),
    ).toHaveLength(1);
    const byOps = chunkOpsForPush([mkOp('a'), mkOp('b'), mkOp('c'), mkOp('d')], {
      maxOps: 3,
      maxBytes: 1 << 20,
    });
    expect(byOps.map((c) => c.length)).toEqual([3, 1]);
  });

  it('字节阈值切块：粗估=content+path×2+96（4000B op ≈ 4098，两块 8196>8192 切）', () => {
    const byBytes = chunkOpsForPush(
      [mkOp('a', 4000), mkOp('b', 4000), mkOp('c', 10)],
      { maxOps: 100, maxBytes: 8192 },
    );
    expect(byBytes.map((c) => c.length)).toEqual([1, 2]);
  });

  it('双约束同时生效取更严；超字节单 op 独占一块；保序；空数组零块', () => {
    const both = chunkOpsForPush([mkOp('a', 100), mkOp('b', 100), mkOp('c', 100)], {
      maxOps: 2,
      maxBytes: 250,
    });
    expect(both).toHaveLength(3);
    const oneHuge = chunkOpsForPush([mkOp('huge.bin', 99999)], { maxOps: 8, maxBytes: 100 });
    expect(oneHuge).toHaveLength(1);
    expect(oneHuge[0]).toHaveLength(1);
    const flat = chunkOpsForPush(
      [1, 2, 3, 4, 5].map((i) => mkOp(`f${i}`)),
      { maxOps: 2, maxBytes: 1 << 20 },
    )
      .flat()
      .map((o) => (o as Record<string, unknown>).path);
    expect(flat).toEqual(['f1', 'f2', 'f3', 'f4', 'f5']);
    expect(chunkOpsForPush([], { maxOps: 2, maxBytes: 100 })).toHaveLength(0);
  });
});

// ── B/C/D. postSpecSync 集成（分批推送行为） ─────────────────────────────────

describe('postSpecSync 分批推送（env SILLYSPEC_SPEC_SYNC_CHUNK_OPS 驱动）', () => {
  let home: string;
  let scratch: string;
  let prevChunkOps: string | undefined;

  beforeEach(() => {
    home = mkdtempSync(join(tmpdir(), 'spec-sync-chunk-home-'));
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-chunk-scratch-'));
    scratchDir = scratch;
    hoisted.homedirMock.mockReturnValue(home);
    prevChunkOps = process.env.SILLYSPEC_SPEC_SYNC_CHUNK_OPS;
    process.env.SILLYSPEC_SPEC_SYNC_CHUNK_OPS = '5';
  });

  afterEach(() => {
    if (prevChunkOps === undefined) delete process.env.SILLYSPEC_SPEC_SYNC_CHUNK_OPS;
    else process.env.SILLYSPEC_SPEC_SYNC_CHUNK_OPS = prevChunkOps;
    hoisted.homedirMock.mockReset();
    rmSync(home, { recursive: true, force: true });
    rmSync(scratch, { recursive: true, force: true });
  });

  it('12 ops → 3 块顺序提交全部落地：逐块调用 5+5+2、响应合并、不回退 tar、进度按块累计', async () => {
    const wsId = 'ws-chunk-ok';
    // 缓存里放一个未变文件撑住「有缓存」路径（真 sha256，防 diff 误发 update op）；再写 12 个新文件 → 12 个 add ops
    await seedCache(wsId, {
      'docs/keep.md': { hash: createHash('sha256').update('keep').digest('hex'), version: 3, mtime: 1 },
    });
    write('docs/keep.md', 'keep');
    for (let i = 0; i < 12; i++) write(`docs/new${i}.md`, `content ${i}`);

    const incrSpy = vi.fn().mockImplementation(async (_ws: string, ops: Array<{ path: string }>) => ({
      ok: true,
      new_versions: Object.fromEntries(ops.map((o) => [o.path, 1])),
      conflict: false,
      server_versions: null,
    }));
    const postSpy = vi.fn();
    const onProgress = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client, wsId, scratch, undefined, onProgress);

    expect(r).toMatchObject({ ok: true, reparsed: 0, filesTotal: 12 });
    expect(incrSpy).toHaveBeenCalledTimes(3);
    expect(incrSpy.mock.calls.map((c) => (c[1] as unknown[]).length)).toEqual([5, 5, 2]);
    expect(postSpy).not.toHaveBeenCalled(); // 增量成功不回退旧 tar
    // 进度：起点 total=12，随后按块累计 processed=5/10/12
    const processedSeq = onProgress.mock.calls
      .map((c) => c[0] as { files_total?: number; files_processed?: number })
      .filter((p) => typeof p.files_processed === 'number' && p.files_processed > 0)
      .map((p) => p.files_processed);
    expect(processedSeq).toEqual([5, 10, 12]);
  });

  it('中途块失败（第 2 块）→ 原始错误上抛、已落地块保留、不回退旧 tar', async () => {
    const wsId = 'ws-chunk-fail-mid';
    await seedCache(wsId, {});
    for (let i = 0; i < 12; i++) write(`docs/f${i}.md`, `content ${i}`);

    let call = 0;
    const incrSpy = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call === 2) throw new Error('ECONNRESET: simulated mid-push network drop');
      return { ok: true, new_versions: {}, conflict: false, server_versions: null };
    });
    const postSpy = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    await expect(postSpecSync(client, wsId, scratch)).rejects.toThrow(
      /ECONNRESET: simulated mid-push network drop/,
    );
    expect(incrSpy).toHaveBeenCalledTimes(2); // 失败即停：第 1 块已落地 + 第 2 块失败
    expect(postSpy).not.toHaveBeenCalled(); // 部分落地后禁 tar 回退（断点续传）
  });

  it('首块失败（零落地）→ 维持既有 tar 回退（旧后端兼容）', async () => {
    const wsId = 'ws-chunk-fail-first';
    await seedCache(wsId, {});
    for (let i = 0; i < 12; i++) write(`docs/g${i}.md`, `content ${i}`);

    const incrSpy = vi.fn().mockRejectedValue(new Error('HTTP 404 endpoint missing'));
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 0 });
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client, wsId, scratch);

    expect(incrSpy).toHaveBeenCalledTimes(1); // 首块即失败
    expect(postSpy).toHaveBeenCalledTimes(1); // 既有行为：404/网络失败 → 回退旧 tar
    expect(r).toMatchObject({ ok: true });
  });

  it('评审 P2-1：rebase 重试段中途块失败 → 透传原始错误断点续传，不升级 SpecPushConflict、不回退 tar', async () => {
    const wsId = 'ws-chunk-rebase-passthrough';
    // 缓存 base.md version=1（真哈希、内容未变——不产 op）；服务器在首轮响应里报
    // version=2 → rebase 可对齐（rebased>0 → 重算重试）。
    await seedCache(wsId, {
      'docs/base.md': {
        hash: createHash('sha256').update('base').digest('hex'),
        version: 1,
        mtime: 1,
      },
    });
    write('docs/base.md', 'base');
    for (let i = 0; i < 7; i++) write(`docs/r${i}.md`, `content ${i}`); // 7 ops → 5+2 两块

    // 首轮（2 块）：两块都回 conflict（server_versions 指向 base.md v2）→ 合并 conflict
    // → rebase 对齐 → 重算重试；重试轮：块1 成功、块2 网络错误（i>0 → ChunkedPushPartialError）
    let call = 0;
    const conflictResp = {
      ok: true,
      new_versions: {},
      conflict: true,
      server_versions: { 'docs/base.md': 2 },
    };
    const incrSpy = vi.fn().mockImplementation(async () => {
      call += 1;
      if (call <= 2) return conflictResp; // 首轮两块全 conflict
      if (call === 4) throw new Error('ECONNRESET: rebase retry mid-push drop'); // 重试轮块2
      return { ok: true, new_versions: {}, conflict: false, server_versions: null };
    });
    const postSpy = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    await expect(postSpecSync(client, wsId, scratch)).rejects.toThrow(
      /ECONNRESET: rebase retry mid-push drop/,
    );
    // 重试轮从块1 断点即停：总调用 = 首轮 2 + 重试轮 2；tar 零调用
    expect(call).toBe(4);
    expect(postSpy).not.toHaveBeenCalled();
  });

  it('评审 P2-2：块响应合并语义——conflict 任一块真（非首块 conflict 亦升级 SpecPushConflict）、new_versions 逐块累积回写缓存', async () => {
    const wsId = 'ws-chunk-merge';
    await seedCache(wsId, {
      'docs/base.md': {
        hash: createHash('sha256').update('base').digest('hex'),
        version: 1,
        mtime: 1,
      },
    });
    write('docs/base.md', 'base');
    for (let i = 0; i < 12; i++) write(`docs/m${i}.md`, `content ${i}`); // 12 ops → 5+5+2

    // 全成三态：块1/块2 成功（各回本块 new_versions v5），块3 conflict（server_versions
    // 指向 base.md——缓存有行可 rebase，rebase 后重算重试整轮再全绿）
    let call = 0;
    const incrSpy = vi.fn().mockImplementation(async (_ws: string, ops: Array<{ path: string }>) => {
      call += 1;
      if (call === 3) {
        return {
          ok: true,
          new_versions: {},
          conflict: true,
          server_versions: { 'docs/base.md': 2 },
        };
      }
      return {
        ok: true,
        new_versions: Object.fromEntries(ops.map((o) => [o.path, 5])),
        conflict: false,
        server_versions: null,
      };
    });
    const postSpy = vi.fn();
    const client = makeClient({ postSpecSyncIncremental: incrSpy, postSpecSync: postSpy });

    const r = await postSpecSync(client, wsId, scratch);

    // 非首块 conflict 亦被合并捕获 → rebase（base.md v1→v2 对齐）→ 重试轮全绿收敛
    expect(r).toMatchObject({ ok: true, reparsed: 0, filesTotal: 12 });
    expect(call).toBe(6); // 首轮 3 + 重试轮 3
    expect(postSpy).not.toHaveBeenCalled();
    // 重试轮回写：全部 12 个新文件 version=5（逐块累积经缓存回写可观察）
    const { readFileSync, existsSync } = await import('node:fs');
    expect(existsSync(resolveManifestCachePath(wsId))).toBe(true);
    const cache = JSON.parse(readFileSync(resolveManifestCachePath(wsId), 'utf-8')) as {
      files: Record<string, { version: number }>;
    };
    for (let i = 0; i < 12; i++) {
      expect(cache.files[`docs/m${i}.md`]?.version).toBe(5);
    }
  });
});
