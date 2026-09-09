// tests/interactive-test-helpers.ts
// ql-20260909-011：interactive 桥接层测试共享三件套（daemon 构造 mock）。
// 从 daemon-agent-event-report.test.ts 抽出——跨 test 文件 import 会让被引
// 文件的 describe 连带执行（用例被复制跑两遍），故抽独立非 test 模块共享。

import { vi } from 'vitest';
import { tmpdir } from 'node:os';
import type { DaemonConfig } from '../src/config.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type { SessionState } from '../src/interactive/types.js';

export const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'info',
  allowed_roots: [tmpdir()],
};

/** mock hub-client：只关心 submitMessages，其余方法补空防 not-a-function。 */
export function createMockClient() {
  return {
    register: vi.fn(async () => ({})),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    leaseHeartbeat: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getPendingChangeWrites: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'run-default', claude_md: '' })),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
    getSpecBundle: vi.fn(async () => Buffer.alloc(0)),
    postSpecSync: vi.fn(async () => ({ ok: true, reparsed: 0 })),
    syncStatus: vi.fn(async () => ({})),
    recoverSession: vi.fn(async () => ({})),
    confirmReconnected: vi.fn(async () => ({})),
    markRecoveryFailed: vi.fn(async () => ({})),
    close: vi.fn(),
  };
}

/** mock SessionManager：get 按预置 state 返回（onTurnMessage 唯一依赖面）。 */
export function createMockSessionManager(
  stateMap: Map<string, Partial<SessionState>>,
): SessionManager {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    get: vi.fn((sid: string) => stateMap.get(sid) as Readonly<SessionState> | undefined),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    markRecoveredSessionFailed: vi.fn(async () => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    refreshClaimToken: vi.fn(async () => {}),
  };
  return sm as unknown as SessionManager;
}
