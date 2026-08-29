/**
 * downloadAndReplace 单元测试（R3 / 2026-08-30 审计）。
 *
 * 覆盖：失败路径清理 .tmp 残留——target 为已存在目录时 rename(file→dir)
 * 跨平台必失败（POSIX EISDIR/ENOTDIR、Windows EPERM），writeFile 的 .tmp
 * 须在 catch 中被清理（修复前残留磁盘）；成功路径 target 落盘内容完整。
 *
 * @module preflight-download-replace.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { downloadAndReplace } from '../src/preflight.js';

const noopLogger = () => undefined;

describe('downloadAndReplace（R3 .tmp 清理）', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'dl-replace-'));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  it('成功路径：下载内容原子落盘 target，无 .tmp 残留', async () => {
    const body = '// bundle v2';
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
    expect(readFileSync(join(dir, 'daemon.js'), 'utf-8')).toBe(body);
    expect(existsSync(join(dir, 'daemon.js.tmp'))).toBe(false);
  });

  it('失败路径（target 为目录 → rename 必败）→ .tmp 被清理、返回 false', async () => {
    // 预置 target 为目录：writeFile(.tmp) 成功、rename(file→dir) 失败
    mkdirSync(join(dir, 'daemon.js'));
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('// x', { status: 200 })),
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
});
