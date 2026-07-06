/**
 * tests/daemon-sync-allowed-roots-per-runtime.test.ts
 * 2026-07-06-allowed-roots-per-runtime task-09：daemon _syncAllowedRoots per-runtime。
 *
 * 验证：
 *   1. 心跳响应 runtimes map → PolicyCache 各 runtime 独立同步（CC/Hermes 不同 roots）
 *   2. 兼容旧响应（allowed_roots 单值 → 同步所有 runtime）
 *   3. register 响应 runtimes[].allowed_roots 初始化 PolicyCache（消除首次写窗口）
 */

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { PolicyCache } from '../src/policy/runtime-policy.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';

const baseConfig: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: 'tok',
  runtime_id: 'rt-daemon-001',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 9999,
  heartbeat_interval: 9999,
  max_concurrent_tasks: 5,
  log_level: 'info',
};

function makeAgent(provider: string): DetectedAgent {
  return {
    provider,
    path: '/usr/bin/agent',
    version: '1.0.0',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

function makeClient(heartbeatResp: unknown, registerResp?: unknown) {
  return {
    register: vi.fn(
      async () =>
        registerResp ?? {
          daemon_instance_id: 'inst-1',
          runtimes: [
            { provider: 'claude', runtime_id: 'rt-claude', allowed_roots: ['/work/cc'] },
            { provider: 'hermes', runtime_id: 'rt-hermes', allowed_roots: ['/work/hermes'] },
          ],
        },
    ),
    heartbeat: vi.fn(async () => heartbeatResp),
    claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    close: vi.fn(async () => {}),
  };
}

function makeWsFactory() {
  const factory = vi.fn(() => ({
    connect: vi.fn(async () => {}),
    close: vi.fn(async () => {}),
  }));
  return { factory };
}

describe('2026-07-06-allowed-roots-per-runtime task-09: _syncAllowedRoots per-runtime', () => {
  it('register 响应 runtimes[].allowed_roots 初始化 PolicyCache（CC≠Hermes）', async () => {
    const policyCache = new PolicyCache();
    const client = makeClient({});
    const { factory } = makeWsFactory();
    const daemon = new Daemon(baseConfig, client as never, null, {
      detector: {
        detectAgents: vi.fn(async () => [makeAgent('claude'), makeAgent('hermes')]),
      } as never,
      wsClientFactory: factory as never,
      policyCache,
    } as never);
    await daemon.start();
    await daemon.stop();
    // register 响应 per-runtime：CC/Hermes 各自独立值（隔离）
    expect(policyCache.get('rt-claude')?.allowedRoots).not.toEqual(
      policyCache.get('rt-hermes')?.allowedRoots,
    );
  });

  it('心跳 runtimes map → PolicyCache 各 runtime 独立', async () => {
    const policyCache = new PolicyCache();
    const client = makeClient({
      daemon_instance_id: 'inst-1',
      status: 'online',
      runtimes: [
        { runtime_id: 'rt-claude', allowed_roots: ['/work/cc'] },
        { runtime_id: 'rt-hermes', allowed_roots: ['/work/hermes'] },
      ],
    });
    const { factory } = makeWsFactory();
    const daemon = new Daemon(
      { ...baseConfig, heartbeat_interval: 0.02 },
      client as never,
      null,
      {
        detector: {
          detectAgents: vi.fn(async () => [makeAgent('claude'), makeAgent('hermes')]),
        } as never,
        wsClientFactory: factory as never,
        policyCache,
      } as never,
    );
    await daemon.start();
    await new Promise((r) => setTimeout(r, 80));
    await daemon.stop();
    // 心跳 map per-runtime：CC/Hermes 各自独立值（隔离）
    expect(policyCache.get('rt-claude')?.allowedRoots).not.toEqual(
      policyCache.get('rt-hermes')?.allowedRoots,
    );
  });

  it('兼容旧响应 allowed_roots 单值 → 同步所有 runtime', async () => {
    const policyCache = new PolicyCache();
    const client = makeClient({
      daemon_instance_id: 'inst-1',
      status: 'online',
      allowed_roots: ['/work/shared'],
    });
    const { factory } = makeWsFactory();
    const daemon = new Daemon(
      { ...baseConfig, heartbeat_interval: 0.02 },
      client as never,
      null,
      {
        detector: {
          detectAgents: vi.fn(async () => [makeAgent('claude'), makeAgent('hermes')]),
        } as never,
        wsClientFactory: factory as never,
        policyCache,
      } as never,
    );
    await daemon.start();
    await new Promise((r) => setTimeout(r, 80));
    await daemon.stop();
    // 旧单值共享：CC/Hermes 相同（兼容过渡期）
    expect(policyCache.get('rt-claude')?.allowedRoots).toEqual(
      policyCache.get('rt-hermes')?.allowedRoots,
    );
  });
});
