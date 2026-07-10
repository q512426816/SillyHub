// tests/host-fs-handler.test.ts
// task-03（2026-07-06-daemon-host-fs-delegate / FR-02）：host_fs.* WS handler 业务层。
// 覆盖：八方法 happy path + git_apply 三路径 + 越界 forbidden + git 命令失败映射 + 不存在/not_found。
// 用例编号 H1~H30 对齐 task-03.md 验收（每方法 happy + 边界 + 三路径）。
//
// task-02（P3 driver gate pilot）：追加 run_command 第九方法测试段（RC1~RC9），
// 覆盖命令白名单通过/拒绝（AC-8：rm/ls/sillyspec derive）+ 超时 exit 124 + cwd 越界 forbidden
// + 四字段回传（exit_code/stdout/stderr/duration_ms）。
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
 *
 * `signal`/`killed`（task-02 run_command 超时测试用）：非空时 mock 把对应属性挂到
 * callback 的 Error 上，模拟 execFile timeout 触发的 SIGTERM（run_command 据此判 exit 124）。
 */
const execQueue: Array<{
  ok: boolean;
  stdout?: string;
  stderr?: string;
  signal?: string;
  killed?: boolean;
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
        // 模拟 execFile 失败：Error 上可选挂 signal/killed（run_command 超时判定依据）。
        const err = new Error(next.stderr ?? 'mock exec failure');
        if (next.signal !== undefined) {
          (err as Error & { signal?: string }).signal = next.signal;
        }
        if (next.killed !== undefined) {
          (err as Error & { killed?: boolean }).killed = next.killed;
        }
        cb(err, next.stdout ?? '', next.stderr ?? '');
      }
    });
    // 返回伪 ChildProcess（host-fs-handler 只用 .stdin.end/.on，给 stub）。
    return {
      stdin: { on: () => undefined, end: () => undefined },
    };
  },
}));

// import 必须在 vi.mock 之后（vitest hoist 会处理顺序，但为可读性放在 mock 后）。
import {
  HostFsHandler,
  isGateCommand,
  type RunCommandParams,
  type RunCommandResult,
} from '../src/host-fs-handler';
import { RpcError } from '../src/ws-client';

/** push 一批 execFile 结果到 mock 队列（signal/killed 仅 run_command 超时测试用）。 */
function queueExec(
  results: Array<{
    ok: boolean;
    stdout?: string;
    stderr?: string;
    signal?: string;
    killed?: boolean;
  }>,
): void {
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

// ──────────────────────────────────────────────────────────────────────────────
// task-02（P3 driver gate pilot）：run_command 第 9 方法测试段（RC1~RC9）
// 覆盖 design §5.3 / TaskCard 验收 6 条 + AC-8 命令白名单拒绝。
// 白名单拒绝用例不触发 execFile（白名单先过），故不消耗 execQueue。
// ──────────────────────────────────────────────────────────────────────────────

describe('isGateCommand 白名单判定（task-02 RC1~RC4 纯函数，AC-8 双端一致）', () => {
  it('RC1: sillyspec gate verify --change <name> --json → 命中', () => {
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', 'my-change', '--json'])).toBe(true);
  });

  it('RC2: 带 --stage <stage> 的 7 元素形状 → 命中', () => {
    expect(
      isGateCommand('sillyspec', [
        'gate',
        'verify',
        '--change',
        'my-change',
        '--json',
        '--stage',
        'brainstorm',
      ]),
    ).toBe(true);
  });

  it('RC3: command 非 sillyspec（rm/ls/evil）→ 拒绝', () => {
    expect(isGateCommand('rm', ['-rf', '/'])).toBe(false);
    expect(isGateCommand('ls', ['-la'])).toBe(false);
    expect(isGateCommand('cat', ['/etc/passwd'])).toBe(false);
    // 带 ../ 路径的 command 也拒绝（防 ../evil/sillyspec）。
    expect(isGateCommand('../evil/sillyspec', ['gate', 'verify', '--change', 'x', '--json'])).toBe(false);
  });

  it('RC4: command 是 sillyspec 但非 gate 子命令（derive/scan/任意）→ 拒绝', () => {
    expect(isGateCommand('sillyspec', ['derive', '--change', 'x'])).toBe(false);
    expect(isGateCommand('sillyspec', ['scan', '--json'])).toBe(false);
    expect(isGateCommand('sillyspec', ['gate', 'run', '--change', 'x', '--json'])).toBe(false);
  });

  it('RC4b: flag 乱序 / 缺 --json / 多余 flag → 拒绝', () => {
    // --json 放到 --change 前（乱序）。
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--json', '--change', 'x'])).toBe(false);
    // 缺 --json。
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', 'x'])).toBe(false);
    // 头部 token 错（gate run 非 gate verify）。
    expect(isGateCommand('sillyspec', ['gate', 'run', '--change', 'x', '--json'])).toBe(false);
  });

  it('RC4c: changeName 非空即过（字符集不约束，与 backend delegate.py:792 对齐）', () => {
    // changeName 含空格 / 分号 / 管道 —— backend 侧只守 `not head[3]`（非空），
    // 不约束字符集（gate 任务负责 change_id 来源校验）；daemon 侧必须同样放行，
    // 否则双端不一致致 gate 跑不了。注入防御靠 execFile 非 shell（第二道防线）。
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', 'a b', '--json'])).toBe(true);
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', 'a;rm', '--json'])).toBe(true);
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', 'x|y', '--json'])).toBe(true);
    // changeName 空串仍拒（非空守卫，与 backend `or not head[3]` 一致）。
    expect(isGateCommand('sillyspec', ['gate', 'verify', '--change', '', '--json'])).toBe(false);
  });

  it('RC4d: 尾部未知 flag → 拒绝（与 backend delegate.py:804 对齐）', () => {
    expect(
      isGateCommand('sillyspec', [
        'gate',
        'verify',
        '--change',
        'x',
        '--json',
        '--evil',
        'v',
      ]),
    ).toBe(false);
  });

  it('RC4e: 尾部 flag 缺值 → 拒绝（与 backend delegate.py:810 对齐）', () => {
    // --stage 无值（尾部只剩 flag 不成对）。
    expect(
      isGateCommand('sillyspec', ['gate', 'verify', '--change', 'x', '--json', '--stage']),
    ).toBe(false);
  });

  it('RC4f: 多个白名单 flag 成对出现 → 通过（与 backend while 成对消费对齐）', () => {
    // 当前白名单仅 --stage；两个 --stage 成对也合法（backend 允许任意成对组合）。
    expect(
      isGateCommand('sillyspec', [
        'gate',
        'verify',
        '--change',
        'x',
        '--json',
        '--stage',
        'brainstorm',
        '--stage',
        'verify',
      ]),
    ).toBe(true);
  });
});

describe('HostFsHandler — run_command（task-02 RC5~RC9，execFile + 白名单 + 超时）', () => {
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

  it('RC5: 白名单通过 + exit 0 → 四字段回传（exit_code/stdout/stderr/duration_ms）', async () => {
    queueExec([
      {
        ok: true,
        stdout: '{"status":"ok","stage":"verify"}\n',
        stderr: '',
      },
    ]);
    const params: RunCommandParams = {
      command: 'sillyspec',
      args: ['gate', 'verify', '--change', 'demo-change', '--json'],
      cwd: root,
      timeout: 12 * 60 * 1000,
      env: null,
    };
    const result: RunCommandResult = await handler.runCommand(params);
    expect(result.exit_code).toBe(0);
    expect(result.stdout).toContain('"status":"ok"');
    expect(result.stderr).toBe('');
    // duration_ms 计时正确（非负，且因 mock setImmediate 极小）。
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
    expect(typeof result.duration_ms).toBe('number');
  });

  it('RC6: 白名单通过 + 带 --stage + exit 1（gate 打回）→ exit_code 1 透传', async () => {
    queueExec([
      {
        ok: false,
        stdout: '',
        stderr: 'gate failed: tests not pass',
      },
    ]);
    const result = await handler.runCommand({
      command: 'sillyspec',
      args: ['gate', 'verify', '--change', 'demo', '--json', '--stage', 'verify'],
      cwd: root,
      timeout: 60_000,
      env: null,
    });
    expect(result.exit_code).toBe(1);
    expect(result.stderr).toContain('tests not pass');
  });

  it('RC7: 白名单拒绝 rm（AC-8）→ exit_code 126 + stderr 拒绝信息，不消耗 execQueue', async () => {
    const result = await handler.runCommand({
      command: 'rm',
      args: ['-rf', '/'],
      cwd: root,
      timeout: 60_000,
      env: null,
    });
    expect(result.exit_code).toBe(126);
    expect(result.stdout).toBe('');
    expect(result.stderr).toBe('command not allowed: rm');
    // 不执行 → execQueue 仍空（白名单先过）。
    expect(execQueue.length).toBe(0);
    // duration_ms 极小（白名单拒绝不经 execFile）。
    expect(result.duration_ms).toBeGreaterThanOrEqual(0);
  });

  it('RC7b: 白名单拒绝 sillyspec derive（AC-8）→ exit_code 126', async () => {
    const result = await handler.runCommand({
      command: 'sillyspec',
      args: ['derive', '--change', 'x'],
      cwd: root,
      timeout: 60_000,
      env: null,
    });
    expect(result.exit_code).toBe(126);
    expect(result.stderr).toBe('command not allowed: sillyspec');
    expect(execQueue.length).toBe(0);
  });

  it('RC7c: 白名单拒绝 ls（AC-8）→ exit_code 126', async () => {
    const result = await handler.runCommand({
      command: 'ls',
      args: ['-la'],
      cwd: root,
      timeout: 60_000,
      env: null,
    });
    expect(result.exit_code).toBe(126);
    expect(result.stderr).toBe('command not allowed: ls');
  });

  it('RC8: 超时 → exit_code 124 + stderr 含 timeout after Nms（不抛）', async () => {
    queueExec([
      {
        ok: false,
        stdout: 'partial out',
        stderr: 'partial err',
        signal: 'SIGTERM',
        killed: true,
      },
    ]);
    const result = await handler.runCommand({
      command: 'sillyspec',
      args: ['gate', 'verify', '--change', 'demo', '--json'],
      cwd: root,
      timeout: 5_000,
      env: null,
    });
    expect(result.exit_code).toBe(124);
    // stdout/stderr 仍回传（子进程部分输出）。
    expect(result.stdout).toBe('partial out');
    expect(result.stderr).toContain('timeout after 5000ms');
  });

  it('RC9: cwd 越界 → forbidden（assertWithinAllowedRoots 守卫，白名单已过）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.runCommand({
        command: 'sillyspec',
        args: ['gate', 'verify', '--change', 'demo', '--json'],
        cwd: evil,
        timeout: 60_000,
        env: null,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('RC9b: env 非空 → 合并到 process.env 之上（execFile 收 env 选项）', async () => {
    // 用真实 execFile spy 捕获传给 execFile 的 env 选项（mock 拦截）。
    // 这里通过 execFile mock 收到的 args 反推：本测试 mock 不直接断言 env，
    // 但验证白名单通过 + env 合并不抛错 + 返回结构正确（env 注入路径走通）。
    queueExec([{ ok: true, stdout: '{"ok":true}', stderr: '' }]);
    const result = await handler.runCommand({
      command: 'sillyspec',
      args: ['gate', 'verify', '--change', 'demo', '--json'],
      cwd: root,
      timeout: 60_000,
      env: { SILLYSPEC_GATE_MODE: 'ci', NODE_ENV: 'test' },
    });
    expect(result.exit_code).toBe(0);
    expect(execQueue.length).toBe(0); // 已被 shift 消费
  });
});
