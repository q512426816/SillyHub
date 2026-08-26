// tests/host-fs-handler-git-log.test.ts
// task-01（2026-08-25-workspace-git-log / FR-01 FR-05 FR-07 / design §5.2 + §7.2 +
// R-01 R-03）：host-fs-handler git 只读四方法（gitLog / gitRefs / gitShow /
// gitDiffFile）+ daemon.ts 平名注册单测。
//
// 覆盖（对齐 TaskCard acceptance 四条）：
//   - 入参守卫（R-01）：root 越界 forbidden；sha ^[0-9a-fA-F]{4,40}$；branch
//     ^[A-Za-z0-9][A-Za-z0-9._/-]*$（首字符禁 - 且 ≤200）；author ≤120 且禁控制
//     字符；path 拒 :( 开头 pathspec magic；count 正整数上限守卫。
//   - 解析（R-03）：中文 message / 含引号 / 多行 body / %x1e 记录分隔 / 单条解析
//     失败跳过并计数不整页失败 / truncated 真值语义。
//   - 空仓库空态（CC-17）：git_log exit 128 → commits:[]；git_refs rev-parse 失败
//     → head:null（均不走红通道 error）。
//   - git_show：numstat 分区解析（文本 + 二进制 -\t-\t 行）；git_diff_file：
//     64KB 截断标 truncated、Binary files 输出标 binary。
//   - 只读命令断言：子命令仅 log / for-each-ref / show / rev-parse；branch /
//     author / path 全部独立 argv 经 execFile（记录 cmd+args 逐 token 断言）。
//
// task-01（2026-08-26-workspace-git-status / FR-02 FR-03 FR-06 / design §5.2 + §7.2）
// 追加 git_status（第 5 个平名 git 方法）用例 GL34~GL45：
//   - porcelain v2 六类形态：正常（upstream+branch.ab）/ 无 upstream（ahead/behind
//     null）/ detached（branch=head_short）/ 空仓库 "(initial)"（empty=true 计数全
//     null，diff HEAD exit 128 容错）/ untracked 混合（1/2/u 条目不参与）/ binary
//     numstat 行（计文件不计行）。
//   - fetch 三分支降级：超时走 err.killed/signal 判定（stderr 空串）/ 非零退出
//     fetch_failed / git remote 预检 no_remote；失败不阻断 ②③ 字段。
//   - 命令构造只读断言：remote/fetch/status/diff 只读子命令 + --no-show-stash +
//     --no-renames 逐 token（FR-06 独立 argv 不经 shell）。
//   - daemon.ts：第 5 个平名 git 方法 git_status 注册断言。
//
// 风格对齐 tests/host-fs-handler-worktree.test.ts：vi.mock('node:child_process')
// 拦截 execFile（队列 + 记录每次调用 cmd/args）+ 真实临时目录（mkdtemp）。
// 注册器测试对齐 tests/file-rpc-explorer.test.ts：Object.create(Daemon.prototype)
// 原型法只喂 _registerGitLogRpcHandler 触及的字段，经 fake WsClientLike 按真实
// 注册路径逐 params 调用。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const IS_WIN = platform() === 'win32';

/**
 * mock 队列：每次 execFile 调用 pop 一项；记录传给 execFile 的 cmd + args，
 * 断言「只读子命令 + branch/author/path 独立 argv」（R-01 验收关键）。
 *
 * errKilled / errSignal：失败时挂到回调 Error 上的属性——git_status 的 fetch
 * 超时判定读 err.killed/signal 而非 stderr（Grill CC-02，真实 execFile 超时
 * Node 自动 SIGTERM，两属性同时置位）。
 */
const glExecQueue: Array<{
  ok: boolean;
  stdout?: string;
  stderr?: string;
  errKilled?: boolean;
  errSignal?: string;
}> = [];

/** 记录所有 execFile 调用的 (cmd, args)，命令构造断言用。 */
const glCalls: Array<{ cmd: string; args: string[] }> = [];

// vi.mock 拦截 node:child_process 的 execFile（hoist 到文件顶部）。
// 本文件还 import Daemon（注册器 harness），其依赖图内其它模块用到
// spawn / execSync 等导出——factory 展开真实模块只覆写 execFile，
// 不破坏其余导出（与 host-fs-handler-worktree.test.ts 的差异点，原因如上）。
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    execFile: (...args: unknown[]): unknown => {
      const cmd = args[0] as string;
      const args1 = args[1];
      const arr = Array.isArray(args1) ? (args1 as string[]) : [];
      glCalls.push({ cmd, args: arr });
      const cb = args[args.length - 1] as (
        err: Error | null,
        stdout: Buffer | string,
        stderr: Buffer | string,
      ) => void;
      const next = glExecQueue.shift();
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
          };
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

// import 必须在 vi.mock 之后（vitest hoist 会处理顺序，但为可读性放在 mock 后）。
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
  return mkdtemp(join(tmpdir(), 'sillyhub-gitlog-'));
}

// ── pretty 输出构造工具（模拟真实 git log --pretty=%H%x00...%B%x1e 输出形状）──
//
// 真实形状：每条记录 = 8 字段 \x00 连接 + %B 尾部换行 + \x1e；相邻记录间 git 补 \n。

/** 单条 commit 记录（8 字段 \x00 连接，message 末位）。 */
function commitRecord(opts: {
  hash: string;
  short: string;
  parents?: string[];
  author?: string;
  email?: string;
  aI?: string;
  cI?: string;
  message: string;
}): string {
  return [
    opts.hash,
    opts.short,
    (opts.parents ?? []).join(' '),
    opts.author ?? '琴忆',
    opts.email ?? 'qinyi@example.com',
    opts.aI ?? '2026-08-25T10:00:00+08:00',
    opts.cI ?? '2026-08-25T10:00:01+08:00',
    opts.message,
  ].join('\x00');
}

/** git log stdout：记录间以 \n 分隔（\x1e 后置，记录内 %B 尾换行保留）。 */
function logStdout(entries: string[]): string {
  return entries.map((e) => `${e}\n\x1e`).join('\n');
}

/** git show stdout：pretty 记录（\x1e 收尾）+ numstat 区两段拼接。 */
function showStdout(entry: string, numstat: string[]): string {
  return `${entry}\n\x1e\n${numstat.join('\n')}\n`;
}

// ── git_status porcelain v2 输出构造（task-01 2026-08-26-workspace-git-status）──

/** 40 位测试用 oid（head_short 取前 8 位 = a1b2c3d4）。 */
const GS_OID = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2';

/** porcelain v2 stdout：行数组拼整段（行形状对齐 git status --porcelain=v2 --branch）。 */
function porcelainV2(lines: string[]): string {
  return lines.join('\n') + '\n';
}

/** 正常形态 porcelain 头三行（oid + head main + upstream + ab）。 */
function gsNormalHeaders(): string[] {
  return [
    `# branch.oid ${GS_OID}`,
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +2 -1',
  ];
}

/**
 * git_status 队列快捷填装：remote 预检（有 origin）+ fetch 成功 + porcelain + numstat。
 * 便于各用例只覆写关心的段（fetch 三分支用例自行逐项 push）。
 */
function gsQueue(statusOut: string, diffOut: string): void {
  glExecQueue.push(
    { ok: true, stdout: 'origin\n', stderr: '' }, // ① git remote 预检
    { ok: true, stdout: '', stderr: '' }, // ① git fetch --quiet
    { ok: true, stdout: statusOut, stderr: '' }, // ② porcelain v2
    { ok: true, stdout: diffOut, stderr: '' }, // ③ numstat
  );
}

// ──────────────────────────────────────────────────────────────────────────────
// 入参守卫（R-01 / TaskCard acceptance 第 1 条）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — git 只读四方法入参守卫（task-01 GL1~GL8，R-01）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL1: root 越界 → 四方法全 forbidden（assertWithinAllowedRoots 守卫）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    await expectRpcError(handler.gitLog({ root: evil, count: 10 }), 'forbidden');
    await expectRpcError(handler.gitRefs({ root: evil }), 'forbidden');
    await expectRpcError(handler.gitShow({ root: evil, sha: 'a1b2c3d4' }), 'forbidden');
    await expectRpcError(
      handler.gitDiffFile({ root: evil, sha: 'a1b2c3d4', path: 'a.txt' }),
      'forbidden',
    );
    // 守卫先于 execFile → 不消耗队列。
    expect(glExecQueue.length).toBe(0);
    expect(glCalls.length).toBe(0);
  });

  it('GL2: branch 首字符 - （-n 选项劫持面）→ forbidden', async () => {
    await expectRpcError(
      handler.gitLog({ root, branch: '-n5', count: 10 }),
      'forbidden',
    );
    await expectRpcError(
      handler.gitLog({ root, branch: '--all', count: 10 }),
      'forbidden',
    );
    expect(glCalls.length).toBe(0);
  });

  it('GL3: branch 含白名单外字符（空格 / 分号 / $()）→ forbidden', async () => {
    await expectRpcError(handler.gitLog({ root, branch: 'a b', count: 10 }), 'forbidden');
    await expectRpcError(handler.gitLog({ root, branch: 'a;rm', count: 10 }), 'forbidden');
    await expectRpcError(handler.gitLog({ root, branch: 'a$(x)', count: 10 }), 'forbidden');
    expect(glCalls.length).toBe(0);
  });

  it('GL4: branch 超 200 字符 → forbidden（≤200 守卫）', async () => {
    await expectRpcError(
      handler.gitLog({ root, branch: 'a'.repeat(201), count: 10 }),
      'forbidden',
    );
    // 恰好 200 放行（边界内），走 execFile 消耗一条队列。
    glExecQueue.push({ ok: true, stdout: '', stderr: '' });
    const r = await handler.gitLog({ root, branch: 'a'.repeat(200), count: 10 });
    expect(r.commits).toEqual([]);
    expect(glCalls.length).toBe(1);
  });

  it('GL5: author 超 120 字符或含控制字符（换行）→ forbidden', async () => {
    await expectRpcError(
      handler.gitLog({ root, author: 'a'.repeat(121), count: 10 }),
      'forbidden',
    );
    await expectRpcError(
      handler.gitLog({ root, author: 'evil\n--upload-pack=x', count: 10 }),
      'forbidden',
    );
    expect(glCalls.length).toBe(0);
  });

  it('GL6: count 非法（0 / 负数 / 非整数 / 超 5000 上限）→ forbidden', async () => {
    await expectRpcError(handler.gitLog({ root, count: 0 }), 'forbidden');
    await expectRpcError(handler.gitLog({ root, count: -5 }), 'forbidden');
    await expectRpcError(handler.gitLog({ root, count: 1.5 }), 'forbidden');
    await expectRpcError(handler.gitLog({ root, count: 5001 }), 'forbidden');
    expect(glCalls.length).toBe(0);
  });

  it('GL7: sha 非 4~40 位十六进制（命令注入 / 过短 / 过长）→ git_show + git_diff_file 全拒', async () => {
    await expectRpcError(handler.gitShow({ root, sha: 'HEAD;rm -rf' }), 'forbidden');
    await expectRpcError(handler.gitShow({ root, sha: 'ab' }), 'forbidden');
    await expectRpcError(handler.gitShow({ root, sha: 'g'.repeat(41) }), 'forbidden');
    await expectRpcError(
      handler.gitDiffFile({ root, sha: '../../etc', path: 'a.txt' }),
      'forbidden',
    );
    expect(glCalls.length).toBe(0);
  });

  it('GL8: path 空 / :( 开头 pathspec magic → git_diff_file forbidden', async () => {
    await expectRpcError(
      handler.gitDiffFile({ root, sha: 'a1b2c3d4', path: '' }),
      'forbidden',
    );
    await expectRpcError(
      handler.gitDiffFile({ root, sha: 'a1b2c3d4', path: ':(glob)**/*' }),
      'forbidden',
    );
    expect(glCalls.length).toBe(0);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// git_log 解析（R-03 / TaskCard acceptance 第 2 条）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitLog 解析（task-01 GL9~GL16，R-03 不按行切）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL9: 中文 message / 含引号 / 多行 body 全字段保真（不按行切）', async () => {
    glExecQueue.push({
      ok: true,
      stdout: logStdout([
        commitRecord({
          hash: 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2',
          short: 'a1b2c3d',
          parents: ['f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1'],
          author: '琴忆',
          email: 'qinyi@example.com',
          message: '修复"引号"与「中文」标题\n\n正文第二行\n带 "quotes" 的多行 body',
        }),
      ]),
    });
    const r = await handler.gitLog({ root, count: 10 });
    expect(r.commits.length).toBe(1);
    const c = r.commits[0];
    expect(c.hash).toBe('a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2');
    expect(c.short).toBe('a1b2c3d');
    expect(c.parents).toEqual(['f0e1d2c3b4a5f0e1d2c3b4a5f0e1d2c3b4a5f0e1']);
    expect(c.author_name).toBe('琴忆');
    expect(c.author_email).toBe('qinyi@example.com');
    expect(c.author_date).toBe('2026-08-25T10:00:00+08:00');
    expect(c.committer_date).toBe('2026-08-25T10:00:01+08:00');
    // message 内部换行保留，%B 尾部换行剥除。
    expect(c.message).toBe('修复"引号"与「中文」标题\n\n正文第二行\n带 "quotes" 的多行 body');
    expect(r.truncated).toBe(false);
    expect(r.error).toBeNull();
  });

  it('GL10: %x1e 记录分隔多条解析：根提交 parents=[]，merge 提交 parents 双元素', async () => {
    glExecQueue.push({
      ok: true,
      stdout: logStdout([
        commitRecord({
          hash: 'c' + 'c'.repeat(39),
          short: 'ccccccc',
          parents: ['a' + 'a'.repeat(39), 'b' + 'b'.repeat(39)],
          message: 'merge: 合并 feature 分支',
        }),
        commitRecord({
          hash: 'a' + 'a'.repeat(39),
          short: 'aaaaaaa',
          parents: [],
          message: 'init: 初始提交',
        }),
      ]),
    });
    const r = await handler.gitLog({ root, count: 10 });
    expect(r.commits.length).toBe(2);
    expect(r.commits[0].parents).toHaveLength(2);
    expect(r.commits[0].message).toBe('merge: 合并 feature 分支');
    expect(r.commits[1].parents).toEqual([]);
    expect(r.commits[1].message).toBe('init: 初始提交');
    expect(r.truncated).toBe(false); // 2 < count=10 且无跳过
  });

  it('GL11: 单条解析失败跳过并计数不整页失败 → 其余条目照常返回 + truncated=true', async () => {
    glExecQueue.push({
      ok: true,
      stdout: logStdout([
        commitRecord({ hash: 'a' + 'a'.repeat(39), short: 'aaaaaaa', message: 'ok-1' }),
        // 畸形记录：字段数 < 8（模拟输出截断 / 格式漂移）。
        'broken\x00only\x00three',
        commitRecord({ hash: 'b' + 'b'.repeat(39), short: 'bbbbbbb', message: 'ok-2' }),
      ]),
    });
    const r = await handler.gitLog({ root, count: 10 });
    expect(r.commits.length).toBe(2); // 坏条跳过，不整页失败
    expect(r.commits.map((c) => c.message)).toEqual(['ok-1', 'ok-2']);
    expect(r.truncated).toBe(true); // 存在跳过 → 结果不完整
    expect(r.error).toBeNull();
  });

  it('GL12: 返回条数达到 -n 上限 → truncated=true（可能还有更多提交）', async () => {
    glExecQueue.push({
      ok: true,
      stdout: logStdout([
        commitRecord({ hash: 'a' + 'a'.repeat(39), short: 'aaaaaaa', message: 'm1' }),
        commitRecord({ hash: 'b' + 'b'.repeat(39), short: 'bbbbbbb', message: 'm2' }),
        commitRecord({ hash: 'c' + 'c'.repeat(39), short: 'ccccccc', message: 'm3' }),
      ]),
    });
    const r = await handler.gitLog({ root, count: 3 });
    expect(r.commits.length).toBe(3);
    expect(r.truncated).toBe(true);
  });

  it('GL13: 空仓库（exit 128 "does not have any commits yet"）→ 空态结构不走红通道', async () => {
    glExecQueue.push({
      ok: false,
      stdout: '',
      stderr: "fatal: your current branch 'main' does not have any commits yet",
    });
    const r = await handler.gitLog({ root, branch: 'main', count: 10 });
    expect(r.commits).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.error).toBeNull();
  });

  it('GL14: 真失败（非 git 目录 / 分支不存在）→ commits 空表 + error 文案（不抛）', async () => {
    glExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories)',
    });
    const r = await handler.gitLog({ root, count: 10 });
    expect(r.commits).toEqual([]);
    expect(r.truncated).toBe(false);
    expect(r.error).toContain('not a git repository');
  });

  it('GL15: 命令构造 —— 只读 log 子命令 + --all 默认 + pretty 格式逐 token 对齐', async () => {
    glExecQueue.push({ ok: true, stdout: '', stderr: '' });
    await handler.gitLog({ root, count: 50 });
    expect(glCalls.length).toBe(1);
    expect(glCalls[0].cmd).toBe('git');
    const args = glCalls[0].args;
    expect(args[0]).toBe('-C');
    expect(args[1]).toBe(root);
    expect(args[2]).toBe('log'); // 只读子命令
    expect(args[3]).toBe('--all'); // 无 branch → --all（互斥二选一）
    expect(args).toContain('-n');
    expect(args[args.indexOf('-n') + 1]).toBe('50');
    expect(args).toContain('--date=iso-strict');
    expect(args).toContain('--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B%x1e');
  });

  it('GL16: 命令构造 —— branch / author 过滤：branch 独立 argv（非 --all），author 单 argv', async () => {
    glExecQueue.push({ ok: true, stdout: '', stderr: '' });
    await handler.gitLog({
      root,
      branch: 'feature/x.y-z',
      author: '琴忆 Qinyi',
      count: 20,
    });
    const args = glCalls[0].args;
    expect(args[3]).toBe('feature/x.y-z'); // 独立 argv，不经 shell 拼接
    expect(args).not.toContain('--all'); // branch 与 --all 互斥
    expect(args).toContain('--author=琴忆 Qinyi'); // 单 argv 传值
    expect(args.join(' ')).not.toMatch(/;|\$\(/); // 无注入面
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// git_refs（tag peeled 回退 CC-04 + 空态 CC-17）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitRefs（task-01 GL17~GL20，CC-04 peeled / CC-17 空态）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL17: branch/remote/tag 混合 + annotated tag peeled 优先 / 轻量 tag 回退 objectname', async () => {
    glExecQueue.push(
      {
        ok: true,
        stdout: [
          // branch：无 peeled → sha=objectname。
          ['refs/heads/main', 'a' + 'a'.repeat(39), '', 'main'].join('\x00'),
          // remote：无 peeled → sha=objectname。
          ['refs/remotes/origin/main', 'b' + 'b'.repeat(39), '', 'origin/main'].join('\x00'),
          // annotated tag：peeled 非空 → sha 取 peeled（commit sha，CC-04）。
          ['refs/tags/v2.0.0', 't' + 't'.repeat(39), 'a' + 'a'.repeat(39), 'v2.0.0'].join('\x00'),
          // 轻量 tag：无 peeled → 回退 objectname（本就是 commit sha）。
          ['refs/tags/v1.0.0', 'c' + 'c'.repeat(39), '', 'v1.0.0'].join('\x00'),
        ].join('\n') + '\n',
      },
      { ok: true, stdout: 'a' + 'a'.repeat(39) + '\n', stderr: '' },
    );
    const r = await handler.gitRefs({ root });
    expect(r.error).toBeNull();
    expect(r.head).toBe('a' + 'a'.repeat(39));
    expect(r.refs).toHaveLength(4);
    expect(r.refs[0]).toEqual({
      name: 'refs/heads/main',
      short: 'main',
      sha: 'a' + 'a'.repeat(39),
      kind: 'branch',
    });
    expect(r.refs[1]).toEqual({
      name: 'refs/remotes/origin/main',
      short: 'origin/main',
      sha: 'b' + 'b'.repeat(39),
      kind: 'remote',
    });
    // annotated tag：sha = peeled（≠ tag 对象 objectname）。
    expect(r.refs[2].kind).toBe('tag');
    expect(r.refs[2].sha).toBe('a' + 'a'.repeat(39));
    // 轻量 tag：sha = objectname。
    expect(r.refs[3].kind).toBe('tag');
    expect(r.refs[3].sha).toBe('c' + 'c'.repeat(39));
  });

  it('GL18: 空仓库 —— for-each-ref 空输出 + rev-parse 失败 → {refs:[], head:null} 空态', async () => {
    glExecQueue.push(
      { ok: true, stdout: '', stderr: '' }, // for-each-ref：无 ref 输出空
      {
        ok: false,
        stdout: '',
        stderr: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
      },
    );
    const r = await handler.gitRefs({ root });
    expect(r.refs).toEqual([]);
    expect(r.head).toBeNull();
    expect(r.error).toBeNull(); // CC-17：空态不走红通道
  });

  it('GL19: for-each-ref 真失败 → refs 空表 + error 文案（不抛）', async () => {
    glExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: not a git repository (or any of the parent directories)',
    });
    const r = await handler.gitRefs({ root });
    expect(r.refs).toEqual([]);
    expect(r.head).toBeNull();
    expect(r.error).toContain('not a git repository');
    expect(glCalls.length).toBe(1); // 失败短路，不再跑 rev-parse
  });

  it('GL20: 命令构造 —— 只读 for-each-ref（format 含 %(*objectname)）+ rev-parse HEAD', async () => {
    glExecQueue.push(
      { ok: true, stdout: '', stderr: '' },
      { ok: true, stdout: 'abc\n', stderr: '' },
    );
    await handler.gitRefs({ root });
    expect(glCalls).toHaveLength(2);
    expect(glCalls.every((c) => c.cmd === 'git')).toBe(true);
    const fer = glCalls[0].args;
    expect(fer[2]).toBe('for-each-ref'); // 只读子命令
    expect(fer[3]).toBe('--format=%(refname)%00%(objectname)%00%(*objectname)%00%(refname:short)');
    expect(fer.slice(4)).toEqual(['refs/heads', 'refs/remotes', 'refs/tags']);
    const rp = glCalls[1].args;
    expect(rp[2]).toBe('rev-parse'); // 只读子命令
    expect(rp[3]).toBe('HEAD');
    expect(rp.join(' ')).not.toContain('config'); // 不写 safe.directory（严格只读，D-003）
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// git_show（numstat 分区解析 + 二进制行）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitShow（task-01 GL21~GL25）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL21: commit 字段 + numstat 文本/二进制/含空格路径混合解析', async () => {
    glExecQueue.push({
      ok: true,
      stdout: showStdout(
        commitRecord({
          hash: 'd' + 'd'.repeat(39),
          short: 'ddddddd',
          parents: ['e' + 'e'.repeat(39)],
          message: 'feat: 详情页\n\n含二进制资源',
        }),
        ['12\t3\tsrc/main.ts', '-\t-\tassets/logo.png', '0\t7\tdocs/my file.md'],
      ),
    });
    const r = await handler.gitShow({ root, sha: 'd1d2d3d4' });
    expect(r.error).toBeNull();
    expect(r.commit?.hash).toBe('d' + 'd'.repeat(39));
    expect(r.commit?.message).toBe('feat: 详情页\n\n含二进制资源');
    expect(r.files).toEqual([
      { path: 'src/main.ts', add: 12, del: 3, binary: false },
      { path: 'assets/logo.png', add: null, del: null, binary: true },
      { path: 'docs/my file.md', add: 0, del: 7, binary: false },
    ]);
  });

  it('GL22: merge 提交（numstat 区为空）→ files:[] 且 commit 正常解析', async () => {
    glExecQueue.push({
      ok: true,
      stdout: showStdout(
        commitRecord({
          hash: 'f' + 'f'.repeat(39),
          short: 'fffffff',
          parents: ['a' + 'a'.repeat(39), 'b' + 'b'.repeat(39)],
          message: 'merge: 无冲突合并',
        }),
        [],
      ),
    });
    const r = await handler.gitShow({ root, sha: 'ffff' });
    expect(r.error).toBeNull();
    expect(r.files).toEqual([]);
    expect(r.commit?.parents).toHaveLength(2);
  });

  it('GL23: sha 不存在（git show 失败）→ {commit:null, files:[], error}（不抛）', async () => {
    glExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: ambiguous argument \'deadbeef\': unknown revision',
    });
    const r = await handler.gitShow({ root, sha: 'deadbeef' });
    expect(r.commit).toBeNull();
    expect(r.files).toEqual([]);
    expect(r.error).toContain('unknown revision');
  });

  it('GL24: pretty 记录无 %x1e（输出畸形）→ commit:null + error（防御路径）', async () => {
    glExecQueue.push({ ok: true, stdout: 'garbage without separator', stderr: '' });
    const r = await handler.gitShow({ root, sha: 'a1b2c3d4' });
    expect(r.commit).toBeNull();
    expect(r.error).toBe('git show parse failed');
  });

  it('GL25: 命令构造 —— 只读 show 子命令 + --numstat --no-renames + 同 pretty 格式', async () => {
    glExecQueue.push({ ok: true, stdout: showStdout(commitRecord({ hash: 'a' + 'a'.repeat(39), short: 'aaaaaaa', message: 'm' }), []) });
    await handler.gitShow({ root, sha: 'a1b2c3d4e5f6' });
    const args = glCalls[0].args;
    expect(glCalls[0].cmd).toBe('git');
    expect(args[2]).toBe('show'); // 只读子命令
    expect(args[3]).toBe('a1b2c3d4e5f6'); // sha 独立 argv
    expect(args).toContain('--numstat');
    expect(args).toContain('--no-renames');
    expect(args).toContain('--pretty=format:%H%x00%h%x00%P%x00%an%x00%ae%x00%aI%x00%cI%x00%B%x1e');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// git_diff_file（64KB 截断 CC-05 + 二进制检测 R-06）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitDiffFile（task-01 GL26~GL29，CC-05 / R-06）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL26: 小 diff 全量回传 —— truncated:false / binary:false / 纯 diff 无 commit 头', async () => {
    // --pretty=format: 空 pretty 去 commit 头：stdout 从 diff --git 行开始
    //（design §5.2 勘误，2026-08-25），无 author/message 前导噪声。
    const diffText = [
      'diff --git a/src/a.ts b/src/a.ts',
      '@@ -1,3 +1,4 @@',
      '+new line',
    ].join('\n');
    glExecQueue.push({ ok: true, stdout: diffText, stderr: '' });
    const r = await handler.gitDiffFile({ root, sha: 'a1b2c3d4', path: 'src/a.ts' });
    expect(r.diff).toBe(diffText);
    expect(r.diff.startsWith('diff --git')).toBe(true);
    expect(r.diff).not.toMatch(/^commit |^Author: |^Date: /m); // 无 commit 头前导
    expect(r.truncated).toBe(false);
    expect(r.binary).toBe(false);
    expect(r.error).toBeNull();
  });

  it('GL27: 超 64KB → truncated:true 且按字节截到 65536', async () => {
    const bigDiff = 'x'.repeat(70_000);
    glExecQueue.push({ ok: true, stdout: bigDiff, stderr: '' });
    const r = await handler.gitDiffFile({ root, sha: 'a1b2c3d4', path: 'big.txt' });
    expect(r.truncated).toBe(true);
    expect(Buffer.byteLength(r.diff, 'utf8')).toBe(64 * 1024);
    expect(r.error).toBeNull();
  });

  it('GL28: 二进制文件（stdout 含 "Binary files"）→ binary:true', async () => {
    glExecQueue.push({
      ok: true,
      stdout: 'Binary files a/assets/logo.png and b/assets/logo.png differ',
      stderr: '',
    });
    const r = await handler.gitDiffFile({ root, sha: 'a1b2c3d4', path: 'assets/logo.png' });
    expect(r.binary).toBe(true);
    expect(r.truncated).toBe(false);
    expect(r.error).toBeNull();
  });

  it('GL29: 命令构造 —— 只读 show + 空 pretty 去 commit 头 + --unified=3 --no-color + `--` 后 path 独立 argv', async () => {
    glExecQueue.push({ ok: true, stdout: '', stderr: '' });
    await handler.gitDiffFile({
      root,
      sha: 'a1b2c3d4e5f6',
      path: 'docs/my file.md',
    });
    const args = glCalls[0].args;
    expect(glCalls[0].cmd).toBe('git');
    expect(args[2]).toBe('show'); // 只读子命令
    expect(args[3]).toBe('a1b2c3d4e5f6'); // sha 独立 argv
    expect(args).toContain('--pretty=format:'); // 空 pretty：去 commit 头（design §5.2 勘误）
    expect(args).toContain('--unified=3');
    expect(args).toContain('--no-color');
    const dd = args.indexOf('--');
    expect(dd).toBeGreaterThan(0);
    expect(args[dd + 1]).toBe('docs/my file.md'); // path 独立 argv（-- 后为 pathspec）
    expect(args).toHaveLength(dd + 2); // -- 之后只有 path 一个 token
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// git_status（task-01 2026-08-26-workspace-git-status —— porcelain v2 解析 /
// fetch 三分支降级 / numstat 单源 / 空仓库空态，design §5.2 + §7.2）
// ──────────────────────────────────────────────────────────────────────────────

describe('HostFsHandler — gitStatus porcelain v2 解析（task-01 GL34~GL39，§5.2）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL34: 正常形态 —— upstream + branch.ab + fetch 成功 + numstat 求和（十四字段全量）', async () => {
    gsQueue(
      porcelainV2([
        ...gsNormalHeaders(),
        '1 .M N... 100644 100644 100644 1111111 2222222 src/a.ts',
        '? notes/new.md',
      ]),
      '12\t3\tsrc/a.ts\n5\t0\tdocs/b.md\n',
    );
    const r = await handler.gitStatus({ root });
    expect(r).toEqual({
      branch: 'main',
      detached: false,
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      files_changed: 2,
      additions: 17, // 12 + 5
      deletions: 3, // 3 + 0
      untracked_count: 1,
      head_short: 'a1b2c3d4', // branch.oid 前 8 位（CC-04）
      empty: false,
      fetch_performed: true,
      fetch_error: null,
      error: null,
    });
  });

  it('GL35: 无 upstream（本地新分支）—— upstream/ahead/behind=null，计数照常', async () => {
    gsQueue(
      porcelainV2([
        `# branch.oid ${GS_OID}`,
        '# branch.head feature/x.y-z',
        // 无 branch.upstream / branch.ab 行（porcelain 无 upstream 时整行缺失）
        '1 .M N... 100644 100644 100644 1111111 2222222 wip.ts',
      ]),
      '4\t1\twip.ts\n',
    );
    const r = await handler.gitStatus({ root });
    expect(r.branch).toBe('feature/x.y-z');
    expect(r.upstream).toBeNull();
    expect(r.ahead).toBeNull();
    expect(r.behind).toBeNull();
    expect(r.files_changed).toBe(1);
    expect(r.additions).toBe(4);
    expect(r.deletions).toBe(1);
    expect(r.untracked_count).toBe(0);
    expect(r.error).toBeNull();
  });

  it('GL36: detached HEAD（branch.head "(detached)"）—— detached=true 且 branch=head_short', async () => {
    gsQueue(
      porcelainV2([
        `# branch.oid ${GS_OID}`,
        '# branch.head (detached)',
        // detached 下 porcelain 不输出 branch.upstream / branch.ab
      ]),
      '',
    );
    const r = await handler.gitStatus({ root });
    expect(r.detached).toBe(true);
    expect(r.branch).toBe('a1b2c3d4'); // branch 字段返回 HEAD 短哈希（§5.2）
    expect(r.head_short).toBe('a1b2c3d4');
    expect(r.upstream).toBeNull();
    expect(r.ahead).toBeNull();
    expect(r.behind).toBeNull();
    expect(r.error).toBeNull();
  });

  it('GL37: 空仓库 "(initial)" —— empty=true 计数全 null + diff HEAD exit 128 容错不走红通道', async () => {
    glExecQueue.push(
      { ok: true, stdout: 'origin\n', stderr: '' }, // remote 预检
      { ok: true, stdout: '', stderr: '' }, // fetch
      {
        ok: true,
        stdout: porcelainV2([
          '# branch.oid (initial)',
          '# branch.head main',
          '? readme.md', // 空仓库有 untracked，但空态下计数归 null（§5.2）
        ]),
        stderr: '',
      },
      {
        // 空仓库 git diff HEAD exit 128 —— 容错转空态，不走红通道（CC-07）
        ok: false,
        stdout: '',
        stderr: "fatal: ambiguous argument 'HEAD': unknown revision or path not in the working tree.",
      },
    );
    const r = await handler.gitStatus({ root });
    expect(r).toEqual({
      branch: null,
      detached: false,
      upstream: null,
      ahead: null,
      behind: null,
      files_changed: null,
      additions: null,
      deletions: null,
      untracked_count: null, // 空态覆盖 "? " 计数
      head_short: null,
      empty: true,
      fetch_performed: true,
      fetch_error: null,
      error: null, // 不走红通道
    });
    // diff 确已执行（exit 128 容错路径真实走到，而非提前跳过）。
    expect(glCalls.map((c) => c.args[2])).toEqual(['remote', 'fetch', 'status', 'diff']);
  });

  it('GL38: untracked 混合 —— "? " 计数、1/2/u 条目不参与 files_changed（CC-05 单源）', async () => {
    gsQueue(
      porcelainV2([
        ...gsNormalHeaders(),
        '1 .M N... 100644 100644 100644 1111111 2222222 modified.ts',
        '2 RM N... 100644 100644 100644 1111111 2222222 R100\trenamed\tnew-name.ts',
        'u AA N... 100644 100644 100644 1111111 2222222 conflict.txt',
        '? a.txt',
        '? dir/b c.txt', // 路径含空格仍单条目
        '? 中文路径.txt',
      ]),
      // numstat 空输出 —— files_changed=0 证明 porcelain 1/2 条目不参与（CC-05）
      '',
    );
    const r = await handler.gitStatus({ root });
    expect(r.untracked_count).toBe(3);
    expect(r.files_changed).toBe(0);
    expect(r.additions).toBe(0);
    expect(r.deletions).toBe(0);
    expect(r.error).toBeNull();
  });

  it('GL39: binary numstat 行（-\\t-\\t）—— 计 files_changed 不计行数', async () => {
    gsQueue(
      porcelainV2(gsNormalHeaders()),
      '10\t2\tsrc/a.ts\n-\t-\tassets/logo.png\n0\t7\tdocs/c.md\n',
    );
    const r = await handler.gitStatus({ root });
    expect(r.files_changed).toBe(3); // 二进制行也计文件数（≡ numstat 行数）
    expect(r.additions).toBe(10); // 10 + 0，binary `-` 不计行
    expect(r.deletions).toBe(9); // 2 + 7
    expect(r.error).toBeNull();
  });
});

describe('HostFsHandler — gitStatus fetch 三分支降级（task-01 GL40~GL44，D-001 / Grill CC-02 CC-07）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ rootsProvider: () => [root] });
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL40: 超时 —— err.killed/signal 判定（stderr 空串）→ fetch_timeout，不阻断 ②③', async () => {
    glExecQueue.push(
      { ok: true, stdout: 'origin\n', stderr: '' }, // remote 预检
      // fetch 超时：真实 execFile 超时 Node SIGTERM 后 killed+signal 同时置位，
      // stderr 为空串——判定只能走 killed/signal（Grill CC-02，非 stderr 文案）。
      { ok: false, stdout: '', stderr: '', errKilled: true, errSignal: 'SIGTERM' },
      { ok: true, stdout: porcelainV2(gsNormalHeaders()), stderr: '' },
      { ok: true, stdout: '3\t1\tsrc/a.ts\n', stderr: '' },
    );
    const r = await handler.gitStatus({ root });
    expect(r.fetch_error).toBe('fetch_timeout');
    expect(r.fetch_performed).toBe(false);
    // 失败不阻断 ②③：branch/dirty 字段仍正常返回。
    expect(r.branch).toBe('main');
    expect(r.upstream).toBe('origin/main');
    expect(r.ahead).toBe(2);
    expect(r.behind).toBe(1);
    expect(r.files_changed).toBe(1);
    expect(r.additions).toBe(3);
    expect(r.deletions).toBe(1);
    expect(r.error).toBeNull();
  });

  it('GL41: 非零退出（exit 1）→ fetch_failed，不阻断 ②③', async () => {
    glExecQueue.push(
      { ok: true, stdout: 'origin\n', stderr: '' },
      { ok: false, stdout: '', stderr: 'error: RPC failed; curl 28 timed out' }, // killed 未置位 → 非超时
      { ok: true, stdout: porcelainV2(gsNormalHeaders()), stderr: '' },
      { ok: true, stdout: '', stderr: '' },
    );
    const r = await handler.gitStatus({ root });
    expect(r.fetch_error).toBe('fetch_failed');
    expect(r.fetch_performed).toBe(false);
    expect(r.branch).toBe('main'); // ②③ 照常
    expect(r.error).toBeNull();
  });

  it('GL42: no_remote 预检 —— git remote 空输出 → 不执行 fetch（calls 无 fetch 子命令）', async () => {
    glExecQueue.push(
      { ok: true, stdout: '\n', stderr: '' }, // git remote 空输出（无任何 remote）
      { ok: true, stdout: porcelainV2(gsNormalHeaders()), stderr: '' },
      { ok: true, stdout: '', stderr: '' },
    );
    const r = await handler.gitStatus({ root });
    expect(r.fetch_error).toBe('no_remote');
    expect(r.fetch_performed).toBe(false);
    expect(r.branch).toBe('main'); // 失败不阻断
    expect(r.error).toBeNull();
    // 仅 remote/status/diff 三条命令，无 fetch（CC-07：静默 exit 0 探测不到）。
    expect(glCalls.map((c) => c.args[2])).toEqual(['remote', 'status', 'diff']);
  });

  it('GL43: 命令构造 —— remote/fetch/status/diff 只读子命令 + --no-show-stash + --no-renames 逐 token（FR-06）', async () => {
    gsQueue(porcelainV2(gsNormalHeaders()), '');
    await handler.gitStatus({ root });
    expect(glCalls).toHaveLength(4);
    expect(glCalls.every((c) => c.cmd === 'git')).toBe(true);
    const [remote, fetch, status, diff] = glCalls.map((c) => c.args);
    expect(remote).toEqual(['-C', root, 'remote']); // 只读预检子命令
    expect(fetch).toEqual(['-C', root, 'fetch', '--quiet']); // fetch 独立 argv + --quiet
    expect(status).toEqual([
      '-C',
      root,
      'status', // 只读子命令
      '--porcelain=v2',
      '--branch',
      '--no-show-stash', // CC-01：--show-stash=no 为非法 flag 的实测修正
    ]);
    expect(diff).toEqual([
      '-C',
      root,
      'diff', // 只读子命令
      'HEAD',
      '--numstat',
      '--no-renames', // CC-03：防 rename 检测破坏计数
    ]);
    // 全部独立 argv 经 execFile 不经 shell：无注入面。
    for (const c of glCalls) {
      expect(c.args.join(' ')).not.toMatch(/;|&&|\$\(/);
    }
  });

  it('GL44: numstat 真失败（非 exit 128 族）→ error 文案不抛，branch 字段保留、行计数 null', async () => {
    glExecQueue.push(
      { ok: true, stdout: 'origin\n', stderr: '' },
      { ok: true, stdout: '', stderr: '' },
      { ok: true, stdout: porcelainV2(gsNormalHeaders()), stderr: '' },
      { ok: false, stdout: '', stderr: 'error: mmap failed while reading object' }, // 非 HEAD 缺失族
    );
    const r = await handler.gitStatus({ root });
    expect(r.branch).toBe('main'); // porcelain 段照常保留
    expect(r.upstream).toBe('origin/main');
    expect(r.files_changed).toBeNull();
    expect(r.additions).toBeNull();
    expect(r.deletions).toBeNull();
    expect(r.error).toContain('mmap failed');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// daemon.ts 平名注册（design §5.2 CC-02 —— 对齐 explorer 注册形态，不走 host_fs. 前缀）
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

/**
 * Daemon 原型法 harness（对齐 file-rpc-explorer.test.ts）：只喂
 * _registerGitLogRpcHandler 调用链（_effectiveAllowedRoots → _config /
 * _policyCache / _registeredRuntimes）触及的字段，不跑构造器。
 */
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
    runtime_id: 'rt-gitlog-test',
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

describe('daemon 注册器 — _registerGitLogRpcHandler（task-01 GL30~GL33，CC-02 平名）', () => {
  let root: string;

  beforeEach(async () => {
    root = await makeRoot();
  });

  afterEach(async () => {
    glExecQueue.length = 0;
    glCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('GL30: 注册且仅注册五个平名方法（无 host_fs. 前缀，CC-02；git_status 为第 5 个）', () => {
    const h = makeHarness(['/tmp/whatever-root']);
    expect([...h.methods.keys()].sort()).toEqual([
      'git_diff_file',
      'git_log',
      'git_refs',
      'git_show',
      'git_status', // task-01 2026-08-26-workspace-git-status（CC-11 计数更正）
    ]);
  });

  it('GL31: ws 无 registerRpcHandler（鸭子类型可选）→ warn ws_no_rpc_support，不抛', () => {
    const daemon = Object.create(Daemon.prototype) as unknown as DaemonInternals;
    daemon._config = { runtime_id: 'rt-no-rpc', allowed_roots: [] } as DaemonInternals['_config'];
    daemon._logger = { warn: vi.fn() };
    daemon._policyCache = null;
    daemon._registeredRuntimes = new Map();
    expect(() => daemon._registerGitLogRpcHandler({ connect() {} })).not.toThrow();
    expect(daemon._logger.warn).toHaveBeenCalledWith(
      'ws_no_rpc_support',
      expect.objectContaining({ daemon_local_id: 'rt-no-rpc' }),
    );
  });

  it('GL32: 经注册路径 —— count 缺省 100；params 类型归一（root 非字符串 → forbidden）', async () => {
    const h = makeHarness([root]);
    // count 缺省 → 100（对齐 explorer max_results 缺省形态）。
    glExecQueue.push({ ok: true, stdout: '', stderr: '' });
    await h.call('git_log', { root });
    expect(glCalls.length).toBe(1);
    const nIdx = glCalls[0].args.indexOf('-n');
    expect(glCalls[0].args[nIdx + 1]).toBe('100');
    // count 显式非法（0）→ 透传 handler 拒 forbidden（不静默钳制）。
    await expectRpcError(h.call('git_log', { root, count: 0 }), 'forbidden');
    // root 非字符串归一空串 → assertWithinAllowedRoots 拒 forbidden。
    await expectRpcError(h.call('git_refs', { root: 123 }), 'forbidden');
    await expectRpcError(h.call('git_show', { root }), 'forbidden'); // sha 归一 '' → forbidden
  });

  it('GL33: 经注册路径 —— git_diff_file 全链路（params 归一 + 只读命令 + 结果回传）', async () => {
    const h = makeHarness([root]);
    glExecQueue.push({ ok: true, stdout: 'diff --git a/a b/a\n+line', stderr: '' });
    const r = (await h.call('git_diff_file', {
      root,
      sha: 'a1b2c3d4e5f6',
      path: 'a.txt',
    })) as { diff: string; truncated: boolean; binary: boolean; error: string | null };
    expect(r.diff).toContain('diff --git');
    expect(r.truncated).toBe(false);
    expect(r.binary).toBe(false);
    expect(r.error).toBeNull();
    // 只读子命令 + path 独立 argv（经注册路径复验 R-01）。
    expect(glCalls[0].cmd).toBe('git');
    expect(glCalls[0].args[2]).toBe('show');
    expect(glCalls[0].args[glCalls[0].args.indexOf('--') + 1]).toBe('a.txt');
  });

  it('GL45: 经注册路径 —— git_status 全链路（params 归一 + 只读命令序列 + 十四字段回传）', async () => {
    const h = makeHarness([root]);
    // 队列按真实执行序：remote 预检 → fetch → status → diff。
    gsQueue(porcelainV2(gsNormalHeaders()), '2\t1\tsrc/a.ts\n');
    const r = (await h.call('git_status', { root })) as {
      branch: string | null;
      fetch_performed: boolean;
      fetch_error: string | null;
      files_changed: number | null;
      error: string | null;
    };
    expect(r.branch).toBe('main');
    expect(r.fetch_performed).toBe(true);
    expect(r.fetch_error).toBeNull();
    expect(r.files_changed).toBe(1);
    expect(r.error).toBeNull();
    // 经注册路径复验只读命令序列（remote/fetch/status/diff）。
    expect(glCalls.map((c) => c.args[2])).toEqual(['remote', 'fetch', 'status', 'diff']);
    // root 非字符串归一空串 → assertWithinAllowedRoots 拒 forbidden（同 GL32 归一语义）。
    await expectRpcError(h.call('git_status', { root: 123 }), 'forbidden');
  });
});
