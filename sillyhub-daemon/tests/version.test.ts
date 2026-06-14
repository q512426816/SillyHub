// tests/version.test.ts
// task-14: version 语义版本工具。1:1 对齐 Python sillyhub_daemon/version.py（63 行）+ tests/test_version.py（24 用例）。
// 四个导出对照 Python __all__：
//   MIN_VERSIONS (dict) / parse_semver / format_semver / check_min_version
// 对照 Python: version.py:9 _SEMVER_RE / :11-15 MIN_VERSIONS / :18-30 parse_semver / :33-35 format_semver / :38-62 check_min_version

import { describe, it, expect } from 'vitest';
import {
  MIN_VERSIONS,
  parseSemver,
  formatSemver,
  checkMinVersion,
} from '../src/version.js';

// ── parseSemver（对照 test_version.py:16-46 TestParseSemver，10 用例）──

describe('parseSemver', () => {
  // test_version.py:17-19 test_standard
  it('标准版本号 "2.1.5" → [2,1,5]', () => {
    expect(parseSemver('2.1.5')).toEqual([2, 1, 5]);
  });

  // test_version.py:20-22 test_with_prefix（search 语义关键：处理 claude --version 实际输出）
  it('前导文本 "Claude Code 2.1.5" → [2,1,5]（search 语义，非 match）', () => {
    expect(parseSemver('Claude Code 2.1.5')).toEqual([2, 1, 5]);
  });

  // test_version.py:23-25 test_with_v_prefix
  it('v 前缀 "v2.0.0" → [2,0,0]', () => {
    expect(parseSemver('v2.0.0')).toEqual([2, 0, 0]);
  });

  // test_version.py:26-28 test_with_suffix（与 Python 一致：忽略 prerelease，见 N-14-1）
  it('prerelease 后缀 "0.118.0-rc.1" → [0,118,0]（后缀被忽略，非 semver 规范比较）', () => {
    expect(parseSemver('0.118.0-rc.1')).toEqual([0, 118, 0]);
  });

  // test_version.py:29-31 test_no_match
  it('无匹配 "no-version-here" → null', () => {
    expect(parseSemver('no-version-here')).toBeNull();
  });

  // test_version.py:32-34 test_empty（Python `if not raw` 对空串为真）
  it('空串 "" → null（对齐 Python `if not raw`）', () => {
    expect(parseSemver('')).toBeNull();
  });

  // 补强：null / undefined（TS 入参扩展 string|null|undefined，Python None）
  it('null → null', () => {
    expect(parseSemver(null)).toBeNull();
  });

  it('undefined → null', () => {
    expect(parseSemver(undefined)).toBeNull();
  });

  // test_version.py:35-37 test_leading_zeros（JS Number("02")===2，Python int("02")===2）
  it('前导零 "02.01.05" → [2,1,5]', () => {
    expect(parseSemver('02.01.05')).toEqual([2, 1, 5]);
  });

  // test_version.py:38-40 test_large_numbers
  it('大数字 "999.999.999" → [999,999,999]', () => {
    expect(parseSemver('999.999.999')).toEqual([999, 999, 999]);
  });

  // test_version.py:41-43 test_zero_version
  it('零版本 "0.0.0" → [0,0,0]', () => {
    expect(parseSemver('0.0.0')).toEqual([0, 0, 0]);
  });

  // test_version.py:44-46 test_embedded_in_longer_string（exec/search 取首个匹配）
  it('多版本号取首个 "requires 1.0.0, found 2.1.5" → [1,0,0]', () => {
    expect(parseSemver('requires 1.0.0, found 2.1.5')).toEqual([1, 0, 0]);
  });

  // 补强：正则要求恰好三段 \d+\.\d+\.\d+
  it('只有两段 "1.2" → null（正则要求三段）', () => {
    expect(parseSemver('1.2')).toBeNull();
  });

  // 补强：+build 元数据后缀（与 -prerelease 一样被忽略）
  it('+build 后缀 "1.0.0+build.123" → [1,0,0]', () => {
    expect(parseSemver('1.0.0+build.123')).toEqual([1, 0, 0]);
  });
});

// ── formatSemver（对照 test_version.py:52-60 TestFormatSemver，3 用例）──

describe('formatSemver', () => {
  // test_version.py:53-54 test_basic
  it('[2,1,5] → "2.1.5"', () => {
    expect(formatSemver([2, 1, 5])).toBe('2.1.5');
  });

  // test_version.py:56-57 test_zero_version
  it('[0,0,0] → "0.0.0"', () => {
    expect(formatSemver([0, 0, 0])).toBe('0.0.0');
  });

  // test_version.py:59-60 test_large_numbers
  it('[0,100,0] → "0.100.0"', () => {
    expect(formatSemver([0, 100, 0])).toBe('0.100.0');
  });

  // 补强：往返一致性（parse → format 再现原始串）
  it('往返一致：parseSemver(x) → formatSemver → 标准 x', () => {
    const parsed = parseSemver('3.7.2');
    expect(parsed).not.toBeNull();
    expect(formatSemver(parsed!)).toBe('3.7.2');
  });
});

// ── MIN_VERSIONS（对照 test_version.py:66-71 TestMinVersions，1 用例）──

describe('MIN_VERSIONS', () => {
  // test_version.py:67-71 test_has_three_providers
  it('恰好 3 个 provider，含 claude / codex / copilot', () => {
    expect(Object.keys(MIN_VERSIONS)).toHaveLength(3);
    expect(MIN_VERSIONS.claude).toEqual([2, 0, 0]);
    expect(MIN_VERSIONS.codex).toEqual([0, 100, 0]);
    expect(MIN_VERSIONS.copilot).toEqual([1, 0, 0]);
  });
});

// ── checkMinVersion（对照 test_version.py:77-115 TestCheckMinVersion，10 用例）──

describe('checkMinVersion', () => {
  // test_version.py:78-83 test_below_minimum（claude MIN=2.0.0）
  it('claude 低于最低（1.5.0）→ warning 含 provider / version / minVer', () => {
    const r = checkMinVersion('claude', '1.5.0');
    expect(r).not.toBeNull();
    expect(r).toContain('claude');
    expect(r).toContain('1.5.0');
    expect(r).toContain('2.0.0');
  });

  // test_version.py:85-86 test_equal_to_minimum（最低版本 inclusive）
  it('claude 等于最低（2.0.0）→ null', () => {
    expect(checkMinVersion('claude', '2.0.0')).toBeNull();
  });

  // test_version.py:88-89 test_above_minimum
  it('claude 高于最低（2.1.5）→ null', () => {
    expect(checkMinVersion('claude', '2.1.5')).toBeNull();
  });

  // test_version.py:91-92 test_unknown_provider（无 entry → 无要求）
  it('未知 provider（unknown）→ null', () => {
    expect(checkMinVersion('unknown', '1.0.0')).toBeNull();
  });

  // 补强：agent-detector 的 12 provider 中其余 provider 也无要求
  it('未知 provider（gemini）→ null', () => {
    expect(checkMinVersion('gemini', '1.0.0')).toBeNull();
  });

  // test_version.py:94-95 test_codex_at_minimum
  it('codex 等于最低（0.100.0）→ null', () => {
    expect(checkMinVersion('codex', '0.100.0')).toBeNull();
  });

  // test_version.py:97-101 test_codex_below_minimum
  it('codex 低于最低（0.99.0）→ warning 含 "0.100.0"', () => {
    const r = checkMinVersion('codex', '0.99.0');
    expect(r).not.toBeNull();
    expect(r).toContain('codex');
    expect(r).toContain('0.100.0');
  });

  // test_version.py:103-104 test_unparseable_version（解析失败不叠加噪声）
  it('无法解析的 version（claude "no-version"）→ null', () => {
    expect(checkMinVersion('claude', 'no-version')).toBeNull();
  });

  // test_version.py:106-107 test_copilot_at_minimum
  it('copilot 等于最低（1.0.0）→ null', () => {
    expect(checkMinVersion('copilot', '1.0.0')).toBeNull();
  });

  // test_version.py:109-110 test_copilot_above_minimum
  it('copilot 高于最低（1.5.3）→ null', () => {
    expect(checkMinVersion('copilot', '1.5.3')).toBeNull();
  });

  // test_version.py:112-115 test_copilot_below_minimum
  it('copilot 低于最低（0.9.0）→ warning', () => {
    const r = checkMinVersion('copilot', '0.9.0');
    expect(r).not.toBeNull();
    expect(r).toContain('copilot');
  });

  // ── warning 文本格式逐字对齐 Python version.py:57-60 f-string ──
  it('warning 文本格式与 Python 逐字一致', () => {
    const r = checkMinVersion('claude', '1.5.0');
    expect(r).toBe(
      'claude version 1.5.0 is below minimum required version 2.0.0',
    );
  });

  // 补强：三元组逐元素字典序比较（major 优先）
  it('major 相同 minor 高于（claude 2.1.0）→ null', () => {
    expect(checkMinVersion('claude', '2.1.0')).toBeNull();
  });

  it('major 相同 minor 相同 patch 高于（claude 2.0.5）→ null', () => {
    expect(checkMinVersion('claude', '2.0.5')).toBeNull();
  });

  it('major 相同 minor 低于（codex 0.99.5，99<100）→ warning', () => {
    const r = checkMinVersion('codex', '0.99.5');
    expect(r).not.toBeNull();
  });

  it('major 高于（claude 3.0.0）→ null', () => {
    expect(checkMinVersion('claude', '3.0.0')).toBeNull();
  });
});
