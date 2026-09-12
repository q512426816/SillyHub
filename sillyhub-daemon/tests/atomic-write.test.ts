import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// rename 可注入失败（失败保留旧全文用例）；默认透传真实实现。
const renameHook = vi.hoisted(() => ({ failNext: false }));
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
  };
});

const { writeFileAtomic } = await import('../src/atomic-write.js');

let dir: string;

async function freshDir(): Promise<string> {
  dir = await mkdtemp(join(tmpdir(), 'atomic-write-'));
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
