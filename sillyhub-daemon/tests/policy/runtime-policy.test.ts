/**
 * tests/policy/runtime-policy.test.ts —— RuntimePolicy + PolicyCache 单测（task-02）。
 *
 * 覆盖：
 *   - get 未命中返回 undefined
 *   - set 规范化 roots（resolveRealPath）+ 不补 homedir（D-007）
 *   - 按 runtime_id 隔离（claude/codex 各存各，不串扰 / 不取并集）
 *   - version 单调递增（新 rid 从 1，同 rid 更新 +1）
 *   - reload 语义同 set（version 续递增）
 *   - reloadAll 全量刷新（替换内部 map）
 */

import { describe, it, expect } from 'vitest';
import { resolve, sep, join } from 'node:path';
import { homedir } from 'node:os';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { resolveRealPath } from '../../src/policy/path-utils.js';

const isWin = sep === '\\';
const ROOT = resolve('.');
// 用真实存在的目录作为 root，确保 resolveRealPath 走 realpath 分支而非 fallback
const SUB_DIR = join(ROOT, 'sub');

/** helper：规范化路径期望值（与 PolicyCache 内部 resolveRealPath 对齐） */
function real(p: string): string {
  return resolveRealPath(p);
}

// ── get 未命中 ───────────────────────────────────────────────────────────────

describe('PolicyCache.get', () => {
  it('未命中返回 undefined', () => {
    const cache = new PolicyCache();
    expect(cache.get('unknown-rid')).toBeUndefined();
  });

  it('命中返回 RuntimePolicy（含 allowedRoots + version）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    const p = cache.get('claude');
    expect(p).toBeDefined();
    expect(p?.version).toBe(1);
    expect(p?.allowedRoots).toEqual([real(SUB_DIR)]);
  });
});

// ── set：规范化 + 不补 homedir（D-007） ───────────────────────────────────────

describe('PolicyCache.set', () => {
  it('每个 root 经 resolveRealPath 规范化后存', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR, join(SUB_DIR, 'deep')]);
    const p = cache.get('claude');
    expect(p?.allowedRoots).toEqual([real(SUB_DIR), real(join(SUB_DIR, 'deep'))]);
  });

  it('空数组也存（不补任何兜底目录）', () => {
    const cache = new PolicyCache();
    cache.set('claude', []);
    const p = cache.get('claude');
    expect(p?.allowedRoots).toEqual([]);
  });

  it('不偷偷加 homedir（D-007 严格按 admin 配置）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    const roots = cache.get('claude')?.allowedRoots ?? [];
    // homedir 不应出现在 roots 中
    expect(roots).not.toContain(homedir());
    expect(roots.some((r) => homedir().toLowerCase() === r.toLowerCase())).toBe(false);
  });

  it('含 .. 的 root 被折叠', () => {
    const cache = new PolicyCache();
    cache.set('claude', [join(SUB_DIR, '..', 'sub')]);
    expect(cache.get('claude')?.allowedRoots).toEqual([real(SUB_DIR)]);
  });

  it('相对路径被解析为绝对路径', () => {
    const cache = new PolicyCache();
    cache.set('claude', ['sub']);
    expect(cache.get('claude')?.allowedRoots).toEqual([real('sub')]);
  });
});

// ── runtime_id 隔离（D-002：不取并集） ────────────────────────────────────────

describe('runtime_id 隔离', () => {
  it('claude / codex 各存各的 roots，互不串扰', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('codex', [join(ROOT, 'codex-ws')]);

    const claude = cache.get('claude');
    const codex = cache.get('codex');

    expect(claude?.allowedRoots).toEqual([real(SUB_DIR)]);
    expect(codex?.allowedRoots).toEqual([real(join(ROOT, 'codex-ws'))]);

    // claude 的 roots 里不含 codex 的目录，反之亦然（不取并集）
    expect(claude?.allowedRoots).not.toContain(real(join(ROOT, 'codex-ws')));
    expect(codex?.allowedRoots).not.toContain(real(SUB_DIR));
  });

  it('更新 claude 不影响 codex', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('codex', [join(ROOT, 'codex-ws')]);

    cache.set('claude', [join(ROOT, 'new-claude')]);

    const codex = cache.get('codex');
    expect(codex?.allowedRoots).toEqual([real(join(ROOT, 'codex-ws'))]);
    expect(codex?.version).toBe(1); // codex 的 version 没动
  });
});

// ── version 单调递增 ──────────────────────────────────────────────────────────

describe('version 单调递增', () => {
  it('新 rid 从 1 开始', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    expect(cache.get('claude')?.version).toBe(1);
  });

  it('同 rid 更新 version +1', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('claude', [join(ROOT, 'v2')]);
    cache.set('claude', [join(ROOT, 'v3')]);
    expect(cache.get('claude')?.version).toBe(3);
  });

  it('不同 rid 各自独立计数', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('codex', [join(ROOT, 'codex-ws')]);
    cache.set('claude', [join(ROOT, 'v2')]);
    // claude=2, codex=1，各自独立
    expect(cache.get('claude')?.version).toBe(2);
    expect(cache.get('codex')?.version).toBe(1);
  });

  it('更新 root 内容相同也递增 version（语义按 set 计数，非内容 diff）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('claude', [SUB_DIR]); // 内容不变
    expect(cache.get('claude')?.version).toBe(2);
  });
});

// ── reload 语义同 set ────────────────────────────────────────────────────────

describe('reload', () => {
  it('reload 语义同 set（规范化 + version 续递增）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    expect(cache.get('claude')?.version).toBe(1);

    cache.reload('claude', [join(ROOT, 'reloaded')]);
    const p = cache.get('claude');
    expect(p?.version).toBe(2);
    expect(p?.allowedRoots).toEqual([real(join(ROOT, 'reloaded'))]);
  });

  it('reload 新 rid 等同首次 set（version 从 1）', () => {
    const cache = new PolicyCache();
    cache.reload('fresh-rid', [SUB_DIR]);
    expect(cache.get('fresh-rid')?.version).toBe(1);
  });
});

// ── reloadAll 全量刷新 ───────────────────────────────────────────────────────

describe('reloadAll', () => {
  it('全量刷新：替换内部 map（旧 rid 被清除）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('codex', [join(ROOT, 'codex-ws')]);
    // 原有 2 个

    cache.reloadAll([
      ['new-runtime', [SUB_DIR]],
    ]);

    // 旧的没了
    expect(cache.get('claude')).toBeUndefined();
    expect(cache.get('codex')).toBeUndefined();
    // 新的在
    expect(cache.get('new-runtime')?.allowedRoots).toEqual([real(SUB_DIR)]);
  });

  it('空 entries 清空整个 map', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.reloadAll([]);
    expect(cache.get('claude')).toBeUndefined();
  });

  it('全量刷新后 version 从 1 重新开始（视为全新一批）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('claude', [join(ROOT, 'v2')]); // claude version=2

    cache.reloadAll([['claude', [SUB_DIR]]]);
    // 全量刷新语义=重建，version 重置为 1
    expect(cache.get('claude')?.version).toBe(1);
  });

  it('多 runtime 同时全量刷新', () => {
    const cache = new PolicyCache();
    cache.reloadAll([
      ['claude', [SUB_DIR]],
      ['codex', [join(ROOT, 'codex-ws')]],
      ['gemini', [join(ROOT, 'gemini-ws')]],
    ]);

    expect(cache.get('claude')?.allowedRoots).toEqual([real(SUB_DIR)]);
    expect(cache.get('codex')?.allowedRoots).toEqual([real(join(ROOT, 'codex-ws'))]);
    expect(cache.get('gemini')?.allowedRoots).toEqual([real(join(ROOT, 'gemini-ws'))]);

    // 各自 version=1
    expect(cache.get('claude')?.version).toBe(1);
    expect(cache.get('codex')?.version).toBe(1);
    expect(cache.get('gemini')?.version).toBe(1);
  });
});

// ── 跨平台标记（信息性，不做断言） ──────────────────────────────────────────

describe('跨平台', () => {
  it('当前平台 sep 记录（Win/Linux/macOS 均应通过）', () => {
    // 仅确保 sep 可读，测试主体逻辑已跨平台
    expect([ '\\', '/' ]).toContain(sep);
  });
});
