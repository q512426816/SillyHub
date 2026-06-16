/**
 * task-runner-provider-dispatch.test.ts —— Python test_task_runner_provider_dispatch.py 迁移（task-22 P0-A3）。
 *
 * Python 源是规格（475 行 / 13 个用例 / 12 TestClass）。聚焦 **TaskRunner 的 provider 分发
 * + 编排链精确参数传递 + 事件转发 + 旧方法移除**。
 *
 * **与现有 task-runner.test.ts 的关系（R-08 去重）**：
 *   task-runner.test.ts（43 个 it）已覆盖 Python 13 个用例中的 9 个：
 *     - A-02~A-05（claude/codex/copilot/antigravity 分发）→ `provider 分发：getBackend 按入参调用` it.each（5 provider）
 *     - A-06（default claude）→ `默认 provider 为 claude`
 *     - A-07（unsupported）→ `未知 provider → getBackend 抛错 → failed`
 *     - A-11（diff collected）→ AC-01 happy path（collectDiff + patch/files_changed/insertions/deletions）
 *     - A-12（backward compatible）→ 默认 provider claude 已覆盖
 *   **这 9 个不重复迁移**（违反 R-08）。
 *
 *   本文件补 task-runner.test.ts **未细化验证**的 4 个用例：
 *     - A-08：spawn env 精确含 credential.buildEnv 的 KEY（env 透传验证）
 *     - A-09：submitMessages 精确参数（leaseId/claimToken/agentRunId/messages[0].content）
 *     - A-10：submitMessages 抛错（network down）→ 任务仍 success=true（容错验证）
 *     - A-13：`_launch_agent` / `_stream_output` 旧方法不存在（TS 类无此方法，元测试）
 *
 * **TS vs Python 行为差异（Reverse Sync）**：
 *   1. 方法名：Python `execute_task(leaseId, token, payload)`；TS `runLease(ctx: LeaseCtx)`。
 *      ctx 含 leaseId/claimToken/provider/cmdPath/prompt/agentRunId 等扁平字段。
 *   2. backend 模式：Python mock get_backend 返回 backend **class**（runLease 内 new 实例）；
 *      TS getBackend 返回 ProtocolAdapter **实例**（解析器，子进程执行下沉到 TaskRunner._spawnAndStream）。
 *      所以 TS 没有「backend.execute」调用点 —— A-08 的 env/on_event 验证改为检查 spawn 参数。
 *   3. on_event：Python backend.execute 接 on_event callback；TS 由 TaskRunner._handleLine 内调
 *      submitMessages（事件转发是 TaskRunner 职责，非 adapter）。A-09 验证 submitMessages 入参。
 *
 * Mock 隔离（AC-04）：vi.mock 在文件顶部 hoist；vi.mocked(spawn).mockReturnValue 在 beforeEach 重置；
 * afterEach useRealTimers + restoreAllMocks。
 *
 * @module task-runner-provider-dispatch.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// vi.mock 必须在 import 之前（vitest hoist）。
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
import { TaskRunner } from '../src/task-runner.js';
import { createFakeChild, waitForSpawn, type FakeChild } from './helpers/fake-child.js';
import type { AgentEvent, LeaseCtx } from '../src/types.js';

// ── 测试工具（与 task-runner.test.ts 同构，本文件独立持有）──────────────────────

function defaultAdapter(overrides: Partial<Record<string, unknown>> = {}): Record<string, unknown> {
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

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-1',
    runtimeId: 'rt-1',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'do something',
    provider: 'claude',
    cmdPath: '/usr/local/bin/claude',
    agentRunId: 'run-123',
    ...overrides,
  };
}

function makeClient(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
    leaseHeartbeat: vi.fn().mockResolvedValue({}),
    ...overrides,
  };
}

function makeWorkspace(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/workspace'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: 'diff --git a/file.txt b/file.txt',
      files_changed: 1,
      insertions: 5,
      deletions: 2,
      stats: '1 file changed',
    }),
    ...overrides,
  };
}

function makeCred(env: Record<string, string> = { API_KEY: 'test' }): Record<string, unknown> {
  return {
    // task-09：buildSpawnEnv 调 get 读 token，mock 返回 undefined（无 token 配置）
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue(env),
  };
}

function setupRunner(opts: {
  client?: Record<string, unknown>;
  workspace?: Record<string, unknown>;
  cred?: Record<string, unknown>;
  adapter?: Record<string, unknown>;
} = {}): {
  runner: TaskRunner;
  client: Record<string, unknown>;
  workspace: Record<string, unknown>;
  cred: Record<string, unknown>;
} {
  const client = opts.client ?? makeClient();
  const workspace = opts.workspace ?? makeWorkspace();
  const cred = opts.cred ?? makeCred();
  mockAdapter = opts.adapter ?? defaultAdapter();
  const runner = new TaskRunner(client as never, workspace as never, cred as never);
  return { runner, client, workspace, cred };
}

function driveSpawn(child: FakeChild): void {
  vi.mocked(spawn).mockReturnValue(child);
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAdapter = defaultAdapter();
  vi.mocked(spawn).mockReturnValue(null as never);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ── A-08：spawn env 精确含 credential.buildEnv 的 KEY（env 透传验证）─────────────

describe('A-08: spawn env 透传 credential.buildEnv 的 key（对齐 Python test_passes_correct_params）', () => {
  // Python 验证 backend.execute 收到 env 含 API_KEY；TS 子进程执行下沉到 TaskRunner，
  // 改为验证 spawn 第 3 参 opts.env 含 buildEnv 返回的 key。
  it('spawn opts.env 含 buildEnv 返回的 API_KEY', async () => {
    const fakeChild = createFakeChild();
    driveSpawn(fakeChild);
    const { runner } = setupRunner({ cred: makeCred({ API_KEY: 'sk-test-xyz' }) });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    // spawn 第 3 参 opts.env 应含 buildEnv 的 key
    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { env: NodeJS.ProcessEnv };
    expect(opts.env['API_KEY']).toBe('sk-test-xyz');
  });

  it('spawn cwd = workspace.prepareWorkspace 返回的 workDir', async () => {
    const fakeChild = createFakeChild();
    driveSpawn(fakeChild);
    const { runner } = setupRunner({ workspace: makeWorkspace() });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    const opts = spawnCall[2] as { cwd: string };
    expect(opts.cwd).toBe('/tmp/workspace');
  });

  it('spawn 第 1 参 = ctx.cmdPath（对齐 Python cmd_path 透传）', async () => {
    const fakeChild = createFakeChild();
    driveSpawn(fakeChild);
    const { runner } = setupRunner({});

    const p = runner.runLease(makeLease({ cmdPath: '/custom/bin/agent' }));
    await waitForSpawn();
    fakeChild._emitExit(0);
    await p;

    const spawnCall = vi.mocked(spawn).mock.calls[0]!;
    expect(spawnCall[0]).toBe('/custom/bin/agent');
  });
});

// ── A-09：submitMessages 精确参数（对齐 Python test_event_forwarding）────────────

describe('A-09: 事件转发 submitMessages 精确参数（对齐 Python test_event_forwarding）', () => {
  // Python 验证 on_event callback 被调 + submit_messages 入参；TS 事件转发是 TaskRunner._handleLine 职责，
  // stdout 行经 adapter.parse → AgentEvent → _eventToMessages → submitMessages。
  it('text 事件 → submitMessages(leaseId, claimToken, agentRunId, [{event_type:"text", content:"[ASSISTANT] ..."}])', async () => {
    // ql-20260616-005：_eventToMessages 渲染为 [ASSISTANT] 前缀文本（1:1 老格式）
    const fakeChild = createFakeChild();
    driveSpawn(fakeChild);
    const { runner, client } = setupRunner({});

    const lease = makeLease({ leaseId: 'lease-evt', claimToken: 'tok-evt', agentRunId: 'run-evt' });
    const p = runner.runLease(lease);
    await waitForSpawn();
    // adapter.parse 对 'hello' 前缀行返回 [{type:'text', content: line}]
    fakeChild._emitLines(['hello agent says hi']);
    fakeChild._emitExit(0);
    await p;

    expect(client.submitMessages).toHaveBeenCalledTimes(1);
    const callArgs = (client.submitMessages as ReturnType<typeof vi.fn>).mock.calls[0]!;
    // submitMessages(leaseId, claimToken, agentRunId, messages)
    expect(callArgs[0]).toBe('lease-evt');
    expect(callArgs[1]).toBe('tok-evt');
    expect(callArgs[2]).toBe('run-evt');
    const messages = callArgs[3] as Record<string, unknown>[];
    expect(messages.length).toBe(1);
    expect(messages[0]!['event_type']).toBe('text');
    expect(messages[0]!['content']).toBe('[ASSISTANT] hello agent says hi');
  });
});

// ── A-10：submitMessages 抛错 → 任务仍 success（对齐 Python test_event_forward_failure）──

describe('A-10: submitMessages 抛错不中断任务（对齐 Python test_event_forward_failure_doesnt_break）', () => {
  it('submitMessages reject → 任务仍 status=completed, success=true', async () => {
    const fakeChild = createFakeChild();
    driveSpawn(fakeChild);
    const { runner } = setupRunner({
      client: makeClient({
        submitMessages: vi.fn().mockRejectedValue(new Error('network down')),
      }),
    });

    const p = runner.runLease(makeLease());
    await waitForSpawn();
    fakeChild._emitLines(['hello still works']);
    fakeChild._emitExit(0);
    const result = await p;

    // 任务仍成功（submitMessages 失败仅 warn，对齐 task-runner.ts:687）
    expect(result.success).toBe(true);
    expect(result.status).toBe('completed');
  });
});

// ── A-13：旧方法 _launch_agent / _stream_output 不存在（对齐 Python TestOldMethodsRemoved）──

describe('A-13: 旧方法 _launch_agent / _stream_output 不存在（对齐 Python TestOldMethodsRemoved）', () => {
  // TS TaskRunner 类不应有 Python 旧版的 _launch_agent / _stream_output 方法
  // （方案B：子进程执行下沉到 _spawnAndStream，无独立 launch/stream 方法）。
  it('TaskRunner 实例无 _launch_agent 方法', () => {
    const { runner } = setupRunner({});
    // 类型安全：用 in 操作符 + 断言为 Record 检查属性
    const obj = runner as unknown as Record<string, unknown>;
    expect(obj['_launch_agent']).toBeUndefined();
  });

  it('TaskRunner 实例无 _stream_output 方法', () => {
    const { runner } = setupRunner({});
    const obj = runner as unknown as Record<string, unknown>;
    expect(obj['_stream_output']).toBeUndefined();
  });

  it('TaskRunner 实例无 execute_task 方法（旧 Python 方法名，TS 用 runLease）', () => {
    const { runner } = setupRunner({});
    const obj = runner as unknown as Record<string, unknown>;
    expect(obj['execute_task']).toBeUndefined();
    // 新方法存在
    expect(typeof obj['runLease']).toBe('function');
  });
});
