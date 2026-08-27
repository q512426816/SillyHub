/**
 * daemon-ws-stale-reap.test.ts —— _wsLoop 假活看门狗（2026-08-27 网络切换
 * WS 永久假连事故）。
 *
 * 事故形态：ws-client 状态机因旧 socket 事件串扰丢失 keepalive 后，网络切换
 * 的黑洞连接无 ping/pong 检测，isConnected 永真、重连永不触发——HTTP 心跳
 * 与会话 HTTP 兜底照常（「在线」假象），唯独 backend→daemon RPC（git-log/
 * explorer）持续 502。看门狗按 lastMessageAt（消息+pong）/ connectedAt 新鲜
 * 度强制关闭重建，是状态机任何未知漏洞的兜底自愈。
 *
 * 假件形态对齐 daemon-multi-runtime.test.ts（makeAgent/makeClient/detector），
 * wsClientFactory 换成 isConnected/lastMessageAt/connectedAt 可控的 fake。
 *
 * @module daemon-ws-stale-reap.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import { Daemon, WS_STALE_REAP_MS } from '../src/daemon.js';

// ── fixture ──────────────────────────────────────────────────────────────────

const baseConfig: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: 'tok-reap',
  runtime_id: 'rt-reap-001',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  // 大间隔防心跳/轮询循环在本测试中触发（只看 _wsLoop 每秒 reconcile）
  poll_interval: 9999,
  heartbeat_interval: 9999,
  max_concurrent_tasks: 5,
  log_level: 'info',
};

function makeAgent(provider: string): DetectedAgent {
  return {
    provider,
    path: '/usr/bin/agent',
    version: '1.2.3',
    protocol: 'stream_json',
    status: 'available',
    versionWarning: null,
  };
}

/** isConnected / lastMessageAt / connectedAt 可控的假 WsClient。 */
interface FakeWs {
  connect: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  isConnected: boolean;
  lastMessageAt: number | null;
  connectedAt: number | null;
}

interface BuildResult {
  daemon: Daemon;
  created: FakeWs[];
}

/** 构造 Daemon：单 agent 注册 + 可控假 WS 工厂（created 收集每次新建的实例）。 */
function build(): BuildResult {
  const created: FakeWs[] = [];
  const client = {
    register: vi.fn(async (params: { providers?: { provider: string }[] }) => ({
      daemon_instance_id: 'srv-inst-1',
      runtimes: (params.providers ?? []).map((p) => ({
        provider: p.provider,
        runtime_id: 'srv-rt-' + p.provider,
      })),
    })),
    heartbeat: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    close: vi.fn(),
  };
  const factory = vi.fn((opts: { callbacks: { onConnected?: () => void } }) => {
    const fake: FakeWs = {
      connect: vi.fn(() => opts.callbacks.onConnected?.()),
      close: vi.fn(),
      isConnected: false,
      lastMessageAt: null,
      connectedAt: null,
    };
    created.push(fake);
    return fake;
  });
  const daemon = new Daemon(baseConfig, client as never, null, {
    detector: { detectAgents: vi.fn(async () => [makeAgent('claude')]) } as never,
    wsClientFactory: factory as never,
  });
  return { daemon, created };
}

// ── 测试用例 ─────────────────────────────────────────────────────────────────

describe('daemon _wsLoop 假活看门狗（2026-08-27 事故回归）', () => {
  let holder: { daemon: Daemon } | null = null;

  beforeEach(() => {
    holder = null;
  });

  afterEach(async () => {
    if (holder?.daemon.isRunning) {
      await holder.daemon.stop().catch(() => undefined);
    }
    vi.restoreAllMocks();
  });

  it('isConnected 但 lastMessageAt 陈旧 ≥ WS_STALE_REAP_MS → 关闭重建（factory 二次调用）', async () => {
    const { daemon, created } = build();
    holder = { daemon };
    await daemon.start();
    // start 后 _ensureWsClient 已建第一条假 WS（对齐 daemon-multi-runtime 断言形态）
    await vi.waitFor(() => expect(created.length).toBe(1));
    // 假活形态：状态自称 Connected + 新鲜度陈旧（消息与 pong 均停）
    created[0].isConnected = true;
    created[0].lastMessageAt = Date.now() - WS_STALE_REAP_MS - 5_000;
    // 看门狗随 _wsLoop 每秒 reconcile 触发：关闭旧实例 + 下一拍重建
    await vi.waitFor(() => expect(created.length).toBe(2), { timeout: 5_000 });
    expect(created[0].close).toHaveBeenCalledTimes(1);
    // 新实例新鲜（lastMessageAt=null → fail-open，交给 keepalive 主判据）
    expect(created[1].close).not.toHaveBeenCalled();
  }, 12_000);

  it('isConnected 且 lastMessageAt=null 但 connectedAt 陈旧 → 同样重建（null 兜底锚点）', async () => {
    const { daemon, created } = build();
    holder = { daemon };
    await daemon.start();
    await vi.waitFor(() => expect(created.length).toBe(1));
    created[0].isConnected = true;
    created[0].lastMessageAt = null;
    created[0].connectedAt = Date.now() - WS_STALE_REAP_MS - 5_000;
    await vi.waitFor(() => expect(created.length).toBe(2), { timeout: 5_000 });
    expect(created[0].close).toHaveBeenCalledTimes(1);
  }, 12_000);

  it('新鲜度新鲜（lastMessageAt=now）→ 不误杀（3s 内 factory 仍 1 次）', async () => {
    const { daemon, created } = build();
    holder = { daemon };
    await daemon.start();
    await vi.waitFor(() => expect(created.length).toBe(1));
    created[0].isConnected = true;
    created[0].lastMessageAt = Date.now();
    await new Promise((r) => setTimeout(r, 3_000));
    expect(created.length).toBe(1);
    expect(created[0].close).not.toHaveBeenCalled();
  }, 12_000);

  it('lastMessageAt 与 connectedAt 双 null（mock 形态未知）→ fail-open 不动', async () => {
    const { daemon, created } = build();
    holder = { daemon };
    await daemon.start();
    await vi.waitFor(() => expect(created.length).toBe(1));
    created[0].isConnected = true;
    created[0].lastMessageAt = null;
    created[0].connectedAt = null;
    await new Promise((r) => setTimeout(r, 3_000));
    expect(created.length).toBe(1);
    expect(created[0].close).not.toHaveBeenCalled();
  }, 12_000);
});
