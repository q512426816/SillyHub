// tests/spec-sync.test.ts
// task-06 (2026-06-26-daemon-client-spec-sync-fix) daemon 侧单测：
//   - syncSpecTreeIfNeeded 的 ctx-guarded no-op / 触发 / 失败容错（D-002@v1, FR-05, R-03）
//   - packSpecDir push 路径含 .runtime（D-003@v1 非对称契约, FR-06）
//
// task-08（2026-08-13-platform-managed-file-sync）：vi.mock node:os.homedir 指向
// 每文件临时根——postSpecSync 现读写 ~/.sillyhub/daemon/manifests/{ws}.json 本地清单
// 缓存（增量 diff，移出 specDir），不 mock homedir 会用真实 home 残留缓存污染跨 run
// 断言（首同步/空 tar 触发语义）。
//
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-spec-sync-test-home'),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'spec-sync-test-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

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
  beforeEach(() => {
    // 每测试清 manifest 缓存目录（增量 diff 用），避免跨测试同 wsId 污染。
    return rm(join(FAKE_HOME, '.sillyhub', 'daemon', 'manifests'), {
      recursive: true,
      force: true,
    }).catch(() => {});
  });

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
    // wsId 指向 homedir 下不存在的目录：walkDir 容错返回空 → 首同步（无缓存）产空 tar → 仍触发 postSpecSync。
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

  it('excludeRuntime:true 排除 .runtime 整树（import/get_spec_bundle 路径，ql-20260701-002）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'index.md'), '# hi');
    await mkdir(join(dir, '.runtime', 'worktrees'), { recursive: true });
    await writeFile(join(dir, '.runtime', 'sillyspec.db'), 'sqlite-bytes');
    await writeFile(join(dir, '.runtime', 'worktrees', 'big.txt'), 'x'.repeat(1000));

    const tarBuf = await packSpecDir(dir, { excludeRuntime: true });
    const names = parseTarNames(tarBuf);

    // spec 数据保留，.runtime 整树（含嵌套 worktrees）排除
    expect(names).toContain('docs/index.md');
    expect(names.some((n) => n === '.runtime' || n.startsWith('.runtime/'))).toBe(false);
  });

  it('excludeNames 排除顶层目录如 changes（import/get_spec_bundle 路径，ql-20260701-003）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'a.md'), 'a');
    await mkdir(join(dir, 'changes', 'sub'), { recursive: true });
    await writeFile(join(dir, 'changes', 'task-01.md'), 'x'.repeat(1000));
    await writeFile(join(dir, 'changes', 'sub', 'task-02.md'), 'y');

    const tarBuf = await packSpecDir(dir, { excludeNames: ['changes'] });
    const names = parseTarNames(tarBuf);

    // spec 数据保留，changes 整树（含子目录）排除
    expect(names).toContain('docs/a.md');
    expect(names.some((n) => n === 'changes' || n.startsWith('changes/'))).toBe(false);
  });
});

// ql-20260813-004：sync 回灌 HTTP 500 修复——长文件名（GNU LongLink）+ 运行时产物排除。
describe('packSpecDir (ql-20260813-004 长文件名 + 运行时产物排除)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'spec-sync-ql004-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // 解析手工 ustar tar，支持 GNU LongLink（typeflag 'L'）：遇 'L' 头用其 data 块覆盖下一个
  // entry 的 name。对齐 Python tarfile r:* 的 GNU longname 读取语义。
  function parseTarNamesLong(buf: Buffer): string[] {
    const names: string[] = [];
    let pendingLongName: string | null = null;
    let offset = 0;
    while (offset + 512 <= buf.length) {
      const header = buf.subarray(offset, offset + 512);
      if (header.every((b) => b === 0)) break; // 结尾 zero block
      const typeflag = header[156];
      const sizeOctal = header.subarray(124, 136).toString('utf-8').replace(/\0.*$/, '').trim();
      const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
      const dataBlocks = Math.ceil(size / 512) * 512;
      if (typeflag === 0x4c /* 'L' GNU LongLink */) {
        pendingLongName = buf
          .subarray(offset + 512, offset + 512 + size)
          .toString('utf-8')
          .replace(/\0.*$/, '');
      } else {
        const rawName = header.subarray(0, 100).toString('utf-8').replace(/\0.*$/, '').trim();
        const name = (pendingLongName ?? rawName).replace(/\/$/, '');
        if (name) names.push(name);
        pendingLongName = null;
      }
      offset += 512 + dataBlocks;
    }
    return names;
  }

  it('name > 100 字节 → 写 GNU LongLink，解析回完整长名（B：修 tar 截断崩溃）', async () => {
    await mkdir(join(dir, 'changes'), { recursive: true });
    // 构造 >100 字节相对路径，模拟 scan-runs 崩溃场景（change 名 + brainstorm-step + 时间戳）。
    const longDir = 'a-really-long-change-name-2026-06-28-daemon-client-spec-sync-strategy';
    const longFile = 'brainstorm-step10-20260627201119-extra-padding-suffix.md';
    await mkdir(join(dir, 'changes', longDir), { recursive: true });
    await writeFile(join(dir, 'changes', longDir, longFile), '# long');
    const relName = `changes/${longDir}/${longFile}`;
    expect(Buffer.byteLength(relName, 'utf-8')).toBeGreaterThan(100);

    const tarBuf = await packSpecDir(dir);
    const names = parseTarNamesLong(tarBuf);

    // 完整长名出现在 tar（未被 100 字节静默截断）。
    expect(names).toContain(relName);
  });

  it('默认排除 runtime/（无点，daemon scan-runs 崩溃源，W）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'a.md'), 'a');
    await mkdir(join(dir, 'runtime', 'scan-runs'), { recursive: true });
    await writeFile(join(dir, 'runtime', 'scan-runs', 'log.txt'), 'runtime-junk');

    const tarBuf = await packSpecDir(dir);
    const names = parseTarNames(tarBuf);

    // spec 数据保留，runtime/(无点) 整树排除。
    expect(names).toContain('docs/a.md');
    expect(names.some((n) => n === 'runtime' || n.startsWith('runtime/'))).toBe(false);
  });

  it('默认排除 worktrees（任意深度，保留 .runtime 其余内容，W + D-003）', async () => {
    await mkdir(join(dir, 'docs'), { recursive: true });
    await writeFile(join(dir, 'docs', 'a.md'), 'a');
    // worktrees 嵌在 .runtime（有点）下，模拟 sillyspec worktree 位置。
    await mkdir(join(dir, '.runtime', 'worktrees', 'wt-1'), { recursive: true });
    await writeFile(join(dir, '.runtime', 'worktrees', 'wt-1', 'f.txt'), 'x');
    // .runtime（有点）其他内容仍保留（D-003 push 含 .runtime）。
    await writeFile(join(dir, '.runtime', 'sillyspec.db'), 'sqlite');

    const tarBuf = await packSpecDir(dir);
    const names = parseTarNames(tarBuf);

    expect(names).toContain('docs/a.md');
    expect(names).toContain('.runtime/sillyspec.db');
    expect(names.some((n) => n.includes('worktrees'))).toBe(false);
  });
});
