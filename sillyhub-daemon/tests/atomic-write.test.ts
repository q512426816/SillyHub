import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

// rename 可注入失败（失败保留旧全文用例）；open 记录 'r' 旗标调用（目录
// fsync 探针——Windows 真实 open(dir) 会拒，但调用意图被记录）。
const renameHook = vi.hoisted(() => ({ failNext: false }));
const openReads = vi.hoisted(() => ({ paths: [] as string[] }));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    rename: (...args: Parameters<typeof actual.rename>) => {
      if (renameHook.failNext) {
        renameHook.failNext = false;
        return Promise.reject(new Error('rename 注入失败（测试）'));
      }
      return actual.rename(...args);
    },
    open: (...args: Parameters<typeof actual.open>) => {
      if (args[1] === 'r') openReads.paths.push(String(args[0]));
      return actual.open(...args);
    },
  };
});

const { writeFileAtomic } = await import('../src/atomic-write.js');

let dir: string;

async function freshDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'atomic-write-'));
  openReads.paths.length = 0;
  return dir;
}

afterEach(async () => {
  renameHook.failNext = false;
  if (dir) await rm(dir, { recursive: true, force: true });
});

function tmpLeftover(files: string[]): string[] {
  return files.filter((f) => f.includes('.tmp-'));
}

describe('writeFileAtomic（D-003@v1 原子写基座）', () => {
  it('新建写入：目标落新全文，目录无 tmp 残留', async () => {
    const d = await freshDir();
    const target = join(d, 'auth.json');

    await writeFileAtomic(target, '{"k":"v"}');

    expect(await readFile(target, 'utf-8')).toBe('{"k":"v"}');
    expect(tmpLeftover(await readdir(d))).toEqual([]);
  });

  it('rename 后对父目录发起 fsync（open(dirname, "r")；2026-09-13 P2）', async () => {
    const d = await freshDir();
    const target = join(d, 'config.toml');

    await writeFileAtomic(target, 'x');

    // 目录 fsync 意图必须发生（POSIX 掉电窗口目录项持久）；Windows 真实
    // open(dir,'r') 拒绝由实现 best-effort 吞——探针记录的是调用意图，
    // 跨平台断言恒成立。
    expect(openReads.paths).toContain(dirname(target));
    // 主链路不受目录 fsync 结果影响：目标仍是新全文。
    expect(await readFile(target, 'utf-8')).toBe('x');
  });

  it('顶替已存在目标（win32=MoveFileEx REPLACE_EXISTING 语义锁定）：旧全文原子换新全文', async () => {
    const d = await freshDir();
    const target = join(d, 'config.toml');
    await writeFile(target, 'old-content\n', 'utf-8');

    await writeFileAtomic(target, 'new-content\n');

    expect(await readFile(target, 'utf-8')).toBe('new-content\n');
    expect(tmpLeftover(await readdir(d))).toEqual([]);
  });

  it('rename 前失败注入：目标保持旧全文逐字节不变 + tmp 清理 + 原样抛错', async () => {
    const d = await freshDir();
    const target = join(d, 'models.json');
    const frozen = '{"providers":{"keep":1}}';
    await writeFile(target, frozen, 'utf-8');

    renameHook.failNext = true;
    await expect(writeFileAtomic(target, '{"providers":{"evil":2}}')).rejects.toThrow(
      'rename 注入失败（测试）',
    );

    expect(await readFile(target, 'utf-8')).toBe(frozen);
    expect(tmpLeftover(await readdir(d))).toEqual([]);
  });

  it('连续两次写不同内容：终值为其一且全文完整（无交叠半截）', async () => {
    const d = await freshDir();
    const target = join(d, 'settings.json');

    await writeFileAtomic(target, '{"defaultModel":"a"}');
    await writeFileAtomic(target, '{"defaultModel":"b"}');

    const final = await readFile(target, 'utf-8');
    expect(['{"defaultModel":"a"}', '{"defaultModel":"b"}']).toContain(final);
    expect(tmpLeftover(await readdir(d))).toEqual([]);
  });
});
