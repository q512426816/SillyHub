// tests/knowledge-hits-upload.test.ts
// 2026-09-20-knowledge-effect-panel task-02 daemon 侧单测：
//   - 增量只报新行 / 尾行不完整不报（R-01 完整行断点）
//   - hits 文件不存在 no-op 零日志噪音（acceptance 第 3 条）
//   - 端点失败（500/网络）不抛且 offset 不进，下轮重试由服务端 hash 去重兜底（R-05/D-007）
//   - 分批 ≤2000 行 + 批级 offset 前进持久化（R-06；后批失败保留前批进度）
//   - postSpecSync 成功汇聚点挂点集成（R-05：上报失败不阻塞同步主流程）
//
// 隔离照 spec-sync.test.ts 先例：vi.mock node:os.homedir 指向每文件临时根——
// offset 状态文件落 daemonStateDir()（~/.sillyhub/daemon/.hits-upload-state-{ws}.json），
// 不 mock 会读写真实 home。mock client 形态照 spec-sync makeClient 先例
// （最小对象 + `as never` 绕过 HubClient 完整类型）。
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── hoisted mocks（homedir 必须在 knowledge-hits-upload import 前替换）────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-hits-upload-test-home'),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'hits-upload-test-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

import {
  uploadKnowledgeHitsIfNeeded,
  splitCompleteLines,
  hitsUploadStatePath,
} from '../src/knowledge-hits-upload.js';
import { postSpecSync } from '../src/spec-sync.js';

/** 构造最小 mock client（仅 postKnowledgeHitsBatch），`as never` 绕过完整类型。 */
function makePosterClient(overrides: { postKnowledgeHitsBatch?: ReturnType<typeof vi.fn> } = {}) {
  return {
    postKnowledgeHitsBatch:
      overrides.postKnowledgeHitsBatch ??
      vi.fn().mockResolvedValue({ ingested: 1, skipped_bad: 0, duplicates: 0 }),
  };
}

/** 每测试独立的 spec 临时目录 + hits 文件写入 helper。 */
async function makeSpecDirWithHits(wsId: string, hitsRaw: string): Promise<string> {
  const specDir = join(FAKE_HOME, 'specs-tmp', wsId, `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
  await mkdir(join(specDir, '.runtime'), { recursive: true });
  if (hitsRaw.length > 0) {
    await writeFile(join(specDir, '.runtime', 'knowledge-hits.jsonl'), hitsRaw, 'utf-8');
  }
  return specDir;
}

/** 读 offset 状态文件（不存在 → null）。 */
async function readState(wsId: string): Promise<{ uploadedLines?: unknown } | null> {
  try {
    return JSON.parse(await readFile(hitsUploadStatePath(wsId), 'utf-8')) as { uploadedLines?: unknown };
  } catch {
    return null;
  }
}

describe('splitCompleteLines（R-01 完整行断点，纯函数）', () => {
  it('"a\\nb\\n" → ["a","b"]（尾换行即全完整）', () => {
    expect(splitCompleteLines('a\nb\n')).toEqual(['a', 'b']);
  });
  it('"a\\nb" → ["a"]（无换行尾行是半行，留下轮）', () => {
    expect(splitCompleteLines('a\nb')).toEqual(['a']);
  });
  it('空文件 → []', () => {
    expect(splitCompleteLines('')).toEqual([]);
  });
  it('"a\\n\\nb\\n" → 空行也是完整行原样保留（服务端 skipped_bad 计数）', () => {
    expect(splitCompleteLines('a\n\nb\n')).toEqual(['a', '', 'b']);
  });
});

describe('uploadKnowledgeHitsIfNeeded', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    // 清 offset 状态与 spec 临时目录（同 wsId 跨测试污染防护，对齐 spec-sync.test.ts）。
    return rm(join(FAKE_HOME, '.sillyhub', 'daemon'), { recursive: true, force: true })
      .catch(() => {})
      .then(() => rm(join(FAKE_HOME, 'specs-tmp'), { recursive: true, force: true }).catch(() => {}));
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('hits 文件不存在 → 静默 no-op：不调端点、不建状态文件、零日志噪音', async () => {
    const client = makePosterClient();
    // specDir 连 .runtime 都没有（更别说 hits 文件）。
    const specDir = join(FAKE_HOME, 'specs-tmp', 'ws-no-file', `d-${Date.now()}`);
    await mkdir(specDir, { recursive: true });
    await uploadKnowledgeHitsIfNeeded(client as never, 'ws-no-file', specDir);
    expect(client.postKnowledgeHitsBatch).not.toHaveBeenCalled();
    expect(await readState('ws-no-file')).toBeNull();
    expect(warnSpy).not.toHaveBeenCalled();
  });

  it('首轮全量上报 + offset 前进；append 后只报新行（增量）', async () => {
    const client = makePosterClient();
    const wsId = 'ws-incremental';
    let specDir = await makeSpecDirWithHits(wsId, '{"type":"inject"}\n{"type":"fr-inject"}\n');
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"type":"inject"}',
      '{"type":"fr-inject"}',
    ]);
    expect(await readState(wsId)).toEqual(
      expect.objectContaining({ uploadedLines: 2 }),
    );

    // append 两行后：只报新 2 行，不重报旧 2 行。
    client.postKnowledgeHitsBatch.mockClear();
    await writeFile(
      join(specDir, '.runtime', 'knowledge-hits.jsonl'),
      '{"type":"inject"}\n{"type":"fr-inject"}\n{"type":"inject","n":3}\n{"type":"inject","n":4}\n',
      'utf-8',
    );
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"type":"inject","n":3}',
      '{"type":"inject","n":4}',
    ]);
    expect(await readState(wsId)).toEqual(
      expect.objectContaining({ uploadedLines: 4 }),
    );
  });

  it('尾行不完整（无换行）不报，补齐换行后的下一轮才报（R-01）', async () => {
    const client = makePosterClient();
    const wsId = 'ws-tail';
    const specDir = await makeSpecDirWithHits(
      wsId,
      '{"n":1}\n{"n":2}\n{"n":3,"partial":tru', // 尾行无 \n：CLI 正在 append 的半行
    );
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"n":1}',
      '{"n":2}',
    ]);
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 2 }));

    // 半行补齐（append 'e"}\n'）→ 下一轮只报该行。
    client.postKnowledgeHitsBatch.mockClear();
    await writeFile(
      join(specDir, '.runtime', 'knowledge-hits.jsonl'),
      '{"n":1}\n{"n":2}\n{"n":3,"partial":true}\n',
      'utf-8',
    );
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"n":3,"partial":true}',
    ]);
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 3 }));
  });

  it('端点 500 → 不抛、offset 不进（状态文件不落/不前进）、warn 一次；恢复后原样重报', async () => {
    const client = makePosterClient({
      postKnowledgeHitsBatch: vi.fn().mockRejectedValue(new Error('HTTP 500')),
    });
    const wsId = 'ws-500';
    const specDir = await makeSpecDirWithHits(wsId, '{"n":1}\n{"n":2}\n');
    // 不抛（best-effort，R-05）。
    await expect(
      uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    // offset 未进：状态文件不存在（首次上报即失败）。
    expect(await readState(wsId)).toBeNull();

    // 端点恢复 → 同样两行重报（服务端 hash 去重兜底幂等）。
    warnSpy.mockClear();
    const okClient = makePosterClient();
    await uploadKnowledgeHitsIfNeeded(okClient as never, wsId, specDir);
    expect(okClient.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"n":1}',
      '{"n":2}',
    ]);
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 2 }));
  });

  it('分批 ≤2000 行：2005 行 → 2000+5 两批；批级 offset 前进（前批成功后批失败保进度）', async () => {
    const wsId = 'ws-batch';
    const lines = Array.from({ length: 2005 }, (_, i) => `{"n":${i}}`);
    const specDir = await makeSpecDirWithHits(wsId, lines.map((l) => l + '\n').join(''));

    // 第 1 批成功、第 2 批失败：offset 停在 2000（批级前进），warn 一次不抛。
    let call = 0;
    const client = makePosterClient({
      postKnowledgeHitsBatch: vi.fn(async (_ws: string, batch: string[]) => {
        call++;
        if (call === 1) return { ingested: batch.length, skipped_bad: 0, duplicates: 0 };
        throw new Error('HTTP 500 on batch 2');
      }),
    });
    await expect(
      uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir),
    ).resolves.toBeUndefined();
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledTimes(2);
    const b1 = (client.postKnowledgeHitsBatch as ReturnType<typeof vi.fn>).mock.calls[0]![1] as string[];
    const b2 = (client.postKnowledgeHitsBatch as ReturnType<typeof vi.fn>).mock.calls[1]![1] as string[];
    expect(b1).toHaveLength(2000);
    expect(b2).toHaveLength(5);
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 2000 }));

    // 恢复后只报剩余 5 行。
    const okClient = makePosterClient();
    await uploadKnowledgeHitsIfNeeded(okClient as never, wsId, specDir);
    expect(okClient.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);
    expect(okClient.postKnowledgeHitsBatch).toHaveBeenCalledWith(
      wsId,
      lines.slice(2000),
    );
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 2005 }));
  });

  it('状态文件损坏/形状不符 → 视为 offset=0 全量重报（服务端去重兜底，不卡死增量）', async () => {
    const wsId = 'ws-corrupt-state';
    const specDir = await makeSpecDirWithHits(wsId, '{"n":1}\n');
    // 预置坏状态文件（非 JSON）。
    await mkdir(join(FAKE_HOME, '.sillyhub', 'daemon'), { recursive: true });
    await writeFile(hitsUploadStatePath(wsId), 'not-json{{{', 'utf-8');
    const client = makePosterClient();
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, ['{"n":1}']);
  });

  it('offset 超前（外部截断 hits 文件）→ 钳到当前行数不误报，append 后续走', async () => {
    const wsId = 'ws-clamp';
    const specDir = await makeSpecDirWithHits(wsId, '{"n":1}\n');
    await mkdir(join(FAKE_HOME, '.sillyhub', 'daemon'), { recursive: true });
    await writeFile(
      hitsUploadStatePath(wsId),
      JSON.stringify({ uploadedLines: 10, updated_at: '2026-09-20T00:00:00Z' }),
      'utf-8',
    );
    const client = makePosterClient();
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).not.toHaveBeenCalled();
    // append 后从钳位（1）续走，只报新行。
    await writeFile(join(specDir, '.runtime', 'knowledge-hits.jsonl'), '{"n":1}\n{"n":2}\n', 'utf-8');
    await uploadKnowledgeHitsIfNeeded(client as never, wsId, specDir);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, ['{"n":2}']);
  });

  it('client 未实现 postKnowledgeHitsBatch（mock/旧客户端）→ 静默 no-op 零日志', async () => {
    const specDir = await makeSpecDirWithHits('ws-old-client', '{"n":1}\n');
    const warnBefore = warnSpy.mock.calls.length;
    await uploadKnowledgeHitsIfNeeded({} as never, 'ws-old-client', specDir);
    expect(warnSpy.mock.calls.length).toBe(warnBefore);
    expect(await readState('ws-old-client')).toBeNull();
  });
});

describe('postSpecSync 成功汇聚点挂点（task-02 / R-05）', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    return rm(join(FAKE_HOME, '.sillyhub', 'daemon'), { recursive: true, force: true }).catch(() => {});
  });
  afterEach(() => {
    warnSpy.mockRestore();
  });

  it('postSpecSync 成功（首同步 tar 路径）→ 触发 hits 上报一次；同步返回值不受影响', async () => {
    const wsId = 'ws-hook-ok';
    const specDir = await makeSpecDirWithHits(wsId, '{"type":"inject"}\n{"type":"fr-inject"}\n');
    // 加一个 spec 文档让首同步 tar 非空（packSpecDir 正常打包）。
    await writeFile(join(specDir, 'design.md'), '# d\n', 'utf-8');
    const client = {
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 1 }),
      postKnowledgeHitsBatch: vi.fn().mockResolvedValue({ ingested: 2, skipped_bad: 0, duplicates: 0 }),
    };
    const r = await postSpecSync(client as never, wsId, specDir);
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);
    expect(client.postKnowledgeHitsBatch).toHaveBeenCalledWith(wsId, [
      '{"type":"inject"}',
      '{"type":"fr-inject"}',
    ]);
    expect(await readState(wsId)).toEqual(expect.objectContaining({ uploadedLines: 2 }));
  });

  it('hits 上报端点 500 → 同步主流程照常完成不抛（acceptance 第 2 条）', async () => {
    const wsId = 'ws-hook-500';
    const specDir = await makeSpecDirWithHits(wsId, '{"n":1}\n');
    await writeFile(join(specDir, 'design.md'), '# d\n', 'utf-8');
    const client = {
      postSpecSync: vi.fn().mockResolvedValue({ ok: true, reparsed: 1 }),
      postKnowledgeHitsBatch: vi.fn().mockRejectedValue(new Error('HTTP 500')),
    };
    const r = await postSpecSync(client as never, wsId, specDir);
    expect(r).toEqual(expect.objectContaining({ ok: true }));
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalled();
    // offset 未进，下轮重试。
    expect(await readState(wsId)).toBeNull();
  });
});
