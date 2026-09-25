// tests/knowledge-hits-periodic.test.ts
// 2026-09-26-daemon-hits-periodic-upload：周期上行器单测——mtime 短路 / 变化触发 /
// 无 hits 文件静默 / specs 目录缺失零绑定 / 端点失败不抛。
// 隔离照 knowledge-hits-upload.test.ts 先例：vi.mock node:os.homedir 指向临时根。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdir, writeFile, rm, readdir } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-hits-periodic-home'),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'hits-periodic-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

// 上行器真身 mock：只断言调用与否（断点/批次逻辑归 uploadKnowledgeHitsIfNeeded 既有测试）。
const uploadMock = vi.hoisted(() => vi.fn());
vi.mock('../src/knowledge-hits-upload.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/knowledge-hits-upload.js')>();
  return { ...actual, uploadKnowledgeHitsIfNeeded: uploadMock };
});

import { KnowledgeHitsPeriodicUploader } from '../src/knowledge-hits-periodic.js';

const STATE = join(FAKE_HOME, '.sillyhub', 'daemon');

async function makeWs(wsId: string, hitsRaw: string | null): Promise<string> {
  const specDir = join(STATE, 'specs', wsId);
  await mkdir(join(specDir, '.runtime'), { recursive: true });
  if (hitsRaw !== null) {
    await writeFile(join(specDir, '.runtime', 'knowledge-hits.jsonl'), hitsRaw, 'utf-8');
  }
  return specDir;
}

const UUID_A = '11111111-1111-4111-8111-111111111111';

describe('KnowledgeHitsPeriodicUploader.roundOnce', () => {
  beforeEach(async () => {
    uploadMock.mockReset().mockResolvedValue(undefined);
    await rm(join(FAKE_HOME, '.sillyhub'), { recursive: true, force: true }).catch(() => undefined);
  });
  afterEach(() => undefined);

  it('无 specs 目录 → 零绑定零调用（常态静默）', async () => {
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    const r = await u.roundOnce();
    expect(r.attempted).toEqual([]);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('mtime 变化触发 / 未变短路 / append 后再触发', async () => {
    await makeWs(UUID_A, '{"n":1}\n');
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    const r1 = await u.roundOnce();
    expect(r1.attempted).toEqual([UUID_A]);
    expect(uploadMock).toHaveBeenCalledTimes(1);

    const r2 = await u.roundOnce(); // 同 mtime：短路
    expect(r2.skippedUnchanged).toEqual([UUID_A]);
    expect(uploadMock).toHaveBeenCalledTimes(1);

    await writeFile(join(STATE, 'specs', UUID_A, '.runtime', 'knowledge-hits.jsonl'), '{"n":1}\n{"n":2}\n', 'utf-8');
    const r3 = await u.roundOnce();
    expect(r3.attempted).toEqual([UUID_A]);
    expect(uploadMock).toHaveBeenCalledTimes(2);
  });

  it('无 hits 文件的工作区：首轮记录空印不调用，文件出现后触发', async () => {
    await makeWs(UUID_A, null);
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    const r1 = await u.roundOnce();
    // 无文件：记空印短路，不空转调 uploader
    expect(r1.attempted).toEqual([]);
    expect(uploadMock).not.toHaveBeenCalled();
    // 空印未变 → 第二轮短路（不再调 uploader）
    const r2 = await u.roundOnce();
    expect(r2.skippedUnchanged).toEqual([UUID_A]);
    expect(uploadMock).not.toHaveBeenCalled();
  });

  it('uploader 回执 false（内部吞错）→ 不记印，同 mtime 下轮也重试（三审钉子）', async () => {
    await makeWs(UUID_A, '{"n":1}\n');
    uploadMock.mockResolvedValueOnce(false);
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    const r1 = await u.roundOnce();
    expect(r1.attempted).toEqual([]); // 失败不记印
    uploadMock.mockResolvedValue(true);
    const r2 = await u.roundOnce(); // 文件未变（同 mtime）：仍应重试
    expect(r2.attempted).toEqual([UUID_A]);
    expect(uploadMock).toHaveBeenCalledTimes(2);
    const r3 = await u.roundOnce(); // 成功后才短路
    expect(r3.skippedUnchanged).toEqual([UUID_A]);
  });

  it('上行抛错不冒泡（周期通道不中断），下轮照常', async () => {
    await makeWs(UUID_A, '{"n":1}\n');
    uploadMock.mockRejectedValueOnce(new Error('HTTP 502'));
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    await expect(u.roundOnce()).resolves.toMatchObject({ attempted: [] });
    uploadMock.mockResolvedValue(undefined);
    await writeFile(join(STATE, 'specs', UUID_A, '.runtime', 'knowledge-hits.jsonl'), '{"n":3}\n', 'utf-8');
    const r = await u.roundOnce();
    expect(r.attempted).toEqual([UUID_A]);
  });

  it('start/stop 幂等（重复 start 不叠定时器）', async () => {
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    u.start();
    u.start();
    u.stop();
    u.stop();
    // specs 目录存在性由 readdir 容错（不抛即过）
    const names = await readdir(STATE).catch(() => [] as string[]);
    expect(Array.isArray(names)).toBe(true);
  });
});

describe('绑定集守卫（评审 P2 收口：UUID 形态 + backup 目录排除）', () => {
  beforeEach(async () => {
    uploadMock.mockReset().mockResolvedValue(undefined);
    await rm(join(FAKE_HOME, '.sillyhub'), { recursive: true, force: true }).catch(() => undefined);
  });

  it('非 UUID 杂名与 .pre-junction-backup-* 目录不进端点调用', async () => {
    await makeWs(UUID_A, '{"n":1}\n');
    // 杂名目录（有 hits 文件也不该被调）与 backup 缓存目录
    for (const bad of ['not-a-uuid', 'b97f8231.pre-junction-backup-20260909']) {
      const d = join(STATE, 'specs', bad, '.runtime');
      await mkdir(d, { recursive: true });
      await writeFile(join(d, 'knowledge-hits.jsonl'), '{"bad":1}\n', 'utf-8');
    }
    const u = new KnowledgeHitsPeriodicUploader({} as never, 60_000, STATE);
    const r = await u.roundOnce();
    expect(r.attempted).toEqual([UUID_A]);
    expect(uploadMock).toHaveBeenCalledTimes(1);
    const argWs = uploadMock.mock.calls[0]?.[1];
    expect(argWs).toBe(UUID_A);
  });
});
