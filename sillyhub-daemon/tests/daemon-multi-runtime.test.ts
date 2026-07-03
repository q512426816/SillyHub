/**
 * daemon-multi-runtime.test.ts —— Python test_daemon_multi_runtime.py 1:1 迁移（task-22 P0-A2）。
 *
 * Python 源是规格（480 行 / 11 个用例）。聚焦 **daemon 多运行时注册循环**：
 *   start() → detectAgents → filter(available) → register each → tracked in _registeredRuntimes。
 *
 * **与现有 daemon.test.ts 的关系（R-08 去重）**：
 *   daemon.test.ts AC-01/AC-01b/AC-01c 已覆盖「逐个 register / 单失败不中断 / 无 agent 仍启动」
 *   三个**编排骨架**用例。本文件补 **Python 规范的细分断言**：
 *     - capabilities 4 字段（provider/version/protocol/bin_path）精确值
 *     - version null → 'unknown' fallback
 *     - _registeredRuntimes Map 内容（provider → server runtime_id）
 *     - runtime_id 由 server 分配（resp.id，TS 行为，非 Python 的 {base}--{name} 拼接）
 *     - providers set / call_count 精确验证
 *   三个核心编排场景（registers_each / single_failure / no_agents）在本文件重写一份带**细分断言**
 *   的版本（Python 规范的精确验证点，daemon.test.ts 只验证骨架）。
 *
 * **client_register_* 4 个用例**（Python test_daemon_multi_runtime.py:299-403）**不在本文件重复**：
 *   HubClient.register 的 body 条件拼装（runtimeId/protocol 省略逻辑）已由
 *   tests/hub-client.test.ts 的「register 条件 body 拼装」describe block 完整覆盖（4 个 it）。
 *   重复迁移违反 R-08。
 *
 * **TS vs Python 行为差异（Reverse Sync）**：
 *   1. runtime_id 格式：Python `{base}--{agent_name}` 客户端拼接；TS server 分配（resp.id）。
 *      test_daemon_runtime_id_format 调整为验证「server 返回的 id 被存入 _registeredRuntimes」。
 *   2. DetectedAgent 字段：Python name/available/bin_path；TS provider/status/path。
 *   3. capabilities.bin_path：TS 用 agent.path（真实字段名）。
 *
 * Mock 隔离（AC-04）：所有 vi.fn/spy 在 afterEach restoreAllMocks；daemon 实例 stop 后清理。
 *
 * @module daemon-multi-runtime.test
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { join, resolve } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { mkdirSync } from 'node:fs';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import { Daemon } from '../src/daemon.js';
import { PolicyCache } from '../src/policy/runtime-policy.js';
import type { WsClientCallbacks } from '../src/ws-client.js';

// ── fixture ──────────────────────────────────────────────────────────────────

const baseConfig: DaemonConfig = {
  server_url: 'http://localhost:8000',
  token: 'tok-multi',
  runtime_id: 'rt-base-001',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  // 大间隔防心跳/轮询循环在本测试中触发（本文件只测注册阶段）
  poll_interval: 9999,
  heartbeat_interval: 9999,
  max_concurrent_tasks: 5,
  log_level: 'info',
};

/** 构造 mock DetectedAgent（TS 字段名：provider/status/path）。对齐 Python _agent()。 */
function makeAgent(
  provider: string,
  opts: {
    available?: boolean;
    version?: string | null;
    protocol?: string;
    path?: string;
  } = {},
): DetectedAgent {
  const available = opts.available ?? true;
  return {
    provider,
    path: opts.path ?? (available ? '/usr/bin/agent' : ''),
    version: opts.version === undefined ? '1.2.3' : opts.version,
    protocol: opts.protocol ?? 'stream_json',
    status: available ? 'available' : 'unavailable',
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
 * Per-daemon register 契约（2026-07-03-daemon-entity-binding task-05）：
 * daemon.start() 收集所有 available agents 后**单次**调 register，body 含
 * daemon_local_id + providers 列表；resp 返 daemon_instance_id + runtimes[]。
 * _registeredRuntimes 由 resp.runtimes 填充（provider → runtime_id）。
 *
 * 默认 register mock：根据入参 providers 生成 per-daemon 响应。
 */
function perDaemonRegisterResp(
  params: { providers?: { provider: string }[] } | undefined,
): { daemon_instance_id: string; runtimes: { provider: string; runtime_id: string }[] } {
  const providers = params?.providers ?? [];
  return {
    daemon_instance_id: 'srv-inst-1',
    runtimes: providers.map((p) => ({
      provider: p.provider,
      runtime_id: 'srv-rt-' + p.provider,
    })),
  };
}

function makeClient(registerImpl?: ReturnType<typeof vi.fn>): MockClient {
  return {
    register:
      registerImpl ?? vi.fn(async (params: { providers?: { provider: string }[] }) => perDaemonRegisterResp(params)),
    heartbeat: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    close: vi.fn(),
  };
}

function makeDetector(agents: DetectedAgent[]): {
  detector: { detectAgents: ReturnType<typeof vi.fn> };
} {
  return { detector: { detectAgents: vi.fn(async () => agents) } };
}

/** mock WsClient：connect/close 是 no-op，捕获 callbacks（daemon.start 时注入）。 */
function makeWsFactory(): {
  factory: (opts: { callbacks: WsClientCallbacks }) => { connect: () => void; close: () => void };
} {
  return {
    factory: vi.fn((opts: { callbacks: WsClientCallbacks }) => ({
      connect: () => {
        opts.callbacks.onConnected?.();
      },
      close: () => {
        opts.callbacks.onDisconnected?.(1000, 'close');
      },
    })),
  };
}

/** 构造 Daemon + 注入所有 mock。返回 daemon + client 供断言。 */
function build(opts: {
  agents: DetectedAgent[];
  client?: MockClient;
  config?: Partial<DaemonConfig>;
}): { daemon: Daemon; client: MockClient } {
  const client = opts.client ?? makeClient();
  const { detector } = makeDetector(opts.agents);
  const { factory } = makeWsFactory();
  const config = { ...baseConfig, ...(opts.config ?? {}) };
  const daemon = new Daemon(config, client as never, null, {
    detector: detector as never,
    wsClientFactory: factory as never,
  });
  return { daemon, client };
}

// ── 测试用例（对齐 Python test_daemon_multi_runtime.py）────────────────────────

describe('daemon multi-runtime registration (test_daemon_multi_runtime.py)', () => {
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

  // Python test_daemon_registers_each_available_agent（per-daemon：单次调用）
  it('registers_each_available_agent: 2 available + 1 unavailable → register 单次，providers={claude,codex}', async () => {
    const agents = [
      makeAgent('claude', { version: '2.0.1', protocol: 'stream_json' }),
      makeAgent('codex', { version: '0.120.0', protocol: 'json_rpc' }),
      makeAgent('copilot', { available: false }),
    ];
    const { daemon, client } = build({ agents });
    daemons.push(daemon);

    await daemon.start();
    await daemon.stop();

    // per-daemon：register 只调 1 次（整批上报），unavailable 的 copilot 被过滤
    expect(client.register).toHaveBeenCalledTimes(1);
    const params = client.register.mock.calls[0]![0] as {
      providers: { provider: string }[];
    };
    const providers = new Set(params.providers.map((p) => p.provider));
    expect(providers).toEqual(new Set(['claude', 'codex']));
  });

  // Python test_daemon_runtime_id_format（per-daemon：resp.runtimes 分配 server runtime_id）
  it('runtime_id_from_server: resp.runtimes 由 server 分配，providers 含 [claude,gemini]', async () => {
    const agents = [
      makeAgent('claude', { version: '3.0.0' }),
      makeAgent('gemini', { version: '1.0.0' }),
    ];
    // 单次返回 per-daemon 响应（daemon_instance_id + runtimes[]）
    const client = makeClient(
      vi.fn(async () => ({
        daemon_instance_id: 'srv-inst',
        runtimes: [
          { provider: 'claude', runtime_id: 'srv-claude-xyz' },
          { provider: 'gemini', runtime_id: 'srv-gemini-abc' },
        ],
      })),
    );
    const { daemon } = build({ agents, client, config: { runtime_id: 'rt-abc' } });
    daemons.push(daemon);

    await daemon.start();
    await daemon.stop();

    // per-daemon：register 只调 1 次
    expect(client.register).toHaveBeenCalledTimes(1);
    const params = client.register.mock.calls[0]![0] as {
      providers: { provider: string }[];
    };
    // 上报 providers 含 claude + gemini（client 不拼 runtime_id，server 分配）
    expect(params.providers.map((p) => p.provider).sort()).toEqual(['claude', 'gemini']);
  });

  // Python test_daemon_no_agents_detected
  it('no_agents_detected: 全 unavailable → register 0 次，daemon 正常启动+停止', async () => {
    const agents = [
      makeAgent('claude', { available: false }),
      makeAgent('codex', { available: false }),
    ];
    const { daemon, client } = build({ agents });
    daemons.push(daemon);

    await daemon.start();
    expect(client.register).not.toHaveBeenCalled();
    await daemon.stop();
    // 走到这里说明没崩
    expect(daemon.isRunning).toBe(false);
  });

  // Python test_daemon_single_registration_failure_continues
  // per-daemon：整体 register 是一次调用，"per-provider 单失败不中断" 语义不再适用。
  // _registerDaemon 整体失败时 catch + warn（daemon_register_failed），不抛、daemon 仍启动。
  it('register_failure_logged_not_throwing: register reject → daemon.start 仍 resolve，不抛', async () => {
    const agents = [
      makeAgent('claude', { version: '2.0.0' }),
      makeAgent('codex', { version: '0.100.0' }),
    ];
    const client = makeClient(vi.fn(async () => {
      throw new Error('network error');
    }));
    const { daemon } = build({ agents, client });
    daemons.push(daemon);

    // register 整体失败被吞，daemon.start() 仍 resolve（不抛）
    await expect(daemon.start()).resolves.not.toThrow();
    await daemon.stop();

    // 整体 register 只尝试 1 次（per-daemon 单次调用）
    expect(client.register).toHaveBeenCalledTimes(1);
  });

  // Python test_daemon_registers_with_capabilities
  // capabilities 字段已移除（per-daemon body 用 providers[].version/status），语义不存在 → 删除该用例。
  //（原 test_daemon_registers_with_capabilities 断言 capabilities 4 字段精确值，per-daemon 后不再上报。）

  // Python test_daemon_tracks_registered_runtimes
  // task-07 / D-006：心跳合并为单条 per-daemon（带 daemon_local_id + providers 列表）。
  // start 后等一拍短心跳，heartbeat 单次调用，首参为 daemon_local_id（= config.runtime_id），
  // 第二参 providers 含所有已注册 provider。
  it('tracks_registered_runtimes: 2 agent 注册后单条心跳带 daemon_local_id + providers', async () => {
    const agents = [
      makeAgent('claude', { version: '2.0.0' }),
      makeAgent('codex', { version: '0.100.0' }),
    ];
    const client = makeClient(
      vi.fn(async () => ({
        daemon_instance_id: 'srv-inst',
        runtimes: [
          { provider: 'claude', runtime_id: 'srv-rt-claude' },
          { provider: 'codex', runtime_id: 'srv-rt-codex' },
        ],
      })),
    );
    const { daemon } = build({
      agents,
      client,
      config: { runtime_id: 'rt-test', heartbeat_interval: 0.02 },
    });
    daemons.push(daemon);

    await daemon.start();
    // 等一拍心跳（20ms）
    await new Promise((r) => setTimeout(r, 60));
    await daemon.stop();

    // 心跳被调（次数 >= 1），首参为 daemon_local_id（config.runtime_id，非 server runtime id）
    expect(client.heartbeat).toHaveBeenCalled();
    const calls = client.heartbeat.mock.calls as [string, { provider: string; status?: string }[]][];
    for (const [daemonLocalId, providers] of calls) {
      expect(daemonLocalId).toBe('rt-test');
      // providers 含两个 provider（claude + codex）
      const providerNames = providers.map((p) => p.provider).sort();
      expect(providerNames).toEqual(['claude', 'codex']);
    }
    // 旧 per-runtime 调用（首参为 srv-rt-*）不应再出现
    const firstArgs = calls.map((c) => c[0]);
    expect(firstArgs).not.toContain('srv-rt-claude');
    expect(firstArgs).not.toContain('srv-rt-codex');
  });

  // Python test_daemon_version_unknown_when_null
  // per-daemon：version 现在在 providers[].version。daemon 不再 fallback 'unknown'
  //（design：backend 用 None）。agent.version=null → providers[0].version 为 undefined。
  it('version_unknown_when_null: agent.version=null → providers[0].version 为 undefined（daemon 不 fallback）', async () => {
    const agents = [makeAgent('claude', { version: null })];
    const { daemon, client } = build({ agents });
    daemons.push(daemon);

    await daemon.start();
    await daemon.stop();

    expect(client.register).toHaveBeenCalledTimes(1);
    const params = client.register.mock.calls[0]![0] as {
      providers: { provider: string; version?: string }[];
    };
    // daemon _registerDaemon 用 `version: a.version ?? undefined`（不 fallback 'unknown'）
    expect(params.providers[0]!.provider).toBe('claude');
    expect(params.providers[0]!.version).toBeUndefined();
  });

  // task-07 / D-006 / design §5.5：单 WS 收敛——一个 daemon 对 backend 只开一条 WS，
  // 连接身份 = daemon_local_id（config.runtime_id），不再 per-provider 各建。
  it('ws_uses_daemon_local_id: 单条 WS，身份为 daemon_local_id（非 per-provider runtime_id）', async () => {
    const agents = [
      makeAgent('claude', { version: '2.0.0' }),
      makeAgent('codex', { version: '0.100.0' }),
    ];
    const client = makeClient();
    const wsRuntimeIds: string[] = [];
    const factory = vi.fn(
      (opts: { runtimeId: string; callbacks: WsClientCallbacks }) => {
        wsRuntimeIds.push(opts.runtimeId);
        return {
          connect: vi.fn(),
          close: vi.fn(),
          registerRpcHandler: vi.fn(),
        };
      },
    );
    const config = { ...baseConfig, runtime_id: 'local-config-id' };
    const daemon = new Daemon(config, client as never, null, {
      detector: { detectAgents: vi.fn(async () => agents) } as never,
      wsClientFactory: factory as never,
    });
    daemons.push(daemon);

    await daemon.start();
    await new Promise((r) => setTimeout(r, 50));
    await daemon.stop();

    // 单条 WS（factory 仅被调一次），身份 = daemon_local_id（config.runtime_id）
    expect(factory).toHaveBeenCalledTimes(1);
    expect(wsRuntimeIds).toEqual(['local-config-id']);
    // server 分配的 per-provider runtime id 不应作为 WS 身份
    expect(wsRuntimeIds).not.toContain('srv-rt-claude');
    expect(wsRuntimeIds).not.toContain('srv-rt-codex');
  });

  // 2026-07-03-daemon-entity-binding：allowed_roots 上提到 daemon_instance 级（design §4.2）。
  // HEAD 心跳路径：单条心跳（daemon_local_id + providers）→ resp.allowed_roots 写到
  // config.allowed_roots（_syncAllowedRoots 单值，不再 per-runtime PolicyCache）。
  // per-runtime 隔离语义在新模型下已不存在（一个 daemon 一份 allowed_roots）。
  it('heartbeat_syncs_allowed_roots_per_daemon: 心跳 resp.allowed_roots 写入 config.allowed_roots（展开 ~/.sillyhub + homedir 兜底）', async () => {
    const daemonRoot = join(tmpdir(), 'sillyhub-entity-binding-hb');
    mkdirSync(daemonRoot, { recursive: true });

    const policyCache = new PolicyCache();
    // 初始 config.allowed_roots（验证心跳会覆盖它，而非保留）
    const initialAllowedRoots = [homedir()];

    const agents = [
      makeAgent('claude', { version: '2.0.0' }),
      makeAgent('codex', { version: '0.100.0' }),
    ];
    // HEAD：单条心跳（daemonLocalId, providers）→ 单个 resp，allowed_roots 是 daemon 级单值。
    // 不再按 rid 分支（heartbeat 入参是 daemonLocalId = config.runtime_id = 'rt-base-001'）。
    const client: MockClient = {
      register: vi.fn(async (params: { providers?: { provider: string }[] }) => perDaemonRegisterResp(params)),
      heartbeat: vi.fn(async () => ({ allowed_roots: [daemonRoot] })),
      claimLease: vi.fn(async () => ({ claim_token: 'tok', payload: {} })),
      startLease: vi.fn(async () => ({})),
      completeLease: vi.fn(async () => ({})),
      getPendingLeases: vi.fn(async () => []),
      close: vi.fn(),
    };
    const factory = vi.fn(
      (opts: { runtimeId: string; callbacks: WsClientCallbacks }) => ({
        connect: vi.fn(() => opts.callbacks.onConnected?.()),
        close: vi.fn(() => opts.callbacks.onDisconnected?.(1000, 'close')),
        registerRpcHandler: vi.fn(),
      }),
    );
    const config: DaemonConfig = {
      ...baseConfig,
      allowed_roots: initialAllowedRoots,
      heartbeat_interval: 0.02,
    };
    const daemon = new Daemon(config, client as never, null, {
      detector: { detectAgents: vi.fn(async () => agents) } as never,
      wsClientFactory: factory as never,
      policyCache,
    });
    daemons.push(daemon);

    await daemon.start();
    // 等一拍心跳（20ms，确保心跳触发）
    await new Promise((r) => setTimeout(r, 60));
    await daemon.stop();

    // 断言 1（HEAD 核心）：心跳 resp.allowed_roots 写入 config.allowed_roots（per-daemon 单值），
    // 含 daemonRoot + homedir 兜底（_syncAllowedRoots 展开 + normalize）。
    // 注意：_syncAllowedRoots → normalizeAllowedRoots 用 path.resolve 规范化（非
    // resolveRealPath 的 realpathSync，后者会小写化 Windows 盘符），故断言也用 resolve 对齐。
    expect(config.allowed_roots).toContain(resolve(daemonRoot));
    expect(config.allowed_roots).toContain(homedir());
    // 心跳确实覆盖了初始值（initialAllowedRoots 仅 [homedir]，现多了 daemonRoot）
    expect(config.allowed_roots.length).toBeGreaterThanOrEqual(2);

    // 断言 2（HEAD）：心跳路径不再写 PolicyCache（PolicyCache 仅由 WS POLICY_UPDATE 推送填）。
    // claude/codex 两个 server runtime_id 都无 PolicyCache 条目。
    expect(policyCache.get('srv-rt-claude')).toBeUndefined();
    expect(policyCache.get('srv-rt-codex')).toBeUndefined();
  });
});
