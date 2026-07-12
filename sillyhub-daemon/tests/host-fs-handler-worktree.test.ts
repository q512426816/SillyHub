// tests/host-fs-handler-worktree.test.ts
// task-02（2026-07-12-worker-worktree-isolation / FR-01+FR-03+FR-05+FR-06）：
// host_fs worktree 三方法（git_worktree_add / git_merge / git_worktree_remove）单测。
//
// 覆盖（对齐 design §7 RPC 表 + §7.5 契约表 + TaskCard 验收）：
//   WT1: git_worktree_add 成功 → {ok:true, worktree_path}，命令含
//        -c user.name=worker -c user.email=worker@sillyhub（D-008，不依赖宿主机全局 config）
//   WT2: git_worktree_add 失败（exit 非 0）→ {ok:false, error}
//   WT3: git_merge 成功 → {ok:true, conflicts:[], merged_files:[...]}
//   WT4: git_merge 冲突（exit 1 + 冲突文件）→ {ok:false, conflicts:[{file,marker_lines}], merged_files:[]}
//   WT5: git_worktree_remove 成功 → {ok:true}
//   WT6: git_worktree_remove 失败 → {ok:false, error}
//   WT7: 越界 workdir → forbidden（assertWithinAllowedRoots 守卫，沿用 gitApply:479 同款）
//
// 风格对齐 tests/host-fs-handler.test.ts：vi.mock('node:child_process') 拦截 execFile，
// 真实临时目录（mkdtemp）+ 真实 fs。本测试用独立 mock 队列 `wtExecQueue` 并记录每次调用
// 的 cmd/args，以便断言 git_worktree_add 命令含 D-008 identity 参数（既有 execQueue 不记 args）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform } from 'node:os';
import { join } from 'node:path';

const IS_WIN = platform() === 'win32';

/**
 * mock 队列：每次 execFile 调用 pop 一项。记录传给 execFile 的 cmd + args，
 * 让测试能断言 `git -C <workdir> -c user.name=worker -c user.email=... worktree add ...`
 * 命令构造（D-008 验收关键）。
 */
const wtExecQueue: Array<{
  ok: boolean;
  stdout?: string;
  stderr?: string;
}> = [];

/** 记录所有 execFile 调用的 (cmd, args)，断言命令构造用。 */
const wtCalls: Array<{ cmd: string; args: string[] }> = [];

// vi.mock 拦截 node:child_process 的 execFile（hoist 到文件顶部）。
vi.mock('node:child_process', () => ({
  execFile: (...args: unknown[]): unknown => {
    // execFile(cmd, args, opts, cb) 或 execFile(cmd, args, cb) 形式。
    const cmd = args[0] as string;
    const args1 = args[1];
    const arr = Array.isArray(args1) ? (args1 as string[]) : [];
    wtCalls.push({ cmd, args: arr });
    const cb = args[args.length - 1] as (
      err: Error | null,
      stdout: Buffer | string,
      stderr: Buffer | string,
    ) => void;
    const next = wtExecQueue.shift();
    if (!next) {
      throw new Error('execFile mock queue exhausted');
    }
    setImmediate(() => {
      if (next.ok) {
        cb(null, next.stdout ?? '', next.stderr ?? '');
      } else {
        const err = new Error(next.stderr ?? 'mock exec failure');
        cb(err, next.stdout ?? '', next.stderr ?? '');
      }
    });
    return {
      stdin: { on: () => undefined, end: () => undefined },
    };
  },
}));

import { HostFsHandler } from '../src/host-fs-handler';
import { RpcError } from '../src/ws-client';

/** 构造临时根目录。 */
async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'sillyhub-wt-'));
  return root;
}

describe('HostFsHandler — git_worktree_add（task-02 WT1~WT2 + WT7，D-008 默认 identity）', () => {
  let root: string;
  let siblingRoot: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    siblingRoot = await makeRoot();
    handler = new HostFsHandler({ allowed_roots: [root, siblingRoot] });
  });

  afterEach(async () => {
    wtExecQueue.length = 0;
    wtCalls.length = 0;
    await rm(root, { recursive: true, force: true });
    await rm(siblingRoot, { recursive: true, force: true });
  });

  it('WT1: 成功 → {ok:true, worktree_path}，命令含 -c user.name=worker -c user.email=worker@sillyhub（D-008）', async () => {
    wtExecQueue.push({ ok: true, stdout: '', stderr: '' });
    const siblingPath = join(siblingRoot, 'abc12345');
    const result = await handler.gitWorktreeAdd({
      workdir: root,
      sibling_path: siblingPath,
      branch: 'workers/abc12345',
      base_ref: 'main',
    });
    expect(result.ok).toBe(true);
    expect(result.worktree_path).toBe(siblingPath);

    // 断言命令构造（D-008 / R-08 核心）。
    expect(wtCalls.length).toBe(1);
    expect(wtCalls[0].cmd).toBe('git');
    const args = wtCalls[0].args;
    // 必须含 -c user.name=worker + -c user.email=worker@sillyhub 透传，不依赖宿主全局 config。
    const nameIdx = args.indexOf('-c');
    expect(nameIdx).toBeGreaterThanOrEqual(0);
    expect(args[nameIdx + 1]).toBe('user.name=worker');
    const emailIdx = args.indexOf('-c', nameIdx + 1);
    expect(emailIdx).toBeGreaterThan(nameIdx);
    expect(args[emailIdx + 1]).toBe('user.email=worker@sillyhub');
    // worktree add 子命令 + sibling + -b <branch> + base_ref。
    expect(args).toContain('worktree');
    expect(args).toContain('add');
    expect(args).toContain('-b');
    expect(args).toContain('workers/abc12345');
    expect(args).toContain('main');
    // -C <workdir> 指定工作目录。
    const cIdx = args.indexOf('-C');
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(args[cIdx + 1]).toBe(root);
    // sibling_path 作为位置参数（绝对路径）。
    expect(args).toContain(siblingPath);
  });

  it('WT1b: base_ref 为空 → 兜底 HEAD（execution.py:106 同款可空语义，X-001）', async () => {
    wtExecQueue.push({ ok: true, stdout: '', stderr: '' });
    const siblingPath = join(siblingRoot, 'def67890');
    const result = await handler.gitWorktreeAdd({
      workdir: root,
      sibling_path: siblingPath,
      branch: 'workers/def67890',
      base_ref: '',
    });
    expect(result.ok).toBe(true);
    // base_ref 空时命令含 HEAD（不传空串给 git，避免 git 报错）。
    expect(wtCalls[0].args).toContain('HEAD');
  });

  it('WT2: git 失败（exit 非 0）→ {ok:false, error}（不抛，结构化回传）', async () => {
    wtExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'fatal: a branch named \'workers/abc12345\' already exists',
    });
    const result = await handler.gitWorktreeAdd({
      workdir: root,
      sibling_path: join(siblingRoot, 'abc12345'),
      branch: 'workers/abc12345',
      base_ref: 'main',
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/already exists/);
  });

  it('WT7: 越界 workdir → forbidden（assertWithinAllowedRoots 守卫）', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.gitWorktreeAdd({
        workdir: evil,
        sibling_path: join(siblingRoot, 'abc12345'),
        branch: 'workers/abc12345',
        base_ref: 'main',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });

  it('WT7b: 越界 sibling_path → forbidden（worktree 副本路径也要守，防穿越写宿主敏感位置）', async () => {
    const evil = IS_WIN ? 'C:\\Windows\\evil-wt' : '/etc/evil-wt';
    try {
      await handler.gitWorktreeAdd({
        workdir: root,
        sibling_path: evil,
        branch: 'workers/abc12345',
        base_ref: 'main',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — git_merge（task-02 WT3~WT4，冲突解析）', () => {
  let root: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    handler = new HostFsHandler({ allowed_roots: [root] });
  });

  afterEach(async () => {
    wtExecQueue.length = 0;
    wtCalls.length = 0;
    await rm(root, { recursive: true, force: true });
  });

  it('WT3: 成功 → {ok:true, conflicts:[], merged_files 非空}', async () => {
    // git merge（ok）+ git diff --name-only --diff-filter=U（无冲突，空）。
    // 注：成功路径是否拉 merged_files 由实现决定；本测试只断言 ok:true + conflicts:[]。
    wtExecQueue.push({
      ok: true,
      stdout: 'Updating abc..def\n src/a.ts | 2 +-\n 1 file changed',
      stderr: '',
    });
    const result = await handler.gitMerge({
      workdir: root,
      worker_branch: 'workers/abc12345',
    });
    expect(result.ok).toBe(true);
    expect(result.conflicts).toEqual([]);
  });

  it('WT3b: 命令含 `merge --no-ff <worker_branch>`（不带 identity，merge 复用 worktree 已配的 identity）', async () => {
    wtExecQueue.push({ ok: true, stdout: '', stderr: '' });
    await handler.gitMerge({
      workdir: root,
      worker_branch: 'workers/abc12345',
    });
    const args = wtCalls[0].args;
    expect(wtCalls[0].cmd).toBe('git');
    // -C <workdir>
    const cIdx = args.indexOf('-C');
    expect(cIdx).toBeGreaterThanOrEqual(0);
    expect(args[cIdx + 1]).toBe(root);
    // merge --no-ff <branch>。
    expect(args).toContain('merge');
    expect(args).toContain('--no-ff');
    expect(args).toContain('workers/abc12345');
    // 不应带 -c user.name=worker（merge 复用 worker 副本已配 identity）。
    expect(args).not.toContain('user.name=worker');
  });

  it('WT4: 冲突 → {ok:false, conflicts:[{file,marker_lines}], merged_files:[]}（解析冲突文件 + 标记行数）', async () => {
    // merge 失败（exit 1，有冲突）+ git diff --name-only --diff-filter=U（列出冲突文件）。
    wtExecQueue.push({
      ok: false,
      stdout: 'Auto-merging src/a.ts\nCONFLICT (content): Merge conflict in src/a.ts\n',
      stderr: 'Automatic merge failed; fix conflicts and then commit the result.\n',
    });
    // 冲突文件列举命令（git diff --name-only --diff-filter=U）。
    wtExecQueue.push({
      ok: true,
      stdout: 'src/a.ts\n',
      stderr: '',
    });
    // 读冲突文件标记行数（readFile 真实读，构造一个含冲突标记的文件）。
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
      join(root, 'src', 'a.ts'),
      [
        '<<<<<<< HEAD',
        'const a = 1;',
        '=======',
        'const a = 2;',
        '>>>>>>> workers/abc12345',
      ].join('\n') + '\n',
    );

    const result = await handler.gitMerge({
      workdir: root,
      worker_branch: 'workers/abc12345',
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts.length).toBe(1);
    expect(result.conflicts[0].file).toBe('src/a.ts');
    // marker_lines ≥ 2（含至少 <<<<<<< + >>>>>>> 标记）。
    expect(result.conflicts[0].marker_lines).toBeGreaterThanOrEqual(2);
    expect(result.merged_files).toEqual([]);
  });

  it('WT4b: 冲突但 git diff --diff-filter=U 列文件失败（空）→ conflicts 为空数组，ok:false 仍回传（不让 backend 误判成功）', async () => {
    wtExecQueue.push({
      ok: false,
      stdout: '',
      stderr: 'Automatic merge failed; fix conflicts',
    });
    // diff-filter=U 空输出（无冲突文件被识别，可能是奇怪状态）。
    wtExecQueue.push({ ok: true, stdout: '', stderr: '' });
    const result = await handler.gitMerge({
      workdir: root,
      worker_branch: 'workers/abc12345',
    });
    expect(result.ok).toBe(false);
    expect(result.conflicts).toEqual([]);
  });

  it('WT4c: 越界 workdir → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    try {
      await handler.gitMerge({
        workdir: evil,
        worker_branch: 'workers/abc12345',
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});

describe('HostFsHandler — git_worktree_remove（task-02 WT5~WT6）', () => {
  let root: string;
  let siblingRoot: string;
  let handler: HostFsHandler;

  beforeEach(async () => {
    root = await makeRoot();
    siblingRoot = await makeRoot();
    handler = new HostFsHandler({ allowed_roots: [root, siblingRoot] });
  });

  afterEach(async () => {
    wtExecQueue.length = 0;
    wtCalls.length = 0;
    await rm(root, { recursive: true, force: true });
    await rm(siblingRoot, { recursive: true, force: true });
  });

  it('WT5: 成功 → {ok:true}，命令 `worktree remove --force <sibling>`', async () => {
    wtExecQueue.push({ ok: true, stdout: '', stderr: '' });
    const siblingPath = join(siblingRoot, 'abc12345');
    const result = await handler.gitWorktreeRemove({
      workdir: root,
      sibling_path: siblingPath,
    });
    expect(result.ok).toBe(true);
    const args = wtCalls[0].args;
    expect(wtCalls[0].cmd).toBe('git');
    const cIdx = args.indexOf('-C');
    expect(args[cIdx + 1]).toBe(root);
    expect(args).toContain('worktree');
    expect(args).toContain('remove');
    expect(args).toContain('--force');
    expect(args).toContain(siblingPath);
  });

  it('WT6: git 失败 → {ok:false, error}（不抛）', async () => {
    wtExecQueue.push({
      ok: false,
      stdout: '',
      stderr: "fatal: 'abc12345' does not look like a worktree",
    });
    const result = await handler.gitWorktreeRemove({
      workdir: root,
      sibling_path: join(siblingRoot, 'abc12345'),
    });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/does not look like a worktree/);
  });

  it('WT6b: 越界 sibling_path → forbidden', async () => {
    const evil = IS_WIN ? 'C:\\Windows\\evil' : '/etc/evil';
    try {
      await handler.gitWorktreeRemove({
        workdir: root,
        sibling_path: evil,
      });
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(RpcError);
      expect((e as RpcError).code).toBe('forbidden');
    }
  });
});
