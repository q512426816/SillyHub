/**
 * downloadAndReplace 单元测试（R3 / 2026-08-30 审计 + daemon-self-heal task-04）。
 *
 * 覆盖：
 *   - 失败路径清理 .tmp 残留——target 为已存在目录时 rename(file→dir)
 *     跨平台必失败（POSIX EISDIR/ENOTDIR、Windows EPERM），writeFile 的 .tmp
 *     须在 catch 中被清理（修复前残留磁盘）；成功路径 target 落盘内容完整。
 *   - D-003 写前内容校验：坏内容（<64KB 无 BUILD_ID）不落盘、不残留 .tmp、
 *     旧 target 原样保留；合法 fixture 一律 validFakeBundle（≥64KB 且含
 *     BUILD_ID——写盘成功路径的 body 必须过校验，404/网络失败才走原失败档）。
 *   - D-004 备份轮换：连续替换同前缀 .bak 保留最近 3 份、最旧被清、同秒
 *     同名覆盖不增份。
 *
 * @module preflight-download-replace.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAndReplace, validateBundleContent, MIN_BUNDLE_BYTES } from '../src/preflight.js';

// ql-20260831-001-6dde：copyFile 可覆写口（默认透传真实实现）——备份失败用例
// 模拟 ENOSPC 中途留下半截 .bak。先例：autostart.test.ts 的 node:fs/promises
// 局部覆写（vi.hoisted holder + spread actual 透传）。
const { copyFileOverride } = vi.hoisted(() => ({
  copyFileOverride: {
    impl: null as null | ((src: unknown, dest: unknown) => Promise<void>),
  },
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    copyFile: async (...args: Parameters<typeof actual.copyFile>) => {
      if (copyFileOverride.impl) {
        return copyFileOverride.impl(args[0], args[1]);
      }
      return actual.copyFile(...args);
    },
  };
});

const noopLogger = () => undefined;

interface LogEntry {
  level: string;
  msg: string;
  data?: Record<string, unknown>;
}

/** 收集 (level,msg,data) 调用为 entries 数组（坏内容用例断言 warn 事件用）。 */
function makeLogger(): {
  fn: (level: string, msg: string, data?: Record<string, unknown>) => void;
  entries: LogEntry[];
} {
  const entries: LogEntry[] = [];
  const fn = (level: string, msg: string, data?: Record<string, unknown>): void => {
    entries.push({ level, msg, data });
  };
  return { fn, entries };
}

/**
 * 合法假 bundle（D-006/D-003 口径）：≥ MIN_BUNDLE_BYTES 且含可提取 BUILD_ID。
 * 与 preflight.test.ts 各自内联（本任务仅允许改两个测试文件，不新增共享文件）。
 */
function validFakeBundle(buildId: string): Buffer {
  return Buffer.concat([
    Buffer.from(`export const BUILD_ID = "${buildId}";\n`),
    Buffer.alloc(MIN_BUNDLE_BYTES),
  ]);
}

describe('downloadAndReplace（R3 .tmp 清理）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dl-replace-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    copyFileOverride.impl = null;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('成功路径：下载内容原子落盘 target，无 .tmp 残留', async () => {
    const body = validFakeBundle('v2');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(body, { status: 200 })),
    );
    const ok = await downloadAndReplace(
      'http://hub.test/bundle.js',
      'v2',
      'v1',
      dir,
      noopLogger,
      'daemon.js',
    );
    expect(ok).toBe(true);
    // D-006：fixture 为合法假 bundle，落盘内容过校验且 BUILD_ID 提取正确
    const v = validateBundleContent(readFileSync(join(dir, 'daemon.js')));
    expect(v.ok).toBe(true);
    expect(v.buildId).toBe('v2');
    expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false);
  });

  it('失败路径（target 为目录 → rename 必败）→ .tmp 被清理、返回 false', async () => {
    // 预置 target 为目录：writeFile(.tmp) 成功、rename(file→dir) 失败。
    // body 须为合法 bundle——坏内容会被写前校验拦下，到不了 rename，
    // 覆盖不到 R3 的 .tmp 清理路径。
    mkdirSync(join(dir, 'daemon.js'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(validFakeBundle('v2'), { status: 200 })),
    );
    const ok = await downloadAndReplace(
      'http://hub.test/bundle.js',
      'v2',
      'v1',
      dir,
      noopLogger,
      'daemon.js',
    );
    expect(ok).toBe(false);
    expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false); // R3：不留残留
    expect(existsSync(join(dir, 'daemon.js'))).toBe(true); // 原目录原样
  });

  it('下载非 200 → false 且无任何落盘（.tmp 也不出现）', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const ok = await downloadAndReplace(
      'http://hub.test/bundle.js',
      'v2',
      'v1',
      dir,
      noopLogger,
      'daemon.js',
    );
    expect(ok).toBe(false);
    expect(existsSync(join(dir, 'daemon.js'))).toBe(false);
    expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false);
  });

  it('坏内容（<64KB 无 BUILD_ID）→ 写前校验拦截：false、无落盘无 .tmp、旧 target 原样、warn 校验失败', async () => {
    const { fn, entries } = makeLogger();
    // 预置旧 target：拦截后必须逐字节原样保留
    writeFileSync(join(dir, 'daemon.js'), validFakeBundle('v1'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('NEW BUNDLE BODY', { status: 200 })),
    );
    const ok = await downloadAndReplace(
      'http://hub.test/bundle.js',
      'v2',
      'v1',
      dir,
      fn,
      'daemon.js',
    );
    expect(ok).toBe(false);
    expect(readFileSync(join(dir, 'daemon.js'))).toEqual(validFakeBundle('v1')); // 旧文件未动
    expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false); // 无 .tmp 残留
    expect(readdirSync(dir)).toEqual(['daemon.js']); // 除旧 target 外零新增（无 .bak）
    const e = entries.find((x) => x.msg === 'daemon_bundle_validation_failed');
    expect(e?.level).toBe('warn');
    expect(e?.data).toMatchObject({ size: 15, buildId: null });
  });

  it('备份轮换：连续 4 次替换保留最近 3 份 .bak、最旧被清、target 为最新；同秒替换不增份', async () => {
    vi.useFakeTimers();
    try {
      writeFileSync(join(dir, 'daemon.js'), validFakeBundle('v0'));
      const fetchFor = (buf: Buffer): void => {
        vi.stubGlobal('fetch', vi.fn(async () => new Response(buf, { status: 200 })));
      };
      const bakNames = (): string[] =>
        readdirSync(dir).filter((n) => n.startsWith('daemon.js.bak-')).sort();

      // 4 次替换，每次隔 1 秒（时间戳纯数字定长，字典序即时间序）
      for (let i = 1; i <= 4; i++) {
        vi.setSystemTime(new Date(2026, 7, 30, 12, 0, i));
        fetchFor(validFakeBundle(`v${i}`));
        const ok = await downloadAndReplace(
          'http://hub.test/bundle.js',
          `v${i}`,
          'v0',
          dir,
          noopLogger,
          'daemon.js',
        );
        expect(ok).toBe(true);
      }
      const baks = bakNames();
      expect(baks).toHaveLength(3); // 轮换上限 3 份
      expect(baks[0]).toBe('daemon.js.bak-20260830-120002'); // 最旧（120001）被清
      expect(baks[2]).toBe('daemon.js.bak-20260830-120004');
      expect(validateBundleContent(readFileSync(join(dir, 'daemon.js'))).buildId).toBe('v4'); // target = 最新内容

      // 同秒再替换一次 → 备份同名覆盖，份数不增（天然去重）
      vi.setSystemTime(new Date(2026, 7, 30, 12, 0, 4));
      fetchFor(validFakeBundle('v5'));
      const ok = await downloadAndReplace(
        'http://hub.test/bundle.js',
        'v5',
        'v0',
        dir,
        noopLogger,
        'daemon.js',
      );
      expect(ok).toBe(true);
      expect(bakNames()).toHaveLength(3);
      expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it('备份 copyFile 中途失败（ENOSPC 留半截 .bak）→ 残件被清理不留位、替换仍成功（ql-20260831-001-6dde）', async () => {
    // 预置旧 target（合法旧 bundle）供备份与替换。
    writeFileSync(join(dir, 'daemon.js'), validFakeBundle('v1'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(validFakeBundle('v2'), { status: 200 })),
    );
    // 模拟磁盘满中途失败：copyFile 先写出半截目标再抛 ENOSPC。
    copyFileOverride.impl = async (_src, dest) => {
      writeFileSync(String(dest), 'partial-bytes');
      throw Object.assign(new Error('ENOSPC: no space left on device'), {
        code: 'ENOSPC',
      });
    };
    const { fn, entries } = makeLogger();

    const ok = await downloadAndReplace(
      'http://hub.test/bundle.js',
      'v2',
      'v1',
      dir,
      fn,
      'daemon.js',
    );

    // 备份失败不阻塞替换（warn 语义不变）
    expect(ok).toBe(true);
    expect(entries.some((x) => x.msg === 'daemon_bundle_backup_failed')).toBe(true);
    // 修复点：半截 .bak 不残留——否则按字典序轮换会占掉「最近 3 份」名额，
    // 多轮后完整历史备份被挤光，人工 .bak 兜底无物可用。
    expect(readdirSync(dir).filter((n) => n.startsWith('daemon.js.bak-'))).toEqual([]);
    expect(validateBundleContent(readFileSync(join(dir, 'daemon.js'))).buildId).toBe('v2');
  });
});
