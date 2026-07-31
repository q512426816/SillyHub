/**
 * tests/policy/runtime-policy.test.ts —— RuntimePolicy + PolicyCache 单测。
 *
 * task-11（2026-07-30-daemon-heartbeat-dedup-fix）口径统一回归：
 *   PolicyCache.set 存的是 `config.normalizeAllowedRoots` 归一字符串
 *   （path.resolve + 去重保序，**不 realpath、不归一大小写、不 existsSync**）。
 *   realpath（防 symlink/junction/UNC 绕过）下放到消费方判定（isPathUnderAnyRoot），
 *   set 内不触碰文件系统。这样 set 与 daemon._syncAllowedRoots 比较侧同口径，
 *   JSON.stringify 对比稳定 → 短路生效 → 消除每心跳无谓 set + stat 风暴（卡死根因）。
 *
 * 覆盖：
 *   - get 未命中返回 undefined
 *   - set 存 normalizeAllowedRoots 输出（resolve，不 realpath，保留原始大小写）
 *   - set 内不调 resolveRealPath / realpathSync / existsSync（不触碰 fs）
 *   - 不补 homedir（D-007，严格按 admin 配置；空/脏才回填 homedir）
 *   - 按 runtime_id 隔离（claude/codex 各存各，不串扰 / 不取并集）
 *   - version 单调递增（新 rid 从 1，同 rid 更新 +1）
 *   - reload 语义同 set（version 续递增）
 *   - reloadAll 全量刷新（替换内部 map）
 *
 * 注意（task-11 口径变更）：旧实现（task-02）曾把 resolveRealPath 结果存入 cache，
 *   该口径在 daemon._syncAllowedRoots 比较时与 normalizeAllowedRoots 不一致 → 每心跳
 *   changed=1 → set 风暴 → Windows 下 stat 饥饿卡死。task-01 已统一为「只 normalize 不
 *   realpath」，本文件期望值全部对齐 normalizeAllowedRoots（= path.resolve）。
 */

import { describe, it, expect, vi } from 'vitest';
import { resolve, sep, join } from 'node:path';
import { homedir } from 'node:os';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { normalizeAllowedRoots } from '../../src/config.js';

const isWin = sep === '\\';
const ROOT = resolve('.');
const SUB_DIR = join(ROOT, 'sub');

/** helper：期望值 = normalizeAllowedRoots（只 resolve，不 realpath，保留大小写）。 */
function norm(roots: string[]): string[] {
  return normalizeAllowedRoots(roots);
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
    expect(p?.allowedRoots).toEqual(norm([SUB_DIR]));
  });
});

// ── set：存 normalizeAllowedRoots 归一字符串（不 realpath） ──────────────────────

describe('PolicyCache.set', () => {
  it('每个 root 经 normalizeAllowedRoots 归一后存（只 resolve，不 realpath）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR, join(SUB_DIR, 'deep')]);
    const p = cache.get('claude');
    expect(p?.allowedRoots).toEqual(norm([SUB_DIR, join(SUB_DIR, 'deep')]));
    // 口径断言（task-11 核心）：存储值 = path.resolve 结果，逐元素等值
    expect(p?.allowedRoots).toEqual([resolve(SUB_DIR), resolve(join(SUB_DIR, 'deep'))]);
  });

  it('task-11：set 不 realpath、不归一大小写（保留原始盘符大小写）', () => {
    // set 的存储值与 normalizeAllowedRoots 完全一致；不应是 resolveRealPath（后者
    // 在 Windows 会把盘符小写化）。这里直接断言 set 输出 = normalize 输出，
    // 若 set 内误用 realpath，Windows 下盘符大小写会不一致 → 失败。
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    const stored = cache.get('claude')?.allowedRoots ?? [];
    expect(stored).toEqual([resolve(SUB_DIR)]);
    // normalizeAllowedRoots 不动大小写：resolve 后盘符保持 process.cwd 给的大小写
    expect(stored[0]).toBe(resolve(SUB_DIR));
  });

  it('task-11：set 内不调 resolveRealPath / realpathSync / existsSync（不触碰 fs）', () => {
    // 间谍 config.normalizeAllowedRoots 的依赖链不现实（纯函数），改为间谍 node:fs
    // 的 realpathSync / existsSync，确认 set 路径不触发任何 fs 系统调用。
    const cache = new PolicyCache();
    const realpathSpy = vi.spyOn(
      require('node:fs') as { realpathSync: { native: object } },
      'realpathSync',
      // 仅观察是否被调，不替换实现
    );
    const existsSpy = vi.spyOn(
      require('node:fs') as { existsSync: () => boolean },
      'existsSync',
    );

    cache.set('claude', [SUB_DIR, join(ROOT, 'maybe-missing')]);

    // set 走纯字符串归一，不应触发 realpath / existsSync（realpath 由消费方判定时做）
    expect(realpathSpy).not.toHaveBeenCalled();
    expect(existsSpy).not.toHaveBeenCalled();

    realpathSpy.mockRestore();
    existsSpy.mockRestore();
  });

  it('空数组回填 homedir（normalizeAllowedRoots B1 兜底，非 set 补 homedir）', () => {
    const cache = new PolicyCache();
    cache.set('claude', []);
    const p = cache.get('claude');
    // normalizeAllowedRoots([]) → [homedir()]，set 原样存
    expect(p?.allowedRoots).toEqual(norm([]));
    expect(p?.allowedRoots).toEqual([homedir()]);
  });

  it('非空 roots 不偷偷加 homedir（D-007 严格按 admin 配置）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    const roots = cache.get('claude')?.allowedRoots ?? [];
    // 非 homedir 的有效 root → normalize 不附加 homedir
    expect(roots).toEqual([resolve(SUB_DIR)]);
    expect(roots).not.toContain(homedir());
    expect(roots.some((r) => homedir().toLowerCase() === r.toLowerCase())).toBe(false);
  });

  it('含 .. 的 root 被 path.resolve 折叠', () => {
    const cache = new PolicyCache();
    cache.set('claude', [join(SUB_DIR, '..', 'sub')]);
    expect(cache.get('claude')?.allowedRoots).toEqual(norm([SUB_DIR]));
    expect(cache.get('claude')?.allowedRoots).toEqual([resolve(SUB_DIR)]);
  });

  it('相对路径被 path.resolve 解析为绝对路径（基于 cwd）', () => {
    const cache = new PolicyCache();
    cache.set('claude', ['sub']);
    expect(cache.get('claude')?.allowedRoots).toEqual(norm(['sub']));
    expect(cache.get('claude')?.allowedRoots).toEqual([resolve('sub')]);
  });

  it('去重保序（normalizeAllowedRoots B6，首次出现优先）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR, SUB_DIR, join(ROOT, 'other')]);
    expect(cache.get('claude')?.allowedRoots).toEqual([resolve(SUB_DIR), resolve(join(ROOT, 'other'))]);
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

    expect(claude?.allowedRoots).toEqual([resolve(SUB_DIR)]);
    expect(codex?.allowedRoots).toEqual([resolve(join(ROOT, 'codex-ws'))]);

    // claude 的 roots 里不含 codex 的目录，反之亦然（不取并集）
    expect(claude?.allowedRoots).not.toContain(resolve(join(ROOT, 'codex-ws')));
    expect(codex?.allowedRoots).not.toContain(resolve(SUB_DIR));
  });

  it('更新 claude 不影响 codex', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('codex', [join(ROOT, 'codex-ws')]);

    cache.set('claude', [join(ROOT, 'new-claude')]);

    const codex = cache.get('codex');
    expect(codex?.allowedRoots).toEqual([resolve(join(ROOT, 'codex-ws'))]);
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
    // 注：set 自身不做 diff（每次都 +1）；diff/短路是 daemon._syncAllowedRoots 的职责
    // （见 tests/daemon/sync-allowed-roots.test.ts）。
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    cache.set('claude', [SUB_DIR]); // 内容不变
    expect(cache.get('claude')?.version).toBe(2);
  });
});

// ── reload 语义同 set ────────────────────────────────────────────────────────

describe('reload', () => {
  it('reload 语义同 set（归一 + version 续递增）', () => {
    const cache = new PolicyCache();
    cache.set('claude', [SUB_DIR]);
    expect(cache.get('claude')?.version).toBe(1);

    cache.reload('claude', [join(ROOT, 'reloaded')]);
    const p = cache.get('claude');
    expect(p?.version).toBe(2);
    expect(p?.allowedRoots).toEqual([resolve(join(ROOT, 'reloaded'))]);
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
    expect(cache.get('new-runtime')?.allowedRoots).toEqual([resolve(SUB_DIR)]);
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

    expect(cache.get('claude')?.allowedRoots).toEqual([resolve(SUB_DIR)]);
    expect(cache.get('codex')?.allowedRoots).toEqual([resolve(join(ROOT, 'codex-ws'))]);
    expect(cache.get('gemini')?.allowedRoots).toEqual([resolve(join(ROOT, 'gemini-ws'))]);

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
