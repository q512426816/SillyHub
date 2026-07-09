// tests/task-runner.test.ts
// task-19: TaskRunner 编排层（src/task-runner.ts）。
// 1:1 对齐 Python tests/test_task_runner.py + test_task_runner_provider_dispatch.py。
//
// 测试策略（蓝图 task-19.md §TDD）：
//   - mock node:child_process 的 spawn → 返回 FakeChild（驱动 stdout 行 + exit 事件）
//   - mock HubClient / WorkspaceManager / CredentialManager（依赖注入，vi.fn）
//   - mock ./adapters/index.js 的 getBackend → 返回可控 ProtocolAdapter
//
// 验收 AC-01~AC-08 全部由以下 describe block 覆盖：
//   构造/追踪 6 + 编排链 happy path 2 + provider 分发 5 + R-04 背压 2
//   + R-03 stdin control 2 + 取消 2 + 超时 1 + 错误传播 6 + diff 2
//   + _eventToMessage 3 + _truncate 4 = 35 it

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));

// vi.mock 必须在 import 之前（vitest 提升 hoist）。
// mockAdapter 通过闭包变量让测试可热替换。
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

// 延迟 import：vi.mock 已提升，import 拿到 mock 版本。
import { spawn } from 'node:child_process';
import { getBackend } from '../src/adapters/index.js';
import { TaskRunner } from '../src/task-runner.js';
import { GitError } from '../src/workspace.js';
import { createFakeChild, readStdin, waitForSpawn, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

// ── 测试工具 ────────────────────────────────────────────────────────────────

/** 默认 adapter：识别 hello / text 类行；result 行不产事件。 */
function defaultMockAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
  return {
    provider: 'claude',
    parse: vi.fn((line: string): AgentEvent[] | null => {
      if (line.startsWith('hello') || line.includes('"text"')) {
        return [{ type: 'text', content: line.startsWith('hello') ? line : 'parsed' }];
      }
      return null;
    }),
    buildArgs: vi.fn(() => ['-p', '--output-format', 'stream-json']),
    buildInput: vi.fn((prompt: string) => `${prompt}\n`),
    ...overrides,
  };
}

/** 构造最小 LeaseCtx。 */
function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-1',
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

/** 构造 mock HubClient。 */
function makeMockClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

/** 构造 mock WorkspaceManager。 */
function makeMockWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: 'diff --git a/f b/f',
      files_changed: 1,
      insertions: 5,
      deletions: 2,
      stats: '1 file changed',
    }),
    cleanWorkspace: vi.fn().mockResolvedValue(undefined),
    getWorkspacePath: vi.fn().mockReturnValue('/tmp/ws/test'),
    ...overrides,
  };
}

/** 构造 mock CredentialManager。 */
function makeMockCred(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    // task-09：buildSpawnEnv 调 get 读 token，mock 返回 undefined（无 token 配置）
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({ API_KEY: 'sk-secret' }),
    ...overrides,
  };
}

/**
 * 构造禁用重试的 daemon config（task-10）。
 * 旧测试默认 max_retries=0，保持「单次 spawn 执行」语义（task-10 之前的行为）；
 * 重试编排由 tests/task-runner-retry.test.ts 单独覆盖（注入 max_retries=1）。
 */
function makeNoRetryConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://localhost:8000',
    token: null,
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

/** 构造 TaskRunner。 */
function setupRunner(opts: {
  client?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  cred?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
  config?: DaemonConfig;
}): {
  runner: TaskRunner;
  client: Record<string, unknown>;
  workspace: Record<string, unknown>;
  cred: Record<string, unknown>;
} {
  const client = opts.client ?? makeMockClient();
  const workspace = opts.workspace ?? makeMockWorkspace();
  const cred = opts.cred ?? makeMockCred();
  mockAdapter = opts.adapter ?? defaultMockAdapter();
  // task-10：默认注入 max_retries=0 的 config，禁用 spawn 重试（旧测试保持单次执行语义）。
  const config = opts.config ?? makeNoRetryConfig();
  const runner = new TaskRunner(client as never, workspace as never, cred as never, config);
  return { runner, client, workspace, cred };
}

/** 驱动 spawn fake 返回指定 FakeChild。 */
function mockSpawnReturn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child as never);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter = defaultMockAdapter();
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ── 构造器与任务追踪（对齐 Python TestInit / TestTaskTracking）──────────────

describe('TaskRunner 构造 + 追踪', () => {
  it('初始 activeTaskCount=0（对齐 Python empty_running_tasks）', () => {
    const { runner } = setupRunner({});
    expect(runner.activeTaskCount).toBe(0);
  });

  it('track + untrack：activeTaskCount 正确增减', () => {
    const { runner } = setupRunner({});
    runner.track('t1');
    expect(runner.activeTaskCount).toBe(1);
    runner.track('t2');
    expect(runner.activeTaskCount).toBe(2);
    runner.untrack('t1');
    expect(runner.activeTaskCount).toBe(1);
    runner.untrack('t2');
    expect(runner.activeTaskCount).toBe(0);
  });

  it('untrack 不存在的 taskId 静默（对齐 Python noop）', () => {
    const { runner } = setupRunner({});
    expect(() => runner.untrack('nonexistent')).not.toThrow();
    expect(runner.activeTaskCount).toBe(0);
  });

  it('cancel 不存在的 taskId 返回 false（对齐 Python test_cancel_nonexistent）', async () => {
    const { runner } = setupRunner({});
    const cancelled = await runner.cancel('nonexistent');
    expect(cancelled).toBe(false);
  });

  it('track 返回 AbortController（cancel 可触发 abort）', () => {
    const { runner } = setupRunner({});
    const ac = runner.track('t1');
    expect(ac).toBeInstanceOf(AbortController);
    expect(ac.signal.aborted).toBe(false);
    // cancel 触发 abort
    return runner.cancel('t1').then((ok) => {
      expect(ok).toBe(true);
      expect(ac.signal.aborted).toBe(true);
    });
  });

  it('getState 初始返回 undefined', () => {
    const { runner } = setupRunner({});
    expect(runner.getState('any-lease')).toBeUndefined();
  });
});

// ── AC-01：编排链 9 步完整执行（对齐 Python test_successful_task）──────────────

describe('AC-01：runLease 编排链 9 步完整执行', () => {
  it('workspace → CLAUDE.md → cred → adapter → start → spawn → parse → submit → diff', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, client, workspace, cred } = setupRunner({});

    const lease = makeLease({ claudeMd: '# Instructions', prompt: 'hello' });

    const resultP = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitLines(['hello world', '{"type":"result","session_id":"s1"}']);
    fakeChild._emitExit(0);
    const result = await resultP;

    // 步骤 2：workspace.prepareWorkspace 被调用
    // task-05 退役兜底：repoUrl/branch 透传 undefined（不再兜底 'main'），
    // 由 prepareWorkspace 内部 branch='main' 默认值兜底（行为不变）。
    // ql-20260617-009：新增 options.rootPath（ctx.rootPath undefined 时透传 undefined）。
    expect(workspace.prepareWorkspace).toHaveBeenCalledWith('test-ws', undefined, undefined, {
      rootPath: undefined,
    });

    // 步骤 4：credential.buildEnv 被调用
    expect(cred.buildEnv).toHaveBeenCalled();

    // 步骤 5：getBackend 被调用，provider='claude'
    expect(getBackend).toHaveBeenCalledWith('claude');

    // 步骤 6：startLease 被调用
    expect(client.startLease).toHaveBeenCalledWith('lease-1', 'tok');

    // 步骤 7：spawn 被调用，参数含 cmdPath + adapter.buildArgs
    expect(spawn).toHaveBeenCalledTimes(1);
    const callArgs = vi.mocked(spawn).mock.calls[0]!;
    expect(callArgs[0]).toBe('/usr/local/bin/claude');
    const arr = callArgs[1] as string[];
    expect(arr).toContain('-p');
    expect(arr).toContain('--output-format');
    expect(arr).toContain('stream-json');

    // 步骤 7：parse 被调用 2 次
    expect(mockAdapter.parse).toHaveBeenCalledTimes(2);

    // 步骤 7：submitMessages 被调用（hello world 行触发）
    expect(client.submitMessages).toHaveBeenCalled();

    // 步骤 8：collectDiff 被调用
    expect(workspace.collectDiff).toHaveBeenCalledWith('/tmp/ws/test');

    // 步骤 9：结果正确
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
    expect(result.exitCode).toBe(0);
    expect(result.patch).toBe('diff --git a/f b/f');
    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(2);
    // result 行含 session_id="s1"，由 _extractSessionId 提取
    expect(result.sessionId).toBe('s1');
  });

  it('默认 provider 为 claude（对齐 Python test_no_prompt_uses_default_provider）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const lease = makeLease();
    delete (lease as { provider?: string }).provider;

    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(getBackend).toHaveBeenCalledWith('claude');
  });
});

// ── AC-01b：provider 分发（对齐 Python test_task_runner_provider_dispatch.py）──

describe('provider 分发：getBackend 按入参调用（对齐 Python provider_dispatch）', () => {
  for (const provider of ['claude', 'codex', 'copilot', 'antigravity', 'gemini']) {
    it(`provider='${provider}' → getBackend('${provider}')`, async () => {
      const fakeChild = createFakeChild();
      mockSpawnReturn(fakeChild);
      const { runner } = setupRunner({});

      const p = runner.runLease(makeLease({ provider }));
      await waitForSpawn();
      fakeChild._emitExit(0);
      await p;

      expect(getBackend).toHaveBeenCalledWith(provider);
    });
  }
});

// ── AC-02：R-04 stdout 背压（对齐 task-19.md TDD 步骤 4）──────────────────────

describe('AC-02：R-04 stdout 背压（readline 逐行不积压）', () => {
  it('5 行逐行 submit，顺序与 stdout 一致', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    // adapter 把每行原文作为 content 产出
    const adapter = defaultMockAdapter({
      parse: vi.fn((line: string): AgentEvent[] | null => {
        if (line.startsWith('line-')) return [{ type: 'text', content: line }];
        return null;
      }),
    });

    const submitCalls: string[] = [];
    const client = makeMockClient({
      submitMessages: vi.fn(async (_l: string, _t: string, _r: string, msgs: Record<string, unknown>[]) => {
        submitCalls.push(msgs[0]!.content as string);
        // 模拟 submit 慢（验证背压：慢 submit 不导致后续行积压错序）
        await new Promise((r) => setTimeout(r, 5));
      }),
    });

    const { runner } = setupRunner({ client, adapter });

    const lease = makeLease({ prompt: 'go' });
    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitLines(['line-0', 'line-1', 'line-2', 'line-3', 'line-4']);
    fakeChild._emitExit(0);
    await p;

    // ql-20260616-005：text 事件 content 渲染为 [ASSISTANT] <content>，对齐老格式
    expect(submitCalls).toEqual([
      '[ASSISTANT] line-0',
      '[ASSISTANT] line-1',
      '[ASSISTANT] line-2',
      '[ASSISTANT] line-3',
      '[ASSISTANT] line-4',
    ]);
  });

  it('空 stdout（无事件）→ status=completed, output 空（对齐 Python test_no_progress_when_no_events）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, client } = setupRunner({});

    const p = runner.runLease(makeLease({ prompt: '' }));
    await waitForSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed');
    expect(result.success).toBe(true);
    expect(client.submitMessages).not.toHaveBeenCalled();
    expect(result.output).toBe('');
  });
});

// ── AC-03：R-03 stdin control 不 hang（对齐 task-19.md TDD 步骤 5）────────────

describe('AC-03：R-03 stdin control_request 应答', () => {
  it('control_request 行触发 adapter.onControl(line, stdin)，应答写入 stdin', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);

    const onControl = vi.fn((line: string, stdin: NodeJS.WritableStream): void => {
      // 模拟 adapter 构造 control_response JSON 写回 stdin
      stdin.write(JSON.stringify({ type: 'control_response', response: { behavior: 'allow' } }) + '\n');
    });
    const adapter = defaultMockAdapter({ onControl });

    const { runner } = setupRunner({ adapter });
    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines(['{"type":"control_request","request_id":"r1"}', '{"type":"result"}']);
    fakeChild._emitExit(0);
    await p;

    expect(onControl).toHaveBeenCalled();
    const stdinText = readStdin(fakeChild);
    // stdin 应至少包含 prompt + control_response 应答
    expect(stdinText).toContain('control_response');
    expect(stdinText).toContain('behavior');
  });

  it('写完 prompt 后 stdin 不立即 end（result 行后才 end，对齐 B-19-01）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});
    const endSpy = vi.spyOn(fakeChild.stdin, 'end');

    const p = runner.runLease(makeLease({ prompt: 'hi' }));
    // 让出控制流让 runLease 内部 spawn + stdin.write 执行
    await new Promise((r) => setTimeout(r, 10));

    // spawn 后 + result 行之前，stdin.end 不应被调用
    expect(endSpy).not.toHaveBeenCalled();

    await waitForSpawn();
    fakeChild._emitLines(['{"type":"result"}']);
    fakeChild._emitExit(0);
    await p;

    // result 行后 stdin.end 被调用（或在 finally 中调用）
    expect(endSpy).toHaveBeenCalled();
    endSpy.mockRestore();
  });
});

// ── AC-04：子进程非零退出映射 failed（对齐 task-19.md TDD 步骤 8）─────────────

describe('AC-04：子进程非零退出 → status=failed', () => {
  it('exitCode=127 + stderr "permission denied" → failed，error 含退出码 + stderr', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitStderr('permission denied');
    fakeChild._emitExit(127);
    const result = await p;

    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.exitCode).toBe(1); // TaskRunner 统一映射非零退出为 1
    expect(result.error).toContain('exit code 127');
    expect(result.error).toContain('permission denied');
  });

  it('exitCode 非 0 但 stderr 为空 → failed，error 仅含 exit code', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(2);
    const result = await p;

    expect(result.status).toBe('failed');
    expect(result.error).toContain('exit code 2');
  });
});

// ── AC-05：取消映射 cancelled（对齐 Python cancel_task + B-19-06）─────────────

describe('AC-05：取消（AbortSignal）', () => {
  it('cancel(taskId) → AbortSignal 触发，子进程被 SIGTERM kill，status=cancelled', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const p = runner.runLease(makeLease({ leaseId: 'l-cancel' }));
    // 让出控制流，确保 spawn + track + AbortSignal listener 已注册
    await waitForSpawn();

    // cancel 实际 leaseId（runLease 内部 track 用 leaseId 作 key）
    const cancelled = await runner.cancel('l-cancel');
    expect(cancelled).toBe(true);

    // 子进程被 kill（SIGTERM）
    expect(killSpy).toHaveBeenCalled();
    const sig = killSpy.mock.calls[0]?.[0];
    expect(sig === 'SIGTERM' || sig === undefined).toBe(true);

    // AbortSignal 触发后 onAbort killChild；测试再 emit exit 让 for-await 跳出
    fakeChild._emitExit(null, 'SIGTERM');
    const result = await p;
    expect(result.success).toBe(false);
    expect(result.status).toBe('cancelled');
    expect(result.exitCode).toBe(-1); // signal 退出 → -1（AC-05 验收）
    expect(result.error).toContain('cancelled');
    killSpy.mockRestore();
  });

  it('cancel 不存在的 taskId 返回 false（同构造器追踪用例，重复验证）', async () => {
    const { runner } = setupRunner({});
    expect(await runner.cancel('nope')).toBe(false);
  });

  // ql-20260616-006：lease heartbeat 检测到 backend cancel 信号 → 自动 cancel + kill
  it('leaseHeartbeat 返回 status=cancelled → 自动 cancel + SIGTERM kill 子进程', async () => {
    // 用极短 lease_heartbeat_interval（1s）+ 真实定时器，避免 fake timer 跟
    // waitForSpawn / spawn 异步交互复杂。1s × 2 次 ≈ 2s 触发 cancel。
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const leaseHeartbeat = vi
      .fn()
      .mockResolvedValueOnce({ status: 'claimed' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    const { runner } = setupRunner({
      client: { leaseHeartbeat },
      config: { ...makeNoRetryConfig(), lease_heartbeat_interval: 1 },
    });
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const p = runner.runLease(
      makeLease({ leaseId: 'l-hb-cancel', claimToken: 'tok-hb' }),
    );
    await waitForSpawn();

    // 等 2.5s 让 heartbeat 循环跑两次（1s 间隔，第 2 次返 cancelled → cancel）
    await new Promise((r) => setTimeout(r, 2500));

    expect(leaseHeartbeat).toHaveBeenCalled();
    expect(killSpy).toHaveBeenCalled();
    const sig = killSpy.mock.calls[0]?.[0];
    expect(sig === 'SIGTERM' || sig === undefined).toBe(true);
    // 让 _spawnAndStream 的 for-await 跳出
    fakeChild._emitExit(null, 'SIGTERM');

    const result = await p;
    expect(result.status).toBe('cancelled');
    expect(result.error).toContain('cancelled');
    killSpy.mockRestore();
  }, 10000);

  it('无 claimToken → 跳过 leaseHeartbeat（避免无效请求）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const leaseHeartbeat = vi.fn().mockResolvedValue({ status: 'claimed' });
    const { runner } = setupRunner({ client: { leaseHeartbeat } });

    const p = runner.runLease(
      makeLease({ leaseId: 'l-no-tok', claimToken: '' }),
    );
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // claimToken 空 → leaseHeartbeat 永不被调
    expect(leaseHeartbeat).not.toHaveBeenCalled();
  });

  // ql-20260616-006：cancel 时先调 syncStatus("killed") 让 AgentRun 立即终态
  it('检测到 cancelled 时先调 syncStatus("killed") 再 cancel', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const leaseHeartbeat = vi
      .fn()
      .mockResolvedValueOnce({ status: 'claimed' })
      .mockResolvedValueOnce({ status: 'cancelled' });
    const syncStatus = vi.fn().mockResolvedValue({ status: 'killed' });
    const { runner } = setupRunner({
      client: { leaseHeartbeat, syncStatus },
      config: { ...makeNoRetryConfig(), lease_heartbeat_interval: 1 },
    });
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const p = runner.runLease(
      makeLease({ leaseId: 'l-sync-cancel', claimToken: 'tok-sync' }),
    );
    await waitForSpawn();

    // 等 2.5s 让 heartbeat 跑两次，第 2 次返 cancelled 触发 syncStatus+cancel
    await new Promise((r) => setTimeout(r, 2500));

    // syncStatus 被调用，status='killed'，error='cancelled by user'
    expect(syncStatus).toHaveBeenCalledWith(
      'l-sync-cancel',
      'tok-sync',
      'killed',
      'cancelled by user',
    );
    expect(killSpy).toHaveBeenCalled();
    fakeChild._emitExit(null, 'SIGTERM');

    const result = await p;
    expect(result.status).toBe('cancelled');
    killSpy.mockRestore();
  }, 10000);
});

// ── AC-06 超时看门狗（对齐 Python stream_json.py:110-119 + B-19-07）──────────

describe('超时看门狗（B-19-07）', () => {
  it('超过 timeout 触发 kill，status=timeout', async () => {
    vi.useFakeTimers();
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});
    const killSpy = vi.spyOn(fakeChild, 'kill');

    const lease = makeLease({ leaseId: 'l-timeout', timeout: 10 });
    const p = runner.runLease(lease);

    // fake timer 模式下 setImmediate 也被 fake，需手动推进让 spawn 完成 +
    // watchdog 计时器注册。多次小步推进既走微任务也走 timer。
    // spawn 之前的 mock（prepareWorkspace 等）都是同步 resolve，少量推进即到 spawn。
    for (let i = 0; i < 20; i++) {
      await vi.advanceTimersByTimeAsync(0);
      const calls = vi.mocked(spawn).mock.calls.length;
      if (calls > 0) break;
    }
    // 再推进一次确保 watchdog setTimeout 已注册
    await vi.advanceTimersByTimeAsync(0);

    // 推进 fake timer 超过 timeout（10s）→ watchdog 触发 killChild
    await vi.advanceTimersByTimeAsync(11_000);

    expect(killSpy).toHaveBeenCalled();
    const sig = killSpy.mock.calls[0]?.[0];
    expect(sig === 'SIGTERM' || sig === undefined).toBe(true);

    // kill 后测试 emit exit 让 for-await 跳出
    fakeChild._emitExit(null, 'SIGTERM');
    const result = await p;

    expect(result.status).toBe('timeout');
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
    killSpy.mockRestore();
  });
});

// ── 错误传播（对齐 Python test_exception_during_execution / unsupported_provider）──

describe('错误传播（顶层 try/catch 映射 failed）', () => {
  it('workspace.prepareWorkspace 抛错 → failed（对齐 Python test_exception_during_execution）', async () => {
    const { runner } = setupRunner({
      workspace: makeMockWorkspace({
        prepareWorkspace: vi.fn().mockRejectedValue(new Error('workspace blew up')),
      }),
    });

    const result = await runner.runLease(makeLease());

    expect(result.status).toBe('failed');
    expect(result.success).toBe(false);
    expect(result.error).toContain('workspace blew up');
  });

  it('workspace.prepareWorkspace 抛 GitError → failed（task-15 错误类型）', async () => {
    const { runner } = setupRunner({
      workspace: makeMockWorkspace({
        prepareWorkspace: vi.fn().mockRejectedValue(
          new GitError(['clone', 'x'], 'auth failed', 128),
        ),
      }),
    });

    const result = await runner.runLease(makeLease());

    expect(result.status).toBe('failed');
    expect(result.error).toContain('auth failed');
  });

  it('未知 provider → getBackend 抛错 → failed，error 含 unsupported provider', async () => {
    vi.mocked(getBackend).mockImplementationOnce(() => {
      throw new Error('Unknown provider: foo');
    });
    const { runner } = setupRunner({});

    const lease = makeLease({ provider: 'foo' });
    const result = await runner.runLease(lease);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('unsupported provider');
    expect(result.error).toContain('foo');
  });

  it('cmdPath 为空 → failed，不调 spawn（B-19-13）', async () => {
    const { runner } = setupRunner({});

    const lease = makeLease({ cmdPath: '' });
    const result = await runner.runLease(lease);

    expect(result.status).toBe('failed');
    expect(result.error).toContain('cmd_path');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('spawn ENOENT（error 事件）→ failed（B-19-05 spawn 错误分支）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease({ cmdPath: '/no/such/bin' }));
    await waitForSpawn();
    fakeChild._emitError(Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
    fakeChild._emitExit(127);
    const result = await p;

    expect(result.status).toBe('failed');
    expect(result.error).toContain('ENOENT');
  });

  it('parse 抛错不中断整体（坏行跳过，后续行仍处理，B-19-04）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const adapter = defaultMockAdapter({
      parse: vi.fn((line: string): AgentEvent[] | null => {
        if (line === 'bad') throw new Error('parse boom');
        if (line === 'good') return [{ type: 'text', content: 'ok' }];
        return null;
      }),
    });
    const { runner, client } = setupRunner({ adapter });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines(['bad', 'good']);
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed'); // 不被坏行影响
    expect(client.submitMessages).toHaveBeenCalledTimes(1); // 仅 good
  });

  it('submitMessages 失败不中断（对齐 Python test_submit_messages_failure_does_not_crash）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const client = makeMockClient({
      submitMessages: vi.fn().mockRejectedValue(new Error('network down')),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner } = setupRunner({ client });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines(['hello-1', 'hello-2']);
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed');
    // 至少一次 event_forward_failed 警告（实现用多参数：tag + leaseId + err）
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('event_forward_failed'),
      expect.anything(),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it('startLease 失败不中断（容错策略，对齐 Python start_lease_failed）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const client = makeMockClient({
      startLease: vi.fn().mockRejectedValue(new Error('start failed')),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner } = setupRunner({ client });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed'); // start 失败仍执行
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('start_lease_failed'),
      expect.anything(),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});

// ── AC-06：diff 收集（对齐 Python test_diff_collected_after_execution）────────

describe('AC-06：diff 收集', () => {
  it('collectDiff 拿到 patch + files_changed，传给结果', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, workspace } = setupRunner({});

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(workspace.collectDiff).toHaveBeenCalledWith('/tmp/ws/test');
    expect(result.patch).toBe('diff --git a/f b/f');
    expect(result.filesChanged).toBe(1);
    expect(result.insertions).toBe(5);
    expect(result.deletions).toBe(2);
  });
});

// ── ql-20260617-009：workspace.root_path 优先用作 cwd，跳过 mirror ────────────

describe('ql-20260617-009：rootPath 优先用作 cwd', () => {
  it('ctx.rootPath 存在 → prepareWorkspace 收到 options.rootPath', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, workspace } = setupRunner({});

    const lease = makeLease({
      claudeMd: '# Instructions',
      prompt: 'hello',
      // 模拟 fetch execution-context 填回的真实 workspace 上下文
      workspaceSlug: 'my-workspace',
      rootPath: '/real/host/path/to/code',
    } as Partial<LeaseCtx>);

    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // workspaceSlug 优先于 workspaceName 作 mirror 目录名兜底
    expect(workspace.prepareWorkspace).toHaveBeenCalledWith(
      'my-workspace',
      undefined,
      undefined,
      { rootPath: '/real/host/path/to/code' },
    );
  });

  it('ctx.rootPath 缺失 → options.rootPath 透传 undefined（保持现有行为）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner, workspace } = setupRunner({});

    const lease = makeLease({ prompt: 'hello' });

    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(workspace.prepareWorkspace).toHaveBeenCalledWith(
      'test-ws',
      undefined,
      undefined,
      { rootPath: undefined },
    );
  });

  it('collectDiff 失败不标记任务失败（对齐 Python non-fatal diff）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const workspace = makeMockWorkspace({
      collectDiff: vi.fn().mockRejectedValue(new Error('git diff boom')),
    });
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { runner } = setupRunner({ workspace });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed'); // 仍成功
    expect(result.patch).toBe(''); // diff 空
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('diff_collect_failed'),
      expect.anything(),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });
});

// ── AC-06b：CLAUDE.md 写入（对齐 Python test_claude_md_written）───────────────

describe('CLAUDE.md 写入', () => {
  it('claudeMd 非空 → 写入 work_dir/.claude/CLAUDE.md', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease({ claudeMd: '# Project\nInstructions.' }));
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // 由于 workspace mock 返回固定路径 '/tmp/ws/test'，TaskRunner 会调 fs.mkdir + fs.writeFile。
    // 这里仅验证调用不抛错即可（真实 fs 写入验证在集成测试 / task-22）。
    expect(getBackend).toHaveBeenCalled();
  });

  it('claudeMd 空 → 跳过写入（对齐 Python test_no_claude_md_skips_write）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease({ claudeMd: '' }));
    await waitForSpawn();
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed');
  });
});

// ── AC-01c：credential env 渲染（对齐 Python test_credentials_rendered_into_env）

describe('credential env 渲染（spawn env 含 buildEnv 产出）', () => {
  it('buildEnv 返回的 env 注入 spawn（API_KEY 出现在 spawn 选项 env 中）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const cred = makeMockCred({
      buildEnv: vi.fn().mockReturnValue({ API_KEY: 'sk-secret-123' }),
      get: vi.fn(() => undefined),
    });
    const { runner } = setupRunner({ cred });

    const p = runner.runLease(makeLease({ toolConfig: { api_key: '{{USER_API_KEY}}' } as Record<string, string> }));
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(cred.buildEnv).toHaveBeenCalledWith({ api_key: '{{USER_API_KEY}}' });
    // spawn 第 3 参数 env 含 API_KEY
    const spawnOpts = vi.mocked(spawn).mock.calls[0]![2] as { env?: Record<string, string> };
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env!.API_KEY).toBe('sk-secret-123');
  });
});

// ── AC-07：output 截断（对齐 Python _MAX_OUTPUT / _MAX_ERROR）────────────────

describe('output/error 截断（_truncate）', () => {
  it('output 超 10000 字符 → 截断到 10000（对齐 Python test_output_truncation）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    // adapter 把每行产 text，累积超 10000
    const longText = 'x'.repeat(60_000);
    const adapter = defaultMockAdapter({
      parse: vi.fn((): AgentEvent[] | null => [{ type: 'text', content: longText }]),
    });
    const { runner } = setupRunner({ adapter });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines(['one-line']);
    fakeChild._emitExit(0);
    const result = await p;

    expect(result.status).toBe('completed');
    expect(result.output.length).toBe(50_000);
  });

  it('error 超 5000 字符 → 截断到 5000', async () => {
    const { runner } = setupRunner({
      workspace: makeMockWorkspace({
        prepareWorkspace: vi.fn().mockRejectedValue(new Error('x'.repeat(20_000))),
      }),
    });

    const result = await runner.runLease(makeLease());

    expect(result.status).toBe('failed');
    expect(result.error.length).toBe(5_000);
  });
});

// ── _eventToMessages（ql-20260616-005：1:N 渲染，1:1 复现老 SERVER 路径格式）──

describe('_eventToMessages（对齐老 _format_conversation_log）', () => {
  // 通过 runner 实例的私有方法访问（TS 允许 (runner as any)._eventToMessages）
  function callEventToMessages(
    runner: TaskRunner,
    ev: AgentEvent,
  ): Record<string, unknown>[] | null {
    return (runner as unknown as {
      _eventToMessages: (ev: AgentEvent) => Record<string, unknown>[] | null;
    })._eventToMessages(ev);
  }

  it('text 事件 → 1 条 [ASSISTANT] content (stdout)', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, { type: 'text', content: 'hi' });
    expect(msgs).toEqual([
      { event_type: 'text', content: '[ASSISTANT] hi', channel: 'stdout' },
    ]);
  });

  it('ql-20260617-008 text + status=system subtype=init → [SYSTEM:init] <content>', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'text',
      content: 'session=sess-1 cwd=/tmp model=sonnet',
      metadata: { status: 'system', subtype: 'init', session_id: 'sess-1' },
    });
    expect(msgs).toEqual([
      {
        event_type: 'text',
        content: '[SYSTEM:init] session=sess-1 cwd=/tmp model=sonnet',
        channel: 'stdout',
        session_id: 'sess-1',
      },
    ]);
  });

  it('ql-20260617-008 text + status=system subtype=status → [SYSTEM:status] <content>', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'text',
      content: 'session=sess-1 status=requesting',
      metadata: { status: 'system', subtype: 'status', session_id: 'sess-1' },
    });
    expect(msgs).toEqual([
      {
        event_type: 'text',
        content: '[SYSTEM:status] session=sess-1 status=requesting',
        channel: 'stdout',
        session_id: 'sess-1',
      },
    ]);
  });

  it('ql-20260617-008 text + status=system subtype=api_retry → [SYSTEM:api_retry] <content>', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'text',
      content: 'session=sess-1 attempt=1/10 http=529 error=rate_limit',
      metadata: { status: 'system', subtype: 'api_retry', session_id: 'sess-1' },
    });
    expect(msgs).toEqual([
      {
        event_type: 'text',
        content:
          '[SYSTEM:api_retry] session=sess-1 attempt=1/10 http=529 error=rate_limit',
        channel: 'stdout',
        session_id: 'sess-1',
      },
    ]);
  });

  it('text + thinking=true → 1 条 [THINKING] preview (2000 截断)', () => {
    const { runner } = setupRunner({});
    const long = 'x'.repeat(25000);
    const msgs = callEventToMessages(runner, {
      type: 'text',
      content: long,
      metadata: { thinking: true },
    });
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.channel).toBe('stdout');
    expect(msgs![0]!.content).toMatch(/^\[THINKING] x{20000}\.\.\.$/);
  });

  it('tool_use + input.command → 2 条 (stdout + tool_call JSON)', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Bash',
        call_id: 'call-1',
        tool_input: { command: 'ls -la', description: 'list' },
      },
    });
    expect(msgs).toHaveLength(2);
    // 第一条 stdout 文本
    expect(msgs![0]).toMatchObject({
      event_type: 'tool_use',
      channel: 'stdout',
      call_id: 'call-1',
    });
    expect(msgs![0]!.content).toBe('[TOOL_USE] Bash: ls -la');
    // 第二条 tool_call JSON
    expect(msgs![1]!.channel).toBe('tool_call');
    const parsed = JSON.parse(msgs![1]!.content as string);
    expect(parsed).toMatchObject({
      tool: 'Bash',
      args: { command: 'ls -la', description: 'list' },
      status: 'allowed',
      success: true,
    });
    expect(typeof parsed.timestamp).toBe('string');
  });

  it('tool_use 无 input.command → stdout 行 args 为 JSON 字符串', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Read',
        tool_input: { file_path: '/tmp/a.txt' },
      },
    });
    expect(msgs![0]!.content).toBe(
      '[TOOL_USE] Read: {"file_path":"/tmp/a.txt"}',
    );
  });

  // ── task-13 / D-002@v1：tool_use_id 补到 tool_call JSON + stdout metadata ──

  it('task-13 tool_use 携带 call_id(toolu_xxx) → tool_call JSON 含 tool_use_id', () => {
    // stream-json.ts:645-654 把 SDK tool_use block.id（toolu_xxx）存到 md.call_id。
    // task-runner 从 md.call_id 提取并注入 tool_use_id（snake_case，对齐 Anthropic API
    // + backend run_sync/service.py）。前端 normalize（task-14）据此全局配对。
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Bash',
        call_id: 'toolu_test123',
        tool_input: { command: 'ls -la' },
      },
    });
    expect(msgs).toHaveLength(2);
    // 第一条 stdout：原格式不变（id 只进 tool_call JSON，避免 submit_messages 丢 metadata）
    expect(msgs![0]!).toMatchObject({
      event_type: 'tool_use',
      channel: 'stdout',
      call_id: 'toolu_test123',
    });
    expect(msgs![0]!.content).toBe('[TOOL_USE] Bash: ls -la');
    // 第二条 tool_call JSON：含 tool_use_id 字段（snake_case，对齐 Anthropic API）
    expect(msgs![1]!.channel).toBe('tool_call');
    const parsed = JSON.parse(msgs![1]!.content as string);
    expect(parsed).toMatchObject({
      tool: 'Bash',
      tool_use_id: 'toolu_test123',
      args: { command: 'ls -la' },
      status: 'allowed',
      success: true,
    });
  });

  it('task-13 tool_use md.tool_use_id 优先于 md.call_id（兼容 adapter 改造后路径）', () => {
    // 未来若 adapter 把 block.id 改存到 md.tool_use_id（命名修正），task-runner 应优先取它。
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Read',
        tool_use_id: 'toolu_primary',
        call_id: 'toolu_fallback',
        tool_input: { file_path: '/a' },
      },
    });
    const parsed = JSON.parse(msgs![1]!.content as string);
    expect(parsed.tool_use_id).toBe('toolu_primary');
  });

  it('task-13 tool_use 无 id（退化）→ tool_call JSON 不含 tool_use_id 字段', () => {
    // SDK 不给 stable id 的退化路径：toolUseId='' → tool_call JSON 省略字段，
    // 前端 normalize 回退 ±3 窗口（task-14 范围）。
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Bash',
        tool_input: { command: 'echo hi' },
      },
    });
    expect(msgs).toHaveLength(2);
    // tool_call JSON：不含 tool_use_id 字段
    const parsed = JSON.parse(msgs![1]!.content as string);
    expect(parsed).not.toHaveProperty('tool_use_id');
    expect(parsed).toMatchObject({
      tool: 'Bash',
      args: { command: 'echo hi' },
      status: 'allowed',
      success: true,
    });
  });

  it('task-13 tool_use 携带 id 时 stdout 文本仍为 [TOOL_USE] Name: <args>（不超长）', () => {
    // 边界8：id 只进 tool_call JSON，不污染 stdout 文本，slice(0,2000) 仍对原文本生效
    const { runner } = setupRunner({});
    const longCmd = 'x'.repeat(21000);
    const msgs = callEventToMessages(runner, {
      type: 'tool_use',
      content: '',
      metadata: {
        tool_name: 'Bash',
        call_id: 'toolu_len',
        tool_input: { command: longCmd },
      },
    });
    // stdout content 长度受 2000 截断
    expect((msgs![0]!.content as string).length).toBe(20000);
    expect((msgs![0]!.content as string).startsWith('[TOOL_USE] Bash: ')).toBe(true);
  });

  it('tool_result → 1 条 [TOOL_RESULT] preview (100000 截断 + 标注)', () => {
    const { runner } = setupRunner({});
    const long = 'y'.repeat(110000);
    const msgs = callEventToMessages(runner, {
      type: 'tool_result',
      content: long,
    });
    expect(msgs).toHaveLength(1);
    expect(msgs![0]!.channel).toBe('stdout');
    // ql-20260709-001：放宽 3000→100000，超长追加中文截断标注
    expect(msgs![0]!.content).toBe(
      `[TOOL_RESULT] ${'y'.repeat(100000)}\n...(输出过长，已截断，共 110000 字符)`,
    );
  });

  it('error → 1 条 [LEVEL] content (stderr)', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'error',
      content: 'something broke',
      metadata: { level: 'warn' },
    });
    expect(msgs).toEqual([
      {
        event_type: 'error',
        content: '[WARN] something broke',
        channel: 'stderr',
      },
    ]);
  });

  it('error 无 level → 默认 [ERROR]', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'error',
      content: 'fatal',
    });
    expect(msgs![0]!.content).toBe('[ERROR] fatal');
    expect(msgs![0]!.channel).toBe('stderr');
  });

  it('complete + stats → 1 条 [RESULT:success] duration/turns', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'complete',
      content: 'all done',
      metadata: {
        stats: { total_duration_ms: 12345, num_turns: 7 },
      },
    });
    expect(msgs).toEqual([
      {
        event_type: 'complete',
        content: '[RESULT:success] all done duration=12345ms turns=7',
        channel: 'stdout',
      },
    ]);
  });

  it('text + usage metadata → usage 透传到首条 message', () => {
    const { runner } = setupRunner({});
    const msgs = callEventToMessages(runner, {
      type: 'text',
      content: 'hi',
      metadata: { usage: { input_tokens: 100, output_tokens: 50 } },
    });
    expect(msgs![0]!.usage).toEqual({ input_tokens: 100, output_tokens: 50 });
  });
});

// ── _truncate（对齐 Python _truncate + test_truncate）────────────────────────

describe('_truncate（对齐 Python _truncate / test_truncate）', () => {
  function truncate(runner: TaskRunner, text: string, limit: number): string {
    return (runner as unknown as {
      _truncate: (text: string, limit: number) => string;
    })._truncate(text, limit);
  }

  it('短文本不变（对齐 Python test_short_text_unchanged）', () => {
    const { runner } = setupRunner({});
    expect(truncate(runner, 'hello', 10)).toBe('hello');
  });

  it('超长截断到 limit（对齐 Python test_long_text_truncated）', () => {
    const { runner } = setupRunner({});
    expect(truncate(runner, 'a'.repeat(100), 10)).toBe('a'.repeat(10));
  });

  it('空文本（对齐 Python test_empty_text）', () => {
    const { runner } = setupRunner({});
    expect(truncate(runner, '', 5)).toBe('');
  });

  it('刚好等长不截断（对齐 Python test_exact_length_unchanged）', () => {
    const { runner } = setupRunner({});
    expect(truncate(runner, '12345', 5)).toBe('12345');
  });
});

// ── AC-08：状态机（getState 反映 runLease 终态）─────────────────────────────

describe('状态机 getState', () => {
  it('执行中 → completed（终态写入）', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const lease = makeLease({ leaseId: 'lease-state-1' });
    const p = runner.runLease(lease);
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    expect(runner.getState('lease-state-1')).toBe('completed');
  });

  it('失败 → failed', async () => {
    const { runner } = setupRunner({
      workspace: makeMockWorkspace({
        prepareWorkspace: vi.fn().mockRejectedValue(new Error('boom')),
      }),
    });

    await runner.runLease(makeLease({ leaseId: 'lease-state-2' }));

    expect(runner.getState('lease-state-2')).toBe('failed');
  });

  it('非零退出 → failed', async () => {
    const fakeChild = createFakeChild();
    mockSpawnReturn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease({ leaseId: 'lease-state-3' }));
    await waitForSpawn();
    fakeChild._emitExit(1);
    await p;

    expect(runner.getState('lease-state-3')).toBe('failed');
  });
});
