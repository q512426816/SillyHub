// tests/file-rpc.test.ts
// task-05: list_dir RPC handler（daemon 端 file-rpc.ts）。
// 覆盖：穿越防护（D-002）、readdir+stat、错误映射、符号链接归类、权限降级。
// 用例编号 T1~T13 对齐 task-05.md §7.1。
// 2026-08-18-workspace-file-browser（task-01）：新增 explorer 三函数核心语义用例；
// 「不读文件内容」旧契约已被该变更 design §1/§7.1 显式推翻——读能力仅经
// explorerReadFile 暴露，listDir 仍不读内容（末尾守卫 describe 已同步改写）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  listDir,
  assertWithinAllowedRoots,
  explorerListDir,
  explorerReadFile,
  explorerSearch,
  EXPLORER_MAX_READ_BYTES,
  EXPLORER_EXCLUDED_NAMES,
  EXPLORER_DEFAULT_MAX_RESULTS,
  type DirEntry,
} from '../src/file-rpc';
import { RpcError } from '../src/ws-client';
import type { PolicyEngine, PolicyDecision } from '../src/policy/filesystem-policy';

const IS_WIN = platform() === 'win32';

/** 构造一个 spy PolicyEngine：记录 canRead 入参 + 可配置 decision（默认全 allow）。 */
function makePolicyEngineSpy(opts?: {
  decision?: PolicyDecision;
}): { engine: PolicyEngine; canRead: ReturnType<typeof vi.fn> } {
  const canRead = vi.fn();
  canRead.mockReturnValue(
    opts?.decision ?? { allowed: true, reason: 'allow', normalizedPath: '/x' },
  );
  // 用对象冒充 PolicyEngine 实例（listDir 只调 canRead，鸭子类型足够）。
  const engine = { canRead } as unknown as PolicyEngine;
  return { engine, canRead };
}

/** 构造临时根目录 + 测试桩文件。返回 { root, abs, file }。 */
async function makeRoot(opts?: {
  withFiles?: boolean;
  empty?: boolean;
}): Promise<{
  root: string;
  abs: (rel: string) => string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-file-rpc-'));
  const abs = (rel: string): string => join(root, rel);
  if (opts?.withFiles ?? true) {
    await mkdir(abs('a'));
    await mkdir(abs('c'));
    await writeFile(abs('b.txt'), 'hello');
  }
  return { root, abs };
}

/** 判断能否在当前进程创建/读取无权限目录（POSIX 可，Windows skip）。 */
function canChmod(): boolean {
  return !IS_WIN && typeof process.getuid === 'function' && process.getuid() !== 0;
}

/** 断言 promise 以指定 code 的 RpcError reject（explorer 用例共用）。 */
async function expectRpcError(p: Promise<unknown>, code: string): Promise<void> {
  try {
    await p;
  } catch (e) {
    expect(e).toBeInstanceOf(RpcError);
    expect((e as RpcError).code).toBe(code);
    return;
  }
  throw new Error(`expected RpcError(${code}) but promise resolved`);
}

describe('assertWithinAllowedRoots — D-002 穿越防护（task-05 T2/T3/T4/T11/T12）', () => {
  it('T2: 越界抛出的是 RpcError，code === forbidden', () => {
    const root = IS_WIN ? 'C:\\home\\x' : '/home/x';
    const evil = IS_WIN ? 'C:\\etc' : '/etc';
    try {
      assertWithinAllowedRoots(evil, [root]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
      // message 含「outside allowed_roots」便于日志检索
      expect((e as Error).message).toMatch(/outside allowed_roots/);
    }
  });

  it('T3: .. 路径穿越被 resolve 折叠后判定越界 → forbidden', () => {
    const root = IS_WIN ? 'C:\\home\\x' : '/home/x';
    // resolve("/home/x/../../etc") === "/etc"（POSIX）/ "C:\\etc"（win 用反斜杠等价）
    const traversal = IS_WIN
      ? 'C:\\home\\x\\..\\..\\etc'
      : '/home/x/../../etc';
    try {
      assertWithinAllowedRoots(traversal, [root]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('T4: 兄弟撞名前缀（/home/x-evil 不匹配 /home/x）→ forbidden', () => {
    const root = IS_WIN ? 'C:\\home\\x' : '/home/x';
    const sibling = IS_WIN ? 'C:\\home\\x-evil' : '/home/x-evil';
    try {
      assertWithinAllowedRoots(sibling, [root]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('T5: path 等于 root 本身允许通过（不抛）', () => {
    const root = IS_WIN ? 'C:\\home\\x' : '/home/x';
    expect(() => assertWithinAllowedRoots(root, [root])).not.toThrow();
  });

  it('T5b: path 是 root 子目录允许通过', () => {
    const root = IS_WIN ? 'C:\\home\\x' : '/home/x';
    const child = IS_WIN ? 'C:\\home\\x\\sub' : '/home/x/sub';
    expect(() => assertWithinAllowedRoots(child, [root])).not.toThrow();
  });

  it('T5c: 多个 allowed_roots，命中任一即可', () => {
    const roots = IS_WIN
      ? ['C:\\home\\a', 'C:\\home\\b']
      : ['/home/a', '/home/b'];
    const p = IS_WIN ? 'C:\\home\\b\\deep\\dir' : '/home/b/deep/dir';
    expect(() => assertWithinAllowedRoots(p, roots)).not.toThrow();
  });

  it('T11: allowed_roots 为空数组 → forbidden "no allowed_roots configured"', () => {
    try {
      assertWithinAllowedRoots('/anything', []);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
      expect((e as Error).message).toMatch(/no allowed_roots configured/);
    }
  });

  it('T12: path 空串 → forbidden "path is empty"', () => {
    try {
      assertWithinAllowedRoots('', ['/home/x']);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
      expect((e as Error).message).toMatch(/path is empty/);
    }
  });

  it('T12b: path 非字符串（null）→ forbidden "path is empty"', () => {
    try {
      assertWithinAllowedRoots(null as unknown as string, ['/home/x']);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('T13: Windows 大小写归一（仅 win32 跑；posix skip）', () => {
    if (!IS_WIN) return; // POSIX 大小写敏感，跳过
    const root = 'C:\\Users\\x';
    const upper = 'C:\\USERS\\X';
    expect(() => assertWithinAllowedRoots(upper, [root])).not.toThrow();
  });
});

describe('listDir — readdir+stat（task-05 T1/T6/T7/T8）', () => {
  let tmpRoot: string;
  let tmpAbs: (rel: string) => string;
  let engine: PolicyEngine;
  let canRead: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const r = await makeRoot();
    tmpRoot = r.root;
    tmpAbs = r.abs;
    const spy = makePolicyEngineSpy();
    engine = spy.engine;
    canRead = spy.canRead;
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('T1: 合法 root 内目录列举 → entries 含所有项，dir 优先 + 字母序', async () => {
    const result = await listDir(tmpRoot, engine, 'rt-T1');
    expect(result.entries.length).toBe(3);
    // 排序：dir 优先（a, c），再 file（b.txt）；同类字母序：a < c, b.txt 唯一 file
    const names = result.entries.map((e) => e.name);
    expect(names).toEqual(['a', 'c', 'b.txt']);
    // 类型映射
    const byName = new Map(result.entries.map((e) => [e.name, e.type]));
    expect(byName.get('a')).toBe('dir');
    expect(byName.get('c')).toBe('dir');
    expect(byName.get('b.txt')).toBe('file');
  });

  it('T1b: path 为 root 子目录，列举该子目录', async () => {
    await mkdir(tmpAbs('a/sub1'));
    await mkdir(tmpAbs('a/sub2'));
    const result = await listDir(tmpAbs('a'), engine, 'rt-T1b');
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['sub1', 'sub2']);
    expect(result.entries.every((e) => e.type === 'dir')).toBe(true);
  });

  it('T5: listDir 接受 path === root', async () => {
    const result = await listDir(tmpRoot, engine, 'rt-T5');
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('T8: 空目录 → { entries: [] }（非 reject）', async () => {
    await mkdir(tmpAbs('empty-dir'));
    const result = await listDir(tmpAbs('empty-dir'), engine, 'rt-T8');
    expect(result.entries).toEqual([]);
  });

  it('T6: 不存在路径 → not_found', async () => {
    try {
      await listDir(tmpAbs('does-not-exist'), engine, 'rt-T6');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
    }
  });

  it('T7: path 是文件 → not_found "is not a directory"', async () => {
    try {
      await listDir(tmpAbs('b.txt'), engine, 'rt-T7');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
      expect((e as Error).message).toMatch(/is not a directory/);
    }
  });

  it('policyEngine 为 null + fallback_roots 越界 → forbidden（向后兼容路径层）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await listDir(evil, null, 'rt-fb', [tmpRoot]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('T18a: policyEngine.canRead 透传 runtimeId + path（读自由，即便旧白名单外也放行）', async () => {
    // canRead 默认全 allow（D-008 读自由）——即便 path 在旧 allowed_roots 之外也不抛。
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    // 越界路径在真实 fs 多半不存在 → lstat 抛 not_found；我们只断言「不被 canRead 拦」。
    try {
      await listDir(evil, engine, 'rt-T18a');
    } catch (e) {
      // 只允许 not_found（说明越过了权限校验进入 fs 层），不允许 forbidden。
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
    }
    // canRead 收到透传的 runtimeId + path（task-18 验收：runtimeId 透传）。
    expect(canRead).toHaveBeenCalledWith('rt-T18a', evil);
  });

  it('T1c: 返回结构精确匹配 { entries: [{ name: string, type: "dir"|"file" }] }', async () => {
    const result = await listDir(tmpRoot, engine, 'rt-T1c');
    expect(Object.keys(result).sort()).toEqual(['entries']);
    for (const e of result.entries as DirEntry[]) {
      expect(Object.keys(e).sort()).toEqual(['name', 'type']);
      expect(typeof e.name).toBe('string');
      expect(e.type === 'dir' || e.type === 'file').toBe(true);
    }
  });
});

describe('listDir — 符号链接与权限（task-05 T9/T10）', () => {
  let tmpRoot: string;
  let tmpAbs: (rel: string) => string;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    tmpRoot = r.root;
    tmpAbs = r.abs;
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('T9: 符号链接归类（symlink→dir 归 dir，symlink→file 归 file，dangling 兜底 file）', async () => {
    // Windows 创建符号链接需管理员权限 / Developer Mode。无权限时 skip。
    try {
      await mkdir(tmpAbs('realdir'));
      await writeFile(tmpAbs('realfile.txt'), 'x');
      await symlink(
        tmpAbs('realdir'),
        tmpAbs('link-to-dir'),
        IS_WIN ? 'junction' : 'dir',
      );
      await symlink(
        tmpAbs('realfile.txt'),
        tmpAbs('link-to-file'),
        IS_WIN ? 'file' : 'file',
      );
      await symlink(
        tmpAbs('no-such-target'),
        tmpAbs('dangling-link'),
        IS_WIN ? 'file' : 'file',
      );
    } catch (e) {
      // EPERM/EXIST 等：本环境不支持创建 symlink，跳过本用例
      if (
        (e as NodeJS.ErrnoException).code === 'EPERM' ||
        (e as NodeJS.ErrnoException).code === 'EEXIST'
      ) {
        return;
      }
      throw e;
    }

    const result = await listDir(tmpRoot, null, "rt-symlink", [tmpRoot]);
    const byName = new Map(result.entries.map((e) => [e.name, e.type]));
    // stat 跟随 symlink：symlink→dir 归 dir
    expect(byName.get('link-to-dir')).toBe('dir');
    // symlink→file 归 file
    expect(byName.get('link-to-file')).toBe('file');
    // dangling：stat 失败 → 兜底 file，且不中断整体
    expect(byName.get('dangling-link')).toBe('file');
    // 整体不 reject（已到这里）
    expect(result.entries.length).toBeGreaterThanOrEqual(3);
  }, 10_000);

  it('T10: 子项 stat EACCES（穿越无权限父目录）→ 兜底 file（POSIX only）', async () => {
    if (!canChmod()) return; // Windows 或 root 跳过
    // 直接子项 chmod 000 不能让 stat 失败（POSIX stat 只需父目录 x 权限，不检查目标
    // 自身权限）。构造 symlink 指向「无权限父目录下的文件」：stat(symlink) 跟随 →
    // 穿越无 x 的 noaccess → EACCES → 兜底 file（§5.3 step4 try/catch）。
    try {
      await mkdir(tmpAbs('noaccess'));
      await writeFile(tmpAbs('noaccess/secret'), 'x');
      await chmod(tmpAbs('noaccess'), 0o000);
      await symlink(tmpAbs('noaccess/secret'), tmpAbs('locked-link'), 'file');
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // 不支持创建 symlink
      throw e;
    }
    try {
      const result = await listDir(tmpRoot, null, "rt-symlink", [tmpRoot]);
      const byName = new Map(result.entries.map((e) => [e.name, e.type]));
      // stat 穿越无权限目录 → EACCES → 兜底 file，整体不中断
      expect(byName.get('locked-link')).toBe('file');
      expect(result.entries.length).toBeGreaterThanOrEqual(1);
    } finally {
      // 恢复权限以便 rm 清理
      await chmod(tmpAbs('noaccess'), 0o755).catch(() => undefined);
    }
  });
});

describe('listDir — resolve 一致性（Windows 路径形态）', () => {
  it('传入相对路径在 root 内（cwd 偶然外）会被 resolve 规范化后判定', async () => {
    const r = await makeRoot();
    try {
      // resolve('a') 基于 process.cwd() —— 若 cwd 不在 root 内必越界 forbidden
      // 本用例不假设 cwd，仅断言「相对路径不会绕过 root 校验」
      let caught: unknown;
      try {
        await listDir('a', null, 'rt-resolve', [r.root]);
      } catch (e) {
        caught = e;
      }
      // 要么 forbidden（cwd 在 root 外），要么 not_found（cwd 在 root 内但无 a），
      // 二者都说明 resolve 把相对路径归到某绝对路径再判定，而非直接通过
      if (caught instanceof RpcError) {
        expect(['forbidden', 'not_found']).toContain(caught.code);
      } else {
        // 罕见：cwd===r.root 且恰好有 a 子目录 → 成功也合理（resolve 后在 root 内）
        expect(caught).toBeUndefined();
      }
    } finally {
      await rm(r.root, { recursive: true, force: true });
    }
  });
});

// task-18: list_dir 改调 PolicyEngine.canRead（D-008：读全 allow、不产 audit）。
describe('listDir — PolicyEngine 接入（task-18 / D-008）', () => {
  it('canRead 全 allow、不产 audit 事件（mock auditSink.record 未被调）', async () => {
    const { PolicyCache } = await import('../src/policy/runtime-policy.js');
    const { PolicyEngine } = await import('../src/policy/filesystem-policy.js');
    const { AuditSink } = await import('../src/policy/audit-sink.js');

    // 真实 PolicyCache + 真实 PolicyEngine + mock AuditSink（拦截 record）。
    const cache = new PolicyCache();
    const record = vi.fn();
    // AuditSink 构造需 sender（这里 flush 不触发，sender 给空函数）。
    const auditSink = {
      record,
      flush: vi.fn().mockResolvedValue(undefined),
    } as unknown as InstanceType<typeof AuditSink>;
    const engine = new PolicyEngine(cache, auditSink);

    const r = await makeRoot();
    try {
      // 命中 root（白名单内放行，行为不变）。
      const result = await listDir(r.root, engine, 'rt-D008');
      expect(result.entries.length).toBeGreaterThanOrEqual(0);
      // D-008：canRead 不调 auditSink.record（读不审计）。
      expect(record).not.toHaveBeenCalled();
    } finally {
      await rm(r.root, { recursive: true, force: true });
    }
  });

  it('runtimeId 透传：listDir 把发起 runtime 的 id 传给 canRead', async () => {
    const spy = makePolicyEngineSpy();
    const r = await makeRoot();
    try {
      await listDir(r.root, spy.engine, 'rt-xyz-789');
      expect(spy.canRead).toHaveBeenCalledWith('rt-xyz-789', r.root);
    } finally {
      await rm(r.root, { recursive: true, force: true });
    }
  });
});

// ── explorer 系列（2026-08-18-workspace-file-browser task-01 / design §5 §7.1）──
// 此处为任务内核心语义冒烟；全量矩阵（含更多逃逸形态/编码组合）在 task-03 的
// file-rpc-explorer.test.ts。
describe('explorer 系列 — 双重校验与核心语义（task-01）', () => {
  let root: string;
  let abs: (rel: string) => string;

  beforeEach(async () => {
    const r = await makeRoot(); // a/ c/ 目录 + b.txt
    root = r.root;
    abs = r.abs;
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('explorerListDir：entries 含 size/mtime(ISO 串)，dir 优先 + 字母序，键精确对齐契约', async () => {
    const res = await explorerListDir(root, root, [root]);
    expect(res.entries.map((e) => e.name)).toEqual(['a', 'c', 'b.txt']);
    const b = res.entries.find((e) => e.name === 'b.txt');
    expect(b).toBeDefined();
    expect(b!.type).toBe('file');
    expect(b!.size).toBe(5); // 'hello'
    expect(b!.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    for (const e of res.entries) {
      expect(Object.keys(e).sort()).toEqual(['mtime', 'name', 'size', 'type']);
    }
  });

  it('explorerListDir：非目录 → not_found；不存在 → not_found', async () => {
    await expectRpcError(explorerListDir(abs('b.txt'), root, [root]), 'not_found');
    await expectRpcError(explorerListDir(abs('no-such'), root, [root]), 'not_found');
  });

  it('双重校验第 1 层：path 直接在 root 外（绝对路径穿越）→ forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    await expectRpcError(explorerListDir(evil, root, [root]), 'forbidden');
    await expectRpcError(explorerReadFile(evil, root, [root]), 'forbidden');
  });

  it('双重校验第 2 层：path 在 root 内但 root 不在 allowed_roots → forbidden', async () => {
    const other = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-other-'));
    try {
      await expectRpcError(explorerListDir(abs('a'), root, [other]), 'forbidden');
      await expectRpcError(explorerReadFile(abs('b.txt'), root, [other]), 'forbidden');
      await expectRpcError(explorerSearch(root, 'a', [other]), 'forbidden');
    } finally {
      await rm(other, { recursive: true, force: true });
    }
  });

  it('realpath 逃逸：工作区内链接指向 root 外 → forbidden（dir 用 junction，Win 免管理员）', async () => {
    const outside = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-out-'));
    try {
      await writeFile(join(outside, 'secret.txt'), 'x');
      try {
        await symlink(outside, abs('escape-dir'), IS_WIN ? 'junction' : 'dir');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return; // 无 symlink 权限环境跳过
        throw e;
      }
      await expectRpcError(
        explorerListDir(abs('escape-dir'), root, [root]),
        'forbidden',
      );
      await expectRpcError(
        explorerReadFile(join(abs('escape-dir'), 'secret.txt'), root, [root]),
        'forbidden',
      );
    } finally {
      await rm(outside, { recursive: true, force: true });
    }
  }, 10_000);

  it('root 本身是 symlink/junction 不误拒（realpath 双方解析 + roots 条目归一）', async () => {
    const real = await mkdtemp(join(tmpdir(), 'sillyhub-explorer-real-'));
    try {
      await writeFile(join(real, 'in-root.txt'), 'hi');
      const link = join(tmpdir(), `sillyhub-explorer-link-${Date.now()}`);
      try {
        await symlink(real, link, IS_WIN ? 'junction' : 'dir');
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code === 'EPERM') return;
        throw e;
      }
      try {
        // path 用真实路径、root 用链接形态：realpath 后相等 → 放行
        const res = await explorerListDir(real, link, [link]);
        expect(res.entries.map((e) => e.name)).toContain('in-root.txt');
        // 两者都用链接形态：realpath 解析到同一落点 → 放行
        const res2 = await explorerListDir(link, link, [link]);
        expect(res2.entries.length).toBeGreaterThan(0);
      } finally {
        await rm(link, { recursive: true, force: true }); // 只删链接本体不删 real
      }
    } finally {
      await rm(real, { recursive: true, force: true });
    }
  }, 10_000);

  it('explorerReadFile：utf8 文本 → 原文 + binary=false；键精确对齐契约', async () => {
    await writeFile(abs('note.md'), '你好, explorer');
    const res = await explorerReadFile(abs('note.md'), root, [root]);
    expect(Object.keys(res).sort()).toEqual([
      'binary',
      'content',
      'mtime',
      'name',
      'size',
      'truncated',
    ]);
    expect(res.name).toBe('note.md');
    expect(res.content).toBe('你好, explorer');
    expect(res.binary).toBe(false);
    expect(res.truncated).toBe(false);
    expect(res.size).toBe(Buffer.byteLength('你好, explorer'));
    expect(res.mtime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('explorerReadFile：NUL 字节 → binary=true + base64 兜底（不报错）', async () => {
    const raw = Buffer.from([0x00, 0x01, 0x02, 0x03]);
    await writeFile(abs('bin.dat'), raw);
    const res = await explorerReadFile(abs('bin.dat'), root, [root]);
    expect(res.binary).toBe(true);
    expect(res.content).toBe(raw.toString('base64'));
  });

  it('explorerReadFile：encoding=base64 强制 base64（文本文件也走 base64，download 链路）', async () => {
    await writeFile(abs('plain.txt'), 'hello');
    const res = await explorerReadFile(abs('plain.txt'), root, [root], 'base64');
    expect(res.binary).toBe(false);
    expect(res.content).toBe(Buffer.from('hello').toString('base64'));
  });

  it('explorerReadFile：超 10MB → truncated=true 且 content 恰为前 10MB（截断先于传输）', async () => {
    const buf = Buffer.alloc(EXPLORER_MAX_READ_BYTES + 5, 0x61); // 'a'
    await writeFile(abs('big.txt'), buf);
    const res = await explorerReadFile(abs('big.txt'), root, [root]);
    expect(res.truncated).toBe(true);
    expect(res.size).toBe(EXPLORER_MAX_READ_BYTES + 5);
    expect(Buffer.byteLength(res.content, 'utf8')).toBe(EXPLORER_MAX_READ_BYTES);
    expect(res.binary).toBe(false);
  }, 20_000);

  it('explorerReadFile：截断误切多字节字符 → 不误判 binary、content 裁到有效边界无 U+FFFD', async () => {
    // 前 10MB-1 字节 'a'，随后 2 字节 é(0xC3 0xA9) 跨截断边界：窗口尾部只剩孤立的 0xC3。
    const buf = Buffer.alloc(EXPLORER_MAX_READ_BYTES + 1, 0x61);
    buf[EXPLORER_MAX_READ_BYTES - 1] = 0xc3;
    buf[EXPLORER_MAX_READ_BYTES] = 0xa9;
    await writeFile(abs('cut.txt'), buf);
    const res = await explorerReadFile(abs('cut.txt'), root, [root]);
    expect(res.truncated).toBe(true);
    expect(res.binary).toBe(false); // 截断误切不得误判二进制
    expect(res.content).toBe('a'.repeat(EXPLORER_MAX_READ_BYTES - 1));
    expect(res.content.includes('�')).toBe(false); // 不得产生替换符乱码
  }, 20_000);

  it('explorerReadFile：目录 → not_found', async () => {
    await expectRpcError(explorerReadFile(abs('a'), root, [root]), 'not_found');
  });

  it('explorerSearch：大小写不敏感子串匹配 + 相对路径 POSIX 风格 + 目录也命中', async () => {
    await mkdir(abs('src'));
    await writeFile(abs('src/Alpha.ts'), 'x');
    await writeFile(abs('src/readme-alpha.md'), 'x');
    await writeFile(abs('zz-unrelated.txt'), 'x');
    await mkdir(abs('AlphaDocs'));
    const res = await explorerSearch(root, 'ALPHA', [root]);
    expect(Object.keys(res).sort()).toEqual(['matches', 'truncated']);
    const paths = res.matches.map((m) => m.path);
    expect(paths).toContain('src/Alpha.ts');
    expect(paths).toContain('src/readme-alpha.md');
    expect(paths).toContain('AlphaDocs');
    expect(res.matches.find((m) => m.path === 'AlphaDocs')!.type).toBe('dir');
    expect(paths).not.toContain('zz-unrelated.txt');
    // 相对路径统一 POSIX 分隔（Windows 也不出反斜杠）
    expect(res.matches.every((m) => !m.path.includes('\\'))).toBe(true);
    expect(res.truncated).toBe(false);
    for (const m of res.matches) {
      expect(Object.keys(m).sort()).toEqual(['name', 'path', 'type']);
    }
  });

  it('explorerSearch：跳过 node_modules/.git 等噪声目录（EXPLORER_EXCLUDED_NAMES）', async () => {
    await mkdir(abs('node_modules/pkg'), { recursive: true });
    await writeFile(abs('node_modules/pkg/alpha-needle.js'), 'x');
    await writeFile(abs('alpha-keep.ts'), 'x');
    const res = await explorerSearch(root, 'alpha', [root]);
    expect(res.matches.map((m) => m.path)).toEqual(['alpha-keep.ts']);
  });

  it('explorerSearch：达 maxResults 上限 → 截到上限 + truncated=true 收敛', async () => {
    for (let i = 0; i < 3; i++) {
      await writeFile(abs(`needle-${i}.txt`), 'x');
    }
    const res = await explorerSearch(root, 'needle', [root], 2);
    expect(res.matches.length).toBe(2);
    expect(res.truncated).toBe(true);
  });

  it('explorerSearch：空 query → forbidden；root 不存在 → not_found', async () => {
    await expectRpcError(explorerSearch(root, '', [root]), 'forbidden');
    await expectRpcError(
      explorerSearch(join(root, 'no-such'), 'x', [root]),
      'not_found',
    );
  });
});

// ── 读能力守卫（契约更新版）──────────────────────────────────────────────────
// 2026-08-18-workspace-file-browser（task-01）：本变更 design §1/§7.1 显式引入
// 文件内容读取，推翻 2026-06 旧变更「file-rpc 不读文件内容（readFile）」的非目标。
// 旧守卫「import 行不得含 readFile」基于已过时契约，同步改写为新契约守卫：
// listDir 仍不读文件内容，读能力仅经 explorerReadFile 暴露。
describe('file-rpc 读能力守卫（契约更新：2026-08-18-workspace-file-browser design §1/§7.1）', () => {
  it('listDir 函数体不引用 readFile/createReadStream——列举通道仍不读文件内容', async () => {
    // 用 readFileSync 读源文件（避免动态 import readFile 自身被误判）。
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(resolve(process.cwd(), 'src/file-rpc.ts'), 'utf-8');
    const start = src.indexOf('export async function listDir');
    expect(start).toBeGreaterThanOrEqual(0);
    // listDir 源文本 = 声明处到下一个顶层 export（explorer 常量/函数）之间，
    // 其间只含 listDir 与私有 toRpcError——均不得引用读内容 API。
    const nextExport = src.indexOf('\nexport ', start + 1);
    const body = src.slice(start, nextExport === -1 ? undefined : nextExport);
    expect(body).toMatch(/\breaddir\b/); // 列举语义仍在
    expect(body).not.toMatch(/\breadFile\b/);
    expect(body).not.toMatch(/createReadStream/);
  });

  it('读能力仅经 explorerReadFile 暴露——三个 explorer 函数与常量契约存在', () => {
    expect(typeof explorerListDir).toBe('function');
    expect(typeof explorerReadFile).toBe('function');
    expect(typeof explorerSearch).toBe('function');
    // 签名形状：前三参数均为安全关键三元组 (path|root, root, roots)；
    // encoding / maxResults 为带默认值的可选尾参（Function.length 不计入）。
    expect(explorerListDir).toHaveLength(3);
    expect(explorerReadFile).toHaveLength(3);
    expect(explorerSearch).toHaveLength(3);
    // 常量契约（D-004@v1 10MB / design §7.1 上限默认 100 / 噪声排除表）。
    // ESM 静态 import 本身守卫「未导出即链接失败」；此处再校验运行时值。
    expect(EXPLORER_MAX_READ_BYTES).toBe(10 * 1024 * 1024);
    expect(EXPLORER_EXCLUDED_NAMES.has('node_modules')).toBe(true);
    expect(EXPLORER_EXCLUDED_NAMES.has('.git')).toBe(true);
    expect(EXPLORER_DEFAULT_MAX_RESULTS).toBe(100);
  });
});
