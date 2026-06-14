// tests/diff-truncate.test.ts
// task-07: A4 diff 50KB 截断 + stat_summary 生成（daemon 侧）。
//
// 覆盖 AC-04（5 case 全绿）/ AC-05（>50KB diff 不撑爆 payload）：
//   case1 截断：超 50_000 字符 diff → 截断到 50_000 + '\n...[truncated]' 尾标
//   case2 未超：小 diff → 原样返回，无尾标
//   case3 空 diff：无改动 → 零值（patch='' / stats='' / files_changed=0）
//   case4 stat_summary：stats = shortstat.trim()（人可读串，对齐 backend
//                       diff_collector.DiffResult.stat_summary，redact 留后端）
//   case5 parseShortstat：既有解析逻辑回归
//
// 后端 redact（patch/output 二次脱敏）的 backend pytest case 见
// backend/app/modules/agent/tests/test_execution_context.py::TestCompleteLeaseDiffRedact
// （task-07 接入 complete_lease redact_output 后转 GREEN）。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WorkspaceManager, parseShortstat } from '../src/workspace.js';

// ---------------------------------------------------------------------------
// 测试辅助：复用 workspace.test.ts 的 makeOriginRepo 模式（真实 git fixture）。
// ---------------------------------------------------------------------------

function gitSync(args: string[], cwd: string): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

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

describe('diff-truncate (task-07: A4 50KB 截断 + stat_summary)', () => {
  let tmpRoot: string;
  let baseDir: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'sillyhub-diff-'));
    baseDir = join(tmpRoot, 'workspaces');
    await mkdir(baseDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
  });

  it('case1: 超 50_000 字符的 diff → 截断到 50_000 + "\\n...[truncated]" 尾标', async () => {
    const origin = await makeOriginRepo(tmpRoot);
    const mgr = new WorkspaceManager(baseDir);
    const ws = await mgr.prepareWorkspace('big-diff', origin, 'main');

    // 改写已跟踪文件 hello.txt 为 60_000 字符（git diff 工作区不含未跟踪文件，
    // 必须改已跟踪文件才能让 diff 非空且超 50_000）
    await writeFile(join(ws, 'hello.txt'), 'x'.repeat(60_000), 'utf8');

    const result = await mgr.collectDiff(ws);

    expect(result.patch.endsWith('\n...[truncated]')).toBe(true);
    expect(result.patch.length).toBe(50_000 + '\n...[truncated]'.length);
    expect(result.files_changed).toBeGreaterThanOrEqual(1);
  });

  it('case2: 未超 50_000 的 diff → 原样返回，无尾标', async () => {
    const origin = await makeOriginRepo(tmpRoot);
    const mgr = new WorkspaceManager(baseDir);
    const ws = await mgr.prepareWorkspace('small-diff', origin, 'main');

    await writeFile(join(ws, 'hello.txt'), 'small change', 'utf8');

    const result = await mgr.collectDiff(ws);

    expect(result.patch).not.toContain('[truncated]');
    expect(result.patch.length).toBeLessThan(50_000);
    expect(result.patch).toContain('diff --git');
  });

  it('case3: 无改动 → 零值（patch="" / stats="" / files_changed=0）', async () => {
    const origin = await makeOriginRepo(tmpRoot);
    const mgr = new WorkspaceManager(baseDir);
    const ws = await mgr.prepareWorkspace('no-change', origin, 'main');

    const result = await mgr.collectDiff(ws);

    expect(result.patch).toBe('');
    expect(result.stats).toBe('');
    expect(result.files_changed).toBe(0);
    expect(result.insertions).toBe(0);
    expect(result.deletions).toBe(0);
  });

  it('case4: stat_summary = shortstat.trim()（人可读串，含 "file" 关键字）', async () => {
    const origin = await makeOriginRepo(tmpRoot);
    const mgr = new WorkspaceManager(baseDir);
    const ws = await mgr.prepareWorkspace('stat-test', origin, 'main');

    // 修改已跟踪文件（git diff 不含未跟踪文件，需改 hello.txt）
    await writeFile(join(ws, 'hello.txt'), 'stat test change\n', 'utf8');

    const result = await mgr.collectDiff(ws);

    // stats 即 stat_summary：与 git diff --shortstat 原文 trim 后逐字一致
    expect(result.stats).not.toBe('');
    expect(result.stats).toContain('file');
    const rawShortstat = gitSync(['diff', '--shortstat'], ws).trim();
    expect(result.stats).toBe(rawShortstat);
    // stat_summary 不含 [truncated]（仅 patch 才截断）
    expect(result.stats).not.toContain('[truncated]');
  });

  it('case5: parseShortstat 解析 shortstat 三段', () => {
    const r = parseShortstat(
      ' 3 files changed, 10 insertions(+), 2 deletions(-)',
    );
    expect(r.files_changed).toBe(3);
    expect(r.insertions).toBe(10);
    expect(r.deletions).toBe(2);
  });
});
