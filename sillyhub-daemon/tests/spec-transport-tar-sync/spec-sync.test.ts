// tests/spec-transport-tar-sync/spec-sync.test.ts
// task-04：spec-sync.ts 共享 utility 单测（D-007 纯函数 + client 参数注入）。
//
// 对照蓝图 task-04.md §8 TDD 用例 + §9 AC-3~AC-8。覆盖：
//   - resolveSpecDir 路径 + wsId 分隔符校验
//   - pullSpecBundle 404 容错（R-02/E-01，本任务核心新增行为）
//   - pullSpecBundle 5xx 透传 / 跳过分支
//   - packSpecDir 排除 .runtime + zero block 结尾
//   - Tar Slip 防护（.. 段 / 绝对路径 / resolve 逃逸）
//   - postSpecSync mock 未实现返回 null
//
// mock node:os.homedir 固定 spec_dir 父目录；mock HubClient 方法；真实 tar round-trip
// 到 os.tmpdir() 临时目录。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

// ── hoisted mocks（homedir 必须在 spec-sync import 前替换）────────────────────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-spec-sync-home'),
}));

vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});

// 在 spec-sync import 前设定临时 home（mkdtempSync 顶层安全）。
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'spec-sync-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

// spec-sync 在 homedir mock 就位后 import。
const { resolveSpecDir, pullSpecBundle, packSpecDir, postSpecSync } =
  await import('../../src/spec-sync.js');

// ── duck-type HubHttpError 构造器（不依赖 hub-client.ts 导出）────────────────
function fakeHttpErr(status: number, msg = 'err'): { status: number; message: string } {
  return { status, message: msg };
}

// ── 构造一个最小 tar Buffer（手工 ustar），用于 extractTar 路径穿越测试 ───────
function buildTarEntry(name: string, content: string, typeflag: string, isDir = false): Buffer {
  const header = Buffer.alloc(512, 0);
  header.write(name, 0, 'utf-8');
  header.write(isDir ? '0000755' : '0000644', 100, 'ascii');
  header[107] = 0;
  header.write('0000000', 108, 'ascii');
  header[115] = 0;
  header.write('0000000', 116, 'ascii');
  header[123] = 0;
  const size = isDir ? 0 : Buffer.byteLength(content, 'utf-8');
  header.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  header.write('00000000000', 136, 'ascii');
  header[147] = 0;
  header.write('        ', 148, 'ascii');
  header[156] = typeflag.charCodeAt(0);
  header.write('ustar', 257, 'ascii');
  header[262] = 0;
  header.write('00', 263, 'ascii');
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  if (isDir) return header;
  const data = Buffer.from(content, 'utf-8');
  const padLen = (512 - (data.length % 512)) % 512;
  return Buffer.concat([header, data, Buffer.alloc(padLen, 0)]);
}

function tarBuf(entries: Buffer[]): Buffer {
  return Buffer.concat([...entries, Buffer.alloc(1024, 0)]); // 2×512 zero block 结尾
}

describe('resolveSpecDir', () => {
  it('返回 ~/.sillyhub/daemon/specs/{wsId}（homedir 展开）', () => {
    const got = resolveSpecDir('ws-uuid-123');
    expect(got).toBe(join(FAKE_HOME, '.sillyhub', 'daemon', 'specs', 'ws-uuid-123'));
  });

  it('wsId 含 / → throw invalid workspace_id', () => {
    expect(() => resolveSpecDir('a/b')).toThrow(/invalid workspace_id/);
  });

  it('wsId 含 \\ → throw invalid workspace_id', () => {
    expect(() => resolveSpecDir('a\\b')).toThrow(/invalid workspace_id/);
  });

  it('wsId 为空字符串 → throw invalid workspace_id', () => {
    expect(() => resolveSpecDir('')).toThrow(/invalid workspace_id/);
  });
});

describe('pullSpecBundle', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-pull-'));
  });
  afterEach(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('无 wsId → 返回 null', async () => {
    const client = { getSpecBundle: vi.fn() } as any;
    const r = await pullSpecBundle(client, undefined, {});
    expect(r).toBeNull();
    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });

  it('existingSpecRoot 已有 → 返回 null（防御性跳过）', async () => {
    const client = { getSpecBundle: vi.fn() } as any;
    const r = await pullSpecBundle(client, 'ws', { existingSpecRoot: '/already/here' });
    expect(r).toBeNull();
    expect(client.getSpecBundle).not.toHaveBeenCalled();
  });

  it('client 无 getSpecBundle 方法（mock 未实现）→ 返回 null', async () => {
    const r = await pullSpecBundle({} as any, 'ws', {});
    expect(r).toBeNull();
  });

  it('404 容错（R-02/E-01，核心）：getSpecBundle 抛 status=404 → mkdir 空本地目录、返回路径非 null、不调 extractTar', async () => {
    const wsId = 'ws-404-empty';
    const client = {
      getSpecBundle: vi.fn().mockRejectedValue(fakeHttpErr(404, 'not found')),
    } as any;
    const r = await pullSpecBundle(client, wsId, {});
    expect(r).not.toBeNull();
    expect(r).toBe(resolveSpecDir(wsId));
    // 本地目录已创建（空）
    expect(existsSync(r!)).toBe(true);
    expect(statSync(r!).isDirectory()).toBe(true);
    expect(readdirSync(r!)).toEqual([]);
  });

  it('5xx 透传（仅 404 容错）', async () => {
    const client = {
      getSpecBundle: vi.fn().mockRejectedValue(fakeHttpErr(500, 'server err')),
    } as any;
    await expect(pullSpecBundle(client, 'ws-5xx', {})).rejects.toMatchObject({ status: 500 });
  });

  it('418 等其他 4xx 也透传（仅 404 容错）', async () => {
    const client = {
      getSpecBundle: vi.fn().mockRejectedValue(fakeHttpErr(418, "I'm a teapot")),
    } as any;
    await expect(pullSpecBundle(client, 'ws-418', {})).rejects.toMatchObject({ status: 418 });
  });

  it('网络错透传（非 HTTP 错）', async () => {
    const client = {
      getSpecBundle: vi.fn().mockRejectedValue(new TypeError('fetch failed')),
    } as any;
    await expect(pullSpecBundle(client, 'ws-net', {})).rejects.toThrow('fetch failed');
  });

  it('正常解包：调 getSpecBundle → rm + extractTar → 返回 specDir，文件落盘', async () => {
    const wsId = 'ws-ok-roundtrip';
    const tar = tarBuf([buildTarEntry('spec.md', '# hello', '0')]);
    const client = {
      getSpecBundle: vi.fn().mockResolvedValue(tar),
    } as any;
    const r = await pullSpecBundle(client, wsId, {});
    expect(r).toBe(resolveSpecDir(wsId));
    expect(existsSync(join(r!, 'spec.md'))).toBe(true);
    expect(readFileSync(join(r!, 'spec.md'), 'utf-8')).toBe('# hello');
  });
});

describe('packSpecDir', () => {
  let scratch: string;

  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-pack-'));
  });
  afterEach(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('排除 .runtime 段 + 以 2×512 zero block 结尾', async () => {
    // 构造 specDir：含 .runtime/leak.txt（应排除）+ spec.md（应包含）+ sub/nested.md
    mkdirSync(join(scratch, '.runtime'));
    writeFileSync(join(scratch, '.runtime', 'leak.txt'), 'secret');
    writeFileSync(join(scratch, 'spec.md'), 'root-spec');
    mkdirSync(join(scratch, 'sub'));
    writeFileSync(join(scratch, 'sub', 'nested.md'), 'nested');

    const buf = await packSpecDir(scratch);
    // 结尾 2×512 zero block
    expect(buf.length % 512).toBe(0);
    const tail = buf.subarray(buf.length - 1024);
    expect(tail.every((b) => b === 0)).toBe(true);
    // 不含 .runtime 段
    const asText = buf.toString('utf-8');
    expect(asText).not.toContain('.runtime');
    expect(asText).not.toContain('secret');
    // 含 spec.md / sub/nested.md
    expect(asText).toContain('spec.md');
    expect(asText).toContain('nested.md');
    expect(asText).toContain('root-spec');
  });

  it('pack → pull extractTar round-trip（自洽）', async () => {
    // 先 pack，再用 pullSpecBundle 的解包链路解到另一个目录验证内容一致
    writeFileSync(join(scratch, 'a.md'), 'AAA');
    mkdirSync(join(scratch, 'd'));
    writeFileSync(join(scratch, 'd', 'b.md'), 'BBB');
    const tar = await packSpecDir(scratch);

    const wsId = 'ws-roundtrip';
    const client = { getSpecBundle: vi.fn().mockResolvedValue(tar) } as any;
    const r = await pullSpecBundle(client, wsId, {});
    expect(readFileSync(join(r!, 'a.md'), 'utf-8')).toBe('AAA');
    expect(readFileSync(join(r!, 'd', 'b.md'), 'utf-8')).toBe('BBB');
  });
});

describe('Tar Slip 防护（pullSpecBundle → extractTar）', () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-tarslip-'));
  });
  afterEach(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('entry name 含 .. → throw', async () => {
    const tar = tarBuf([buildTarEntry('../escape.txt', 'x', '0')]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(tar) } as any;
    await expect(pullSpecBundle(client, 'ws-slip-dotdot', {})).rejects.toThrow(
      /traversal|escapes/i,
    );
  });

  it('entry name 为绝对路径（/ 开头）→ throw', async () => {
    const tar = tarBuf([buildTarEntry('/abs/escape.txt', 'x', '0')]);
    const client = { getSpecBundle: vi.fn().mockResolvedValue(tar) } as any;
    await expect(pullSpecBundle(client, 'ws-slip-abs', {})).rejects.toThrow(
      /traversal|escapes/i,
    );
  });

  it('symlink 条目跳过 + warn（不抛、不落盘）', async () => {
    // typeflag '2' = symlink，应被 warn + skip，不抛错
    const tar = tarBuf([
      buildTarEntry('link', '/etc/passwd', '2'),
      buildTarEntry('ok.md', 'kept', '0'),
    ]);
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const client = { getSpecBundle: vi.fn().mockResolvedValue(tar) } as any;
    const r = await pullSpecBundle(client, 'ws-symlink', {});
    expect(r).not.toBeNull();
    expect(existsSync(join(r!, 'ok.md'))).toBe(true);
    expect(existsSync(join(r!, 'link'))).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
    warnSpy.mockRestore();
  });
});

describe('postSpecSync', () => {
  let scratch: string;
  beforeEach(() => {
    scratch = mkdtempSync(join(tmpdir(), 'spec-sync-post-'));
  });
  afterEach(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it('client 无 postSpecSync 方法 → 返回 null', async () => {
    const r = await postSpecSync({} as any, 'ws', scratch);
    expect(r).toBeNull();
  });

  it('封装 pack + client.postSpecSync，透传 backend 响应 { ok, reparsed }', async () => {
    writeFileSync(join(scratch, 'spec.md'), 'content');
    const postSpy = vi.fn().mockResolvedValue({ ok: true, reparsed: 3 });
    const client = { postSpecSync: postSpy } as any;
    const r = await postSpecSync(client, 'ws', scratch);
    expect(r).toEqual({ ok: true, reparsed: 3 });
    expect(postSpy).toHaveBeenCalledTimes(1);
    const [wsId, tarBuf] = postSpy.mock.calls[0];
    expect(wsId).toBe('ws');
    expect(Buffer.isBuffer(tarBuf)).toBe(true);
    expect(tarBuf.length).toBeGreaterThan(0);
  });

  it('backend 非 2xx → 透传抛错', async () => {
    writeFileSync(join(scratch, 'spec.md'), 'content');
    const client = {
      postSpecSync: vi.fn().mockRejectedValue(fakeHttpErr(500, 'boom')),
    } as any;
    await expect(postSpecSync(client, 'ws', scratch)).rejects.toMatchObject({ status: 500 });
  });
});
