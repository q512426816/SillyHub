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
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

vi.mock('../../src/config.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../src/config.js')>()),
  CLAUDE_CONFIG_DIR: '/fake-isolated',
}));
vi.mock('node:os', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:os')>()),
  homedir: () => '/fake-home',
}));
vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return {
    ...actual,
    // ql-20260825-f3#5：源码 find/migrate 也异步化后共用本 mock。只拦截假根
    //（/fake-isolated、/fake-home，locate/apply 用例），真实 tmp 目录（find/migrate
    // 用例）透传真实 readdir，两套用例互不干扰。
    readdir: ((
      p: string,
      opts?: Parameters<typeof actual.readdir>[1],
    ): ReturnType<typeof actual.readdir> => {
      // Windows join 产反斜杠路径，前缀判定统一归一为正斜杠（fsTable 键仍用原样 p）。
      const key = String(p).replace(/\\/g, '/');
      if (key.startsWith('/fake-isolated') || key.startsWith('/fake-home')) {
        return mocks.readdir(p, opts);
      }
      return actual.readdir(p, opts);
    }) as typeof actual.readdir,
  };
});

const mocks = vi.hoisted(() => ({ readdir: vi.fn() }));

import {
  locateClaudeTranscript,
  applyTranscriptConfigDir,
  findClaudeTranscriptPath,
  migrateClaudeTranscriptToHost,
  migrateClaudeTranscriptToIsolated,
  type TranscriptDirs,
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

// ── ql-20260822-001：findClaudeTranscriptPath / migrateClaudeTranscriptToIsolated
// 单测。ql-20260825-f3#5 异步化后走真实 tmp 目录 + 真实 fs/promises（上方 fs
// mock 只拦截 /fake-* 假根，与本组用例互不干扰）。────────────────────────────

/** tmp 目录对（isolated/home 都指向同一 root 下不同子目录）。 */
function buildTmpDirs(): TranscriptDirs & { root: string } {
  const root = mkdtempSync(join(tmpdir(), 'ctd-mig-'));
  return { root, isolated: join(root, 'iso'), home: join(root, 'home') };
}

/** 在 configDir/projects/<encoded>/ 写 <sid>.jsonl。 */
function writeJsonl(configDir: string, encoded: string, sid: string, content = '{}\n'): void {
  const dir = join(configDir, 'projects', encoded);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sid}.jsonl`), content, 'utf8');
}

describe('findClaudeTranscriptPath', () => {
  it('命中 → 返回绝对路径；未命中 → null', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.home, 'C--work', 'sid-find');
      const hit = await findClaudeTranscriptPath(dirs.home, 'sid-find');
      expect(hit).toBe(join(dirs.home, 'projects', 'C--work', 'sid-find.jsonl'));
      expect(await findClaudeTranscriptPath(dirs.home, 'sid-none')).toBeNull();
      expect(await findClaudeTranscriptPath(dirs.isolated, 'sid-find')).toBeNull();
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('agentSessionId 非法（路径分隔符）→ null 不探测', async () => {
    const dirs = buildTmpDirs();
    try {
      expect(await findClaudeTranscriptPath(dirs.home, '../evil')).toBeNull();
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});

describe('migrateClaudeTranscriptToIsolated', () => {
  it('MIG-1: home jsonl 存在 → 复制到隔离目录同子目录，home 原件保留（复制非移动）', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.home, 'C--work', 'sid-m1');
      expect(await migrateClaudeTranscriptToIsolated('sid-m1', dirs)).toBe(true);
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sid-m1.jsonl')),
      ).toBe(true);
      // 复制非移动：用户 ~/.claude 原件不动（daemon 不删用户数据）。
      expect(
        existsSync(join(dirs.home, 'projects', 'C--work', 'sid-m1.jsonl')),
      ).toBe(true);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-2: home 无源 jsonl → false（迁移降级语义，调用方保持 home resume）', async () => {
    const dirs = buildTmpDirs();
    try {
      expect(await migrateClaudeTranscriptToIsolated('sid-none', dirs)).toBe(false);
      expect(existsSync(join(dirs.isolated, 'projects'))).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-3: isolated 已有副本 → false 跳过（isolated 是真相源，防回灌 home 旧副本丢增量）', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.home, 'C--work', 'sid-m3', 'stale-home\n');
      writeJsonl(dirs.isolated, 'C--work', 'sid-m3', 'fresh-isolated\n');
      expect(await migrateClaudeTranscriptToIsolated('sid-m3', dirs)).toBe(false);
      // 隔离副本内容不被 home 旧副本覆盖。
      expect(
        readFileSync(
          join(dirs.isolated, 'projects', 'C--work', 'sid-m3.jsonl'),
          'utf8',
        ),
      ).toBe('fresh-isolated\n');
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-4: agentSessionId 非法 → false 不迁移', async () => {
    const dirs = buildTmpDirs();
    try {
      expect(await migrateClaudeTranscriptToIsolated('../evil', dirs)).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});

// ── ql-20260824-016：migrateClaudeTranscriptToHost（切回本机默认的反向迁移）
// 单测，与 migrateClaudeTranscriptToIsolated 镜像。──────────────────────────

describe('migrateClaudeTranscriptToHost', () => {
  it('MIG-H1: isolated jsonl 存在 → 复制回宿主机同子目录并删除 isolated 原件（移动语义）', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.isolated, 'C--work', 'sid-h1', 'isolated-latest\n');
      expect(await migrateClaudeTranscriptToHost('sid-h1', dirs)).toBe(true);
      expect(
        readFileSync(join(dirs.home, 'projects', 'C--work', 'sid-h1.jsonl'), 'utf8'),
      ).toBe('isolated-latest\n');
      // 移动语义：isolated 是 daemon 自管目录，不删则 locate 双侧命中取
      // isolated，永远回不到 home。
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sid-h1.jsonl')),
      ).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-H2: home 已有旧副本（正向迁移复制非移动的停留档）→ 覆盖为 isolated 最新内容', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.home, 'C--work', 'sid-h2', 'stale-home\n');
      writeJsonl(dirs.isolated, 'C--work', 'sid-h2', 'fresh-isolated\n');
      expect(await migrateClaudeTranscriptToHost('sid-h2', dirs)).toBe(true);
      expect(
        readFileSync(join(dirs.home, 'projects', 'C--work', 'sid-h2.jsonl'), 'utf8'),
      ).toBe('fresh-isolated\n');
      expect(
        existsSync(join(dirs.isolated, 'projects', 'C--work', 'sid-h2.jsonl')),
      ).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-H3: isolated 无源 jsonl（本来就在 home）→ false 无操作', async () => {
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.home, 'C--work', 'sid-h3');
      expect(await migrateClaudeTranscriptToHost('sid-h3', dirs)).toBe(false);
      expect(
        existsSync(join(dirs.home, 'projects', 'C--work', 'sid-h3.jsonl')),
      ).toBe(true);
      expect(existsSync(join(dirs.isolated, 'projects'))).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-H4: agentSessionId 非法 → false 不迁移', async () => {
    const dirs = buildTmpDirs();
    try {
      expect(await migrateClaudeTranscriptToHost('../evil', dirs)).toBe(false);
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });

  it('MIG-H5: 回迁后 jsonl 仅在 host（探测命中 home、isolated 落空）', async () => {
    // 注：本文件 mock 了 node:fs/promises 的假根 readdir（async locate 在假根
    // 上用不了真实 tmp 目录），「host 命中 → applyTranscriptConfigDir 不隔离」
    // 链路由上方 mocked 用例覆盖，此处仅用 find 探测锁迁移落点。
    const dirs = buildTmpDirs();
    try {
      writeJsonl(dirs.isolated, 'C--work', 'sid-h5');
      expect(await migrateClaudeTranscriptToHost('sid-h5', dirs)).toBe(true);
      expect(await findClaudeTranscriptPath(dirs.home, 'sid-h5')).toBe(
        join(dirs.home, 'projects', 'C--work', 'sid-h5.jsonl'),
      );
      expect(await findClaudeTranscriptPath(dirs.isolated, 'sid-h5')).toBeNull();
    } finally {
      rmSync(dirs.root, { recursive: true, force: true });
    }
  });
});
