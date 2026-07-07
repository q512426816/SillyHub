// tests/host-fs-handler.test.ts
// task-03（2026-07-06-daemon-host-fs-delegate / FR-02）：host_fs.* WS handler 业务层。
// 覆盖：八方法 happy path + git_apply 三路径 + 越界 forbidden + git 命令失败映射 + 不存在/not_found。
// 用例编号 H1~H30 对齐 task-03.md 验收（每方法 happy + 边界 + 三路径）。
//
// 风格对齐 tests/file-rpc.test.ts：真实临时目录（mkdtemp）+ 真实 fs。
// git 命令走 vi.mock('node:child_process') 替换 execFile（具名导入在 vitest mock 下被拦截）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const IS_WIN = platform() === 'win32';

/**
 * mock 队列：git_apply / git_rev_parse 测试 push 预期 execFile 结果序列。
 * 由下方 vi.mock factory 引用（hoist 后仍可读，因为声明在 mock 调用前）。
 */
const execQueue: Array<{
  ok: boolean;
  stdout?: string;
  stderr?: string;
}> = [];

// vi.mock hoist 到文件顶部，替换 node:child_process 的 execFile 导出。
// host-fs-handler.ts 的 `import { execFile }` 会拿到本 factory 版本。
vi.mock('node:child_process', () => ({
  execFile: (
    ...args: unknown[]
  ): unknown => {
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: Buffer | string,
      stderr: Buffer | string,
    ) => void;
    const next = execQueue.shift();
    if (!next) {
      throw new Error('execFile mock queue exhausted');
    }
    setImmediate(() => {
      if (next.ok) {
        cb(null, next.stdout ?? '', next.stderr ?? '');
      } else {
        cb(new Error(next.stderr ?? 'mock git failure'), next.stdout ?? '', next.stderr ?? '');
      }
    });
    // 返回伪 ChildProcess（host-fs-handler 只用 .stdin.end/.on，给 stub）。
    return {
      stdin: { on: () => undefined, end: () => undefined },
    };
  },
}));

// import 必须在 vi.mock 之后（vitest hoist 会处理顺序，但为可读性放在 mock 后）。
import { HostFsHandler } from '../src/host-fs-handler';
import { RpcError } from '../src/ws-client';

/** push 一批 execFile 结果到 mock 队列。 */
function queueExec(results: Array<{ ok: boolean; stdout?: string; stderr?: string }>): void {
  for (const r of results) execQueue.push(r);
}

/** 构造临时根目录 + 测试桩文件。 */
async function makeRoot(opts?: { withFiles?: boolean }): Promise<{
  root: string;
  abs: (rel: string) => string;
}> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-host-fs-'));
  const abs = (rel: string): string => join(root, rel);
  if (opts?.withFiles ?? true) {
    await mkdir(abs('a'), { recursive: true });
    await mkdir(abs('a/sub'), { recursive: true });
    await writeFile(abs('b.txt'), 'hello world');
    await writeFile(abs('a/sub/c.txt'), 'nested');
  }
  return { root, abs };
}

describe('HostFsHandler — stat（task-03 H1~H4）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('H1: 文件 → {exists:true, is_dir:false, size>0}', async () => {
    const result = await handler.stat(abs('b.txt'));
    expect(result.exists).toBe(true);
    expect(result.is_dir).toBe(false);
    expect(result.size).toBe('hello world'.length);
  });

  it('H2: 目录 → {exists:true, is_dir:true}', async () => {
    const result = await handler.stat(abs('a'));
    expect(result.exists).toBe(true);
    expect(result.is_dir).toBe(true);
  });

  it('H3: 不存在 → {exists:false}（不抛）', async () => {
    const result = await handler.stat(abs('does-not-exist'));
    expect(result.exists).toBe(false);
    expect(result.is_dir).toBe(false);
    expect(result.size).toBe(0);
  });

  it('H4: 越界 → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows\\System32' : '/etc';
    try {
      await handler.stat(evil);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — read_file（task-03 H5~H7）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('H5: 读文件内容', async () => {
    const content = await handler.readFile(abs('b.txt'));
    expect(content).toBe('hello world');
  });

  it('H6: 不存在 → not_found', async () => {
    try {
      await handler.readFile(abs('nope.txt'));
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('not_found');
    }
  });

  it('H7: 越界 → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows\\win.ini' : '/etc/passwd';
    try {
      await handler.readFile(evil);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — list_dir（task-03 H8~H9，复用 file-rpc.ts:listDir）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot();
    root = r.root;
    abs = r.abs;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('H8: 列举 root → entries 含 a/b.txt，零行为变更（复用 listDir）', async () => {
    const result = await handler.listDir(root);
    const names = result.entries.map((e) => e.name);
    expect(names).toContain('a');
    expect(names).toContain('b.txt');
    // dir 优先排序
    expect(result.entries[0].type).toBe('dir');
  });

  it('H9: 越界 → forbidden（assertWithinAllowedRoots 透传）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.listDir(evil);
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — git_apply（task-03 H10~H14，D-008 幂等 + 三路径）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    root = r.root;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    execQueue.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('H10: check 通过 + apply 成功 → {ok:true, skipped:false}', async () => {
    // git apply --check（ok）+ git apply（ok）
    queueExec([
      { ok: true, stdout: '', stderr: '' },
      { ok: true, stdout: '', stderr: '' },
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'dummy diff',
      use_3way: true,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
    expect(result.conflict_detail).toBe('');
  });

  it('H11: check 通过 + apply 报 already applied → {ok:true, skipped:true}（D-008 幂等）', async () => {
    queueExec([
      { ok: true, stdout: '', stderr: '' }, // --check 通过
      { ok: false, stdout: '', stderr: 'error: patch already applied' }, // apply 报已应用
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'dummy',
      use_3way: false,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('H11b: check 通过 + apply 报 no changes → skipped:true', async () => {
    queueExec([
      { ok: true, stdout: '', stderr: '' },
      { ok: false, stdout: '', stderr: 'no changes detected' },
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'dummy',
      use_3way: false,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(true);
  });

  it('H12: check 失败 + !use_3way → {ok:false, conflict_detail:<check stderr>}（不抛）', async () => {
    queueExec([
      { ok: false, stdout: '', stderr: 'error: patch failed at line 5' },
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'bad diff',
      use_3way: false,
    });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.conflict_detail).toMatch(/patch failed at line 5/);
  });

  it('H13: check 失败 + use_3way + 3way 成功 → {ok:true}', async () => {
    queueExec([
      { ok: false, stdout: '', stderr: 'patch does not apply' }, // --check
      { ok: true, stdout: '', stderr: 'Applied patch with 3way' }, // --3way
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'conflict diff',
      use_3way: true,
    });
    expect(result.ok).toBe(true);
    expect(result.skipped).toBe(false);
  });

  it('H14: check 失败 + use_3way + 3way 失败 → {ok:false, conflict_detail 含两段}', async () => {
    queueExec([
      { ok: false, stdout: '', stderr: 'check failed A' },
      { ok: false, stdout: '', stderr: '3way conflict B' },
    ]);
    const result = await handler.gitApply({
      workdir: root,
      patch_data: 'bad',
      use_3way: true,
    });
    expect(result.ok).toBe(false);
    expect(result.skipped).toBe(false);
    expect(result.conflict_detail).toContain('check failed A');
    expect(result.conflict_detail).toContain('3way conflict B');
  });

  it('H14b: 越界 workdir → forbidden（assertWithinAllowedRoots 守卫）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.gitApply({
        workdir: evil,
        patch_data: '',
        use_3way: false,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — git_rev_parse（task-03 H15~H18）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    root = r.root;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    execQueue.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('H15: git 仓库 → {commit, error:null}', async () => {
    queueExec([
      { ok: true, stdout: 'abc123def456\n', stderr: '' },
    ]);
    const result = await handler.gitRevParse({ root });
    expect(result.commit).toBe('abc123def456');
    expect(result.error).toBeNull();
  });

  it('H16: 非 git 仓库 → {commit:null, error:"not_git_repo"}', async () => {
    queueExec([
      { ok: false, stdout: '', stderr: 'fatal: not a git repository' },
    ]);
    const result = await handler.gitRevParse({ root });
    expect(result.commit).toBeNull();
    expect(result.error).toBe('not_git_repo');
  });

  it('H17: dubious ownership → 自动加 safe.directory 重试成功', async () => {
    queueExec([
      { ok: false, stdout: '', stderr: 'fatal: detected dubious ownership' }, // 首次
      { ok: true, stdout: '', stderr: '' }, // git config --global --add safe.directory
      { ok: true, stdout: 'retried_commit\n', stderr: '' }, // 重试 rev-parse
    ]);
    const result = await handler.gitRevParse({ root });
    expect(result.commit).toBe('retried_commit');
    expect(result.error).toBeNull();
  });

  it('H18: 越界 → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.gitRevParse({ root: evil });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — pollution_archive（task-03 H19~H23）', () => {
  let root: string;
  let runtimeRoot: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    root = r.root;
    abs = r.abs;
    runtimeRoot = await mkdtemp(join(tmpdir(), 'sillyhub-host-fs-rt-'));
    handler = new HostFsHandler({ allowed_roots: [root, runtimeRoot] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(runtimeRoot, { recursive: true, force: true });
  });

  it('H19: source/.sillyspec 不存在 → {archived:false, archive_path:null, file_count:0}', async () => {
    const result = await handler.pollutionArchive({
      source_root: root,
      runtime_root: runtimeRoot,
      scan_run_id: 'scan-1',
    });
    expect(result.archived).toBe(false);
    expect(result.archive_path).toBeNull();
    expect(result.file_count).toBe(0);
  });

  it('H20: source/.sillyspec 存在含文件 → 归档成功 + file_count 正确', async () => {
    // 构造 source/.sillyspec/docs/a.md + .sillyspec/empty（空目录不计）
    await mkdir(abs('.sillyspec/docs'), { recursive: true });
    await mkdir(abs('.sillyspec/empty'), { recursive: true });
    await writeFile(abs('.sillyspec/docs/a.md'), 'a');
    await writeFile(abs('.sillyspec/docs/b.md'), 'bb');
    await writeFile(abs('.sillyspec/top.txt'), 'x');

    const result = await handler.pollutionArchive({
      source_root: root,
      runtime_root: runtimeRoot,
      scan_run_id: 'scan-2',
    });
    expect(result.archived).toBe(true);
    expect(result.file_count).toBe(3);
    expect(result.archive_path).toContain('scan-2');
    // source/.sillyspec 已被移走
    const statSrc = await handler.stat(abs('.sillyspec'));
    expect(statSrc.exists).toBe(false);
  });

  it('H21: source/.sillyspec 仅空目录 → file_count:0 → archived:false', async () => {
    await mkdir(abs('.sillyspec/emptydir'), { recursive: true });
    const result = await handler.pollutionArchive({
      source_root: root,
      runtime_root: runtimeRoot,
      scan_run_id: 'scan-3',
    });
    expect(result.archived).toBe(false);
    expect(result.file_count).toBe(0);
  });

  it('H22: 归档路径结构 = runtime_root/pollution/<scan_run_id>/.sillyspec', async () => {
    await mkdir(abs('.sillyspec'), { recursive: true });
    await writeFile(abs('.sillyspec/x.txt'), 'x');
    const result = await handler.pollutionArchive({
      source_root: root,
      runtime_root: runtimeRoot,
      scan_run_id: 'scan-xyz',
    });
    expect(result.archive_path).toBe(join(runtimeRoot, 'pollution', 'scan-xyz', '.sillyspec'));
  });

  it('H23: 越界 source_root → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.pollutionArchive({
        source_root: evil,
        runtime_root: runtimeRoot,
        scan_run_id: 'x',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — read_package_json（task-03 H24~H26）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    root = r.root;
    abs = r.abs;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('H24: package.json 存在 → 解析为 dict', async () => {
    await writeFile(
      abs('package.json'),
      JSON.stringify({ name: 'demo', scripts: { build: 'tsc' } }),
    );
    const result = await handler.readPackageJson({ root });
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).name).toBe('demo');
  });

  it('H25: package.json 不存在 → null', async () => {
    const result = await handler.readPackageJson({ root });
    expect(result).toBeNull();
  });

  it('H26: 越界 → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.readPackageJson({ root: evil });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — read_local_yaml（task-03 H27~H30，js-yaml 已显式声明依赖）', () => {
  let root: string;
  let abs: (rel: string) => string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    const r = await makeRoot({ withFiles: false });
    root = r.root;
    abs = r.abs;
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    vi.resetModules();
    await rm(root, { recursive: true, force: true });
  });

  it('H27: local.yaml 不存在 → null', async () => {
    const result = await handler.readLocalYaml({ root });
    expect(result).toBeNull();
  });

  it('H28: 越界 → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.readLocalYaml({ root: evil });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('H29: local.yaml 存在 + js-yaml 静态解析 → 解析为 dict', async () => {
    await mkdir(abs('.sillyspec'), { recursive: true });
    await writeFile(abs('.sillyspec/local.yaml'), 'build: npm run build\n');
    // js-yaml 已在 package.json 显式声明（dependencies），readLocalYaml 静态 import。
    const result = await handler.readLocalYaml({ root });
    expect(result).not.toBeNull();
    expect((result as Record<string, unknown>).build).toBe('npm run build');
  });

  it('H30: local.yaml 内容非法 → yaml.load 抛 YAMLException → toRpcError parse', async () => {
    await mkdir(abs('.sillyspec'), { recursive: true });
    // tab 缩进在 YAML 中非法，js-yaml.load 必抛 YAMLException。
    await writeFile(abs('.sillyspec/local.yaml'), 'foo: bar\n\tbad: indent\n');
    try {
      await handler.readLocalYaml({ root });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('internal');
      expect((e as Error).message).toMatch(/host_fs.read_local_yaml.parse/);
    }
  });
});
