// tests/interactive/session-manager-bg-anchor.test.ts
// 2026-09-15-background-task-permission-lockout（task-10 / FR-01）：
// 后台锚点生命周期——onResult 注册表非空保留 currentRunId；task_notification
// 注销清空后清锚点；clearBackgroundTasks 同步清；hasBackgroundTaskGrace 守卫三态。
//
// 模板沿用 tests/interactive/task-lifecycle.test.ts 的 fake driver harness
//（create 捕获 onTurnMessage/onTurnResult 适配回调直接驱动 _onMessage/_onResult）。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import {
  hasBackgroundTaskGrace,
  writeChannelGuardDeny,
} from '../../src/interactive/session-manager/permission.js';
import { clearBackgroundTasks } from '../../src/interactive/session-manager/background-tasks.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
} from '../../src/interactive/driver.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';

interface Harness {
  sm: SessionManager;
  deps: {
    onTurnResult: ReturnType<typeof vi.fn>;
    onTurnMessage: ReturnType<typeof vi.fn>;
    onSessionEnd: ReturnType<typeof vi.fn>;
    onSessionEvent: ReturnType<typeof vi.fn>;
  };
  emitMessage: (msg: Record<string, unknown>) => Promise<void>;
  emitResult: (r: Record<string, unknown>) => Promise<void>;
}

async function createHarness(
  sessionId = 'sess-1',
  runId = 'run-1',
): Promise<Harness> {
  let capturedMessage:
    | ((msg: Record<string, unknown>) => Promise<void>)
    | null = null;
  let capturedResult:
    | ((r: Record<string, unknown>) => Promise<void>)
    | null = null;
  const fakeDriver: InteractiveDriver = {
    async start() {
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(
      _handle: InteractiveDriverHandle,
      callbacks: InteractiveDriverCallbacks,
    ) {
      capturedMessage = callbacks.onTurnMessage as unknown as (
        msg: Record<string, unknown>,
      ) => Promise<void>;
      capturedResult = callbacks.onTurnResult as unknown as (
        r: Record<string, unknown>,
      ) => Promise<void>;
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return false;
    },
  };
  const deps = {
    driver: fakeDriver as unknown as SessionManagerDeps['driver'],
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(),
    onTurnMessage: vi.fn(),
    onSessionEnd: vi.fn(),
    onSessionEvent: vi.fn(),
  };
  const sm = new SessionManager(deps as unknown as SessionManagerDeps);
  await sm.create({
    sessionId,
    leaseId: `lease-${sessionId}`,
    claimToken: 'ct-1',
    firstPrompt: 'hi',
    firstRunId: runId,
    cwd: '/tmp/bg-anchor-test',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/usr/bin/claude',
  });
  await Promise.resolve();
  return {
    sm,
    deps,
    emitMessage: (msg) => {
      if (!capturedMessage) throw new Error('consume 回调未捕获');
      return capturedMessage(msg);
    },
    emitResult: (r) => {
      if (!capturedResult) throw new Error('consume 回调未捕获');
      return capturedResult(r);
    },
  };
}

function msgTaskStarted(o: {
  taskId: string;
  toolUseId?: string;
  description?: string;
}): Record<string, unknown> {
  return {
    events: [
      {
        type: 'status',
        subtype: 'agent_task_status',
        content: o.description ?? '',
        metadata: {
          task_id: o.taskId,
          task_name: o.description || '后台任务',
          status: 'running',
          ...(o.toolUseId ? { tool_use_id: o.toolUseId } : {}),
        },
      },
    ],
  };
}

function msgTaskNotification(o: {
  taskId: string;
  status: 'completed' | 'failed' | 'stopped';
  summary?: string;
}): Record<string, unknown> {
  return {
    events: [
      {
        type: 'status',
        subtype: 'task_notification',
        content: o.summary ?? '',
        metadata: {
          task_id: o.taskId,
          status: o.status,
          ...(o.summary !== undefined ? { summary: o.summary } : {}),
        },
      },
    ],
  };
}

function msgResultSuccess(): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'ok',
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: {
      input_tokens: 1,
      output_tokens: 1,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('后台锚点生命周期（FR-01）', () => {
  it('注册表非空：onResult 保留 currentRunId（status 翻 active，锚点生效）', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-a1', toolUseId: 'toolu_a1', description: '后台任务A' }),
    );
    expect(h.sm.hasLiveBackgroundTasks('sess-1')).toBe(true);
    expect(h.sm.get('sess-1')!.currentRunId).toBe('run-1'); // 主轮在跑

    await h.emitResult(msgResultSuccess());

    const st = h.sm.get('sess-1')!;
    expect(st.status).toBe('active');
    expect(st.currentRunId).toBe('run-1'); // 锚点保留（注册表非空）
  });

  it('注册表为空：onResult 清 currentRunId，行为与现状一致', async () => {
    const h = await createHarness();
    // 不起后台任务，直接收尾。
    await h.emitResult(msgResultSuccess());
    const st = h.sm.get('sess-1')!;
    expect(st.status).toBe('active');
    expect(st.currentRunId).toBeUndefined();
    expect(h.sm.hasLiveBackgroundTasks('sess-1')).toBe(false);
  });

  it('末任务终态注销后注册表清空 → 清锚点；status=running 时不误清', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-b1', toolUseId: 'toolu_b1', description: '后台任务B' }),
    );
    await h.emitResult(msgResultSuccess());
    expect(h.sm.get('sess-1')!.currentRunId).toBe('run-1'); // 锚点在

    // 注销清空 → 锚点清。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-b1', status: 'completed', summary: '完成' }),
    );
    expect(h.sm.hasLiveBackgroundTasks('sess-1')).toBe(false);
    expect(h.sm.get('sess-1')!.currentRunId).toBeUndefined();

    // 再起一轮（inject 会走 SDK——fake driver 不模拟新 turn；直接验证
    // status=running 时 notification 不误清：另起任务后手动置 running 态验证。
    const h2 = await createHarness('sess-2', 'run-2');
    await h2.emitMessage(
      msgTaskStarted({ taskId: 'task-b2', toolUseId: 'toolu_b2', description: '任务B2' }),
    );
    // 模拟新一轮在跑：status=running + 新 currentRunId。
    const st2 = h2.sm.get('sess-2')!;
    st2.status = 'running';
    st2.currentRunId = 'run-2b';
    await h2.emitMessage(
      msgTaskNotification({ taskId: 'task-b2', status: 'completed', summary: '完成' }),
    );
    // running 态不清锚点/活轮绑定。
    expect(st2.currentRunId).toBe('run-2b');
    expect(st2.status).toBe('running');
  });

  it('clearBackgroundTasks 同步清锚点（终态兜底，active 态防注册表泄漏 R-01）', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-c1', toolUseId: 'toolu_c1', description: '任务C' }),
    );
    await h.emitResult(msgResultSuccess());
    expect(h.sm.get('sess-1')!.currentRunId).toBe('run-1');

    // 直接调模块导出的终态清理（end() 会先翻 status=ended——ended 态守卫本就
    // deny，锚点清理分支面向 active 态的注册表泄漏兜底）：active 态清注册表
    // 应连带清锚点。
    const core = (h.sm as unknown as { _core: () => Parameters<typeof clearBackgroundTasks>[0] })._core();
    clearBackgroundTasks(core, 'sess-1');

    expect(h.sm.hasLiveBackgroundTasks('sess-1')).toBe(false);
    expect(h.sm.get('sess-1')!.currentRunId).toBeUndefined();
  });

  it('hasLiveBackgroundTasks 不建 map（无副作用，仅 boolean）', async () => {
    const h = await createHarness();
    expect(h.sm.hasLiveBackgroundTasks('never-existed')).toBe(false);
    expect(h.sm.get('never-existed')).toBeUndefined(); // 未创建 state
  });
});

describe('hasBackgroundTaskGrace 守卫三态（FR-01）', () => {
  it('注册表空（active+currentRunId）→ deny；非空 → 放行；currentRunId 无 → deny', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-g1', toolUseId: 'toolu_g1', description: '任务G' }),
    );
    await h.emitResult(msgResultSuccess());
    const st = h.sm.get('sess-1')!;
    const core = (h.sm as unknown as { _core: () => Parameters<typeof hasBackgroundTaskGrace>[0] })._core();

    // 锚点态 + 注册表非空 → 放行。
    expect(hasBackgroundTaskGrace(core, st)).toBe(true);
    expect(writeChannelGuardDeny(core, st, 'Write')).toBeNull();

    // 注销清空 → 守卫恢复 deny（注册表空）。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-g1', status: 'completed', summary: '完成' }),
    );
    const st2 = h.sm.get('sess-1')!;
    expect(hasBackgroundTaskGrace(core, st2)).toBe(false);
    const deny = writeChannelGuardDeny(core, st2, 'Write');
    expect(deny).not.toBeNull();
    expect(deny!.message).toContain('PLATFORM_NO_RUNNING_TURN:');

    // currentRunId 无（锚点已清）+ 注册表非空（构造态）→ deny。
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-g2', toolUseId: 'toolu_g2', description: '任务G2' }),
    );
    const st3 = h.sm.get('sess-1')!;
    st3.currentRunId = undefined; // 强制无锚点（异常态）
    expect(hasBackgroundTaskGrace(core, st3)).toBe(false);
    expect(writeChannelGuardDeny(core, st3, 'Write')).not.toBeNull();
  });
});

// ── 2026-09-15-background-task-permission-lockout（task-10 / FR-02）：
// 4 处可达 register 注入点逐一断言 background_task 透传 + 2 处不可达路径锚点态
// cancelled（execute QA 复审补齐——正是缺这张网漏过 AskUserQuestion 拦截点）。

describe('background_task 注入点（FR-02，manualApproval 会话）', () => {
  it('锚点态：默认普通审批 register（canUseTool Bash）payload 带 background_task: true', async () => {
    const harness = await makeApprovalHarness();
    // 构造锚点态：status=active + currentRunId 在 + 注册表非空。
    await harness.seedAnchorState();
    const pending = harness.canUseTool!('Bash', { command: 'ls' });
    const payload = harness.lastRequestPayload();
    expect(payload.background_task).toBe(true);
    harness.resolveLast('deny');
    const decision = (await pending) as { behavior: string };
    expect(decision.behavior).toBe('deny');
  });

  it('锚点态：AskUserQuestion 拦截 register payload 带 background_task: true（P0 事故路径）', async () => {
    const harness = await makeApprovalHarness();
    await harness.seedAnchorState();
    const pending = harness.canUseTool!('AskUserQuestion', {
      questions: [{ question: 'q', header: 'H', options: [], multiSelect: false }],
    });
    const payload = harness.lastRequestPayload();
    expect(payload.background_task).toBe(true);
    expect(payload.dialog_kind).toBe('AskUserQuestion');
    harness.resolveLast('deny');
    await pending;
  });

  it('锚点态：ExitPlanMode（plan_approval dialog）payload 带 background_task: true', async () => {
    const harness = await makeApprovalHarness();
    await harness.seedAnchorState();
    const pending = harness.canUseTool!('ExitPlanMode', { plan: '步骤1' });
    const payload = harness.lastRequestPayload();
    expect(payload.background_task).toBe(true);
    expect(payload.dialog_kind).toBe('plan_approval');
    harness.resolveLast('deny');
    await pending;
  });

  it('锚点态：requestPermission（codex/pi sessionPermission 路径）payload 带 background_task: true', async () => {
    const harness = await makeApprovalHarness();
    await harness.seedAnchorState();
    const pending = harness.sm.requestPermission('sess-1', {
      toolName: 'Bash',
      toolInput: { command: 'ls' },
    });
    const payload = harness.lastRequestPayload();
    expect(payload.background_task).toBe(true);
    harness.resolveLast('deny');
    const decision = (await pending) as { behavior: string };
    expect(decision.behavior).toBe('deny');
  });

  it('主轮进行中（status=running）：默认审批 payload 无 background_task 键', async () => {
    const harness = await makeApprovalHarness();
    // 不构造锚点态——create 后主轮在跑（status=running），注册表为空。
    const pending = harness.canUseTool!('Bash', { command: 'ls' });
    const payload = harness.lastRequestPayload();
    expect('background_task' in payload).toBe(false);
    harness.resolveLast('deny');
    await pending;
  });

  it('不可达路径①：requestUserDialog 锚点态 → cancelled（不发请求）', async () => {
    const harness = await makeApprovalHarness();
    await harness.seedAnchorState();
    const result = await harness.sm.requestUserDialog('sess-1', {
      dialogKind: 'AskUserQuestion',
      dialogPayload: { questions: [] },
    });
    expect(result).toEqual({ behavior: 'cancelled' });
    expect(harness.sendCount()).toBe(0);
  });

  it('不可达路径②：onUserDialog 回调锚点态 → cancelled（不发请求）', async () => {
    const harness = await makeApprovalHarness();
    await harness.seedAnchorState();
    const onUserDialog = harness.capturedOnUserDialog!;
    const result = await onUserDialog({
      dialogKind: 'AskUserQuestion',
      payload: { questions: [] },
    });
    expect(result).toEqual({ behavior: 'cancelled' });
    expect(harness.sendCount()).toBe(0);
  });
});

// ── 注入点断言 harness：manualApproval 会话捕获 canUseTool / onUserDialog ────
// 模板沿用 tests/interactive/claude-sdk-driver-permission.test.ts 的
// makeManualSession（捕获 driver options 里的回调）。

interface ApprovalHarness {
  sm: SessionManager;
  canUseTool:
    | ((
        toolName: string,
        toolInput: Record<string, unknown>,
      ) => Promise<Record<string, unknown>>)
    | undefined;
  capturedOnUserDialog:
    | ((req: { dialogKind: string; payload: Record<string, unknown> }) => Promise<
        Record<string, unknown>
      >)
    | undefined;
  seedAnchorState: () => Promise<void>;
  lastRequestPayload: () => Record<string, unknown>;
  resolveLast: (decision: 'allow' | 'deny') => void;
  sendCount: () => number;
}

async function makeApprovalHarness(): Promise<ApprovalHarness> {
  let capturedOptions: Record<string, unknown> | null = null;
  const fakeDriver = {
    async start() {
      return {} as unknown as ReturnType<Parameters<typeof Object>[0]>;
    },
    async consume(_h: unknown, callbacks: unknown) {
      void callbacks;
      return new Promise<void>(() => {});
    },
    async interrupt() {
      return false;
    },
  };
  const sendCalls: { payload: Record<string, unknown> }[] = [];
  const wsClient = {
    send: (msg: { payload: Record<string, unknown> }) => {
      sendCalls.push({ payload: msg.payload });
      return true;
    },
  };
  const resolvers: {
    register: (input: {
      send: (msg: { payload: Record<string, unknown> }) => boolean;
    }) => { promise: Promise<Record<string, unknown>> };
    resolve: (
      payload: Record<string, unknown>,
      sessionId: string,
    ) => string;
  }[] = [];
  // 轻量 resolver：复用真实 PermissionResolver 的 wire 形态最稳——直接 new。
  const { PermissionResolver } = await import(
    '../../src/interactive/permission-resolver.js'
  );
  const resolver = new PermissionResolver();
  resolvers.push(resolver as never);

  const deps = {
    driver: fakeDriver as never,
    drivers: { claude: fakeDriver },
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
    onSessionEvent: vi.fn(),
  };
  const sm = new SessionManager(deps as never, {
    manualApproval: true,
    permissionResolver: resolver,
    permissionWsClient: wsClient as never,
  });
  // 捕获注入 driver 的 options：包一层 start。
  const origCreate = sm.create.bind(sm);
  void origCreate;
  // SessionManager 创建时经 driver-factory 注入 options 到 driver.start——
  // 用 monkey-patch 捕获（fakeDriver.start 收到的是 SessionManager 组装产物）。
  const driverAny = fakeDriver as { start: (i: unknown, o: Record<string, unknown>) => unknown };
  const realStart = driverAny.start.bind(driverAny);
  (fakeDriver as { start: unknown }).start = (
    input: unknown,
    opts: Record<string, unknown>,
  ) => {
    capturedOptions = opts;
    return realStart(input, opts);
  };

  await sm.create({
    sessionId: 'sess-1',
    leaseId: 'lease-1',
    claimToken: 'ct-1',
    firstPrompt: 'hi',
    firstRunId: 'run-1',
    cwd: '/tmp/bg-inject-test',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/usr/bin/claude',
  });
  await Promise.resolve();

  let messageId = 0;
  return {
    sm,
    canUseTool: capturedOptions?.['canUseTool'] as ApprovalHarness['canUseTool'],
    capturedOnUserDialog: capturedOptions?.['onUserDialog'] as ApprovalHarness['capturedOnUserDialog'],
    seedAnchorState: async () => {
      // 经真实事件链注册后台任务 + 主轮收尾（锚点态：active + currentRunId + 注册表非空）。
      const st = sm.get('sess-1')!;
      (
        sm as unknown as {
          _getOrCreateTaskMap: (sid: string) => Map<string, unknown>;
        }
      )._getOrCreateTaskMap('sess-1').set('task-i1', {
        taskName: '注入点测试任务',
        async: true,
        startedAt: Date.now(),
        runId: 'run-1',
      } as never);
      st.status = 'active';
      st.currentRunId = 'run-1';
      messageId++;
      void messageId;
    },
    lastRequestPayload: () => {
      const last = sendCalls[sendCalls.length - 1];
      if (!last) throw new Error('无 PERMISSION_REQUEST send 调用');
      return last.payload;
    },
    resolveLast: (decision: 'allow' | 'deny') => {
      const last = sendCalls[sendCalls.length - 1];
      if (!last) throw new Error('无 PERMISSION_REQUEST send 调用');
      resolver.resolve(
        {
          session_id: 'sess-1',
          request_id: last.payload['request_id'] as string,
          decision,
        } as never,
        'sess-1',
      );
    },
    sendCount: () => sendCalls.length,
  };
}
