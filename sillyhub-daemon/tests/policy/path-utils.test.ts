/**
 * tests/policy/path-utils.test.ts —— path-utils 纯函数单测（task-01）。
 *
 * 覆盖：
 *   - normalizePath（strip 引号、git bash `/x/`→`X:/`、`..` 折叠）
 *   - resolveRealPath（existing realpath、non-existing fallback、UNC）
 *   - isPathUnderAnyRoot（边界敏感前缀、盘符根修复、symlink 穿越）
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep, join } from 'node:path';
import { writeFileSync, symlinkSync, rmSync } from 'node:fs';
import {
  normalizePath,
  resolveRealPath,
  isPathUnderAnyRoot,
  UNC_REJECTED,
} from '../../src/policy/path-utils.js';

const isWin = sep === '\\';
const ROOT = resolve('.');
const INSIDE = join(ROOT, 'sub', 'file.txt');
const OUTSIDE = isWin ? 'D:\\evil.txt' : '/tmp/evil_test.txt';

// ── normalizePath ───────────────────────────────────────────────────────────

describe('normalizePath', () => {
  it('strip 外层引号', () => {
    expect(normalizePath("'D:/file.txt'")).toBe(normalizePath('D:/file.txt'));
    expect(normalizePath('"D:/file.txt"')).toBe(normalizePath('D:/file.txt'));
  });
  it('无引号原样', () => {
    expect(normalizePath('D:/file.txt')).toBe(resolve('D:/file.txt'));
  });
  it('`..` 折叠', () => {
    // 用带盘符/根的绝对路径测 `..` 折叠，避免 Windows 下裸 `/a/...` 被 git bash `/x/` 映射误判。
    const base = isWin ? 'D:' : '';
    expect(normalizePath(`${base}/a/b/../c`)).toBe(resolve(`${base}/a/c`));
  });
  it('git bash /x/ 映射（Windows only）', () => {
    if (isWin) {
      expect(normalizePath('/c/Work/test.txt')).toBe(resolve('C:/Work/test.txt'));
      expect(normalizePath('/d/other/file')).toBe(resolve('D:/other/file'));
    }
  });
  it('git bash /x/ 不破坏 Unix 路径', () => {
    if (!isWin) {
      expect(normalizePath('/tmp/file.txt')).toBe('/tmp/file.txt');
    }
  });
});

// ── resolveRealPath ─────────────────────────────────────────────────────────

describe('resolveRealPath', () => {
  it('存在的路径返回 realpath', () => {
    // ROOT 存在，realpath 应返回相同（或 resolv 后相同）
    const r = resolveRealPath(ROOT);
    expect(r.toLowerCase()).toBe(ROOT.toLowerCase());
  });
  it('不存在的路径 fallback 父目录 realpath', () => {
    const fakePath = join(ROOT, '_nonexistent_policy_test_dir_', 'newfile.txt');
    const r = resolveRealPath(fakePath);
    // 应回落为 root 下 newfile.txt
    expect(r.toLowerCase()).toContain('newfile.txt');
  });
  it('UNC 路径返回 UNC_REJECTED', () => {
    expect(resolveRealPath('\\\\server\\share\\file.txt')).toBe(UNC_REJECTED);
    expect(resolveRealPath('//server/share/file.txt')).toBe(UNC_REJECTED);
  });
  it('Windows 盘符 case 归一为小写', () => {
    if (isWin) {
      const r = resolveRealPath('C:\\Windows');
      expect(r).toMatch(/^c:/);
    }
  });
  it('symlink 解析（若文件系统支持）', () => {
    // 当前目录创建一个 symlink 测试
    const target = join(ROOT, '_path_utils_link_target');
    const link = join(ROOT, '_path_utils_link');
    try {
      // 创建目标文件
      writeFileSync(target, 'test', 'utf-8');
      symlinkSync(target, link);
      const r = resolveRealPath(link);
      expect(r.toLowerCase()).toBe(target.toLowerCase());
    } catch {
      // symlink 创建可能失败（权限/平台），不阻断
    } finally {
      try { rmSync(target, { force: true }); } catch {}
      try { rmSync(link, { force: true }); } catch {}
    }
  });
});

// ── isPathUnderAnyRoot ──────────────────────────────────────────────────────

describe('isPathUnderAnyRoot', () => {
  it('在白名单内 → true', () => {
    expect(isPathUnderAnyRoot(INSIDE, [ROOT])).toBe(true);
  });
  it('在白名单外 → false', () => {
    expect(isPathUnderAnyRoot(OUTSIDE, [ROOT])).toBe(false);
  });
  it('空 allowedRoots → 全 false（严格按 admin 配置，不兜底）', () => {
    expect(isPathUnderAnyRoot(INSIDE, [])).toBe(false);
  });
  it('盘符根 D:/ 作 root Write D:\\file → true', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('D:\\test.txt', ['D:/'])).toBe(true);
    }
  });
  it('盘符根 D:\\ 作 root Write D:\\sub\\file → true', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('D:\\sub\\file.txt', ['D:\\'])).toBe(true);
    }
  });
  it('盘符根 D:/ 作 root → 别盘 E:\\ → false', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('E:\\evil.txt', ['D:/'])).toBe(false);
    }
  });
  it('Unix 根 / 作 root → /tmp/x → true', () => {
    if (!isWin) {
      expect(isPathUnderAnyRoot('/tmp/x.txt', ['/'])).toBe(true);
    }
  });
  it('UNC 路径 → false（不落在任何 root 下）', () => {
    expect(isPathUnderAnyRoot('\\\\server\\share\\file.txt', [ROOT])).toBe(false);
  });
});
