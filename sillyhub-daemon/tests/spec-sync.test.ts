// tests/spec-sync.test.ts
// task-06 (2026-06-26-daemon-client-spec-sync-fix) daemon 侧单测：
//   - syncSpecTreeIfNeeded 的 ctx-guarded no-op / 触发 / 失败容错（D-002@v1, FR-05, R-03）
//   - packSpecDir push 路径含 .runtime（D-003@v1 非对称契约, FR-06）
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { syncSpecTreeIfNeeded, packSpecDir } from '../src/spec-sync.js';

/** 构造最小 mock client（仅 postSpecSync），用 `as never` 绕过 HubClient 完整类型。 */
function makeClient(overrides: { postSpecSync?: ReturnType<typeof vi.fn> } = {}) {
  return {
    postSpecSync:
      overrides.postSpecSync ?? vi.fn().mockResolvedValue({ ok: true, reparsed: 0 }),
  };
}

/** 解析手工 ustar tar 的 entry name 列表（仅读 name 字段 + 按 size 跳过 data 块）。 */
function parseTarNames(buf: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 512 <= buf.length) {
    const header = buf.subarray(offset, offset + 512);
    if (header.every((b) => b === 0)) break; // 结尾 zero block
    const name = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '').trim();
    if (name) names.push(name.replace(/\/$/, '')); // 去目录尾 '/'
    const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return names;
}

describe('syncSpecTreeIfNeeded (task-06 / D-002@v1)', () => {
  it('ctx=null → no-op，不调 postSpecSync（quick-chat / shared 无 ctx）', async () => {
    const client = makeClient();
    await syncSpecTreeIfNeeded(null, client as never);
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('ctx=undefined → no-op（onSessionEnd 反查 leaseId 失败安全）', async () => {
    const client = makeClient();
    await syncSpecTreeIfNeeded(undefined, client as never);
    expect(client.postSpecSync).not.toHaveBeenCalled();
  });

  it('ctx 有 workspaceId → 调 postSpecSync 一次（scan 终态回灌，FR-05）', async () => {
    const client = makeClient();
    // wsId 指向 homedir 下不存在的目录：walkDir 容错返回空 → 产空 tar → 仍触发 postSpecSync。
    await syncSpecTreeIfNeeded(
      { workspaceId: 'ws-task06-sync-trigger' },
      client as never,
    );
    expect(client.postSpecSync).toHaveBeenCalledTimes(1);
    expect(client.postSpecSync).toHaveBeenCalledWith(
      'ws-task06-sync-trigger',
      expect.any(Buffer),
    );
  });

  it('postSpecSync 抛错 → 仅 warn 不抛（R-03：不改写 run/session 终态）', async () => {
    const client = makeClient({
      postSpecSync: vi.fn().mockRejectedValue(new Error('boom')),
    });
    await expect(
      syncSpecTreeIfNeeded({ workspaceId: 'ws-task06-err' }, client as never),
    ).resolves.toBeUndefined();
  });

  it('client 未实现 postSpecSync → postSpecSync 返回 null，无副作用（mock 容错）', async () => {
    // postSpecSync 内部对 typeof !== 'function' 返回 null；syncSpecTreeIfNeeded 不应抛。
    const client = {} as never;
    await expect(
      syncSpecTreeIfNeeded({ workspaceId: 'ws-task06-noop-client' }, client),
    ).resolves.toBeUndefined();
  });
});

describe('packSpecDir (task-06 / D-003@v1 push 含 .runtime)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-sync-test-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('输出 tar 含 .runtime/sillyspec.db（push 不再排除 .runtime，FR-06）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'index.md'), '# hi');
    await mkdir(join(dir, '.runtime'), { recursive: true });
    await writeFile(join(dir, '.runtime', 'sillyspec.db'), 'sqlite-bytes');

    const tarBuf = await packSpecDir(dir);
    const names = parseTarNames(tarBuf);

    // spec 数据 + .runtime 都在（task-06 D-003 push 路径含 .runtime）
    expect(names).toContain('docs/index.md');
    expect(names).toContain('.runtime/sillyspec.db');
  });
});
