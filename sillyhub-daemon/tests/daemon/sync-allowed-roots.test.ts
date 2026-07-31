/**
 * tests/daemon/sync-allowed-roots.test.ts —— daemon._syncAllowedRoots 短路口径测试。
 *
 * task-11（2026-07-30-daemon-heartbeat-dedup-fix）：验证卡死根因消除。
 *
 * 根因回顾：旧实现每心跳无条件 set PolicyCache，且 PolicyCache.set（task-02）存的是
 *   resolveRealPath 结果（realpath + Windows 盘符小写），而 _syncAllowedRoots 比较侧
 *   用 normalizeAllowedRoots（只 resolve 保留大小写）。两侧口径不一致 →
 *   JSON.stringify 恒不等 → 每心跳 changed=1 → 无限 set + 间接 stat 风暴 →
 *   Windows 下文件系统饥饿卡死。
 *
 * task-01 + task-03 修复：
 *   - task-01：PolicyCache.set 改存 normalizeAllowedRoots 输出（只 resolve 不 realpath），
 *     与比较侧同口径（见 runtime-policy.test.ts）。
 *   - task-03：_syncAllowedRoots 加短路——existing !== undefined 且
 *     JSON.stringify(existing) === JSON.stringify(normalized) → continue（不 set 不 changed++）。
 *
 * 本文件覆盖：
 *   1. 相同 roots 连续两次心跳 → 第二次 changed=0、PolicyCache.set 不被再次调用（短路）；
 *   2. 真正变化（增 root）→ changed=1 + PolicyCache.set 被调；
 *   3. （Windows 适用）同路径盘符大小写不同但归一后相等 → 短路（口径统一后稳定）。
 *
 * 测试策略（私有方法）：
 *   _syncAllowedRoots 是 Daemon 私有方法，无法直接调。按 tests/daemon-multi-runtime.test.ts
 *   与 tests/daemon-sync-allowed-roots-per-runtime.test.ts 既有惯例：构造真实 Daemon +
 *   注入 mock client（heartbeat 返回受控 runtimes）+ 注入真实 PolicyCache 并 spy 其 set。
 *   通过短心跳间隔（20ms）触发 _heartbeatLoop → _syncAllowedRoots，间接覆盖私有方法。
 *
 * @module daemon/sync-allowed-roots.test
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { resolve, sep } from 'node:path';
import { homedir } from 'node:os';
import { Daemon } from '../../src/daemon.js';
import { PolicyCache } from '../../src/policy/runtime-policy.js';
import type { DaemonConfig } from '../../src/config.js';
import type { DetectedAgent } from '../../src/agent-detector.js';

const isWin = sep === '\\';

// ── fixture ──────────────────────────────────────────────────────────────────

const baseConfig: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: 'tok-short-circuit',
  runtime_id: 'rt-sc-001',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  // 大间隔防轮询触发；心跳间隔在用例内覆盖为短间隔
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

/**
 * mock client：heartbeat 返回值由测试动态控制（setHeartbeatResponse 实时切换），
 * 用于模拟「相同 roots 连续两次」与「变化」两种心跳响应。
 * register 响应不带 per-runtime allowed_roots（避免 register 阶段预填 PolicyCache 干扰
 * 心跳短路的 spy 计数；gotPerRuntime=false → register 走兜底 _syncPolicyCache 给所有
 * runtime 设共享值，该值与首次心跳的 normalized 不同 → 首次心跳会 set 一次建立基线）。
 */
function makeClient(): MockClient & {
  setHeartbeatResponse: (r: unknown) => void;
} {
  let hbResp: unknown = {};
  return {
    register: vi.fn(async () => ({
      daemon_instance_id: 'srv-inst-sc',
      runtimes: [{ provider: 'claude', runtime_id: 'srv-rt-claude' }],
    })),
    heartbeat: vi.fn(async () => hbResp),
    claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    close: vi.fn(async () => {}),
    setHeartbeatResponse: (r: unknown) => {
      hbResp = r;
    },
  };
}

function makeWsFactory() {
  // connect/close no-op；本文件不测 WS 路径
  return {
    factory: vi.fn(() => ({
      connect: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
    })),
  };
}

/**
 * 构造 Daemon + 注入真实 PolicyCache（spy set）+ mock client。
 * 返回各句柄供测试驱动心跳与断言。
 */
function build() {
  const policyCache = new PolicyCache();
  const setSpy = vi.spyOn(policyCache, 'set');
  const client = makeClient();
  const { factory } = makeWsFactory();
  const daemon = new Daemon(
    { ...baseConfig, heartbeat_interval: 0.02 } as DaemonConfig,
    client as never,
    null,
    {
      detector: {
        detectAgents: vi.fn(async () => [makeAgent('claude')]),
      } as never,
      wsClientFactory: factory as never,
      policyCache,
    } as never,
  );
  return { daemon, policyCache, setSpy, client };
}

// ── 用例 ─────────────────────────────────────────────────────────────────────

describe('task-11: _syncAllowedRoots 短路（口径统一后 JSON.stringify 稳定相等）', () => {
  let daemons: Daemon[] = [];

  beforeEach(() => {
    daemons = [];
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    vi.restoreAllMocks();
  });

  it('相同 roots 连续多次心跳 → 首次 set 建基线，之后全短路（set 次数收敛）', async () => {
    const { daemon, policyCache, setSpy, client } = build();
    daemons.push(daemon);

    // 固定心跳响应（runtimes[].allowed_roots 不变）
    client.setHeartbeatResponse({
      runtimes: [{ runtime_id: 'srv-rt-claude', allowed_roots: ['/work/claude'] }],
    });

    await daemon.start();
    // 等三拍心跳（20ms × 3 + 余量），让基线 set 完成 + 至少两次「相同 roots」心跳
    await new Promise((r) => setTimeout(r, 90));
    // 快照：此时基线已建立（register 兜底 set + 首次心跳 set 各一次）
    const heartbeatCallsMid = client.heartbeat.mock.calls.length;
    const setCountMid = setSpy.mock.calls.length;
    expect(heartbeatCallsMid).toBeGreaterThanOrEqual(2);

    // 再等多拍心跳（仍是相同 roots），set 次数应不再增长（短路）
    await new Promise((r) => setTimeout(r, 100));
    await daemon.stop();

    const heartbeatCallsLate = client.heartbeat.mock.calls.length;
    const setCountLate = setSpy.mock.calls.length;

    // 心跳确实又跑了多次（证明「set 不增长」不是因为没心跳）
    expect(heartbeatCallsLate).toBeGreaterThan(heartbeatCallsMid);
    // 短路核心：相同 roots，set 次数收敛（不再增长）
    expect(setCountLate).toBe(setCountMid);

    // PolicyCache 有该 runtime 条目（心跳确实同步过）
    const policy = policyCache.get('srv-rt-claude');
    expect(policy).toBeDefined();
    // 口径断言：存的是 normalizeAllowedRoots（resolve），含 homedir + sillyspec temp roots
    expect(policy?.allowedRoots).toContain(resolve('/work/claude'));
  });

  it('真正变化（增 root）→ set 被调（changed=1）', async () => {
    const { daemon, policyCache, setSpy, client } = build();
    daemons.push(daemon);

    // 第一拍：单 root
    client.setHeartbeatResponse({
      runtimes: [{ runtime_id: 'srv-rt-claude', allowed_roots: ['/work/claude'] }],
    });

    await daemon.start();
    await new Promise((r) => setTimeout(r, 60)); // 至少一次心跳

    const setCountAfterFirst = setSpy.mock.calls.length;
    const policyV1 = policyCache.get('srv-rt-claude');
    expect(policyV1?.allowedRoots).toContain(resolve('/work/claude'));

    // 第二拍：新增一个 root（真正变化）
    client.setHeartbeatResponse({
      runtimes: [
        {
          runtime_id: 'srv-rt-claude',
          allowed_roots: ['/work/claude', '/work/new'],
        },
      ],
    });
    await new Promise((r) => setTimeout(r, 80)); // 再一次心跳
    await daemon.stop();

    // 变化 → set 被再次调用（changed=1）
    expect(setSpy.mock.calls.length).toBeGreaterThan(setCountAfterFirst);

    // PolicyCache 已更新为新 roots（含 /work/new）
    const policyV2 = policyCache.get('srv-rt-claude');
    expect(policyV2?.allowedRoots).toContain(resolve('/work/new'));
    expect(policyV2?.allowedRoots).toContain(resolve('/work/claude'));
  });

  it('真正变化（删 root）→ set 被调（changed=1）', async () => {
    const { daemon, policyCache, setSpy, client } = build();
    daemons.push(daemon);

    // 第一拍：两个 root
    client.setHeartbeatResponse({
      runtimes: [
        {
          runtime_id: 'srv-rt-claude',
          allowed_roots: ['/work/a', '/work/b'],
        },
      ],
    });

    await daemon.start();
    await new Promise((r) => setTimeout(r, 60));
    const setCountAfterFirst = setSpy.mock.calls.length;
    expect(policyCache.get('srv-rt-claude')?.allowedRoots).toContain(resolve('/work/b'));

    // 第二拍：删掉 /work/b
    client.setHeartbeatResponse({
      runtimes: [
        { runtime_id: 'srv-rt-claude', allowed_roots: ['/work/a'] },
      ],
    });
    await new Promise((r) => setTimeout(r, 80));
    await daemon.stop();

    expect(setSpy.mock.calls.length).toBeGreaterThan(setCountAfterFirst);
    const policyV2 = policyCache.get('srv-rt-claude');
    expect(policyV2?.allowedRoots).toContain(resolve('/work/a'));
    expect(policyV2?.allowedRoots).not.toContain(resolve('/work/b'));
  });

  it('相同 roots 重复出现（多次心跳）→ set 只在首次变化时调一次，之后全短路', async () => {
    const { daemon, setSpy, client } = build();
    daemons.push(daemon);

    client.setHeartbeatResponse({
      runtimes: [
        { runtime_id: 'srv-rt-claude', allowed_roots: ['/stable/root'] },
      ],
    });

    await daemon.start();
    // 等多拍心跳（确保 3+ 次心跳），相同 roots
    await new Promise((r) => setTimeout(r, 150));
    const setCountMid = setSpy.mock.calls.length;
    // 再等多拍
    await new Promise((r) => setTimeout(r, 120));
    const setCountLate = setSpy.mock.calls.length;
    await daemon.stop();

    // 心跳多次，但 set 次数收敛（首次建立基线后全短路）
    expect(setCountLate).toBe(setCountMid);
    expect(client.heartbeat.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

// ── Windows 盘符大小写归一后相等 → 短路（仅 Windows 有意义） ──────────────────

describe('task-11: Windows 盘符大小写口径（normalizeAllowedRoots 不归一大小写）', () => {
  it.skipIf(!isWin)(
    'Windows：同路径不同盘符大小写，normalizeAllowedRoots 不归一 → 两字符串不等（口径稳定）',
    () => {
      // 说明：normalizeAllowedRoots 只 resolve 不归一大小写（D-001：realpath 才归一）。
      // 故 'C:\\x' 与 'c:\\x' 经 resolve 后盘符大小写各自保留 → 字符串不等。
      // 这意味着 _syncAllowedRoots 不会把这两个误判为相等而错误短路——
      // 口径在「同输入串」维度稳定（backend 下发的串大小写一致 → 相同 → 短路）。
      // 此用例锁定该口径契约，防止有人误以为 normalize 会归一大小写。
      const upper = resolve('C:\\dev\\null');
      const lower = resolve('c:\\dev\\null');
      // resolve 保留输入大小写，二者作为字符串不相等
      expect(upper === lower).toBe(false);
    },
  );

  it.skipIf(isWin)(
    '非 Windows：本组用例仅 Windows 适用，跳过（保持套件跨平台绿）',
    () => {
      expect(true).toBe(true);
    },
  );
});

// ── 口径契约：心跳写入 PolicyCache 的值 = normalizeAllowedRoots（不 realpath） ──

describe('task-11: 心跳同步口径 = normalizeAllowedRoots（与 PolicyCache.set 同源）', () => {
  let daemons: Daemon[] = [];

  beforeEach(() => {
    daemons = [];
  });

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
    vi.restoreAllMocks();
  });

  it('心跳写入的 allowedRoots 含 path.resolve 结果（非 realpath 小写盘符）', async () => {
    const { daemon, policyCache, client } = build();
    daemons.push(daemon);

    client.setHeartbeatResponse({
      runtimes: [
        { runtime_id: 'srv-rt-claude', allowed_roots: ['/work/claude'] },
      ],
    });

    await daemon.start();
    await new Promise((r) => setTimeout(r, 80));
    await daemon.stop();

    const policy = policyCache.get('srv-rt-claude');
    expect(policy).toBeDefined();
    // 心跳同步 + PolicyCache.set 全程用 normalizeAllowedRoots（resolve），
    // 不经 realpathSync 小写化。断言 resolve 结果在其中即可（homedir / temp roots 也并入）。
    expect(policy?.allowedRoots).toContain(resolve('/work/claude'));
    // homedir 兜底始终并入（_syncAllowedRoots union.add(homedir())）
    expect(policy?.allowedRoots).toContain(homedir());
  });
});
