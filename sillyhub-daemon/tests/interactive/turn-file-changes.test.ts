/**
 * interactive/turn-file-changes 单测 —— 每轮工作区快照采集
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-023@v1 / task-09）。
 *
 * 手法（对齐 turn-anchor.test.ts 的 daemon 测试惯例）：
 *   - **真实临时 git 仓**跑六类夹具（有改动 / 无改动 / 非 git 仓 / untracked /
 *     binary / ignored-by-mtime）——不 mock git，口径以真实 `git status --porcelain -z`
 *     与 `git diff --numstat` 为准（`core.autocrlf=false` 抹平 CRLF 差，跨平台可跑）；
 *   - **注入执行器**（`input.execFile`）覆盖必须是假件的面：超时（假 git 睡 2s）、
 *     子进程计数与参数断言、rename `R` 条目归一、git_missing、串行队列不并发、
 *     队列溢出、行级退档口径。
 *
 * 覆盖（= task-09 acceptance 逐条）：
 *   1. 六类夹具全绿；2. 单轮子进程 ≤3 + `--no-optional-locks` / `core.preloadIndex`
 *   在参数里；3. 超时 → partial/timeout；4. 非 git 仓 → unavailable/not_a_repo
 *   （不抛错、不写「无改动」伪值）；5. rename 归一 delete+add；6. 串行队列并发标记
 *   恒 1 + 队列溢出 partial/queue_overflow；7. 遥测：结构化日志 + 滑窗 p50/p95/降级率；
 *   8. E1 基线解析（零子进程 fs 口径三态）。
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import {
  collectTurnFileChanges,
  getTurnFileChangesTelemetry,
  readBaselineHead,
  resetTurnFileChangesTelemetry,
  resolveBaselineHead,
  resolveTurnFileChangesLimits,
  toolCallPathsFromEvent,
} from '../../src/interactive/turn-file-changes.js';
import type {
  TurnFileChangesExecFile,
  TurnFileChangesSnapshot,
} from '../../src/interactive/turn-file-changes-types.js';

const execFileAsync = promisify(execFile);

/* ── 夹具工具 ────────────────────────────────────────────────────────────── */

/** 真 git 命令（夹具自用；被测模块自己持 git 实现）。 */
async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, {
    cwd,
    timeout: 20_000,
    windowsHide: true,
  });
  return stdout;
}

/**
 * 造一个带一次基线提交的临时 git 仓。
 *
 * `core.autocrlf=false` 关掉换行归一：Windows 默认 true 时 `writeFile('a\nb\n')`
 * 与仓库内 LF 内容的 diff 会凭空多出删除行（行级断言不稳），关掉后
 * 「改一行」恒为 +1/−1，Linux/macOS 同口径。
 */
async function makeRepo(files: Record<string, string>): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'turn-file-changes-'));
  try {
    await git(dir, ['init', '-b', 'main']);
  } catch {
    await git(dir, ['init']); // 旧版 git 无 -b
  }
  await git(dir, ['config', 'user.email', 't@t.local']);
  await git(dir, ['config', 'user.name', 't']);
  await git(dir, ['config', 'commit.gpgsign', 'false']);
  await git(dir, ['config', 'core.autocrlf', 'false']);
  for (const [relPath, content] of Object.entries(files)) {
    await writeRepoFile(dir, relPath, content);
  }
  await git(dir, ['add', '-A']);
  await git(dir, ['commit', '-m', 'base']);
  return dir;
}

/** 写文件（自动建父目录）。 */
async function writeRepoFile(
  root: string,
  relPath: string,
  content: string | Uint8Array,
): Promise<void> {
  const abs = join(root, relPath);
  await mkdir(join(abs, '..'), { recursive: true });
  if (typeof content === 'string') {
    await writeFile(abs, content, 'utf-8');
  } else {
    await writeFile(abs, content);
  }
}

/** 造一个空临时目录（非 git 仓夹具）。 */
async function makePlainDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'turn-file-changes-plain-'));
}

/** 计数/造错用假执行器：`respond(args, callIndex)` 返回 stdout 或抛错。 */
function makeFakeExec(
  respond: (args: string[], callIndex: number) => string | Error,
  delayMs = 0,
): { exec: TurnFileChangesExecFile; calls: string[][]; maxInFlight: () => number } {
  const calls: string[][] = [];
  let inFlight = 0;
  let peak = 0;
  const exec: TurnFileChangesExecFile = async (args) => {
    calls.push([...args]);
    inFlight += 1;
    peak = Math.max(peak, inFlight);
    try {
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
      const out = respond(args, calls.length - 1);
      if (out instanceof Error) throw out;
      return { stdout: out, stderr: '' };
    } finally {
      inFlight -= 1;
    }
  };
  return { exec, calls, maxInFlight: () => peak };
}

/** 断言「git 全局参数前缀」在场（--no-optional-locks + core.preloadIndex=true）。 */
function expectGitBaseArgs(args: string[]): void {
  expect(args).toContain('--no-optional-locks');
  const index = args.indexOf('core.preloadIndex=true');
  expect(index).toBeGreaterThan(0);
  expect(args[index - 1]).toBe('-c');
}

const created: string[] = [];

/**
 * 真实 git 夹具的超时放宽：这些用例验的是解析/合并/归因，不验计时；机器满载
 *（多 agent 并行、CPU 100%）时 spawn 抖动会让默认 1500ms 硬超时误触发假红。
 * **默认 1500ms 超时口径**由专测 `run-timeout`（假 git 睡 2s，用默认 limits）覆盖，
 * 不在此放宽。
 */
const FIXTURE_LIMITS = { timeoutMs: 10_000 } as const;

beforeEach(() => {
  resetTurnFileChangesTelemetry();
});

afterEach(async () => {
  while (created.length > 0) {
    const dir = created.pop();
    if (dir) await rm(dir, { recursive: true, force: true }).catch(() => undefined);
  }
});

/** makeRepo + 登记清理。 */
async function repo(files: Record<string, string>): Promise<string> {
  const dir = await makeRepo(files);
  created.push(dir);
  return dir;
}

async function plainDir(): Promise<string> {
  const dir = await makePlainDir();
  created.push(dir);
  return dir;
}

/** 找某个路径的快照条目。 */
function fileAt(
  snapshot: TurnFileChangesSnapshot,
  path: string,
): TurnFileChangesSnapshot['files'][number] | undefined {
  return snapshot.files.find((f) => f.path === path);
}

/* ── ① 六类夹具 ──────────────────────────────────────────────────────────── */

describe('collectTurnFileChanges × 六类夹具（真实 git 仓）', () => {
  it('有改动：逐文件 +/− 取 numstat；Edit 命中归因 edit_patch，其余 command', async () => {
    const dir = await repo({
      'base.txt': 'line1\nline2\n',
      'other.txt': 'x\ny\n',
    });
    await writeRepoFile(dir, 'base.txt', 'line1\nLINE2\nline3\n'); // +2/−1
    await writeRepoFile(dir, 'other.txt', 'x\ny\nz\n'); // +1/−0

    const snap = await collectTurnFileChanges({
      runId: 'run-changed',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      toolCallPaths: [{ path: 'base.txt', toolName: 'Edit' }],
      turnStartedAtMs: Date.now() - 5_000,
      limits: FIXTURE_LIMITS,
    });

    expect(snap.status).toBe('ok');
    expect(snap.reason).toBeUndefined();
    expect(snap.truncated).toBeUndefined();
    expect(snap.concurrentSessionsHint).toBe(true);
    expect(snap.runId).toBe('run-changed');
    expect(snap.baselineHead).toMatch(/^[0-9a-f]{7,40}$/);
    expect(snap.collectMs).toBeGreaterThanOrEqual(0);
    expect(Number.isNaN(Date.parse(snap.collectedAt))).toBe(false);

    const base = fileAt(snap, 'base.txt');
    expect(base).toMatchObject({
      path: 'base.txt',
      status: 'modified',
      added: 2,
      deleted: 1,
      attribution: 'edit_patch',
      editToolNames: ['Edit'],
      source: 'git',
    });
    const other = fileAt(snap, 'other.txt');
    expect(other).toMatchObject({
      path: 'other.txt',
      status: 'modified',
      added: 1,
      deleted: 0,
      attribution: 'command',
      source: 'git',
    });
    expect(other?.editToolNames).toBeUndefined(); // 缺失就不写
    // 不变量：files 按 path 唯一且升序（design「不变量」）
    expect(snap.files.map((f) => f.path)).toEqual(['base.txt', 'other.txt']);
  });

  it('无改动：files 空、status=ok、不伪造任何条目', async () => {
    const dir = await repo({ 'base.txt': 'line1\n' });
    // 把 mtime 拨回 1 分钟前（模拟「本轮之前的文件」）：ignored 目录探测按时序
    // 跳过 tracked-未改动文件，不得把它报成改动（防假报的回归护栏）。
    const past = new Date(Date.now() - 60_000);
    await utimes(join(dir, 'base.txt'), past, past);
    const snap = await collectTurnFileChanges({
      runId: 'run-clean',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      toolCallPaths: [{ path: 'base.txt', toolName: 'Read' }],
      turnStartedAtMs: Date.now(),
      limits: FIXTURE_LIMITS,
    });
    expect(snap.status).toBe('ok');
    expect(snap.files).toEqual([]);
    expect(snap.truncated).toBeUndefined();
  });

  it('非 git 仓：unavailable + not_a_repo，不抛错、不写「无改动」伪值', async () => {
    const dir = await plainDir();
    const snap = await collectTurnFileChanges({
      runId: 'run-not-repo',
      workspaceRoot: dir,
      limits: FIXTURE_LIMITS,
    });
    expect(snap.status).toBe('unavailable');
    expect(snap.reason).toBe('not_a_repo');
    expect(snap.baselineHead).toBeNull();
    expect(snap.files).toEqual([]);
    // 诚实的空数组 + unavailable：前端据 capability 走降级卡（不是「本轮无改动」）
    expect(snap.status).not.toBe('ok');
  });

  it('untracked：status=untracked，行数 0/0（numstat 不覆盖未跟踪文件，不伪造）', async () => {
    const dir = await repo({ 'base.txt': 'line1\n' });
    await writeRepoFile(dir, 'new-file.ts', 'export const x = 1;\n');
    const snap = await collectTurnFileChanges({
      runId: 'run-untracked',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      toolCallPaths: [{ path: 'new-file.ts', toolName: 'Write' }],
      limits: FIXTURE_LIMITS,
    });
    const entry = fileAt(snap, 'new-file.ts');
    expect(entry).toMatchObject({
      path: 'new-file.ts',
      status: 'untracked',
      added: 0,
      deleted: 0,
      attribution: 'edit_patch',
      editToolNames: ['Write'],
      source: 'git',
    });
    expect(entry?.binary).toBeUndefined();
  });

  it('轮内 commit 的改动进入文件清单（status 干净也能看到 M/A/D）', async () => {
    const dir = await repo({ 'a.ts': 'line1\n', 'old.ts': 'bye\n' });
    const baseline = (await resolveBaselineHead(dir)) ?? undefined;
    await writeRepoFile(dir, 'a.ts', 'line1\nline2\n');
    await writeRepoFile(dir, 'new.ts', 'hello\n');
    await rm(join(dir, 'old.ts'));
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'turn commit']);

    const snap = await collectTurnFileChanges({
      runId: 'run-committed',
      workspaceRoot: dir,
      baselineHead: baseline,
      limits: FIXTURE_LIMITS,
    });
    expect(snap.status).toBe('ok');
    expect(fileAt(snap, 'a.ts')).toMatchObject({ status: 'modified', added: 1, deleted: 0 });
    expect(fileAt(snap, 'new.ts')).toMatchObject({ status: 'added', added: 1, deleted: 0 });
    expect(fileAt(snap, 'old.ts')).toMatchObject({ status: 'deleted', added: 0, deleted: 1 });
  });

  it('同一文件多次 Edit：editToolNames 保留重复，长度=编辑调用次数', async () => {
    const dir = await repo({ 'base.txt': 'a\n' });
    await writeRepoFile(dir, 'base.txt', 'a\nb\n');
    const snap = await collectTurnFileChanges({
      runId: 'run-edit-count',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      toolCallPaths: [
        { path: 'base.txt', toolName: 'Edit' },
        { path: 'base.txt', toolName: 'Edit' },
        { path: 'base.txt', toolName: 'Write' },
      ],
      limits: FIXTURE_LIMITS,
    });
    expect(fileAt(snap, 'base.txt')?.editToolNames).toEqual(['Edit', 'Edit', 'Write']);
  });

  it('binary：numstat 的 -/- → added=0/deleted=0 + binary=true', async () => {
    const dir = await repo({ 'base.txt': 'line1\n' });
    const binary = Uint8Array.from([0, 1, 2, 3, 255, 0, 7]);
    await writeRepoFile(dir, 'blob.bin', binary);
    await git(dir, ['add', '-A']);
    await git(dir, ['commit', '-m', 'add binary']);
    await writeRepoFile(dir, 'blob.bin', Uint8Array.from([0, 9, 9, 0, 255, 1]));

    const snap = await collectTurnFileChanges({
      runId: 'run-binary',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      limits: FIXTURE_LIMITS,
    });
    const entry = fileAt(snap, 'blob.bin');
    expect(entry).toMatchObject({
      path: 'blob.bin',
      status: 'modified',
      added: 0,
      deleted: 0,
      binary: true,
      attribution: 'command',
    });
  });

  it('ignored-by-mtime：gitignore 命中目录按「工具调用路径前缀 + mtime」探测，标 source=mtime', async () => {
    const dir = await repo({
      'base.txt': 'line1\n',
      '.gitignore': 'logs/\n',
    });
    // 本轮起点之后的 ignored 文件（git status 看不见）
    const startedAt = Date.now();
    await new Promise((r) => setTimeout(r, 20));
    await writeRepoFile(dir, 'logs/turn.log', 'hello\n');

    const snap = await collectTurnFileChanges({
      runId: 'run-ignored',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      toolCallPaths: [
        { path: join(dir, 'logs', 'turn.log'), toolName: 'Bash' }, // 绝对路径也归一
      ],
      turnStartedAtMs: startedAt,
      limits: FIXTURE_LIMITS,
    });

    const entry = fileAt(snap, 'logs/turn.log');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      path: 'logs/turn.log',
      added: 0,
      deleted: 0,
      attribution: 'command',
      source: 'mtime',
    });
    // 本轮新建（birthtime 落在本轮）→ added；文件系统不支持 birthtime 时保守 modified。
    expect(['added', 'modified']).toContain(entry?.status);
    // git 侧不应重复出现同一条（mtime 只补 git 看不见的路径）
    expect(snap.files.filter((f) => f.path === 'logs/turn.log')).toHaveLength(1);
  });
});

/* ── ② 子进程预算 + 参数红线 ──────────────────────────────────────────────── */

describe('collectTurnFileChanges × 子进程预算（≤3）与 git 参数红线', () => {
  it('E1 已给基线：status + name-status + numstat 恰 3 条，参数含 --no-optional-locks 与 core.preloadIndex', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('status')) return 'M  src/a.ts\0';
      if (args.includes('--name-status')) return 'M\0src/a.ts\0';
      return '1\t0\tsrc/a.ts\n';
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-procs-2',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
    });
    expect(snap.status).toBe('ok');
    expect(fake.calls).toHaveLength(3);
    expect(fake.calls[0]?.slice(-5)).toEqual([
      'status',
      '--porcelain',
      '-z',
      '--untracked-files=normal',
      '--no-renames',
    ]);
    expect(fake.calls[1]).toEqual(
      expect.arrayContaining(['diff', '--name-status', '--no-renames']),
    );
    expect(fake.calls[2]).toEqual(
      expect.arrayContaining(['diff', '--numstat', '--no-renames']),
    );
    for (const args of fake.calls) expectGitBaseArgs(args);
    expect(fileAt(snap, 'src/a.ts')).toMatchObject({ status: 'modified', added: 1, deleted: 0 });
    expect(getTurnFileChangesTelemetry().subprocessCountMax).toBe(3);
  });

  it('E1 未给基线：rev-parse + status + name-status + numstat 恰 4 条（兜底路径登记例外）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('rev-parse')) return 'cafebabecafebabecafebabecafebabecafebabe\n';
      if (args.includes('status')) return ' M a.txt\0';
      if (args.includes('--name-status')) return 'M\0a.txt\0';
      return '3\t1\ta.txt\n';
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-procs-3',
      workspaceRoot: dir,
      execFile: fake.exec,
    });
    expect(snap.status).toBe('ok');
    expect(fake.calls).toHaveLength(4);
    expect(snap.baselineHead).toBe('cafebabecafebabecafebabecafebabecafebabe');
    expect(fileAt(snap, 'a.txt')).toMatchObject({ added: 3, deleted: 1 });
    for (const args of fake.calls) expectGitBaseArgs(args);
    expect(getTurnFileChangesTelemetry().subprocessCountMax).toBe(4);
  });

  it('退档口径（includeLineCounts=false）：只跑 status，+/− 留 0 且快照标 partial', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec(() => ' M a.txt\0');
    const snap = await collectTurnFileChanges({
      runId: 'run-no-lines',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
      limits: { includeLineCounts: false },
    });
    expect(fake.calls).toHaveLength(1);
    expect(fake.calls[0]).toEqual(expect.arrayContaining(['status', '--porcelain', '-z']));
    expect(snap.status).toBe('partial');
    expect(snap.reason).toBeUndefined(); // 枚举无「行数未采」，不造值
    expect(fileAt(snap, 'a.txt')).toMatchObject({ added: 0, deleted: 0 });
  });

  it('/mnt/ 慢盘基础预算 ≥8s；显式 limits 优先；普通路径保持 1500ms', () => {
    const prev = process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
    delete process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
    try {
      expect(
        resolveTurnFileChangesLimits('/mnt/e/proj', undefined).timeoutMs,
      ).toBeGreaterThanOrEqual(8_000);
      expect(resolveTurnFileChangesLimits('/tmp/proj', undefined).timeoutMs).toBe(1_500);
      expect(
        resolveTurnFileChangesLimits('/mnt/e/proj', { timeoutMs: 1_234 }).timeoutMs,
      ).toBe(1_234);
    } finally {
      if (prev !== undefined) process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS = prev;
    }
  });

  it('环境变量覆盖基础预算；timeout 后该工作区自适应升级，下一轮成功', async () => {
    const dir = await plainDir();
    const prev = process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
    process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS = '50';
    let call = 0;
    const exec: TurnFileChangesExecFile = async (args) => {
      call += 1;
      if (call === 1) {
        // 首轮 rev-parse 慢（忽略 signal），触发硬超时并升级预算
        await new Promise((resolve) => setTimeout(resolve, 300));
        return { stdout: '', stderr: '' };
      }
      if (args.includes('rev-parse')) {
        return {
          stdout: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef\n',
          stderr: '',
        };
      }
      return { stdout: '', stderr: '' };
    };
    try {
      const first = await collectTurnFileChanges({
        runId: 'run-adaptive-1',
        workspaceRoot: dir,
        execFile: exec,
      });
      expect(first.status).toBe('partial');
      expect(first.reason).toBe('timeout');
      const second = await collectTurnFileChanges({
        runId: 'run-adaptive-2',
        workspaceRoot: dir,
        execFile: exec,
      });
      expect(second.status).toBe('ok');
    } finally {
      if (prev === undefined) {
        delete process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
      } else {
        process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS = prev;
      }
    }
  }, 20_000);

  it('子进程自身 timeout 也升级预算（不依赖外层硬超时）', async () => {
    const dir = await plainDir();
    const prev = process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
    process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS = '50';
    let phase: 'first' | 'second' = 'first';
    const exec: TurnFileChangesExecFile = async (args) => {
      if (phase === 'first') {
        // 第一轮 status 直接被 kill（classifyGitError → partial/timeout 路径）
        throw Object.assign(new Error('git killed by timeout'), { killed: true });
      }
      if (args.includes('status')) {
        // 200ms > 原 50ms、< 升级后的 2050ms：只有升级生效才会成功
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
      return { stdout: '', stderr: '' };
    };
    try {
      const first = await collectTurnFileChanges({
        runId: 'run-subproc-timeout-1',
        workspaceRoot: dir,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: exec,
      });
      expect(first.status).toBe('partial');
      expect(first.reason).toBe('timeout');
      phase = 'second';
      const second = await collectTurnFileChanges({
        runId: 'run-subproc-timeout-2',
        workspaceRoot: dir,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: exec,
      });
      expect(second.status).toBe('ok');
    } finally {
      if (prev === undefined) {
        delete process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS;
      } else {
        process.env.SILLYHUB_FILE_CHANGES_TIMEOUT_MS = prev;
      }
    }
  }, 20_000);
});

/* ── ③ 降级路径（timeout / git_missing / 截断）───────────────────────────── */

describe('collectTurnFileChanges × 降级路径', () => {
  it('超时：假 git 睡 2s，默认 1500ms 硬超时 → partial + reason=timeout（不挂起调用方）', async () => {
    const dir = await plainDir();
    const sleepy: TurnFileChangesExecFile = async () =>
      new Promise((resolve) => {
        // 忽略 signal（模拟无响应子进程）：验证 Promise.race 硬超时臂本身兜得住。
        setTimeout(() => resolve({ stdout: ' M a.txt\0', stderr: '' }), 2_000);
      });
    const started = Date.now();
    const snap = await collectTurnFileChanges({
      runId: 'run-timeout',
      workspaceRoot: dir,
      execFile: sleepy,
    });
    const elapsed = Date.now() - started;
    expect(snap.status).toBe('partial');
    expect(snap.reason).toBe('timeout');
    expect(snap.files).toEqual([]);
    expect(elapsed).toBeLessThan(1_900); // 远早于假 git 的 2s
    expect(snap.collectMs).toBeLessThan(1_900);
  }, 20_000);

  it('numstat 超时：保留 status/name-status 清单（partial/timeout，行数不可信）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('status')) return 'M  src/a.ts\0';
      if (args.includes('--name-status')) return 'M\0src/a.ts\0';
      return Object.assign(new Error('git killed by timeout'), { killed: true });
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-numstat-timeout',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
    });
    expect(snap.status).toBe('partial');
    expect(snap.reason).toBe('timeout');
    expect(fileAt(snap, 'src/a.ts')).toMatchObject({
      status: 'modified',
      added: 0,
      deleted: 0,
    });
  });

  it('name-status 超时但 numstat 成功：numstat 路径兜底入列，仍标 partial/timeout', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('status')) return 'M  a.ts\0';
      if (args.includes('--name-status')) {
        return Object.assign(new Error('git killed by timeout'), { killed: true });
      }
      return '2\t0\ta.ts\n';
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-name-status-timeout',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
    });
    expect(snap.status).toBe('partial');
    expect(snap.reason).toBe('timeout');
    expect(fileAt(snap, 'a.ts')).toMatchObject({ status: 'modified', added: 2, deleted: 0 });
  });

  it('name-status 非 timeout git 错误经 onGitDiagnostic 落结构化诊断，快照语义不变（2026-10-23-review-risk-fixes-2）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('status')) return 'M  a.ts\0';
      if (args.includes('--name-status')) return new Error('fatal: bad object');
      return '2\t0\ta.ts\n';
    });
    const diagnostics: Array<{
      stage: string;
      reason: string | null;
      message: string;
    }> = [];
    const snap = await collectTurnFileChanges({
      runId: 'run-name-status-git-error',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
      onGitDiagnostic: (d) => diagnostics.push({ ...d }),
    });
    // 旧实现：非 timeout 错误在 catch 里无痕消失（无日志/无 reason 可排查）
    expect(diagnostics).toEqual([
      { stage: 'name-status', reason: null, message: 'fatal: bad object' },
    ]);
    // 快照照常产出：numstat 行级可信、清单在——降级语义与旧一致（reason 枚举冻结禁新增）
    expect(fileAt(snap, 'a.ts')).toMatchObject({ status: 'modified', added: 2, deleted: 0 });
  });

  it('git 缺失：执行器 ENOENT → unavailable + reason=git_missing（不抛错）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec(() => {
      const err = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
      err.code = 'ENOENT';
      return err;
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-git-missing',
      workspaceRoot: dir,
      execFile: fake.exec,
    });
    expect(snap.status).toBe('unavailable');
    expect(snap.reason).toBe('git_missing');
    expect(snap.files).toEqual([]);
  });

  it('未知 git 错误：status=failed（不带 reason，不伪造 ok）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec(() => new Error('git exited with code 128'));
    const snap = await collectTurnFileChanges({
      runId: 'run-git-failed',
      workspaceRoot: dir,
      execFile: fake.exec,
    });
    expect(snap.status).toBe('failed');
    expect(snap.reason).toBeUndefined(); // 枚举无「未知错误」值，不造值
    expect(snap.files).toEqual([]);
  });

  it('截断：改动数超 maxFiles → truncated=true + status=partial（只保留前 N 条）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      if (args.includes('status')) return ' M a.ts\0 M b.ts\0 M c.ts\0';
      return '1\t0\ta.ts\n1\t0\tb.ts\n1\t0\tc.ts\n';
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-truncated',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
      limits: { maxFiles: 2 },
    });
    expect(snap.status).toBe('partial');
    expect(snap.truncated).toBe(true);
    expect(snap.files).toHaveLength(2);
    expect(snap.files.map((f) => f.path)).toEqual(['a.ts', 'b.ts']);
  });
});

/* ── ④ rename 归一 ────────────────────────────────────────────────────────── */

describe('collectTurnFileChanges × rename 归一', () => {
  it('porcelain 的 R 条目归一成 delete（旧路径）+ add（新路径）两条', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => {
      // -z 的 rename 条目：`XY NEW\0OLD\0`
      if (args.includes('status')) return 'R  src/new.ts\0src/old.ts\0';
      return '4\t0\tsrc/new.ts\n0\t4\tsrc/old.ts\n';
    });
    const snap = await collectTurnFileChanges({
      runId: 'run-rename',
      workspaceRoot: dir,
      baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
      execFile: fake.exec,
    });
    const byPath = new Map(snap.files.map((f) => [f.path, f]));
    expect(byPath.get('src/old.ts')).toMatchObject({
      status: 'deleted',
      added: 0,
      deleted: 4,
    });
    expect(byPath.get('src/new.ts')).toMatchObject({
      status: 'added',
      added: 4,
      deleted: 0,
    });
    expect(snap.files).toHaveLength(2);
  });

  it('真 git mv（--no-renames 下 git 自己就报 delete+add）：不出现 rename 状态', async () => {
    const dir = await repo({ 'a.txt': '1\n2\n3\n' });
    await git(dir, ['mv', 'a.txt', 'b.txt']);
    const snap = await collectTurnFileChanges({
      runId: 'run-git-mv',
      workspaceRoot: dir,
      baselineHead: (await resolveBaselineHead(dir)) ?? undefined,
      limits: FIXTURE_LIMITS,
    });
    expect(snap.files.map((f) => [f.path, f.status])).toEqual([
      ['a.txt', 'deleted'],
      ['b.txt', 'added'],
    ]);
  });
});

/* ── ⑤ 串行队列（不并发 + 溢出降级）──────────────────────────────────────── */

describe('collectTurnFileChanges × 单工作区串行队列', () => {
  it('同工作区并发两次：并发标记恒 1（第二次等第一次彻底结束）', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => (args.includes('status') ? ' M a.ts\0' : '1\t0\ta.ts\n'), 40);
    const collect = (runId: string, root: string) =>
      collectTurnFileChanges({
        runId,
        workspaceRoot: root,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: fake.exec,
      });
    const [first, second] = await Promise.all([collect('run-serial-1', dir), collect('run-serial-2', dir)]);
    expect(first.status).toBe('ok');
    expect(second.status).toBe('ok');
    // 两次采集各 3 条 git 调用；串行 → 任何时刻最多 1 条在飞。
    expect(fake.calls).toHaveLength(6);
    expect(fake.maxInFlight()).toBe(1);
  });

  it('队列溢出（默认深度 1）：第三个并发调用立即 partial + reason=queue_overflow', async () => {
    const dir = await plainDir();
    const fake = makeFakeExec((args) => (args.includes('status') ? ' M a.ts\0' : '1\t0\ta.ts\n'), 60);
    const collect = (runId: string) =>
      collectTurnFileChanges({
        runId,
        workspaceRoot: dir,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: fake.exec,
      });
    const started = Date.now();
    const results = await Promise.all([collect('q-1'), collect('q-2'), collect('q-3')]);
    const overflow = results[2]!;
    expect(overflow.status).toBe('partial');
    expect(overflow.reason).toBe('queue_overflow');
    expect(overflow.files).toEqual([]);
    expect(overflow.collectMs).toBeLessThan(100); // 立即返回，不排队
    expect(results[0]!.status).toBe('ok');
    expect(results[1]!.status).toBe('ok');
    expect(Date.now() - started).toBeGreaterThanOrEqual(100);
  });

  it('不同工作区互不阻塞（队列按 workspaceRoot 分桶）', async () => {
    const dirA = await plainDir();
    const dirB = await plainDir();
    const fake = makeFakeExec(() => '', 50);
    const results = await Promise.all([
      collectTurnFileChanges({
        runId: 'x-a',
        workspaceRoot: dirA,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: fake.exec,
      }),
      collectTurnFileChanges({
        runId: 'x-b',
        workspaceRoot: dirB,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: fake.exec,
      }),
    ]);
    expect(results.every((r) => r.status === 'ok')).toBe(true);
    expect(fake.maxInFlight()).toBe(2); // 两桶并行
  });
});

/* ── ⑥ 遥测：结构化日志 + 滑窗统计 ────────────────────────────────────────── */

describe('collectTurnFileChanges × 遥测', () => {
  it('每轮打一行 turn_file_changes_collected（runId/collectMs/fileCount/subprocessCount/status）', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const dir = await plainDir();
    const fake = makeFakeExec((args) => (args.includes('status') ? ' M a.ts\0' : '1\t0\ta.ts\n'));
    try {
      await collectTurnFileChanges({
        runId: 'run-log',
        workspaceRoot: dir,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: fake.exec,
      });
      const logCall = infoSpy.mock.calls.find(
        ([tag]) => tag === '[turn-file-changes] turn_file_changes_collected',
      );
      expect(logCall).toBeDefined();
      const payload = logCall![1] as Record<string, unknown>;
      expect(payload).toMatchObject({
        runId: 'run-log',
        fileCount: 1,
        subprocessCount: 3,
        status: 'ok',
        truncated: false,
        lineCounts: true,
      });
      expect(typeof payload['collectMs']).toBe('number');
    } finally {
      infoSpy.mockRestore();
    }
  });

  it('滑窗统计：samples / p50 / p95 / 降级率 / 子进程峰值可用且降级率按 status 计', async () => {
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    const dir = await plainDir();
    try {
      // 1 轮 ok + 1 轮 unavailable（非 git 仓真夹具太慢 → 用 ENOENT 假执行器）
      const okExec = makeFakeExec((args) => (args.includes('status') ? '' : ''));
      await collectTurnFileChanges({
        runId: 't-ok',
        workspaceRoot: dir,
        baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        execFile: okExec.exec,
      });
      const missing = new Error('spawn git ENOENT') as NodeJS.ErrnoException;
      missing.code = 'ENOENT';
      const badExec = makeFakeExec(() => missing);
      await collectTurnFileChanges({
        runId: 't-bad',
        workspaceRoot: dir,
        execFile: badExec.exec,
      });

      const summary = getTurnFileChangesTelemetry();
      expect(summary.samples).toBe(2);
      expect(summary.p50).toBeGreaterThanOrEqual(0);
      expect(summary.p95).toBeGreaterThanOrEqual(summary.p50);
      expect(summary.degradeRate).toBeCloseTo(0.5, 3);
      expect(summary.subprocessCountMax).toBeLessThanOrEqual(3);
    } finally {
      infoSpy.mockRestore();
    }
  });
});

/* ── ⑦ 纯函数：事件 → 工具调用路径 ────────────────────────────────────────── */

describe('toolCallPathsFromEvent', () => {
  it('tool_use + 入参 JSON 的路径键 → { path, toolName }', () => {
    expect(
      toolCallPathsFromEvent({
        type: 'tool_use',
        tool_name: 'Edit',
        content: JSON.stringify({ file_path: 'src/a.ts', old_string: 'x' }),
      }),
    ).toEqual([{ path: 'src/a.ts', toolName: 'Edit' }]);
    expect(
      toolCallPathsFromEvent({
        type: 'tool_use',
        tool_name: 'Write',
        content: JSON.stringify({ path: 'docs/b.md' }),
      }),
    ).toEqual([{ path: 'docs/b.md', toolName: 'Write' }]);
  });

  it('非 tool_use / 无 tool_name / 非法 JSON / 无路径键 → 空（不猜）', () => {
    expect(toolCallPathsFromEvent({ type: 'text', content: 'hi' })).toEqual([]);
    expect(
      toolCallPathsFromEvent({ type: 'tool_use', content: '{"path":"a"}' }),
    ).toEqual([]);
    expect(
      toolCallPathsFromEvent({ type: 'tool_use', tool_name: 'Edit', content: 'not-json' }),
    ).toEqual([]);
    expect(
      toolCallPathsFromEvent({
        type: 'tool_use',
        tool_name: 'Bash',
        content: JSON.stringify({ command: 'ls' }),
      }),
    ).toEqual([]);
  });
});

/* ── ⑧ E1 基线（零子进程 fs 读 + git 口径对照）────────────────────────────── */

describe('readBaselineHead（E1 轮首基线，零子进程）', () => {
  it('真 git 仓返回 HEAD sha，与 git rev-parse 同值', async () => {
    const dir = await repo({ 'a.txt': '1\n' });
    const head = await readBaselineHead(dir);
    const viaGit = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    expect(head).toMatch(/^[0-9a-f]{40}$/);
    expect(head).toBe(viaGit);
  });

  it('非 git 目录返回 null（采集期不再跑 rev-parse，直接降级 unavailable）', async () => {
    const plain = await plainDir();
    await expect(readBaselineHead(plain)).resolves.toBeNull();
  });

  it('packed-refs 里的分支也解析得出（loose ref 被 gc 后仍可用）', async () => {
    const dir = await repo({ 'a.txt': '1\n' });
    const before = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    await git(dir, ['pack-refs', '--all']);
    await expect(readBaselineHead(dir)).resolves.toBe(before);
  });

  it('detached HEAD（HEAD 直接是 sha）解析得出', async () => {
    const dir = await repo({ 'a.txt': '1\n' });
    const head = (await git(dir, ['rev-parse', 'HEAD'])).trim();
    await git(dir, ['checkout', '--detach', head]);
    await expect(readBaselineHead(dir)).resolves.toBe(head);
  });

  it('`.git` 是文件但内容不可解析 → undefined（交采集期 git 兜底，不假报 null）', async () => {
    const dir = await plainDir();
    await writeFile(join(dir, '.git'), 'garbage\n', 'utf-8');
    await expect(readBaselineHead(dir)).resolves.toBeUndefined();
  });

  it('resolveBaselineHead（git 口径对照）：真仓返回 sha、非仓 null 且不抛', async () => {
    const dir = await repo({ 'a.txt': '1\n' });
    await expect(resolveBaselineHead(dir)).resolves.toMatch(/^[0-9a-f]{40}$/);
    const plain = await plainDir();
    await expect(resolveBaselineHead(plain)).resolves.toBeNull();
  });
});
