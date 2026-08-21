// tests/daemon-session-switch-config.test.ts
// task-09（2026-08-14-sessions-portal / FR-05 / D-012@v1 / design §5 Wave2、§7.2）：
// daemon._handleWsMessage 收到 SESSION_SWITCH_CONFIG WS 消息后，必须调
// sessionManager.markPendingConfigSwitch(sessionId, payload)（task-08 实现）。
//
// 本文件 ONLY 测 daemon.ts 的 WS 分发接线（handler → markPendingConfigSwitch
// 调用契约），reload 空闲/生成中分支 + reloadWithConfig 见 session-manager
// 系列测试（task-08）。覆盖：
//   - snake_case / camelCase payload 归一化后构造 SessionSwitchConfigPayload 透传
//   - profile=null / provider_config=null（不切语义，design §7.2）透传 null
//   - 缺 run_id / claim_token → warn 丢弃不调；prompt 空串=静默切换正常路由（ql-20260817-011）
//   - 缺 session_id → warn 丢弃不调
//   - session 不在 SessionStore（迟到/重放）→ warn 丢弃不调（口径同 SESSION_INJECT）
//   - markPendingConfigSwitch 抛 SessionNotFoundError → best-effort warn 不崩
//   - 无 sessionManager → warn 不抛
//   - 与 SESSION_INJECT 并存互不干扰（各自路由互不串线）
//
// 注：消息类型常量 SESSION_SWITCH_CONFIG_MSG 定义在 daemon.ts 模块级（task-05
// backend 侧落地后升格 protocol.ts MSG），测试用同值字面量（'daemon:session_switch_config'）
// 锁定 wire 契约。

import { describe, it, expect, afterEach, vi } from 'vitest';
import { Daemon } from '../src/daemon.js';
import { MSG } from '../src/protocol.js';
import type { DaemonConfig } from '../src/config.js';
import type { DetectedAgent } from '../src/agent-detector.js';
import type { ProviderConfig } from '../src/types.js';
import type { SessionManager } from '../src/interactive/session-manager.js';
import type {
  SessionSwitchConfigPayload,
  SessionState,
} from '../src/interactive/types.js';

// 与 daemon.ts 模块级 SESSION_SWITCH_CONFIG_MSG 逐字对齐（wire 契约锁定）。
const SESSION_SWITCH_CONFIG_MSG = 'daemon:session_switch_config';

const mockConfig: DaemonConfig = {
  server_url: 'http://127.0.0.1:8000',
  token: 'test-token',
  runtime_id: 'runtime-uuid-123',
  profile: 'default',
  workspace_dir: '/tmp/ws',
  poll_interval: 0.02,
  heartbeat_interval: 0.02,
  max_concurrent_tasks: 5,
  log_level: 'debug',
};

function createMockClient() {
  return {
    register: vi.fn(async () => ({ id: 'srv-rid-1' })),
    heartbeat: vi.fn(async () => ({})),
    markOffline: vi.fn(async () => ({})),
    claimLease: vi.fn(async () => ({ claim_token: 't', payload: {} })),
    startLease: vi.fn(async () => ({})),
    completeLease: vi.fn(async () => ({})),
    getPendingLeases: vi.fn(async () => []),
    getExecutionContext: vi.fn(async () => ({ agent_run_id: 'r' })),
    close: vi.fn(),
    notifyRunResult: vi.fn(async () => ({})),
    submitMessages: vi.fn(async () => ({})),
    notifySessionEnd: vi.fn(async () => ({})),
  };
}

function createMockTaskRunner() {
  return { runLease: vi.fn(async () => ({})) };
}

/** mock SessionManager：markPendingConfigSwitch / inject / get 均为 spy。 */
function createMockSessionManager(
  sessionState?: SessionState,
  markImpl?: (sessionId: string, payload: SessionSwitchConfigPayload) => void,
): SessionManager & {
  markPendingConfigSwitch: ReturnType<typeof vi.fn>;
  inject: ReturnType<typeof vi.fn>;
  refreshClaimToken: ReturnType<typeof vi.fn>;
} {
  const sm = {
    create: vi.fn(async () => {}),
    inject: vi.fn(async () => ({ runId: '' })),
    interrupt: vi.fn(async () => false),
    end: vi.fn(async () => {}),
    fail: vi.fn(async () => {}),
    // 默认返回给定 state（undefined=模拟 session 不在 store）。
    get: vi.fn(() => sessionState),
    start: vi.fn(() => {}),
    stop: vi.fn(() => {}),
    manualApproval: false,
    getPermissionResolver: vi.fn(() => undefined),
    getPendingInjectCount: vi.fn(() => 0),
    getIdleTimeoutSec: vi.fn(() => 1800),
    refreshClaimToken: vi.fn(async () => {}),
    restoreAndReconnect: vi.fn(async () => {}),
    markReconnected: vi.fn(async () => {}),
    // 默认 no-op；测试可覆盖为抛错模拟 SessionNotFoundError 场景。
    markPendingConfigSwitch: vi.fn(markImpl ?? (() => {})),
    flush: vi.fn(async () => {}),
    snapshotPersistable: vi.fn(() => []),
    scanOnce: vi.fn(async () => {}),
  };
  return sm as unknown as SessionManager & {
    markPendingConfigSwitch: ReturnType<typeof vi.fn>;
    inject: ReturnType<typeof vi.fn>;
    refreshClaimToken: ReturnType<typeof vi.fn>;
  };
}

/** 构造最小 SessionState（SESSION_INJECT 校验用 leaseId）。 */
function makeState(sessionId: string, leaseId: string): SessionState {
  return {
    sessionId,
    leaseId,
    claimToken: 'old-token',
    status: 'active',
  } as unknown as SessionState;
}

function buildDaemon(sm: SessionManager | null = createMockSessionManager()): {
  daemon: Daemon;
  sm: SessionManager;
} {
  const detector = { detectAgents: vi.fn(async () => [] as DetectedAgent[]) };
  const daemon = new Daemon(
    mockConfig,
    createMockClient() as never,
    createMockTaskRunner() as never,
    { detector, sessionManager: sm } as never,
  );
  return { daemon, sm: sm as SessionManager };
}

async function emit(daemon: Daemon, msg: {
  type: string;
  payload: unknown;
}): Promise<void> {
  // _handleWsMessage 是 private；通过 unknown 透传调用（同 resume-route 测试）。
  const handle = (
    daemon as unknown as {
      _handleWsMessage: (m: { type: string; payload: unknown }) => Promise<void>;
    }
  )._handleWsMessage.bind(daemon);
  await handle(msg);
}

/** 等 void Promise 分发（fire-and-forget catch 链）settle。 */
async function flushMicro(): Promise<void> {
  await new Promise((r) => setTimeout(r, 5));
}

const SESSION_ID = 'sess-switch-1';
const LEASE_ID = 'lease-switch-1';
const RUN_ID = 'run-switch-9';
const CLAIM_TOKEN = 'claim-token-new';

const SAMPLE_PROFILE = {
  systemPrompt: '你是新人格',
  mcpRefs: ['mcp-a'],
  skillRefs: ['skill-b'],
};

const SAMPLE_PROVIDER_CONFIG: ProviderConfig = {
  agent_kind: 'claude',
  base_url: 'https://api.anthropic.example',
  api_key: 'sk-test-secret',
  auth_field: 'ANTHROPIC_AUTH_TOKEN',
  model: 'claude-sonnet-4',
};

describe('task-09 / FR-05 / D-012@v1: daemon SESSION_SWITCH_CONFIG WS handler 接线', () => {
  let daemons: Daemon[] = [];

  afterEach(async () => {
    for (const d of daemons) {
      if (d.isRunning) {
        await d.stop().catch(() => undefined);
      }
    }
    daemons = [];
  });

  it('snake_case payload → markPendingConfigSwitch(sessionId, payload) 被调一次且逐字段透传', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '用新配置继续',
        profile: SAMPLE_PROFILE,
        provider_config: SAMPLE_PROVIDER_CONFIG,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(1);
    expect(sm.markPendingConfigSwitch).toHaveBeenCalledWith(SESSION_ID, {
      sessionId: SESSION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      prompt: '用新配置继续',
      profile: SAMPLE_PROFILE,
      providerConfig: SAMPLE_PROVIDER_CONFIG,
    } satisfies SessionSwitchConfigPayload);
  });

  it('camelCase payload 也归一化（snake/camel 双写，ql-20260616-006 风格）', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        sessionId: SESSION_ID,
        runId: RUN_ID,
        claimToken: CLAIM_TOKEN,
        prompt: 'camel 继续跑',
        profile: SAMPLE_PROFILE,
        providerConfig: SAMPLE_PROVIDER_CONFIG,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(1);
    const arg = sm.markPendingConfigSwitch.mock.calls[0]![1] as SessionSwitchConfigPayload;
    expect(arg).toMatchObject({
      sessionId: SESSION_ID,
      runId: RUN_ID,
      claimToken: CLAIM_TOKEN,
      prompt: 'camel 继续跑',
      profile: SAMPLE_PROFILE,
      providerConfig: SAMPLE_PROVIDER_CONFIG,
    });
  });

  it('profile=null / provider_config=null（不切语义，design §7.2）→ 透传 null 不拦截', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '只说话不切',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(1);
    const arg = sm.markPendingConfigSwitch.mock.calls[0]![1] as SessionSwitchConfigPayload;
    expect(arg.profile).toBeNull();
    expect(arg.providerConfig).toBeNull();
  });

  it('缺 run_id → warn 丢弃，markPendingConfigSwitch 不被调', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '缺 runId',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).not.toHaveBeenCalled();
  });

  it('缺 claim_token → warn 丢弃，markPendingConfigSwitch 不被调', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: RUN_ID,
        prompt: '缺 token',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).not.toHaveBeenCalled();
  });

  it('空 prompt（静默切换）→ 正常路由，markPendingConfigSwitch 被调（ql-20260817-011）', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    // 静默切换：prompt 空串不再当「三要素缺失」丢弃——reloadWithConfig 对空
    // prompt 只 reload 配置不喂消息（此前 DB 切了 daemon 丢弃消息不 reload）。
    expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(1);
    const arg = sm.markPendingConfigSwitch.mock.calls[0]?.[1];
    expect(arg.prompt).toBe('');
  });

  it('缺 session_id → warn 丢弃，markPendingConfigSwitch 不被调', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '缺目标会话',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).not.toHaveBeenCalled();
  });

  it('session 不在 SessionStore（迟到/WS 重放）→ warn 丢弃不调（口径同 SESSION_INJECT）', async () => {
    // get 返回 undefined：模拟 session 已 end / 进程重启后 store 已清。
    const sm = createMockSessionManager(undefined);
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: 'sess-gone',
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '迟到消息',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();

    expect(sm.markPendingConfigSwitch).not.toHaveBeenCalled();
  });

  it('markPendingConfigSwitch 抛 SessionNotFoundError → best-effort warn，不崩 WS 主循环', async () => {
    const boom = new Error('SessionNotFoundError: not in store');
    const sm = createMockSessionManager(
      makeState(SESSION_ID, LEASE_ID),
      () => {
        throw boom;
      },
    );
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    let unhandled = false;
    const onUnhandled = (): void => {
      unhandled = true;
    };
    process.on('unhandledRejection', onUnhandled);

    try {
      await emit(daemon, {
        type: SESSION_SWITCH_CONFIG_MSG,
        payload: {
          session_id: SESSION_ID,
          run_id: RUN_ID,
          claim_token: CLAIM_TOKEN,
          prompt: '竞态：校验后 store 被清',
          profile: null,
          provider_config: null,
        },
      });
      await flushMicro();
      await flushMicro();

      expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(1);
      expect(unhandled).toBe(false);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('sessionManager=null（未注入）→ 仅 warn 不抛（AC-14 同 SESSION_INJECT 风格）', async () => {
    const { daemon } = buildDaemon(null);
    daemons.push(daemon);

    await expect(
      emit(daemon, {
        type: SESSION_SWITCH_CONFIG_MSG,
        payload: {
          session_id: SESSION_ID,
          run_id: RUN_ID,
          claim_token: CLAIM_TOKEN,
          prompt: '无 manager',
          profile: null,
          provider_config: null,
        },
      }),
    ).resolves.toBeUndefined();
  });

  it('与 SESSION_INJECT 并存互不干扰：各自消息路由到各自 API', async () => {
    const sm = createMockSessionManager(makeState(SESSION_ID, LEASE_ID));
    const { daemon } = buildDaemon(sm);
    daemons.push(daemon);

    // 先 inject（普通轮）后 switch_config（切换轮），再反序各来一条。
    await emit(daemon, {
      type: MSG.SESSION_INJECT,
      payload: {
        session_id: SESSION_ID,
        lease_id: LEASE_ID,
        run_id: 'run-inject-1',
        prompt: '普通注入',
        claim_token: 'tok-inject',
      },
    });
    await flushMicro();
    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: RUN_ID,
        claim_token: CLAIM_TOKEN,
        prompt: '切换轮',
        profile: SAMPLE_PROFILE,
        provider_config: SAMPLE_PROVIDER_CONFIG,
      },
    });
    await flushMicro();
    await emit(daemon, {
      type: SESSION_SWITCH_CONFIG_MSG,
      payload: {
        session_id: SESSION_ID,
        run_id: 'run-switch-2',
        claim_token: 'tok-2',
        prompt: '再次切换',
        profile: null,
        provider_config: null,
      },
    });
    await flushMicro();
    await emit(daemon, {
      type: MSG.SESSION_INJECT,
      payload: {
        session_id: SESSION_ID,
        lease_id: LEASE_ID,
        run_id: 'run-inject-2',
        prompt: '普通注入二',
        claim_token: 'tok-inject-2',
      },
    });
    await flushMicro();

    // SESSION_INJECT → inject(sessionId, prompt, runId, attachments, downloadAttachment)
    // 两次（multimodal-attachments 后固定 5 参，无附件时后两参 undefined），不受 switch 串线。
    expect(sm.inject).toHaveBeenCalledTimes(2);
    expect(sm.inject).toHaveBeenNthCalledWith(1, SESSION_ID, '普通注入', 'run-inject-1', undefined, undefined);
    expect(sm.inject).toHaveBeenNthCalledWith(2, SESSION_ID, '普通注入二', 'run-inject-2', undefined, undefined);
    // SESSION_SWITCH_CONFIG → markPendingConfigSwitch 两次（覆盖写幂等由 task-08 保证），
    // 不触发 inject。
    expect(sm.markPendingConfigSwitch).toHaveBeenCalledTimes(2);
    const first = sm.markPendingConfigSwitch.mock.calls[0]![1] as SessionSwitchConfigPayload;
    expect(first.runId).toBe(RUN_ID);
    expect(first.profile).toEqual(SAMPLE_PROFILE);
    const second = sm.markPendingConfigSwitch.mock.calls[1]![1] as SessionSwitchConfigPayload;
    expect(second.runId).toBe('run-switch-2');
    expect(second.profile).toBeNull();
  });
});
