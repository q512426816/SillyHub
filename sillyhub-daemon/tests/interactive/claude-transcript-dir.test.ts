// tests/interactive/claude-transcript-dir.test.ts
// ql-20260822-009：resume/reload 的 CLAUDE_CONFIG_DIR 按 transcript 实际位置判定——
// locator 单元测试（mock fs/os/config，免真实磁盘依赖）。
//
// 覆盖：
//   - 隔离目录命中 → 'isolated'；仅宿主机 ~/.claude 命中 → 'host'；都没有 → 'unknown'
//   - 双侧同 id → 'isolated' 优先（ql-20260807-002 停供应商语义保留）
//   - agentSessionId 含路径分隔符 / 点点 → 不探测直接 'unknown'
//   - projects 根不可读（EACCES）→ 按未命中继续探另一侧
//   - applyTranscriptConfigDir：host → 删 env；isolated/unknown → 设隔离目录；
//     agentSessionId 缺省 → 不探测、默认隔离
//
// mock 模式对齐 tests/roots-rpc.test.ts：vi.hoisted 持有 mock fn（vi.mock 工厂被
// hoist，只能引用 vi.hoisted 产物）；内置模块工厂带 default: {}。

import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';

vi.mock('../../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/config.js')>()),
  CLAUDE_CONFIG_DIR: '/fake-isolated',
}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => '/fake-home',
}));
vi.mock('node:fs/promises', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:fs/promises')>()),
  readdir: mocks.readdir,
}));

const mocks = vi.hoisted(() => ({ readdir: vi.fn() }));

import {
  locateClaudeTranscript,
  applyTranscriptConfigDir,
} from '../../src/interactive/claude-transcript-dir.js';

interface FakeDirent {
  name: string;
  kind: 'dir' | 'file';
}
function dirent({ name, kind }: FakeDirent): Dirent {
  return {
    name,
    isDirectory: () => kind === 'dir',
    isFile: () => kind === 'file',
  } as unknown as Dirent;
}

// 路径键必须用 join 构造（源码同样用 node:path join 拼路径；Windows 下 join 输出
// 反斜杠，直接写字面量正斜杠键会查表落空）。
const ISOLATED_PROJECTS = join('/fake-isolated', 'projects');
const ISOLATED_WORK = join(ISOLATED_PROJECTS, 'C--work');
const HOST_PROJECTS = join('/fake-home', '.claude', 'projects');
const HOST_OTHER = join(HOST_PROJECTS, 'C--other');

/** path → 目录条目表；缺省路径视为空目录，'EACCES' 模拟不可读。 */
let fsTable: Record<string, FakeDirent[] | 'EACCES'> = {};

/** 标准假文件系统：隔离侧有 aaa/bbb，宿主侧有 ccc。 */
function seedStandardFs(): void {
  fsTable = {
    [ISOLATED_PROJECTS]: [{ name: 'C--work', kind: 'dir' }],
    [ISOLATED_WORK]: [
      { name: 'aaa-111.jsonl', kind: 'file' },
      { name: 'bbb-222.jsonl', kind: 'file' },
    ],
    [HOST_PROJECTS]: [{ name: 'C--other', kind: 'dir' }],
    [HOST_OTHER]: [{ name: 'ccc-333.jsonl', kind: 'file' }],
  };
}

beforeEach(() => {
  fsTable = {};
  mocks.readdir.mockReset();
  mocks.readdir.mockImplementation(async (p: string) => {
    const entry = fsTable[p as string];
    if (entry === 'EACCES') {
      throw Object.assign(new Error('EACCES'), { code: 'EACCES' });
    }
    return (entry ?? []).map(dirent);
  });
});

describe('locateClaudeTranscript', () => {
  it('隔离目录命中 → isolated', async () => {
    seedStandardFs();
    await expect(locateClaudeTranscript('aaa-111')).resolves.toBe('isolated');
  });

  it('仅宿主机 ~/.claude 命中 → host', async () => {
    seedStandardFs();
    await expect(locateClaudeTranscript('ccc-333')).resolves.toBe('host');
  });

  it('两侧都没有 → unknown', async () => {
    seedStandardFs();
    await expect(locateClaudeTranscript('zzz-none')).resolves.toBe('unknown');
  });

  it('双侧同 id → isolated 优先', async () => {
    seedStandardFs();
    fsTable[HOST_OTHER] = [
      { name: 'ccc-333.jsonl', kind: 'file' },
      { name: 'aaa-111.jsonl', kind: 'file' },
    ];
    await expect(locateClaudeTranscript('aaa-111')).resolves.toBe('isolated');
  });

  it('agentSessionId 含路径分隔符 / 点点 → 不探测直接 unknown', async () => {
    seedStandardFs();
    await expect(locateClaudeTranscript('../evil')).resolves.toBe('unknown');
    await expect(locateClaudeTranscript('a/b')).resolves.toBe('unknown');
    expect(mocks.readdir).not.toHaveBeenCalled();
  });

  it('隔离 projects 根不可读（EACCES）→ 继续探宿主机侧', async () => {
    seedStandardFs();
    fsTable[ISOLATED_PROJECTS] = 'EACCES';
    await expect(locateClaudeTranscript('ccc-333')).resolves.toBe('host');
  });

  it('projects 根不存在（ENOENT 吞错）→ unknown', async () => {
    await expect(locateClaudeTranscript('aaa-111')).resolves.toBe('unknown');
  });
});

describe('applyTranscriptConfigDir', () => {
  it('host → 删除 env 既有 CLAUDE_CONFIG_DIR（回 ~/.claude）', async () => {
    seedStandardFs();
    const env: NodeJS.ProcessEnv = {
      CLAUDE_CONFIG_DIR: '/fake-isolated',
      OTHER: 'x',
    };
    await applyTranscriptConfigDir(env, 'ccc-333');
    expect(env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(env.OTHER).toBe('x');
  });

  it('isolated → 设为隔离目录', async () => {
    seedStandardFs();
    const env: NodeJS.ProcessEnv = {};
    await applyTranscriptConfigDir(env, 'aaa-111');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
  });

  it('unknown（探测不到）→ 维持强制隔离默认（修复前行为）', async () => {
    const env: NodeJS.ProcessEnv = {};
    await applyTranscriptConfigDir(env, 'zzz-none');
    expect(env.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
  });

  it('agentSessionId 缺省 → 不探测、默认隔离', async () => {
    const env: NodeJS.ProcessEnv = {};
    await applyTranscriptConfigDir(env, undefined);
    expect(env.CLAUDE_CONFIG_DIR).toBe('/fake-isolated');
    expect(mocks.readdir).not.toHaveBeenCalled();
  });
});
