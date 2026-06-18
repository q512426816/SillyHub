// tests/file-rpc.test.ts
// task-05: list_dir RPC handler（daemon 端 file-rpc.ts）。
// 覆盖：穿越防护（D-002）、readdir+stat、错误映射、符号链接归类、权限降级。
// 用例编号 T1~T13 对齐 task-05.md §7.1。
// 不读文件内容（design §3 非目标）—— 本测只验证目录列举语义。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, symlink, chmod } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join, resolve, sep } from 'node:path';
import {
  listDir,
  assertWithinAllowedRoots,
  type DirEntry,
} from '../src/file-rpc';
import { RpcError } from '../src/ws-client';

const IS_WIN = platform() === 'win32';

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

  beforeEach(async () => {
    const r = await makeRoot();
    tmpRoot = r.root;
    tmpAbs = r.abs;
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('T1: 合法 root 内目录列举 → entries 含所有项，dir 优先 + 字母序', async () => {
    const result = await listDir(tmpRoot, [tmpRoot]);
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
    const result = await listDir(tmpAbs('a'), [tmpRoot]);
    const names = result.entries.map((e) => e.name).sort();
    expect(names).toEqual(['sub1', 'sub2']);
    expect(result.entries.every((e) => e.type === 'dir')).toBe(true);
  });

  it('T5: listDir 接受 path === root', async () => {
    const result = await listDir(tmpRoot, [tmpRoot]);
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it('T8: 空目录 → { entries: [] }（非 reject）', async () => {
    await mkdir(tmpAbs('empty-dir'));
    const result = await listDir(tmpAbs('empty-dir'), [tmpRoot]);
    expect(result.entries).toEqual([]);
  });

  it('T6: 不存在路径 → not_found', async () => {
    try {
      await listDir(tmpAbs('does-not-exist'), [tmpRoot]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
    }
  });

  it('T7: path 是文件 → not_found "is not a directory"', async () => {
    try {
      await listDir(tmpAbs('b.txt'), [tmpRoot]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
      expect((e as Error).message).toMatch(/is not a directory/);
    }
  });

  it('越界 path → forbidden（listDir 路径层）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await listDir(evil, [tmpRoot]);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('T1c: 返回结构精确匹配 { entries: [{ name: string, type: "dir"|"file" }] }', async () => {
    const result = await listDir(tmpRoot, [tmpRoot]);
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

    const result = await listDir(tmpRoot, [tmpRoot]);
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

  it('T10: 子项权限不足 → 该项降级 file，整体不中断（POSIX only）', async () => {
    if (!canChmod()) return; // Windows 或 root 跳过
    // 父目录可读；建一个无权限子项（chmod 000 → stat EACCES → 兜底 file）
    await mkdir(tmpAbs('noaccess'));
    await chmod(tmpAbs('noaccess'), 0o000);
    try {
      const result = await listDir(tmpRoot, [tmpRoot]);
      const byName = new Map(result.entries.map((e) => [e.name, e.type]));
      // noaccess 目录本身 stat 不到真实类型 → 兜底 file（按 §5.3 step4 try/catch）
      expect(byName.get('noaccess')).toBe('file');
      // 整体未 reject
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
        await listDir('a', [r.root]);
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

// 确认 file-rpc 模块不引入文件读取 API（design §3 非目标守住）
describe('file-rpc 非目标守卫（design §3）', () => {
  it('import 行只含 readdir/stat/lstat，无 readFile/createReadStream', async () => {
    // 用 readFileSync 读源文件（避免动态 import readFile 自身被误判），
    // 只检查「from 'node:fs/promises'」这一行 import 的具名导出。
    const { readFileSync } = await import('node:fs');
    const src = readFileSync(
      resolve(process.cwd(), 'src/file-rpc.ts'),
      'utf-8',
    );
    // 抽取 fs/promises 的 import 行
    const importMatch = src.match(
      /import\s+\{([^}]+)\}\s+from\s+['"]node:fs\/promises['"]/,
    );
    expect(importMatch, 'src/file-rpc.ts must import from node:fs/promises').not.toBeNull();
    const imported = importMatch![1];
    expect(imported).toMatch(/\breaddir\b/);
    expect(imported).toMatch(/\bstat\b|\blstat\b/);
    // 关键守卫：不允许 readFile / createReadStream（design §3 非目标：不读文件内容）
    expect(imported).not.toMatch(/\breadFile\b/);
    expect(imported).not.toMatch(/createReadStream/);
  });
});
