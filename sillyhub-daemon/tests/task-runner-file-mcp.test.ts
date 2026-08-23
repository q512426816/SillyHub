// tests/task-runner-file-mcp.test.ts
// task-07（2026-08-23-agent-file-upload-mcp / FR-02/FR-07 / D-009@v2 / R-09）：
// worker（claude 引擎）spawn 经 os.tmpdir() 0600 临时 .mcp.json 注入 sillyhub-file。
//
// 覆盖验收：
//   - tmpfile 位于 os.tmpdir()、权限 0600（Windows chmod best-effort 不抛错，按平台断言）
//   - 内容含 sillyhub-file（per-server env 含凭证/MCP_RUN_ID/MCP_ALLOWED_ROOT，D-009@v2）
//   - 不写 workDir（rootPath 模式 workDir=宿主真实仓库，防污染 git status，R-09）
//   - --mcp-config <path> 出现在 spawn args（真实 StreamJsonAdapter 集成）
//   - run 终态（成功/失败/取消）finally 删除
//   - 仅 provider=claude 注入（codex/cursor/gemini 不写文件、不传参，D-008@v1）
//   - daemon 启动清扫 tmpdir 同前缀残留（跳过未超龄的并发活跃文件）
//
// spike-01 本机实测结论（claude CLI 2.1.216，2026-08-23，本卡 execute 笔记）：
//   1. --mcp-config 与既有 buildArgs 全套参数（-p/--output-format stream-json/
//      --input-format stream-json/--verbose/--permission-mode/--include-partial-messages/
//      --allowedTools/--max-turns/--settings）共存无冲突，system/init mcp_servers 含
//      配置文件 server；
//   2. .mcp.json per-server env 的 ${VAR} 按 claude 进程 env 展开可用（加固形态
//      「文件只存变量引用、真值走 spawnEnv」可升级；本任务按 D-009@v2 直写凭证）。
//
// 测试策略：mock node:child_process.spawn + getBackend（claude 用真实
// StreamJsonAdapter 走集成链路）。FakeChild 挂起 stdout 让 tmpfile 可在 spawn 后、
// run 终态前读取断言。**不依赖 helpers 的 waitForSpawn**（其 1000 次 setImmediate
// 轮询在 Windows 真实磁盘 IO（mkdtemp + tmp .mcp.json 写入）下会早于 runLease 到达
// spawn 而超时漏过）——本文件用墙钟 waitFor 等待「spawn 调用含本用例唯一
// --mcp-config 路径」这一决定性条件（runId 全局唯一，不受前序用例污染）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/skill-manager.js', () => ({
  linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })),
}));

let mockAdapter: Record<string, unknown> = {};

vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: vi.fn(() => null as unknown),
  };
});

vi.mock('../src/adapters/index.js', () => ({
  getBackend: vi.fn((_provider: string) => mockAdapter),
}));

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readdir, rm, stat, utimes, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  TaskRunner,
  fileMcpTmpPathFor,
  FILE_MCP_TMP_PREFIX,
  cleanupStaleFileMcpConfigs,
  FILE_MCP_TMP_MAX_AGE_MS,
} from '../src/task-runner.js';
import { StreamJsonAdapter } from '../src/adapters/stream-json.js';
import { createFakeChild, type FakeChild } from './helpers/fake-child.js';
import type { LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

// ── 工具 ─────────────────────────────────────────────────────────────────────

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-file-1',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hello',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-1',
    ...overrides,
  };
}

function makeMockClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
  };
}

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: 'daemon-jwt-tok',
    api_key: 'daemon-apikey-k',
    runtime_id: 'rt-test',
    profile: 'default',
    workspace_dir: '/tmp/ws',
    poll_interval: 30,
    heartbeat_interval: 15,
    max_concurrent_tasks: 5,
    log_level: 'info',
    default_timeout_seconds: 1800,
    max_retries: 0,
    ...overrides,
  };
}

/** 真实 StreamJsonAdapter（claude）——runLease→buildArgs→spawn args 集成链路。 */
function useRealClaudeAdapter(): void {
  mockAdapter = new StreamJsonAdapter('claude') as unknown as Record<string, unknown>;
}

/** 独立 runId（跨用例/并行 worker 不撞文件名，也是 spawn 调用的唯一性锚点）。 */
function freshRunId(): string {
  return randomUUID();
}

async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 墙钟轮询等待条件成立（20ms 间隔；超时抛错带上下文）。 */
async function waitFor(
  cond: () => boolean | Promise<boolean>,
  timeoutMs = 15_000,
  what = 'condition',
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await cond()) return;
    await new Promise<void>((r) => setTimeout(r, 20));
  }
  throw new Error(`waitFor timeout (${timeoutMs}ms): ${what}`);
}

/** 是否已存在「携带本用例 --mcp-config <tmpPath>」的 spawn 调用（决定性条件：
 *  证明该 run 的 tmpfile 已写入且 spawn 已发生、listener 已注册，可安全 emit）。 */
function spawnedWithMcpConfig(tmpPath: string): boolean {
  return vi
    .mocked(spawn)
    .mock.calls.some((c) => (c[1] as string[] | undefined)?.includes(tmpPath));
}

/** 构造 runner（workspace mock 指向真实 mkdtemp 目录）。 */
async function makeRunner(workDirPrefix: string): Promise<{
  runner: TaskRunner;
  workDir: string;
}> {
  const workDir = await mkdtemp(join(tmpdir(), workDirPrefix));
  const runner = new TaskRunner(
    makeMockClient() as never,
    {
      prepareWorkspace: vi.fn().mockResolvedValue(workDir),
      collectDiff: vi.fn().mockResolvedValue({
        patch: '',
        files_changed: 0,
        insertions: 0,
        deletions: 0,
        stats: '',
      }),
    } as never,
    { get: vi.fn(() => undefined), buildEnv: vi.fn(() => ({})) } as never,
    makeConfig(),
  );
  return { runner, workDir };
}

/** 记录用例产物 tmpfile 路径，afterEach 兜底清理（防断言失败早退泄漏）。 */
const createdTmpFiles: string[] = [];
const createdWorkDirs: string[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  useRealClaudeAdapter();
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(async () => {
  for (const p of createdTmpFiles.splice(0)) {
    await rm(p, { force: true }).catch(() => {});
  }
  for (const d of createdWorkDirs.splice(0)) {
    await rm(d, { recursive: true, force: true }).catch(() => {});
  }
});

// ── claude 注入三件套：内容/位置/权限 ────────────────────────────────────────

describe('task-07: claude worker .mcp.json 注入（内容/位置/权限/传参）', () => {
  it('tmpfile 位于 os.tmpdir() 且内容含 sillyhub-file（凭证/runId/allowedRoot per-server env）', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner, workDir } = await makeRunner('task-runner-file-mcp-ws-');
    createdWorkDirs.push(workDir);

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');

    // 位置断言：os.tmpdir()（node:path join 三平台）+ 文件名含 runId（可辨识前缀）
    expect(resolve(tmpPath).startsWith(resolve(tmpdir()))).toBe(true);
    expect(tmpPath.includes(runId)).toBe(true);

    // 内容断言（D-009@v2：凭证经 per-server env 落 0600 tmpfile）
    const parsed = JSON.parse(await readFile(tmpPath, 'utf-8')) as {
      mcpServers: Record<string, { command: string; args: string[]; env: Record<string, string> }>;
    };
    // 仅 sillyhub-file（worker 不注入编排 server，CC-12 防递归）
    expect(Object.keys(parsed.mcpServers)).toEqual(['sillyhub-file']);
    const server = parsed.mcpServers['sillyhub-file']!;
    expect(server.command).toBe('node');
    expect(server.args[0]).toMatch(/mcp-server\.js$/);
    expect(server.env.MCP_TOOLSET).toBe('file');
    expect(server.env.MCP_SERVER_BACKEND_URL).toBe('http://127.0.0.1:8000');
    expect(server.env.MCP_SERVER_DAEMON_TOKEN).toBe('daemon-jwt-tok');
    expect(server.env.MCP_SERVER_DAEMON_API_KEY).toBe('daemon-apikey-k');
    expect(server.env.MCP_RUN_ID).toBe(runId);
    // allowedRoot = workDir（worktree 根），resolve 成绝对路径
    expect(server.env.MCP_ALLOWED_ROOT).toBe(resolve(workDir));
    // worker 上下文无 MCP_SESSION_ID（会话侧专用）
    expect(server.env.MCP_SESSION_ID).toBeUndefined();

    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    const result = await resultP;
    expect(result.success).toBe(true);
  });

  it('tmpfile 权限 0600（POSIX 断言权限位；Windows chmod best-effort 不抛错）', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner } = await makeRunner('ws-0600-');

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');

    const s = await stat(tmpPath);
    if (process.platform === 'win32') {
      // Windows 无 POSIX 0600 对应位：写盘 + chmod 不抛错即通过（三平台兼容约束）
      expect(s.isFile()).toBe(true);
    } else {
      expect(s.mode & 0o777).toBe(0o600);
    }

    fakeChild._emitExit(0);
    await resultP;
  });

  it('tmpfile 不写 workDir（rootPath 模式 workDir=宿主真实仓库，R-09）', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner, workDir } = await makeRunner('task-runner-file-mcp-ws2-');
    createdWorkDirs.push(workDir);

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');

    // workDir 内无任何 .mcp.json（凭证不落 agent 可提交目录）
    const entries = await readdir(workDir);
    expect(entries.filter((name) => name.endsWith('.json'))).toEqual([]);
    expect(entries.filter((name) => name.includes(FILE_MCP_TMP_PREFIX))).toEqual([]);

    fakeChild._emitExit(0);
    await resultP;
  });

  it('--mcp-config <path> 出现在 spawn args（真实 StreamJsonAdapter 集成）', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner } = await makeRunner('ws-args-');

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');

    const call = vi
      .mocked(spawn)
      .mock.calls.find((c) => (c[1] as string[] | undefined)?.includes(tmpPath))!;
    const args = call[1] as string[];
    const idx = args.indexOf('--mcp-config');
    expect(idx).toBeGreaterThan(-1);
    expect(args[idx + 1]).toBe(tmpPath);
    // 既有基础参数零回归
    expect(args).toContain('-p');
    expect(args).toContain('--output-format');

    fakeChild._emitExit(0);
    await resultP;
  });
});

// ── run 终态删除（成功/失败/取消三路均走同一 finally）────────────────────────

describe('task-07: run 终态 finally 删除 tmpfile', () => {
  it('成功终态（exit 0 + result 行）删除', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner } = await makeRunner('ws-fin-ok-');

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');
    expect(await exists(tmpPath)).toBe(true);

    fakeChild._emitLines(['{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    await resultP;
    expect(await exists(tmpPath)).toBe(false);
  });

  it('失败终态（exit 1）删除', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner } = await makeRunner('ws-fin-fail-');

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const resultP = runner.runLease(makeLease({ agentRunId: runId }));
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');
    expect(await exists(tmpPath)).toBe(true);

    fakeChild._emitExit(1);
    await resultP;
    expect(await exists(tmpPath)).toBe(false);
  });

  it('取消终态（cancel → SIGTERM kill）删除', async () => {
    const runId = freshRunId();
    const tmpPath = fileMcpTmpPathFor(runId);
    createdTmpFiles.push(tmpPath);
    const { runner } = await makeRunner('ws-fin-cancel-');

    const fakeChild = createFakeChild();
    vi.mocked(spawn).mockReturnValue(fakeChild as never);
    const lease = makeLease({ agentRunId: runId });
    const resultP = runner.runLease(lease);
    await waitFor(() => spawnedWithMcpConfig(tmpPath), 15_000, 'spawn with --mcp-config');
    expect(await exists(tmpPath)).toBe(true);

    await runner.cancel(lease.leaseId);
    fakeChild._emitExit(null, 'SIGTERM');
    await resultP;
    expect(await exists(tmpPath)).toBe(false);
  });
});

// ── 仅 claude 注入（D-008@v1：codex/cursor/gemini 不注入）────────────────────

describe('task-07: 非 claude provider 不注入', () => {
  it.each(['codex', 'cursor', 'gemini'] as const)(
    'provider=%s 不写 tmpfile、buildArgs 无 mcpConfigPath、spawn args 无 --mcp-config',
    async (provider) => {
      const runId = freshRunId();
      const tmpPath = fileMcpTmpPathFor(runId);
      // 可观测 mock adapter（buildArgs 捕获 opts；本用例专用实例不受前序污染）
      const buildArgs = vi.fn(() => ['-p', '--output-format', 'stream-json']);
      mockAdapter = {
        provider,
        parse: vi.fn(() => null),
        buildArgs,
        buildInput: vi.fn(() => '\n'),
      };
      const { runner } = await makeRunner('ws-noclaude-');

      const fakeChild = createFakeChild();
      vi.mocked(spawn).mockReturnValue(fakeChild as never);
      const resultP = runner.runLease(makeLease({ provider, agentRunId: runId }));
      await waitFor(
        () => vi.mocked(spawn).mock.calls.length > 0,
        15_000,
        'spawn called',
      );
      fakeChild._emitExit(0);
      await resultP;

      // 未写 tmpfile
      expect(await exists(tmpPath)).toBe(false);
      // buildArgs 未收到 mcpConfigPath（undefined 不透传）
      expect(buildArgs).toHaveBeenCalled();
      const opts = buildArgs.mock.calls[0]![0] as { mcpConfigPath?: string };
      expect(opts.mcpConfigPath).toBeUndefined();
      // 无任何 spawn 调用携带本 runId 的 --mcp-config
      expect(spawnedWithMcpConfig(tmpPath)).toBe(false);
    },
  );
});

// ── 启动清扫（R-09 三件套之一）───────────────────────────────────────────────

describe('task-07: 启动清扫 tmpdir 同前缀残留', () => {
  it('cleanupStaleFileMcpConfigs 删除超龄残留、保留未超龄（并发保护）', async () => {
    const staleRunId = freshRunId();
    const freshRunId2 = freshRunId();
    const stalePath = fileMcpTmpPathFor(staleRunId);
    const freshPath = fileMcpTmpPathFor(freshRunId2);
    createdTmpFiles.push(stalePath, freshPath);
    await writeFile(stalePath, '{}\n');
    await writeFile(freshPath, '{}\n');
    // stale 文件 mtime 拨回 2 小时前（超 1h 阈值）；fresh 保持当前
    const old = new Date(Date.now() - FILE_MCP_TMP_MAX_AGE_MS - 60 * 60 * 1000);
    await utimes(stalePath, old, old);

    const removed = await cleanupStaleFileMcpConfigs();

    expect(removed).toBeGreaterThanOrEqual(1);
    expect(await exists(stalePath)).toBe(false);
    expect(await exists(freshPath)).toBe(true);
  });

  it('TaskRunner 构造 fire-and-forget 触发清扫（不动 cli.ts）', async () => {
    const staleRunId = freshRunId();
    const stalePath = fileMcpTmpPathFor(staleRunId);
    createdTmpFiles.push(stalePath);
    await writeFile(stalePath, '{}\n');
    const old = new Date(Date.now() - FILE_MCP_TMP_MAX_AGE_MS - 60 * 60 * 1000);
    await utimes(stalePath, old, old);

    // 构造即触发（fire-and-forget）。清扫守卫是进程级单次（防测试并行构造的 IO
    // 风暴），本文件前序用例已构造过 TaskRunner 把守卫消耗——单文件运行时若直接
    // 构造会 deterministic 挂死（验收审查 P2）。resetModules 取全新模块副本（守卫
    // 复位）再构造，既证「构造触发」接线，又不受前序用例污染。
    vi.resetModules();
    const { TaskRunner: FreshTaskRunner } = await import('../src/task-runner.js');
    const runner = new FreshTaskRunner(
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    void runner;

    await waitFor(async () => !(await exists(stalePath)), 5_000, 'constructor cleanup');
  });
});
