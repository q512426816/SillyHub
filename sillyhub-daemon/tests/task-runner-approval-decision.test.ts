// tests/task-runner-approval-decision.test.ts
// 2026-07-02-daemon-filesystem-policy task-17 / R-06：
// batch Codex server request 审批接入 PolicyEngine 决策。
//
// 覆盖（验收标准 §13 #9）：
//   1. fileChange 写白名单内 → PolicyEngine allow → accept response；
//   2. fileChange 写越界 → PolicyEngine deny → decline response（含中文理由）；
//   3. commandExecution 重定向越界 → 经 extractShellWritePaths 提取后 deny → decline；
//   4. PolicyEngine 未注入 → fail-closed decline；
//   5. fileChange 无可识别路径 → fail-closed decline（design §13 #9 降级）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
vi.mock('../src/skill-manager.js', () => ({ linkSkillsToWorkdir: vi.fn(async () => ({ linked: 0, skipped: true })) }));

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
import { TaskRunner } from '../src/task-runner.js';
import { JsonRpcAdapter } from '../src/adapters/json-rpc.js';
import { createFakeChild, readStdin, waitForSpawn } from './helpers/fake-child.js';
import { PolicyCache } from '../src/policy/runtime-policy.js';
import type { AuditSink as AuditSinkType } from '../src/policy/audit-sink.js';
import { PolicyEngine } from '../src/policy/filesystem-policy.js';
import type { LeaseCtx } from '../src/types.js';
import type { DaemonConfig } from '../src/config.js';

function makeConfig(): DaemonConfig {
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
    allowed_roots: ['/fallback'],
  } as unknown as DaemonConfig;
}

function makeLease(overrides: Partial<LeaseCtx> = {}): LeaseCtx {
  return {
    leaseId: 'lease-1',
    runtimeId: 'rt-codex',
    claimToken: 'tok',
    workspaceName: 'test-ws',
    claudeMd: '',
    prompt: 'hi',
    provider: 'codex',
    cmdPath: '/usr/local/bin/codex',
    agentRunId: 'run-1',
    ...overrides,
  };
}

function makeMockClient(): Record<string, unknown> {
  return {
    startLease: vi.fn().mockResolvedValue({}),
    submitMessages: vi.fn().mockResolvedValue({ status: 'ok' }),
    completeLease: vi.fn().mockResolvedValue({}),
  };
}

function makeMockWorkspace(): Record<string, unknown> {
  return {
    prepareWorkspace: vi.fn().mockResolvedValue('/tmp/ws/test'),
    collectDiff: vi.fn().mockResolvedValue({
      patch: '',
      files_changed: 0,
      insertions: 0,
      deletions: 0,
      stats: '',
    }),
  };
}

function makeMockCred(): Record<string, unknown> {
  return {
    get: vi.fn(() => undefined),
    buildEnv: vi.fn().mockReturnValue({}),
  };
}

/** 内存 AuditSink（攒批不上报），用于构造真实 PolicyEngine。 */
function makeInMemoryAuditSink(): AuditSinkType & { events: Record<string, unknown>[] } {
  const events: Record<string, unknown>[] = [];
  const sink = {
    record(ev: Record<string, unknown>): void {
      events.push(ev);
    },
    flush(): Promise<void> {
      return Promise.resolve();
    },
  };
  return Object.assign(sink as unknown as AuditSinkType, { events });
}

/** 构造一个 codex json-rpc approval server request 行。 */
function approvalLine(
  id: number,
  method: string,
  params: Record<string, unknown>,
): string {
  return JSON.stringify({ jsonrpc: '2.0', id, method, params });
}

describe('task-17: batch Codex 审批接入 PolicyEngine 决策', () => {
  let fakeChild: ReturnType<typeof createFakeChild>;

  beforeEach(() => {
    mockAdapter = new JsonRpcAdapter('codex');
    vi.mocked(spawn).mockClear();
    fakeChild = createFakeChild();
    vi.mocked(spawn).mockImplementation(() => fakeChild as never);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('fileChange 写白名单内 → PolicyEngine allow → accept response', async () => {
    const cache = new PolicyCache();
    cache.set('rt-codex', ['/workspace/allowed']);
    const audit = makeInMemoryAuditSink();
    const engine = new PolicyEngine(cache, audit);

    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
      null,
      cache,
      engine,
    );

    const resultP = runner.runLease(makeLease());
    await waitForSpawn();

    // 推一个 fileChange approval（写白名单内路径）
    fakeChild._emitLines([
      approvalLine(50, 'item/fileChange/requestApproval', {
        item: { id: 'i1', type: 'fileChange', path: '/workspace/allowed/out.txt' },
      }),
      // codex 收尾信号
      '{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"status":"completed"}}}',
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    fakeChild._emitExit(0);
    await resultP;

    const stdin = readStdin(fakeChild);
    // 找到 id=50 的 response，断言 decision=accept
    const respMatch = stdin.match(/"id":50,"result":\{"decision":"(\w+)"\}/);
    expect(respMatch, `expected id=50 response in stdin: ${stdin}`).not.toBeNull();
    expect(respMatch![1]).toBe('accept');
  });

  it('fileChange 写越界 → PolicyEngine deny → decline response（含中文理由透传）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-codex', ['/workspace/allowed']);
    const audit = makeInMemoryAuditSink();
    const engine = new PolicyEngine(cache, audit);
    const client = makeMockClient();

    const runner = new TaskRunner(
      client as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
      null,
      cache,
      engine,
    );

    const resultP = runner.runLease(makeLease());
    await waitForSpawn();

    fakeChild._emitLines([
      approvalLine(51, 'item/fileChange/requestApproval', {
        item: { id: 'i2', type: 'fileChange', path: '/etc/evil.conf' },
      }),
      '{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"status":"completed"}}}',
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    fakeChild._emitExit(0);
    await resultP;

    const stdin = readStdin(fakeChild);
    const respMatch = stdin.match(/"id":51,"result":\{"decision":"(\w+)"\}/);
    expect(respMatch, `expected id=51 response in stdin: ${stdin}`).not.toBeNull();
    expect(respMatch![1]).toBe('decline');

    // deny 决策已记 audit（含中文 reason + 越界路径）
    const denyAudit = audit.events.find(
      (e) => e.decision === 'DENY' && String(e.path).includes('evil.conf'),
    );
    expect(denyAudit).toBeDefined();
    expect(String(denyAudit!.reason)).toContain('Runtime Policy 拒绝本次写入');
    expect(String(denyAudit!.reason)).toContain('evil.conf');
  });

  it('commandExecution 重定向越界 → extractShellWritePaths 提取后 deny → decline', async () => {
    const cache = new PolicyCache();
    cache.set('rt-codex', ['/workspace/allowed']);
    const audit = makeInMemoryAuditSink();
    const engine = new PolicyEngine(cache, audit);

    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
      null,
      cache,
      engine,
    );

    const resultP = runner.runLease(makeLease());
    await waitForSpawn();

    // 命令写越界：echo x > /etc/passwd
    fakeChild._emitLines([
      approvalLine(52, 'item/commandExecution/requestApproval', {
        item: { id: 'i3', type: 'commandExecution', command: 'echo x > /etc/passwd' },
      }),
      '{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"status":"completed"}}}',
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    fakeChild._emitExit(0);
    await resultP;

    const stdin = readStdin(fakeChild);
    const respMatch = stdin.match(/"id":52,"result":\{"decision":"(\w+)"\}/);
    expect(respMatch, `expected id=52 response in stdin: ${stdin}`).not.toBeNull();
    expect(respMatch![1]).toBe('decline');
  });

  it('PolicyEngine 未注入 → fail-closed decline', async () => {
    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
      null,
      null, // policyCache
      null, // policyEngine 未注入
    );

    const resultP = runner.runLease(makeLease());
    await waitForSpawn();

    fakeChild._emitLines([
      approvalLine(53, 'item/fileChange/requestApproval', {
        item: { id: 'i4', type: 'fileChange', path: '/workspace/x.txt' },
      }),
      '{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"status":"completed"}}}',
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    fakeChild._emitExit(0);
    await resultP;

    const stdin = readStdin(fakeChild);
    const respMatch = stdin.match(/"id":53,"result":\{"decision":"(\w+)"\}/);
    expect(respMatch, `expected id=53 response in stdin: ${stdin}`).not.toBeNull();
    expect(respMatch![1]).toBe('decline');
  });

  it('fileChange 无可识别路径字段 → fail-closed decline（§13 #9 降级）', async () => {
    const cache = new PolicyCache();
    cache.set('rt-codex', ['/workspace/allowed']);
    const audit = makeInMemoryAuditSink();
    const engine = new PolicyEngine(cache, audit);

    const runner = new TaskRunner(
      makeMockClient() as never,
      makeMockWorkspace() as never,
      makeMockCred() as never,
      makeConfig(),
      null,
      cache,
      engine,
    );

    const resultP = runner.runLease(makeLease());
    await waitForSpawn();

    // 无 path / change / grantRoot 字段（codex 实际 payload 字段未覆盖）
    fakeChild._emitLines([
      approvalLine(54, 'item/fileChange/requestApproval', {
        item: { id: 'i5', type: 'fileChange' },
      }),
      '{"jsonrpc":"2.0","method":"turn/completed","params":{"turn":{"status":"completed"}}}',
    ]);
    await new Promise<void>((r) => setTimeout(r, 50));
    fakeChild._emitExit(0);
    await resultP;

    const stdin = readStdin(fakeChild);
    const respMatch = stdin.match(/"id":54,"result":\{"decision":"(\w+)"\}/);
    expect(respMatch, `expected id=54 response in stdin: ${stdin}`).not.toBeNull();
    expect(respMatch![1]).toBe('decline');
  });
});
