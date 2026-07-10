/**
 * tests/policy/daemon-policy-update.test.ts —— task-13（2026-07-02-daemon-filesystem-policy / D-004）。
 *
 * 验证 daemon 注册的 onPolicyUpdate 回调：
 *   1. 收到 POLICY_UPDATE → PolicyCache.set 被调（sub-second 热更新）；
 *   2. version 去重（R-07）：新 version 写入，旧/重复 version 忽略；
 *   3. _policyCache 为 null（旧测试场景）→ no-op 不抛错。
 *
 * 不在此文件覆盖：ws-client 层 payload 解析（见 ws-client.test.ts 的 policy_update 用例），
 * 心跳兜底 _syncAllowedRoots（见 daemon-multi-runtime.test.ts）。
 *
 * @module daemon-policy-update.test
 */

import { describe, it, expect, vi } from 'vitest';
import { Daemon } from '../../src/daemon.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import { resolveRealPath } from '../../src/policy/path-utils.js';
import type { DaemonConfig } from '../../src/config.js';
import type { DetectedAgent } from '../../src/agent-detector.js';
import type { WsClientCallbacks } from '../../src/ws-client.js';

// ── fixture ──────────────────────────────────────────────────────────────────

const baseConfig: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: 'tok-policy',
  runtime_id: 'rt-base-001',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  // 大间隔防心跳/轮询触发（本文件只测 WS POLICY_UPDATE 路径）
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

interface MockClient {
  register: ReturnType<typeof vi.fn>;
  heartbeat: ReturnType<typeof vi.fn>;
  claimLease: ReturnType<typeof vi.fn>;
  startLease: ReturnType<typeof vi.fn>;
  completeLease: ReturnType<typeof vi.fn>;
  getPendingLeases: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
}

function makeClient(): MockClient {
  return {
    // 2026-07-03-daemon-entity-binding：register 是 per-daemon 单次调用，resp 是
    // { daemon_instance_id, runtimes: [{provider, runtime_id}] }（不是 origin 的 {id}）。
    // _registeredRuntimes 由 resp.runtimes 填充 → _ensureWsClient 才会建 WS →
    // onPolicyUpdate callback 才会被注入（factory 才被调）。
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst-claude',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rt-claude' }],
    })),
    heartbeat: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    close: vi.fn(),
  };
}

/**
 * mock WsClient factory：捕获 daemon 注入的 callbacks（含 onPolicyUpdate），
 * 测试通过 captured.onPolicyUpdate 直接触发回调。
 */
function makeWsFactory(): {
  factory: (opts: { callbacks: WsClientCallbacks }) => {
    connect: () => void;
    close: () => void;
  };
  captured: () => WsClientCallbacks | undefined;
} {
  let captured: WsClientCallbacks | undefined;
  const factory = vi.fn((opts: { callbacks: WsClientCallbacks }) => {
    captured = opts.callbacks;
    return {
      connect: () => opts.callbacks.onConnected?.(),
      close: () => opts.callbacks.onDisconnected?.(1000, 'close'),
    };
  });
  return { factory, captured: () => captured };
}

async function buildAndStart(policyCache: PolicyCache | null) {
  const client = makeClient();
  const { factory, captured } = makeWsFactory();
  const daemon = new Daemon(
    baseConfig,
    client as never,
    null,
    {
      detector: { detectAgents: vi.fn(async () => [makeAgent('claude')]) } as never,
      wsClientFactory: factory as never,
      policyCache,
    } as never,
  );
  await daemon.start();
  await daemon.stop();
  return { daemon, captured, client };
}

// ── 用例 ─────────────────────────────────────────────────────────────────────

describe('task-13: daemon onPolicyUpdate → PolicyCache', () => {
  it('收到新 version POLICY_UPDATE → PolicyCache.set 写入（规范化 + version 续递增）', async () => {
    const policyCache = new PolicyCache();
    const { captured } = await buildAndStart(policyCache);

    const cbs = captured();
    expect(cbs?.onPolicyUpdate).toBeInstanceOf(Function);
    // 触发回调（模拟 ws-client 收到 POLICY_UPDATE 后调用）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/work/a', '/work/b'], 5);

    const policy = policyCache.get('srv-rt-claude');
    expect(policy).toBeDefined();
    expect(policy?.allowedRoots).toEqual([
      resolveRealPath('/work/a'),
      resolveRealPath('/work/b'),
    ]);
    // ql-20260710 预存债：register 兜底 _syncPolicyCache（daemon.ts:982，b42cd130）在
    // buildAndStart 阶段预填 1 次 → version 基线 1；onPolicyUpdate 写 1 次 → version=2。
    expect(policy?.version).toBe(2);
  });

  it('R-07 version 去重：先收 version=5 再收 version=3，后者不覆盖', async () => {
    const policyCache = new PolicyCache();
    const { captured } = await buildAndStart(policyCache);
    const cbs = captured();

    // 先收新 version=5（写入 rootsA）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/work/A'], 5);
    // 再收旧 version=3（乱序/重放，应忽略，rootsB 不写入）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/work/B'], 3);

    const policy = policyCache.get('srv-rt-claude');
    // 仍是 rootsA（version=5 那次的值）
    expect(policy?.allowedRoots).toEqual([resolveRealPath('/work/A')]);
    // ql-20260710 预存债：register 预填 1 + version=5 写入 1 = version=2；
    // version=3 被去重跳过（去重逻辑正确，仅基线多 1）。
    expect(policy?.version).toBe(2);
  });

  it('R-07 version 单调：1 → 2 → 3 都写入，version=2 重复忽略', async () => {
    const policyCache = new PolicyCache();
    const { captured } = await buildAndStart(policyCache);
    const cbs = captured();

    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/v1'], 1);
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/v2'], 2);
    // 重复 version=2（应忽略）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/v2-dup'], 2);
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/v3'], 3);

    const policy = policyCache.get('srv-rt-claude');
    // 最新值 /v3（/v2-dup 被去重跳过）
    expect(policy?.allowedRoots).toEqual([resolveRealPath('/v3')]);
    // ql-20260710 预存债：register 预填 1 + v1/v2/v3 各写 1 = version=4；v2-dup 被去重跳过。
    expect(policy?.version).toBe(4);
  });

  it('per-runtime 隔离：不同 rid 的 version 独立去重', async () => {
    const policyCache = new PolicyCache();
    const { captured } = await buildAndStart(policyCache);
    const cbs = captured();

    // claude 收 version=2，codex 收 version=1（各自独立序列）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/claude'], 2);
    cbs?.onPolicyUpdate?.('srv-rt-codex', ['/codex'], 1);
    // claude 旧 version=1（应忽略，因 claude 已见 2）
    cbs?.onPolicyUpdate?.('srv-rt-claude', ['/claude-old'], 1);

    expect(policyCache.get('srv-rt-claude')?.allowedRoots).toEqual([
      resolveRealPath('/claude'),
    ]);
    expect(policyCache.get('srv-rt-codex')?.allowedRoots).toEqual([
      resolveRealPath('/codex'),
    ]);
  });

  it('空 allowed_roots 合法（admin 清空策略）→ 写入空数组', async () => {
    const policyCache = new PolicyCache();
    const { captured } = await buildAndStart(policyCache);
    const cbs = captured();

    cbs?.onPolicyUpdate?.('srv-rt-claude', [], 1);

    const policy = policyCache.get('srv-rt-claude');
    expect(policy).toBeDefined();
    expect(policy?.allowedRoots).toEqual([]);
  });

  it('_policyCache 为 null（未注入）→ no-op 不抛错', async () => {
    // 旧测试场景：DaemonOptions.policyCache 缺省 → null
    const { captured } = await buildAndStart(null);
    const cbs = captured();
    expect(() => {
      cbs?.onPolicyUpdate?.('srv-rt-claude', ['/a'], 1);
    }).not.toThrow();
  });
});
