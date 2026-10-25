// tests/host-fs-handler-git-dirty-files.test.ts
// task-01（2026-10-25-explorer-git-status / FR-01 FR-02 FR-03 / design §Phase 1 +
// §接口定义 + D-003@v2 D-010 D-011）：host-fs-handler git 只读第 6/7 方法
// （gitDirtyFiles / gitWorktreeDiff）+ daemon.ts 平名注册单测。
//
// 覆盖（对齐 TaskCard acceptance 与卡上 implementation 用例清单）：
//   - 四态映射表驱动：`1` 条目 XY 含 D→deleted / 含 A→added / 其余→modified；
//     `u` 条目恒 modified（D-011）；`?` 条目→untracked；--no-renames 下 rename 拆
//     D+A 两条（R-04）；path 含空格 + 中文（quotepath off 原样，末段 rejoin）。
//   - porcelain v2 字段区与 path 分隔**双形态**：空格形态（git 2.45.1 实证，path 为
//     行尾字段含空格原样 rejoin）与制表符形态（设计文档口径，行内首个 `\t` 切出）。
//   - ignored 顶层聚合（D-003@v2）：目录行带尾 `/` → is_dir=true；散落忽略单文件
//     逐条 → is_dir=false。
//   - numstat join：按 path 命中填行数；`-` 二进制行 → binary=true 行数 null；
//     untracked 不在 numstat → 行数恒 null（R-06）。
//   - 空仓库（branch.oid "(initial)"）→ empty=true 早退，files/ignored 空数组，
//     ②③ 采集不执行（单次 exec）。
//   - detached HEAD → head_short 正常返回不误判空仓库（Review Focus #2）。
//   - git_worktree_diff 判态分流：modified/deleted/staged-add → git diff HEAD；
//     真 untracked（`?` 条目）→ no-index（D-010：局部 execFile 读退出码，exit 1 =
//     有差异常态成功、exit ≥2 / killed 才 error；CRLF warning 行不进 error 文案）；
//     staged-add（`1 A.`）fileStatus=added 但走 diff HEAD（分流依据 `?` 条目存在）。
//   - 64KB 截断 truncated + "Binary files" binary 检测（对齐 gitDiffFile）。
//   - 入参守卫：root 越界 / path 空 / `:(` magic → RpcError forbidden。
//   - 命令构造只读断言：status/ls-files/diff 只读子命令 + -c core.quotepath=false +
//     --no-renames + `--` 后 path 独立 argv。
//   - daemon.ts：第 6/7 个平名方法注册 + params 类型归一。
//
// 风格对齐 tests/host-fs-handler-git-log.test.ts：vi.mock('node:child_process')
// 拦截 execFile（队列 + 记录每次调用 cmd/args）+ 真实临时目录（mkdtemp）。本文件
// 队列项扩展 errCode（数值退出码）——runGitNoIndexDiff 局部 execFile 读 err.code
// 判 no-index exit 语义（D-010），既有 mock 只挂 killed/signal 不够用。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * mock 队列：每次 execFile 调用 pop 一项；记录传给 execFile 的 cmd + args。
 *
 * errCode：失败时挂到回调 Error 上的退出码（数值）——runGitNoIndexDiff 的 no-index
 * exit 语义判定读 err.code（D-010：0/1 成功、≥2 error），git 2.45.1 no-index 有差异
 * 时 exit=1（err 非空但业务语义成功）。
 * errKilled / errSignal：超时形态（对齐既有 git-log 测试 mock）。
 */
const dfExecQueue: Array<{
  ok: boolean;
  stdout?: string;
  stderr?: string;
  errCode?: number;
  errKilled?: boolean;
  errSignal?: string;
}> = [];

/** 记录所有 execFile 调用的 (cmd, args)，命令构造断言用。 */
const dfCalls: Array<{ cmd: string; args: string[] }> = [];

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: unknown[]): unknown => {
      const cmd = args[0] as string;
      const args1 = args[1];
      const arr = Array.isArray(args1) ? (args1 as string[]) : [];
      dfCalls.push({ cmd, args: arr });
      const cb = args[args.length - 1] as (
        err: Error | null,
        stdout: Buffer | string,
        stderr: Buffer | string,
      ) => void;
      const next = dfExecQueue.shift();
      if (!next) {
        throw new Error('execFile mock queue exhausted');
      }
      setImmediate(() => {
        if (next.ok) {
          cb(null, next.stdout ?? '', next.stderr ?? '');
        } else {
          const err = new Error(next.stderr ?? 'mock exec failure') as Error & {
            killed?: boolean;
            signal?: string;
            code?: number | string;
          };
          if (next.errCode !== undefined) err.code = next.errCode;
          if (next.errKilled !== undefined) err.killed = next.errKilled;
          if (next.errSignal !== undefined) err.signal = next.errSignal;
          cb(err, next.stdout ?? '', next.stderr ?? '');
        }
      });
      return {
        stdin: { on: () => undefined, end: () => undefined },
      };
    },
  };
});

import { HostFsHandler } from '../src/host-fs-handler';
import { Daemon } from '../src/daemon.js';
import { RpcError } from '../src/ws-client';

/** 断言 promise 以指定 code 的 RpcError reject。 */
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

/** 构造临时根目录（git 方法不落盘，目录仅用于 allowed_roots 校验）。 */
async function makeRoot(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'sillyhub-dirty-'));
}

/** 40 位测试用 oid（head_short 取前 8 位 = a1b2c3d4）。 */
const DF_OID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/** porcelain v2 头两行（oid + head main）。 */
function dfHeaders(head = 'main'): string[] {
  return [`# branch.oid ${DF_OID}`, `# branch.head ${head}`];
}

/**
 * gitDirtyFiles 全成功队列快捷填装：porcelain + ls-files ignored + numstat。
 */
function dfQueue(statusOut: string, ignoredOut: string, numstatOut: string): void {
  dfExecQueue.push(
    { ok: true, stdout: statusOut, stderr: '' }, // ① status --porcelain=v2
    { ok: true, stdout: ignoredOut, stderr: '' }, // ② ls-files ignored
    { ok: true, stdout: numstatOut, stderr: '' }, // ③ diff HEAD --numstat
  );
}

/** porcelain v2 `1` changed 条目（空格形态，git 2.45.1 实证）。 */
function v2Changed(xy: string, path: string): string {
  return `1 ${xy} N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 ${path}`;
}

/** porcelain v2 `u` unmerged 条目（10 前置 token，空格形态）。 */
function v2Unmerged(path: string): string {
  return `u AA N... 100644 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222 3333333333333333333333333333333333333333 ${path}`;
}

// ──────────────────────────────────────────────────────────────────────────────
// gitDirtyFiles（task-01 2026-10-25-explorer-git-status —— 四态清单 / ignored
// 聚合 / numstat join / 空仓库 / detached / 错误通道）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitDirtyFiles 四态清单解析（task-01 DF1~DF7）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    dfExecQueue.length = 0;
    dfCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('DF1: 四态映射表驱动 —— XY 含 D→deleted / 含 A→added / 其余→modified；u→modified；?→untracked；rename 拆 D+A 两条', async () => {
    dfQueue(
      [
        ...dfHeaders(),
        v2Changed('.M', 'src/modified.ts'),
        v2Changed('A.', 'new-name.txt'), // rename 拆出的 added 半条（R-04）
        v2Changed('.D', 'old-name.txt'), // rename 拆出的 deleted 半条（R-04）
        v2Unmerged('conflict.txt'), // u 条目 → modified（D-011）
        '? notes/未跟踪 文件.md', // untracked（空格+中文原样）
      ].join('\n') + '\n',
      '',
      [
        '10\t2\tsrc/modified.ts',
        '7\t0\tnew-name.txt',
        '0\t5\told-name.txt',
      ].join('\n') + '\n',
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.error).toBeNull();
    expect(r.empty).toBe(false);
    expect(r.head_short).toBe('a1b2c3d4');
    expect(r.ignored).toEqual([]);
    expect(r.files).toEqual([
      { path: 'src/modified.ts', status: 'modified', additions: 10, deletions: 2, binary: false },
      { path: 'new-name.txt', status: 'added', additions: 7, deletions: 0, binary: false },
      { path: 'old-name.txt', status: 'deleted', additions: 0, deletions: 5, binary: false },
      { path: 'conflict.txt', status: 'modified', additions: null, deletions: null, binary: false },
      { path: 'notes/未跟踪 文件.md', status: 'untracked', additions: null, deletions: null, binary: false },
    ]);
  });

  it('DF2: path 含空格 + 中文（空格形态末段 rejoin 与 numstat join 按 path 精确命中）', async () => {
    dfQueue(
      [...dfHeaders(), v2Changed('.M', 'dir with space/中文 文件.md')].join('\n') + '\n',
      '',
      '3\t1\tdir with space/中文 文件.md\n',
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toEqual([
      { path: 'dir with space/中文 文件.md', status: 'modified', additions: 3, deletions: 1, binary: false },
    ]);
  });

  it('DF3: 制表符形态兼容 —— 字段区与 path 之间 `\\t` 分隔时按行内首个 \\t 切出', async () => {
    const tabLine = `1 .M N... 100644 100644 100644 1111111111111111111111111111111111111111 2222222222222222222222222222222222222222\tpath with space.md`;
    dfQueue([...dfHeaders(), tabLine].join('\n') + '\n', '', '1\t1\tpath with space.md\n');
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toEqual([
      { path: 'path with space.md', status: 'modified', additions: 1, deletions: 1, binary: false },
    ]);
  });

  it('DF4: ignored 顶层聚合 —— 目录行带尾 `/` → is_dir=true，散落单文件逐条 → is_dir=false（D-003@v2）', async () => {
    dfQueue(
      [...dfHeaders()].join('\n') + '\n',
      ['.idea/', '.env', 'node_modules/', 'docs/被忽略 单文件.md'].join('\n') + '\n',
      '',
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.ignored).toEqual([
      { path: '.idea/', is_dir: true },
      { path: '.env', is_dir: false },
      { path: 'node_modules/', is_dir: true },
      { path: 'docs/被忽略 单文件.md', is_dir: false },
    ]);
    expect(r.files).toEqual([]);
  });

  it('DF5: numstat join 细节 —— `-` 二进制行 → binary=true 行数 null；untracked 缺行恒 null（R-06）', async () => {
    dfQueue(
      [...dfHeaders(), v2Changed('.M', 'assets/logo.png'), '? new.md'].join('\n') + '\n',
      '',
      '-\t-\tassets/logo.png\n',
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toEqual([
      { path: 'assets/logo.png', status: 'modified', additions: null, deletions: null, binary: true },
      { path: 'new.md', status: 'untracked', additions: null, deletions: null, binary: false },
    ]);
  });

  it('DF6: 空仓库 "(initial)" —— empty=true、files/ignored 空数组、head_short=null、②③ 不执行（单次 exec）', async () => {
    dfExecQueue.push({
      ok: true,
      stdout: ['# branch.oid (initial)', '# branch.head main', '? readme.md'].join('\n') + '\n',
      stderr: '',
    });
    const r = await handler.gitDirtyFiles({ root });
    expect(r).toEqual({
      head_short: null,
      empty: true,
      files: [], // 空仓库契约：untracked 也归空态
      ignored: [],
      error: null,
    });
    expect(dfCalls).toHaveLength(1); // ② ls-files / ③ numstat 被早退短路
  });

  it('DF7: detached HEAD —— head_short 正常返回、不误判空仓库（Review Focus #2）', async () => {
    dfQueue(
      ['# branch.oid ' + DF_OID, '# branch.head (detached)', v2Changed('.M', 'a.ts')].join('\n') + '\n',
      '',
      '1\t1\ta.ts\n',
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.empty).toBe(false);
    expect(r.head_short).toBe('a1b2c3d4');
    expect(r.files).toHaveLength(1);
    expect(r.error).toBeNull();
  });
});

describe('HostFsHandler — gitDirtyFiles 错误通道与命令构造（task-01 DF8~DF12）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    dfExecQueue.length = 0;
    dfCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('DF8: root 越界 → RpcError forbidden（白名单守卫，不抛 git 命令）', async () => {
    await expectRpcError(handler.gitDirtyFiles({ root: 'C:/definitely-not-allowed' }), 'forbidden');
    expect(dfCalls).toHaveLength(0);
  });

  it('DF9: porcelain 失败（非 git 目录）→ error 通道整体返回，不抛', async () => {
    dfExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toEqual([]);
    expect(r.head_short).toBeNull();
    expect(r.empty).toBe(false);
    expect(r.error).toContain('not a git repository');
  });

  it('DF10: ls-files 失败 → ignored 空数组 + error 记录，files 保留（不整体失败）', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), v2Changed('.M', 'a.ts')].join('\n') + '\n', stderr: '' },
      { ok: false, stdout: '', stderr: 'fatal: ls-files boom' },
      { ok: true, stdout: '1\t1\ta.ts\n', stderr: '' },
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toHaveLength(1);
    expect(r.ignored).toEqual([]);
    expect(r.error).toContain('ls-files boom');
  });

  it('DF11: numstat 失败（非 HEAD 缺失族）→ 行数 null + error 记录', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), v2Changed('.M', 'a.ts')].join('\n') + '\n', stderr: '' },
      { ok: true, stdout: '', stderr: '' },
      { ok: false, stdout: '', stderr: 'fatal: numstat boom' },
    );
    const r = await handler.gitDirtyFiles({ root });
    expect(r.files).toEqual([
      { path: 'a.ts', status: 'modified', additions: null, deletions: null, binary: false },
    ]);
    expect(r.error).toContain('numstat boom');
  });

  it('DF12: 命令构造 —— status/ls-files/diff 只读子命令 + quotepath off + --no-renames，`-C root` 前置', async () => {
    dfQueue([...dfHeaders(), v2Changed('.M', 'a.ts')].join('\n') + '\n', '', '');
    await handler.gitDirtyFiles({ root });
    expect(dfCalls.map((c) => c.cmd)).toEqual(['git', 'git', 'git']);
    const [statusArgs, lsArgs, diffArgs] = dfCalls.map((c) => c.args);
    expect(statusArgs.slice(0, 4)).toEqual(['-C', root, '-c', 'core.quotepath=false']);
    expect(statusArgs.slice(4, 6)).toEqual(['status', '--porcelain=v2']);
    expect(statusArgs).toContain('--branch');
    expect(statusArgs).toContain('--no-show-stash');
    expect(statusArgs).toContain('--no-renames');
    expect(lsArgs.slice(4, 5)).toEqual(['ls-files']);
    expect(lsArgs).toContain('--directory');
    expect(diffArgs.slice(4, 8)).toEqual(['diff', 'HEAD', '--numstat', '--no-renames']);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// gitWorktreeDiff（task-01 2026-10-25-explorer-git-status —— 判态分流 /
// no-index exit 语义 D-010 / 截断与 binary / 守卫）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitWorktreeDiff 判态分流（task-01 WD1~WD8）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    dfExecQueue.length = 0;
    dfCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  /** 单文件判态 porcelain + 第二步差异采集 的两段队列。 */
  function wdQueue(statusLines: string[], diffOut: string): void {
    dfExecQueue.push(
      { ok: true, stdout: statusLines.join('\n') + '\n', stderr: '' },
      { ok: true, stdout: diffOut, stderr: '' },
    );
  }

  const DIFF_TEXT = ['diff --git a/src/a.ts b/src/a.ts', '@@ -1,2 +1,3 @@', '+新行', '-旧行'].join('\n');

  it('WD1: modified（`1 .M`）→ git diff HEAD 采集，status=modified、head_short 正常', async () => {
    wdQueue([...dfHeaders(), v2Changed('.M', 'src/a.ts')], DIFF_TEXT);
    const r = await handler.gitWorktreeDiff({ root, path: 'src/a.ts' });
    expect(r).toEqual({
      status: 'modified',
      head_short: 'a1b2c3d4',
      diff: DIFF_TEXT,
      truncated: false,
      binary: false,
      error: null,
    });
    expect(dfCalls[1].args.slice(4, 8)).toEqual(['diff', 'HEAD', '--unified=3', '--no-color']);
    const dd = dfCalls[1].args.indexOf('--');
    expect(dfCalls[1].args[dd + 1]).toBe('src/a.ts'); // path 独立 argv
  });

  it('WD2: deleted（`1 .D`）→ status=deleted 走 diff HEAD（全红删除形态）', async () => {
    wdQueue([...dfHeaders(), v2Changed('.D', 'gone.ts')], DIFF_TEXT);
    const r = await handler.gitWorktreeDiff({ root, path: 'gone.txt' });
    expect(r.status).toBe('deleted');
    expect(dfCalls[1].args[4]).toBe('diff'); // diff HEAD 分支而非 no-index
  });

  it('WD3: staged-add（`1 A.`）→ status=added 但走 diff HEAD（分流依据 `?` 条目，非 added 投影值）', async () => {
    wdQueue([...dfHeaders(), v2Changed('A.', 'staged-new.ts')], DIFF_TEXT);
    const r = await handler.gitWorktreeDiff({ root, path: 'staged-new.ts' });
    expect(r.status).toBe('added');
    expect(dfCalls[1].args[5]).not.toBe('--no-index'); // diff HEAD 分支
    expect(dfCalls[1].args[4]).toBe('diff');
  });

  it('WD4: 真 untracked（`?` 条目）→ no-index 形态 + exit 1 = 有差异常态成功（D-010）', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), '? brand new.md'].join('\n') + '\n', stderr: '' },
      // no-index exit=1（err 非空）但业务成功：stdout 为全新增 diff
      { ok: false, errCode: 1, stdout: DIFF_TEXT, stderr: '' },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'brand new.md' });
    expect(r.status).toBe('added');
    expect(r.diff).toBe(DIFF_TEXT);
    expect(r.error).toBeNull();
    const args = dfCalls[1].args;
    expect(args.slice(4, 5)).toEqual(['diff']);
    expect(args).toContain('--no-index');
    expect(args).toContain('/dev/null');
    const dd = args.indexOf('--');
    expect(args[dd + 1]).toBe('/dev/null');
    expect(args[dd + 2]).toBe('brand new.md'); // path 独立 argv（含空格原样）
  });

  it('WD5: no-index exit 2 → error 通道（≥2 才失败）', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), '? brand new.md'].join('\n') + '\n', stderr: '' },
      { ok: false, errCode: 2, stdout: '', stderr: 'fatal: real failure' },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'brand new.md' });
    expect(r.error).toContain('real failure');
    expect(r.diff).toBe('');
  });

  it('WD6: CRLF warning 行不进 error 文案（D-010）——warning 过滤后仅剩真错误', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), '? brand new.md'].join('\n') + '\n', stderr: '' },
      {
        ok: false,
        errCode: 2,
        stdout: '',
        stderr: [
          "warning: in the working copy of 'brand new.md', LF will be replaced by CRLF the next time Git touches it",
          'fatal: real failure',
        ].join('\n'),
      },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'brand new.md' });
    expect(r.error).toBe('fatal: real failure'); // warning 行被过滤
    expect(r.error).not.toContain('CRLF');
  });

  it('WD7: no-index killed（超时形态）→ error 通道', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders(), '? brand new.md'].join('\n') + '\n', stderr: '' },
      { ok: false, errKilled: true, errSignal: 'SIGTERM', stdout: '', stderr: '' },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'brand new.md' });
    expect(r.error).toBeTruthy();
    expect(r.diff).toBe('');
  });

  it('WD8: 64KB 截断 truncated + "Binary files" binary 检测（gitDiffFile 同款）', async () => {
    wdQueue([...dfHeaders(), v2Changed('.M', 'big.bin')], 'x'.repeat(70_000));
    const r = await handler.gitWorktreeDiff({ root, path: 'big.bin' });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.diff, 'utf8')).toBe(64 * 1024);

    dfExecQueue.length = 0;
    dfCalls.length = 0;
    wdQueue([...dfHeaders(), v2Changed('.M', 'logo.png')], 'Binary files a/logo.png and b/logo.png differ');
    const b = await handler.gitWorktreeDiff({ root, path: 'logo.png' });
    expect(b.binary).toBe(true);
    expect(b.truncated).toBe(false);
  });
});

describe('HostFsHandler — gitWorktreeDiff 边界与守卫（task-01 WD9~WD12）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    dfExecQueue.length = 0;
    dfCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('WD9: 无条目（文件与 HEAD 一致）→ status=modified + 空 diff 不走红通道', async () => {
    dfExecQueue.push(
      { ok: true, stdout: [...dfHeaders()].join('\n') + '\n', stderr: '' },
      { ok: true, stdout: '', stderr: '' },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'clean.ts' });
    expect(r).toEqual({
      status: 'modified',
      head_short: 'a1b2c3d4',
      diff: '',
      truncated: false,
      binary: false,
      error: null,
    });
  });

  it('WD10: 空仓库 untracked —— head_short=null 但 no-index 照常出 diff', async () => {
    dfExecQueue.push(
      { ok: true, stdout: ['# branch.oid (initial)', '# branch.head main', '? first.md'].join('\n') + '\n', stderr: '' },
      { ok: false, errCode: 1, stdout: DIFF_MIN, stderr: '' },
    );
    const r = await handler.gitWorktreeDiff({ root, path: 'first.md' });
    expect(r.head_short).toBeNull();
    expect(r.status).toBe('added');
    expect(r.diff).toBe(DIFF_MIN);
  });

  it('WD11: path 空 / `:(` magic → RpcError forbidden；root 越界同理', async () => {
    await expectRpcError(handler.gitWorktreeDiff({ root, path: '' }), 'forbidden');
    await expectRpcError(handler.gitWorktreeDiff({ root, path: ':(glob)**' }), 'forbidden');
    await expectRpcError(
      handler.gitWorktreeDiff({ root: 'C:/definitely-not-allowed', path: 'a.ts' }),
      'forbidden',
    );
    expect(dfCalls).toHaveLength(0);
  });

  it('WD12: porcelain 失败 → error 通道整体返回（单次 exec，不进分流）', async () => {
    dfExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories): .git',
    });
    const r = await handler.gitWorktreeDiff({ root, path: 'a.ts' });
    expect(r.error).toContain('not a git repository');
    expect(dfCalls).toHaveLength(1);
  });
});

const DIFF_MIN = '+hello';

// ──────────────────────────────────────────────────────────────────────────────
// daemon.ts 平名注册（第 6/7 个平名 git 方法 —— 对齐既有五方法注册形态）
// ──────────────────────────────────────────────────────────────────────────────

type RpcHandlerFn = (params: Record<string, unknown>) => Promise<unknown> | unknown;

/** 轻量 fake WsClientLike：捕获 registerRpcHandler 注册的 (method, handler)。 */
function makeFakeWs(): {
  methods: Map<string, RpcHandlerFn>;
  registerRpcHandler: (method: string, handler: RpcHandlerFn) => void;
} {
  const methods = new Map<string, RpcHandlerFn>();
  return {
    methods,
    registerRpcHandler(method, handler) {
      methods.set(method, handler);
    },
  };
}

type DaemonInternals = {
  _config: { runtime_id: string; allowed_roots: string[] };
  _logger: { warn: ReturnType<typeof vi.fn> };
  _policyCache: unknown;
  _registeredRuntimes: Map<string, string>;
  _registerGitLogRpcHandler: (ws: unknown) => void;
};

function makeHarness(allowedRoots: string[]): {
  methods: Map<string, RpcHandlerFn>;
  call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
} {
  const daemon = Object.create(Daemon.prototype) as unknown as DaemonInternals;
  daemon._config = {
    runtime_id: 'rt-dirty-test',
    allowed_roots: [...allowedRoots],
  } as DaemonInternals['_config'];
  daemon._logger = { warn: vi.fn() };
  daemon._policyCache = null;
  daemon._registeredRuntimes = new Map();
  const ws = makeFakeWs();
  daemon._registerGitLogRpcHandler(ws);
  return {
    methods: ws.methods,
    call: (method, params) => {
      const h = ws.methods.get(method);
      if (!h) throw new Error(`handler not registered: ${method}`);
      return Promise.resolve(h(params));
    },
  };
}

describe('daemon 注册器 — git_dirty_files / git_worktree_diff 平名注册（task-01 RG）', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRoot();
  });

  afterEach(async () => {
    dfExecQueue.length = 0;
    dfCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('RG1: 两新方法平名注册（无 host_fs. 前缀）', () => {
    const h = makeHarness(['/tmp/whatever-root']);
    expect(h.methods.has('git_dirty_files')).toBe(true);
    expect(h.methods.has('git_worktree_diff')).toBe(true);
    // 完整方法集（7 个）由 tests/host-fs-handler-git-log.test.ts GL30 断言。
  });

  it("RG2: 经注册路径 —— params 类型归一（root 非字符串归空串 → forbidden）", async () => {
    const h = makeHarness([root]);
    await expectRpcError(h.call('git_dirty_files', {}), 'forbidden');
    await expectRpcError(h.call('git_worktree_diff', { root }), 'forbidden'); // path 缺省 → ''
  });

  it('RG3: 经注册路径端到端 —— git_dirty_files 真实走 handler 采集', async () => {
    const h = makeHarness([root]);
    dfQueue([...dfHeaders(), v2Changed('.M', 'a.ts')].join('\n') + '\n', '', '1\t2\ta.ts\n');
    const r = (await h.call('git_dirty_files', { root })) as {
      files: Array<{ path: string }>;
    };
    expect(r.files).toEqual([
      { path: 'a.ts', status: 'modified', additions: 1, deletions: 2, binary: false },
    ]);
  });
});
