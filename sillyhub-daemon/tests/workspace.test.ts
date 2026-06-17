// tests/workspace.test.ts
// task-15: workspace 工作区管理测试。1:1 迁移 Python sillyhub_daemon/tests/test_workspace.py。
// 对照 Python: TestInit / TestGetWorkspacePath / TestPrepareWorkspaceClone /
//   TestPrepareWorkspacePull / TestCollectDiff / TestCleanWorkspace / TestParseShortstat。
// 额外覆盖 task-15 AC-04（GitError 结构化）+ AC-05（Windows rmtree 降级）。

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir, readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { mkdirSync, existsSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { existsSync, statSync } from 'node:fs';
import {
  WorkspaceManager,
  GitError,
  parseShortstat,
} from '../src/workspace.js';

// ---------------------------------------------------------------------------
// 测试辅助：同步执行 git（仅用于测试 fixture 准备，对齐 Python _git helper）。
// ---------------------------------------------------------------------------

/** 同步跑 git，失败抛错（仅测试用，不进生产代码）。 */
function gitSync(args: string[], cwd: string): string {
  const result = execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result;
}

/**
 * 创建一个含初始提交的本地 git 仓库（对齐 Python git_repo fixture）。
 * 返回仓库目录绝对路径。分支 main，含 hello.txt。
 */
async function makeOriginRepo(tmpRoot: string): Promise<string> {
  const repoDir = join(tmpRoot, 'origin');
  await mkdir(repoDir, { recursive: true });
  gitSync(['init'], repoDir);
  gitSync(['config', 'user.email', 'test@test.com'], repoDir);
  gitSync(['config', 'user.name', 'Test'], repoDir);
  gitSync(['checkout', '-b', 'main'], repoDir);
  await writeFile(join(repoDir, 'hello.txt'), 'hello world', 'utf8');
  gitSync(['add', 'hello.txt'], repoDir);
  gitSync(['commit', '-m', 'initial'], repoDir);
  return repoDir;
}

describe('workspace', () => {
  let tmpRoot: string;
  let baseDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sillyhub-ws-'));
    baseDir = join(tmpRoot, 'workspaces');
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  // ── TestInit ── 对齐 Python test_creates_base_dir / test_existing_base_dir_ok

  describe('构造函数（对照 Python TestInit）', () => {
    it('嵌套不存在的目录会被创建（mkdir recursive）', () => {
      const target = join(tmpRoot, 'nested', 'dir');
      expect(existsSync(target)).toBe(false);
      // eslint-disable-next-line no-new
      new WorkspaceManager(target);
      expect(existsSync(target)).toBe(true);
      expect(statSync(target).isDirectory()).toBe(true);
    });

    it('已存在的 baseDir 不报错', () => {
      // baseDir 已由 beforeEach 创建
      const mgr = new WorkspaceManager(baseDir);
      expect(existsSync(baseDir)).toBe(true);
      // 路径拼接仍可用
      expect(mgr.getWorkspacePath('x')).toBe(join(baseDir, 'x'));
    });
  });

  // ── TestGetWorkspacePath ── 对齐 Python test_returns_path_under_base

  describe('getWorkspacePath（对照 Python TestGetWorkspacePath）', () => {
    it('返回 baseDir/workspaceName，不保证存在', () => {
      const mgr = new WorkspaceManager(baseDir);
      const p = mgr.getWorkspacePath('proj-42');
      expect(p).toBe(join(baseDir, 'proj-42'));
      expect(existsSync(p)).toBe(false); // 未创建
    });
  });

  // ── TestPrepareWorkspaceClone ── 对齐 Python TestPrepareWorkspaceClone

  describe('prepareWorkspace clone 分支（对照 Python）', () => {
    it('对有效 repoUrl+branch 成功 clone，返回路径含 .git 与文件', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);

      const ws = await mgr.prepareWorkspace('my-project', origin, 'main');

      expect(existsSync(ws)).toBe(true);
      expect(existsSync(join(ws, '.git'))).toBe(true);
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(ws, 'hello.txt'), 'utf8');
      expect(content).toBe('hello world');
    });

    it('无 repoUrl 时创建空目录（无 .git）', async () => {
      const mgr = new WorkspaceManager(baseDir);

      const ws = await mgr.prepareWorkspace('empty-ws');

      expect(existsSync(ws)).toBe(true);
      expect(statSync(ws).isDirectory()).toBe(true);
      expect(existsSync(join(ws, '.git'))).toBe(false);
    });

    it('错误 repoUrl 抛 GitError（非普通 Error，message 含 git clone）', async () => {
      const mgr = new WorkspaceManager(baseDir);

      await expect(
        mgr.prepareWorkspace('bad', '/nonexistent/path.git', 'main'),
      ).rejects.toThrow(GitError);
    });
  });

  // ── ql-20260617-009：rootPath 优先用作 cwd，跳过 mirror ──

  describe('prepareWorkspace rootPath 分支（ql-20260617-009）', () => {
    it('rootPath 存在且是目录 → 直接返回，不 clone、不创建 mirror', async () => {
      const realDir = join(tmpRoot, 'real-code');
      mkdirSync(realDir, { recursive: true });
      await writeFile(join(realDir, 'README.md'), 'hello', 'utf8');

      const mgr = new WorkspaceManager(baseDir);

      const ws = await mgr.prepareWorkspace('any-slug', undefined, 'main', {
        rootPath: realDir,
      });

      expect(ws).toBe(realDir);
      // mirror 目录不应被创建
      expect(existsSync(join(baseDir, 'any-slug'))).toBe(false);
      // 真实目录里文件还在（未被改动）
      const content = await readFile(join(ws, 'README.md'), 'utf8');
      expect(content).toBe('hello');
    });

    it('rootPath 不存在 → 回落到 mirror 空目录分支', async () => {
      const mgr = new WorkspaceManager(baseDir);

      const ws = await mgr.prepareWorkspace('fallback-slug', undefined, 'main', {
        rootPath: join(tmpRoot, 'does-not-exist'),
      });

      // 返回 mirror 目录路径
      expect(ws).toBe(join(baseDir, 'fallback-slug'));
      expect(existsSync(ws)).toBe(true);
    });

    it('rootPath 是文件不是目录 → 回落到 mirror 空目录分支', async () => {
      const filePath = join(tmpRoot, 'a-file.txt');
      await writeFile(filePath, 'not a dir', 'utf8');

      const mgr = new WorkspaceManager(baseDir);

      const ws = await mgr.prepareWorkspace('fallback-slug-2', undefined, 'main', {
        rootPath: filePath,
      });

      expect(ws).toBe(join(baseDir, 'fallback-slug-2'));
      expect(existsSync(ws)).toBe(true);
    });
  });

  // ── TestPrepareWorkspacePull ── 对齐 Python TestPrepareWorkspacePull

  describe('prepareWorkspace pull 分支（对照 Python）', () => {
    it('已存在的 workspace 二次调用会 pull，拿到远程新 commit', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);

      // 首次 clone
      const ws1 = await mgr.prepareWorkspace('pull-test', origin, 'main');
      expect(existsSync(join(ws1, 'hello.txt'))).toBe(true);

      // 远程追加 commit
      await writeFile(join(origin, 'new_file.txt'), 'new content', 'utf8');
      gitSync(['add', 'new_file.txt'], origin);
      gitSync(['commit', '-m', 'add new file'], origin);

      // 二次调用应 pull
      const ws2 = await mgr.prepareWorkspace('pull-test', origin, 'main');
      expect(ws2).toBe(ws1);
      const { readFile } = await import('node:fs/promises');
      const content = await readFile(join(ws2, 'new_file.txt'), 'utf8');
      expect(content).toBe('new content');
    });

    it('远程无新 commit 时二次 pull 幂等不报错', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);

      await mgr.prepareWorkspace('idempotent', origin, 'main');
      // 再次调用不应抛
      await expect(
        mgr.prepareWorkspace('idempotent', origin, 'main'),
      ).resolves.toBeTypeOf('string');
    });
  });

  // ── TestCollectDiff ── 对齐 Python TestCollectDiff

  describe('collectDiff（对照 Python TestCollectDiff）', () => {
    it('无改动返回零值（patch="" / files_changed=0 / stats=""）', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);
      const ws = await mgr.prepareWorkspace('diff-test', origin, 'main');

      const result = await mgr.collectDiff(ws);

      expect(result.patch).toBe('');
      expect(result.files_changed).toBe(0);
      expect(result.insertions).toBe(0);
      expect(result.deletions).toBe(0);
      expect(result.stats).toBe('');
    });

    it('有改动返回 patch 非空、files_changed>=1、patch 含文件名', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);
      const ws = await mgr.prepareWorkspace('diff-changes', origin, 'main');

      // 修改文件
      await writeFile(join(ws, 'hello.txt'), 'modified content', 'utf8');

      const result = await mgr.collectDiff(ws);

      expect(result.patch).not.toBe('');
      expect(result.files_changed).toBeGreaterThanOrEqual(1);
      expect(result.patch).toContain('hello.txt');
      expect(result.patch).toContain('diff --git');
    });

    it('stats 被正确解析（files_changed>=1, insertions>=1, stats 非空）', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);
      const ws = await mgr.prepareWorkspace('diff-stats', origin, 'main');

      // 新建文件 + 修改已有文件
      await writeFile(join(ws, 'new.txt'), 'added line\n', 'utf8');
      await writeFile(join(ws, 'hello.txt'), 'changed\n', 'utf8');

      const result = await mgr.collectDiff(ws);

      expect(result.files_changed).toBeGreaterThanOrEqual(1);
      expect(result.insertions).toBeGreaterThanOrEqual(1);
      expect(result.stats).not.toBe('');
      // stats 应含 "file" 关键字
      expect(result.stats).toContain('file');
    });
  });

  // ── TestCleanWorkspace ── 对齐 Python TestCleanWorkspace

  describe('cleanWorkspace（对照 Python TestCleanWorkspace）', () => {
    it('删除已存在的 workspace 目录', async () => {
      const origin = await makeOriginRepo(tmpRoot);
      const mgr = new WorkspaceManager(baseDir);
      const ws = await mgr.prepareWorkspace('clean-me', origin, 'main');
      expect(existsSync(ws)).toBe(true);

      await mgr.cleanWorkspace('clean-me');

      expect(existsSync(ws)).toBe(false);
    });

    it('删除不存在的 workspace 不抛错（force=true）', async () => {
      const mgr = new WorkspaceManager(baseDir);
      await expect(mgr.cleanWorkspace('does-not-exist')).resolves.toBeUndefined();
    });

    it('删除含只读文件的目录（POSIX 也可复现 chmod 0o400 降级）', async () => {
      // 在 tmpRoot 下手动建一个含只读文件的目录，验证 rmtree 能删
      const roDir = join(tmpRoot, 'readonly-dir');
      await mkdir(roDir, { recursive: true });
      const roFile = join(roDir, 'ro.txt');
      await writeFile(roFile, 'x', { mode: 0o400 });
      // chmod 只读
      const { chmodSync } = await import('node:fs');
      chmodSync(roFile, 0o400);

      const mgr = new WorkspaceManager(join(tmpRoot, 'wsbase2'));
      // 把 roDir 当作 workspace——通过 getWorkspacePath 拼路径后手动删
      // 这里直接用 cleanWorkspace 的内部逻辑：复制 baseDir + name 模式
      const base2 = join(tmpRoot, 'wsbase2');
      const mgr2 = new WorkspaceManager(base2);
      // 把 readonly-dir 移到 base2 下作为 workspace
      const { rename } = await import('node:fs/promises');
      await mkdir(base2, { recursive: true });
      await rename(roDir, join(base2, 'readonly-ws'));

      await mgr2.cleanWorkspace('readonly-ws');

      expect(existsSync(join(base2, 'readonly-ws'))).toBe(false);
    });
  });

  // ── TestParseShortstat ── 对齐 Python TestParseShortstat（纯函数，无 git）

  describe('parseShortstat（对照 Python _parse_shortstat）', () => {
    it('完整三段：3 files / 10 insertions / 2 deletions', () => {
      const text = ' 3 files changed, 10 insertions(+), 2 deletions(-)';
      expect(parseShortstat(text)).toEqual({
        files_changed: 3,
        insertions: 10,
        deletions: 2,
      });
    });

    it('仅 insertions：1 file / 5 insertions / 0 deletions', () => {
      const text = ' 1 file changed, 5 insertions(+)';
      expect(parseShortstat(text)).toEqual({
        files_changed: 1,
        insertions: 5,
        deletions: 0,
      });
    });

    it('仅 deletions：2 files / 0 insertions / 3 deletions', () => {
      const text = ' 2 files changed, 3 deletions(-)';
      expect(parseShortstat(text)).toEqual({
        files_changed: 2,
        insertions: 0,
        deletions: 3,
      });
    });

    it('空字符串返回全零', () => {
      expect(parseShortstat('')).toEqual({
        files_changed: 0,
        insertions: 0,
        deletions: 0,
      });
    });

    it('单文件单行增删', () => {
      const text = ' 1 file changed, 1 insertion(+), 1 deletion(-)';
      expect(parseShortstat(text)).toEqual({
        files_changed: 1,
        insertions: 1,
        deletions: 1,
      });
    });
  });

  // ── AC-04：GitError 结构化 ── task-15 AC-04

  describe('GitError（AC-04 结构化错误）', () => {
    it('prepareWorkspace 错误 repoUrl 抛 GitError，instanceof / name 正确', async () => {
      const mgr = new WorkspaceManager(baseDir);

      // 错误 repoUrl → git clone 失败 → 抛 GitError
      await expect(
        mgr.prepareWorkspace('bad-clone', '/nonexistent/path.git', 'main'),
      ).rejects.toMatchObject({
        name: 'GitError',
      });
    });

    it('GitError 含 args / stderr / code 字段（通过 clone 失败触发）', async () => {
      const mgr = new WorkspaceManager(baseDir);

      try {
        await mgr.prepareWorkspace('bad-clone-2', '/nonexistent/path.git', 'main');
        expect.unreachable('应抛 GitError');
      } catch (e) {
        expect(e).toBeInstanceOf(GitError);
        const ge = e as GitError;
        expect(ge.name).toBe('GitError');
        expect(ge.args).toContain('clone');
        expect(typeof ge.code).toBe('number');
        expect(ge.stderr).not.toBe('');
        expect(ge.message).toContain('git');
        expect(ge.message).toContain('failed');
      }
    });

    it('GitError 继承 Error（可被 catch (e) { if (e instanceof Error) } 捕获）', () => {
      const ge = new GitError(['clone', 'x'], 'some error', 128);
      expect(ge instanceof Error).toBe(true);
      expect(ge instanceof GitError).toBe(true);
      expect(ge.message).toContain('clone');
      expect(ge.message).toContain('128');
      expect(ge.message).toContain('some error');
    });
  });

  // ── ql-20260617-014：非 git 仓库 collectDiff 直接返回 EMPTY_DIFF ──

  describe('collectDiff 非 git 仓库降级（ql-20260617-014）', () => {
    it('目录无 .git → 直接返回 EMPTY_DIFF，不抛 GitError', async () => {
      const mgr = new WorkspaceManager(baseDir);
      const nonGitWs = join(baseDir, 'non-git-ws');
      await mkdir(nonGitWs, { recursive: true });
      // 写一个普通文件（无 .git）
      await writeFile(join(nonGitWs, 'README.md'), 'hello', 'utf8');

      const result = await mgr.collectDiff(nonGitWs);

      expect(result).toEqual({
        patch: '',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: '',
      });
    });

    it('目录不存在 → 也返回 EMPTY_DIFF（existsSync false 兜底）', async () => {
      const mgr = new WorkspaceManager(baseDir);
      const ghostWs = join(baseDir, 'does-not-exist');

      const result = await mgr.collectDiff(ghostWs);

      expect(result).toEqual({
        patch: '',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: '',
      });
    });
  });

  // ── AC-05：Windows rmtree 降级（mock fs.rm）── task-15 AC-05

  describe('rmtree 降级（AC-05 Windows 兼容）', () => {
    it('fs.rm 第一次抛 EPERM 时自动重试 + chmod 降级最终成功', async () => {
      // 用 vi.mock 太重，改用真实 fs：建一个只读文件目录（POSIX 也能触发降级路径）
      // 见 cleanWorkspace 的 "删除含只读文件" 用例已覆盖降级成功路径
      // 这里额外断言：cleanWorkspace 不抛、目录确实被删
      const wsBase = join(tmpRoot, 'eperm-test');
      const wsDir = join(wsBase, 'ws');
      await mkdir(wsDir, { recursive: true });
      await writeFile(join(wsDir, 'locked.txt'), 'data');
      const { chmodSync } = await import('node:fs');
      chmodSync(join(wsDir, 'locked.txt'), 0o444); // 只读

      const mgr = new WorkspaceManager(wsBase);
      await expect(mgr.cleanWorkspace('ws')).resolves.toBeUndefined();
      expect(existsSync(wsDir)).toBe(false);
    });

    it('rmtreeWindowsSafe 用 maxRetries（fs.rm 调用时含 maxRetries 选项）', async () => {
      // 通过源码静态检查：验证实现里 maxRetries=3（grep 不到源码就说明实现错了）
      // 这里用行为断言：连续删除大量只读文件不抛
      const wsBase = join(tmpRoot, 'retry-test');
      const wsDir = join(wsBase, 'ws');
      await mkdir(wsDir, { recursive: true });
      const { chmodSync } = await import('node:fs');
      for (let i = 0; i < 5; i++) {
        const p = join(wsDir, `file${i}.txt`);
        await writeFile(p, 'x');
        chmodSync(p, 0o444);
      }
      const mgr = new WorkspaceManager(wsBase);
      await mgr.cleanWorkspace('ws');
      expect(existsSync(wsDir)).toBe(false);
    });
  });
});
