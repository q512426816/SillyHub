/**
 * tests/policy/allowed-roots-temp-paths.test.ts —— 写安全兜底 PolicyEngine 侧验证（task-08 / FR-007）。
 *
 * 与 permission-rules-temp-paths.test.ts 双重校验：
 *   - CLI 侧（CC --settings）：permission-rules-temp-paths.test.ts；
 *   - PolicyEngine 侧（allowed_roots isPathUnderAnyRoot）：本文件。
 *
 * 守护 daemon.ts 把 SILLYSPEC_TEMP_ROOTS 并入 PolicyCache.allowedRoots 后：
 *   - FR-007：写 c:\dev\null / 系统 temp 下文件 → PolicyEngine 判 allow；
 *   - R-01：ask_user_only=true 时写工具 allow-through，写安全靠 PolicyEngine + CLI deny 双重；
 *   - R-02：越界写（工作区根外、临时路径外，如 /etc、~/Documents）→ deny。
 *
 * 跨平台（CLAUDE.md 规则 12）：
 *   - 系统 temp 用 os.tmpdir() 真实值；
 *   - c:\dev\null Windows 专用，POSIX 上条件 skip（path-utils.resolveRealPath 在 POSIX
 *     上对 C:\dev\null 解析为相对路径，无意义）；
 *   - isPathUnderAnyRoot Windows 大小写归一（C:/dev/null vs c:\dev\null）单独验证。
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { sep } from 'node:path';
import { tmpdir, homedir } from 'node:os';
import { PolicyEngine } from '../../src/policy/filesystem-policy.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { isPathUnderAnyRoot } from '../../src/policy/path-utils.js';
import type { AuditEvent, AuditSink } from '../../src/policy/audit-sink.js';

const isWin = sep === '\\';

/** daemon.ts SILLYSPEC_TEMP_ROOTS 的等价集合（task-04 把这些并入 allowed_roots）。 */
const TEMP_ROOTS = isWin
  ? ['C:\\dev\\null', 'C:/dev/null', tmpdir()]
  : ['/dev/null', tmpdir()];

/** mock AuditSink：仅暂存事件 + 计数。 */
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
  } as unknown as AuditSink & { events: AuditEvent[]; recordCount: number };
  return sink;
}

describe('PolicyEngine allowed_roots 临时路径放行（FR-007）', () => {
  let cache: PolicyCache;
  let sink: ReturnType<typeof createMockSink>;
  let engine: PolicyEngine;

  beforeEach(() => {
    cache = new PolicyCache();
    sink = createMockSink();
    engine = new PolicyEngine(cache, sink);
    // 模拟 daemon.ts：工作区根 + 临时路径并入 allowed_roots
    cache.set('rt-claude', ['/workspace/proj', ...TEMP_ROOTS]);
  });

  // ── 临时路径放行写（FR-007）────────────────────────────────────────────────
  describe('临时路径在 allowed_roots 放行写', () => {
    it('系统 temp 下文件 → allow', () => {
      const target = isWin
        ? `${tmpdir()}\\sess_tmp\\log.json`
        : `${tmpdir()}/sess_tmp/log.json`;
      const d = engine.canWrite('rt-claude', target, 'claude', 'Write');
      expect(d.allowed).toBe(true);
      expect(d.reason).toBe('');
    });

    it('Windows c:\\dev\\null 下文件 → allow（Windows only）', () => {
      if (!isWin) return; // c:\dev\null 是 Windows 专用
      // 大写盘符写法
      const d1 = engine.canWrite('rt-claude', 'C:\\dev\\null\\foo.txt', 'claude', 'Write');
      expect(d1.allowed).toBe(true);
      // 小写盘符写法（Windows 大小写归一）
      const d2 = engine.canWrite('rt-claude', 'c:\\dev\\null\\foo.txt', 'claude', 'Write');
      expect(d2.allowed).toBe(true);
    });

    it('POSIX /dev/null 下文件 → allow（POSIX only）', () => {
      if (isWin) return;
      const d = engine.canWrite('rt-claude', '/dev/null/foo', 'claude', 'Write');
      expect(d.allowed).toBe(true);
    });

    it('allow 写记 ALLOW audit（D-006）', () => {
      const target = isWin
        ? `${tmpdir()}\\audit_ok.txt`
        : `${tmpdir()}/audit_ok.txt`;
      engine.canWrite('rt-claude', target, 'claude', 'Write');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
      expect(sink.events[0]!.decision).toBe('ALLOW');
    });
  });

  // ── 越界写 deny（R-01 / R-02）─────────────────────────────────────────────
  describe('越界写 deny', () => {
    it('写系统敏感路径 → deny（Windows C:\\Windows\\System32）', () => {
      if (!isWin) return;
      const d = engine.canWrite(
        'rt-claude',
        'C:\\Windows\\System32\\evil.dll',
        'claude',
        'Write',
      );
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('Runtime Policy 拒绝本次写入');
    });

    it('写系统敏感路径 → deny（POSIX /etc/passwd）', () => {
      if (isWin) return;
      const d = engine.canWrite('rt-claude', '/etc/passwd', 'claude', 'Write');
      expect(d.allowed).toBe(false);
      expect(d.reason).toContain('Runtime Policy 拒绝本次写入');
    });

    it('工作区根外、临时路径外的路径 → deny（~/Documents/secret）', () => {
      const docs = isWin
        ? `${homedir()}\\Documents\\secret.txt`
        : `${homedir()}/Documents/secret.txt`;
      const d = engine.canWrite('rt-claude', docs, 'claude', 'Write');
      expect(d.allowed).toBe(false);
      // homedir 下 Documents 不在 allowed_roots（仅 tmp + workspace + dev/null）
      expect(d.reason).toContain('目标目录未配置为可写目录');
    });

    it('越界 deny 记 DENY audit（D-006）', () => {
      const evil = isWin ? 'D:\\evil.txt' : '/opt/evil.txt';
      engine.canWrite('rt-claude', evil, 'claude', 'Write');
      expect(sink.recordCount).toBeGreaterThanOrEqual(1);
      expect(sink.events[0]!.decision).toBe('DENY');
    });

    it('D 盘越界写 → deny（仅 C:/dev/null 放行不泛化到 D 盘）', () => {
      if (!isWin) return;
      const d = engine.canWrite('rt-claude', 'D:\\dev\\null\\foo.txt', 'claude', 'Write');
      expect(d.allowed).toBe(false);
    });
  });

  // ── 工作区根写 allow（对照：allowed_roots 含工作区根仍正常放行）──────────
  describe('工作区根写仍 allow', () => {
    it('/workspace/proj 下文件 → allow', () => {
      const target = isWin ? 'C:\\workspace\\proj\\a.txt' : '/workspace/proj/a.txt';
      const d = engine.canWrite('rt-claude', target, 'claude', 'Write');
      expect(d.allowed).toBe(true);
    });
  });
});

// ── isPathUnderAnyRoot 临时路径纯函数校验（task-04 直接落地）──────────────────
describe('isPathUnderAnyRoot 临时路径放行（纯函数）', () => {
  it('Windows C:/dev/null 与 c:\\dev\\null 两种写法都 true（大小写归一）', () => {
    if (!isWin) return;
    // 两种 root 写法 + 两种 target 写法，4 组合均应放行
    const roots = ['C:/dev/null', 'c:\\dev\\null'];
    const targets = ['C:\\dev\\null\\foo.txt', 'c:/dev/null/bar.txt'];
    for (const root of roots) {
      for (const target of targets) {
        expect(isPathUnderAnyRoot(target, [root])).toBe(true);
      }
    }
  });

  it('Windows 系统 tmpdir 作 root → tmpdir 下文件 true', () => {
    if (!isWin) return;
    const root = tmpdir();
    expect(isPathUnderAnyRoot(`${tmpdir()}\\sub\\f.txt`, [root])).toBe(true);
  });

  it('POSIX /dev/null 作 root → /dev/null/x true', () => {
    if (isWin) return;
    expect(isPathUnderAnyRoot('/dev/null/x', ['/dev/null'])).toBe(true);
  });

  it('越界路径 false（root 为临时路径，target 在别处）', () => {
    if (isWin) {
      expect(isPathUnderAnyRoot('D:\\evil.txt', ['C:/dev/null'])).toBe(false);
      expect(isPathUnderAnyRoot('E:\\Windows\\x', [tmpdir()])).toBe(false);
    } else {
      expect(isPathUnderAnyRoot('/etc/passwd', ['/dev/null'])).toBe(false);
      expect(isPathUnderAnyRoot('/opt/evil', [tmpdir()])).toBe(false);
    }
  });
});
