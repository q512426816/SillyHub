/**
 * tests/policy/filesystem-policy.test.ts —— PolicyEngine 单测（task-05）。
 *
 * 覆盖：
 *   - canRead 任意路径 allowed=true，**不**产 audit（D-008）
 *   - canWrite 白名单内 allow + 记 ALLOW；越界 deny + 记 DENY + 中文 reason
 *   - canCreate / canDelete 同 canWrite 流程
 *   - canRename 任一端点越界 → deny
 *   - cache 未命中 → deny（不 throw，reason 注明策略未加载）
 *   - UNC 路径 → deny（reason 注明 UNC 不允许）
 *   - ALLOW 与 DENY 均记 audit（D-006 全量）
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { resolve, sep } from 'node:path';
import { PolicyEngine } from '../../src/policy/filesystem-policy.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import type { AuditEvent, AuditSink } from '../../src/policy/audit-sink.js';

const isWin = sep === '\\';
const ROOT = resolve('.');
const ALLOWED = resolve(ROOT, 'allowed');
const OUTSIDE = resolve(ROOT, 'outside');

/** mock AuditSink：实现 record 接口，统计调用 + 暂存事件。 */
function createMockSink(): AuditSink & {
  events: AuditEvent[];
  recordCount: number;
} {
  const events: AuditEvent[] = [];
  let recordCount = 0;
  const sink = {
    events,
    get recordCount() {
      return recordCount;
    },
    record(e: AuditEvent): void {
      recordCount += 1;
      events.push(e);
    },
    // AuditSink 其余方法（flush/destroy 等）测试无需调用，省略；
    // 这里仅满足 AuditSink 结构的最小 record 契约。TS 结构类型允许只多不少。
  } as unknown as AuditSink & { events: AuditEvent[]; recordCount: number };
  return sink;
}

describe('PolicyEngine', () => {
  let cache: PolicyCache;
  let sink: ReturnType<typeof createMockSink>;
  let engine: PolicyEngine;

  beforeEach(() => {
    cache = new PolicyCache();
    sink = createMockSink();
    engine = new PolicyEngine(cache, sink);
    cache.set('rt-claude', [ALLOWED]);
  });

  // ── canRead（D-008：全 allow，不 audit）─────────────────────────────────────
  describe('canRead', () => {
    it('任意路径返回 allowed=true', () => {
      const d1 = engine.canRead('rt-claude', OUTSIDE, 'claude', 'list_dir');
      expect(d1.allowed).toBe(true);
      const d2 = engine.canRead('rt-claude', ALLOWED, 'claude', 'list_dir');
      expect(d2.allowed).toBe(true);
    });

    it('不产 audit（record 未被调用）', () => {
      engine.canRead('rt-claude', OUTSIDE, 'claude', 'list_dir');
      engine.canRead('rt-claude', ALLOWED, 'claude', 'list_dir');
      expect(sink.recordCount).toBe(0);
      expect(sink.events).toHaveLength(0);
    });
  });

  // ── canWrite（白名单内 allow + 记 ALLOW；越界 deny + 记 DENY）──────────────────
  describe('canWrite', () => {
    it('白名单内路径 → allow + 记 ALLOW', () => {
      const target = resolve(ALLOWED, 'a.txt');
      const d = engine.canWrite('rt-claude', target, 'claude', 'Write');
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe('');
      expect(sink.recordCount).toBe(1);
      const ev = sink.events[0];
      expect(ev).toBeDefined();
      expect(ev!.decision).toBe('ALLOW');
      expect(ev!.provider).toBe('claude');
      expect(ev!.tool).toBe('Write');
      expect(ev!.runtimeId).toBe('rt-claude');
      expect(typeof ev!.ts).toBe('number');
    });

    it('白名单外路径 → deny + 记 DENY + 中文 reason', () => {
      const target = resolve(OUTSIDE, 'evil.txt');
      const d = engine.canWrite('rt-claude', target, 'codex', 'Edit');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('Runtime Policy 拒绝本次写入');
      expect(d.reason).toContain('Agent：codex');
      expect(d.reason).toContain('原因：目标目录未配置为可写目录');
      expect(d.reason).toContain(`目标路径：${d.normalizedPath}`);
      expect(sink.recordCount).toBe(1);
      const ev = sink.events[0];
      expect(ev).toBeDefined();
      expect(ev!.decision).toBe('DENY');
      expect(ev!.provider).toBe('codex');
      expect(ev!.reason).toBe(d.reason);
    });
  });

  // ── canCreate / canDelete（同 canWrite 流程）────────────────────────────────
  describe('canCreate / canDelete', () => {
    it('canCreate 白名单内 allow + 记 ALLOW', () => {
      const target = resolve(ALLOWED, 'new.txt');
      const d = engine.canCreate('rt-claude', target, 'claude', 'Write');
      expect(d.allowed).toBe(true);
      expect(sink.recordCount).toBe(1);
      expect(sink.events[0]!.decision).toBe('ALLOW');
    });

    it('canDelete 越界 deny + 记 DENY', () => {
      const target = resolve(OUTSIDE, 'rm.txt');
      const d = engine.canDelete('rt-claude', target, 'claude', 'Bash');
      expect(d.allowed).toBe(false);
      expect(sink.recordCount).toBe(1);
      expect(sink.events[0]!.decision).toBe('DENY');
    });
  });

  // ── canRename（两端皆需 allow）──────────────────────────────────────────────
  describe('canRename', () => {
    it('两端均在白名单内 → allow', () => {
      const from = resolve(ALLOWED, 'a.txt');
      const to = resolve(ALLOWED, 'b.txt');
      const d = engine.canRename('rt-claude', from, to, 'claude', 'Bash');
      expect(d.allowed).toBe(true);
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
    });

    it('源端越界 → deny', () => {
      const from = resolve(OUTSIDE, 'a.txt');
      const to = resolve(ALLOWED, 'b.txt');
      const d = engine.canRename('rt-claude', from, to, 'claude', 'Bash');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('源路径');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
    });

    it('目标端越界 → deny', () => {
      const from = resolve(ALLOWED, 'a.txt');
      const to = resolve(OUTSIDE, 'b.txt');
      const d = engine.canRename('rt-claude', from, to, 'claude', 'Bash');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('目标路径');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
    });

    it('两端均越界 → deny', () => {
      const from = resolve(OUTSIDE, 'a.txt');
      const to = resolve(OUTSIDE, 'b.txt');
      const d = engine.canRename('rt-claude', from, to, 'claude', 'Bash');
      expect(d.allowed).toBe(false);
    });
  });

  // ── cache 未命中 → deny（不 throw）─────────────────────────────────────────
  describe('策略未加载', () => {
    it('cache 未命中 → deny，reason 注明策略未加载，不 throw', () => {
      const target = resolve(ALLOWED, 'a.txt');
      expect(() =>
        engine.canWrite('rt-unknown', target, 'claude', 'Write'),
      ).not.toThrow();
      const d = engine.canWrite('rt-unknown', target, 'claude', 'Write');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('策略未加载');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── UNC 路径 → deny（reason 注明 UNC 不允许）───────────────────────────────
  describe('UNC 路径', () => {
    it('UNC 路径 → deny，reason 注明 UNC 不允许', () => {
      const d = engine.canWrite('rt-claude', '\\\\server\\share\\evil.txt', 'claude', 'Write');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('UNC');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
    });
  });

  // ── D-006 全量：ALLOW 与 DENY 都记 audit ────────────────────────────────────
  describe('D-006 全量审计', () => {
    it('一次 allow + 一次 deny 都被记录', () => {
      engine.canWrite('rt-claude', resolve(ALLOWED, 'ok.txt'), 'claude', 'Write');
      engine.canWrite('rt-claude', resolve(OUTSIDE, 'bad.txt'), 'claude', 'Write');
      expect(sink.recordCount).toBe(2);
      const decisions = sink.events.map((e) => e.decision).sort();
      expect(decisions).toEqual(['ALLOW', 'DENY']);
    });
  });

  // ── 跨平台 sanity（避免空 roots 时误 allow）─────────────────────────────────
  describe('空 roots', () => {
    it('allowedRoots 为空数组时所有写均 deny', () => {
      cache.set('rt-empty', []);
      const d = engine.canWrite('rt-empty', resolve(ALLOWED, 'a.txt'), 'claude', 'Write');
      expect(d.allowed).toBe(false);
    });
  });
});

// 触发 isWin 静态引用，避免未用警告（保留跨平台语义可见性）。
void isWin;
