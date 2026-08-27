// tests/interactive/task-lifecycle.test.ts
// 2026-08-27-background-subagent-progress task-04：daemon 侧 task_* 生命周期消费单测
//（FR-01 消息映射 / FR-03 [TASK_*] 行格式 + R-03 节流；被测实现 task-03）。
//
// 路径说明：任务卡 allowed_paths 写的是 src/interactive/__tests__/，但
// vitest.config.ts include 仅 tests/**/*.test.ts（src 下测试文件 vitest 直接拒跑，
// 实测 "No test files found"），且全部 session-manager 既有测试都在 tests/interactive/
// —— 故按仓库实际 harness 惯例落位本目录（harness 复用 session-plan-bash-events.test.ts
// 的 fake driver 捕获 consume 回调驱动 _onMessage 的先例）。
//
// 覆盖（design §5 P1.1 + §6 契约表 + §8 / R-03）：
//   - FR-01：task_started 注册 + running emit（关联字段 tool_use_id/task_name）；
//     task_progress emit 不节流（last_tool_name/elapsed_ms/total_tokens/tool_uses 透传）；
//     task_notification 终态 emit（summary/elapsed_ms）+ 任务表注销（后续 task_updated
//     无从挂靠）；task_updated 仅 patch.status/is_backgrounded 变化 emit、不落行；
//     重复 task_started 幂等；skip_transcript ambient 任务跳过；
//   - FR-03：[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] flat 行形状
//     （event_type:'text' + 前缀 + 单行 JSON task_name 键 + 顶层 parent_tool_use_id）；
//     R-03 节流：短间隔多次 task_progress 只落 1 条 [TASK_PROGRESS]，超 2000ms 恢复
//     落行，终态行不受节流（fake timers）；
//   - 跨 turn：result 收尾（currentRunId 清空）后到达的 task_notification 用注册时
//     捕获的派发 runId 落行/emit。
//
// 不起真 CLI：fake driver 捕获 SessionManager._runConsume 注入的 onTurnMessage/
// onTurnResult 回调，直接调用即驱动 _onMessage / _onResult 全链路。

import { describe, it, expect, vi, afterEach } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
} from '../../src/interactive/driver.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';

// ── harness（复用 tests/session-plan-bash-events.test.ts 先例） ─────────────

interface Harness {
  sm: SessionManager;
  deps: {
    onTurnResult: ReturnType<typeof vi.fn>;
    onTurnMessage: ReturnType<typeof vi.fn>;
    onSessionEnd: ReturnType<typeof vi.fn>;
    onSessionEvent: ReturnType<typeof vi.fn>;
  };
  /** 驱动 _onMessage 全链路（consume 捕获的 onTurnMessage 适配回调）。 */
  emitMessage: (msg: Record<string, unknown>) => Promise<void>;
  /** 驱动 _onResult（turn 收尾：status→active + currentRunId 清空）。 */
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
      // E5：handle.provider 必须与 driver 一致（interrupt 路由校验用）。
      return { provider: 'claude' } as unknown as InteractiveDriverHandle;
    },
    async consume(
      _handle: InteractiveDriverHandle,
      callbacks: InteractiveDriverCallbacks,
    ) {
      // _runConsume 注入的适配回调（新旧键并存），调用即触发 _onMessage/_onResult。
      capturedMessage = callbacks.onTurnMessage as unknown as (
        msg: Record<string, unknown>,
      ) => Promise<void>;
      capturedResult = callbacks.onTurnResult as unknown as (
        r: Record<string, unknown>,
      ) => Promise<void>;
      // 模拟 driver 持续运行（consume 永不自然结束）。
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
    cwd: '/tmp/task-lifecycle-test',
    provider: 'claude',
    pathToClaudeCodeExecutable: '/usr/bin/claude',
  });
  // create 返回时 _runConsume 已同步越过 consume() 调用点（回调已捕获）；
  // 补一拍微任务兜底。
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

// ── 伪 SDK 消息构造（SDK 0.3.181 system/task_* 契约 + spike 实测字段） ────────

function msgTaskStarted(o: {
  taskId: string;
  toolUseId?: string;
  description?: string;
  subagentType?: string;
  skipTranscript?: boolean;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: o.taskId,
    ...(o.toolUseId ? { tool_use_id: o.toolUseId } : {}),
    ...(o.description !== undefined ? { description: o.description } : {}),
    ...(o.subagentType ? { subagent_type: o.subagentType } : {}),
    ...(o.skipTranscript ? { skip_transcript: true } : {}),
  };
}

function msgTaskProgress(o: {
  taskId: string;
  lastToolName?: string;
  summary?: string;
  durationMs?: number;
  totalTokens?: number;
  toolUses?: number;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_progress',
    task_id: o.taskId,
    ...(o.lastToolName ? { last_tool_name: o.lastToolName } : {}),
    ...(o.summary ? { summary: o.summary } : {}),
    usage: {
      ...(o.durationMs !== undefined ? { duration_ms: o.durationMs } : {}),
      ...(o.totalTokens !== undefined ? { total_tokens: o.totalTokens } : {}),
      ...(o.toolUses !== undefined ? { tool_uses: o.toolUses } : {}),
    },
  };
}

function msgTaskNotification(o: {
  taskId: string;
  status: 'completed' | 'failed' | 'stopped';
  summary?: string;
  durationMs?: number;
  toolUseId?: string;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_notification',
    task_id: o.taskId,
    status: o.status,
    ...(o.summary !== undefined ? { summary: o.summary } : {}),
    ...(o.durationMs !== undefined
      ? { usage: { duration_ms: o.durationMs } }
      : {}),
    ...(o.toolUseId ? { tool_use_id: o.toolUseId } : {}),
  };
}

function msgTaskUpdated(o: {
  taskId: string;
  patch: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_updated',
    task_id: o.taskId,
    patch: o.patch,
  };
}

/** turn 收尾 result（shape 对齐既有测试 resultSuccess 先例）。 */
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

// ── 断言辅助 ─────────────────────────────────────────────────────────────────

/** onTurnMessage 收到的 [TASK_*] flat 行调用（args: sessionId, runId, line）。 */
function taskLineCalls(h: Harness) {
  return h.deps.onTurnMessage.mock.calls.filter(
    ([, , m]) =>
      !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string' &&
      ((m as { content: string }).content.startsWith('[TASK_')),
  );
}

/** 解析一条 [TASK_*] 行：前缀 + 单行 JSON 载荷。 */
function parseTaskLine(call: unknown[]) {
  const [sid, rid, msg] = call as [
    string,
    string,
    { event_type: string; content: string; channel: string; parent_tool_use_id?: string },
  ];
  const content = msg.content;
  const spaceIdx = content.indexOf(' ');
  return {
    sessionId: sid,
    runId: rid,
    flat: msg,
    prefix: content.slice(0, spaceIdx),
    json: JSON.parse(content.slice(spaceIdx + 1)) as Record<string, unknown>,
  };
}

/** onSessionEvent 收到的 agent_task_status 事件（args: sessionId, runId, event）。 */
function taskEventCalls(h: Harness) {
  return h.deps.onSessionEvent.mock.calls.filter(
    ([, , e]) => (e as { kind?: string }).kind === 'agent_task_status',
  );
}

afterEach(() => {
  vi.useRealTimers();
});

// ── FR-01：task_* 消息 → agent_task_status 事件序列 ─────────────────────────

describe('task-lifecycle FR-01/FR-03 — task_started→task_progress×3→task_notification 全序列', () => {
  it('emit 序列 running（关联字段）→progress×3（last_tool_name/elapsed_ms 透传，emit 不节流）→completed（summary/elapsed_ms）', async () => {
    vi.useFakeTimers();
    const h = await createHarness();

    await h.emitMessage(
      msgTaskStarted({
        taskId: 'task-001',
        toolUseId: 'toolu_a1',
        description: '后台扫描依赖',
        subagentType: 'scanner',
      }),
    );
    // 3 次 task_progress 短间隔到达（300ms，远小于 R-03 的 2000ms 节流窗）。
    await h.emitMessage(
      msgTaskProgress({
        taskId: 'task-001',
        lastToolName: 'Grep',
        durationMs: 1200,
        totalTokens: 800,
        toolUses: 4,
      }),
    );
    vi.advanceTimersByTime(300);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-001', lastToolName: 'Read', durationMs: 1600 }),
    );
    vi.advanceTimersByTime(300);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-001', lastToolName: 'Bash', durationMs: 1900 }),
    );
    await h.emitMessage(
      msgTaskNotification({
        taskId: 'task-001',
        status: 'completed',
        summary: '扫描完成，产出 3 份报告',
        durationMs: 5000,
        toolUseId: 'toolu_a1',
      }),
    );

    const events = taskEventCalls(h);
    // 精确序列：1 running + 3 progress（running 态）+ 1 终态，无其它噪声。
    expect(events.map(([, , e]) => (e as { status: string }).status)).toEqual([
      'running',
      'running',
      'running',
      'running',
      'completed',
    ]);
    // FR-01 running 带关联字段（task_id/task_name/tool_use_id）。
    expect(events[0]![2]).toStrictEqual({
      kind: 'agent_task_status',
      task_id: 'task-001',
      task_name: '后台扫描依赖',
      status: 'running',
      tool_use_id: 'toolu_a1',
    });
    // FR-01 progress 字段透传（emit 不节流：3 条全部到达）。
    expect(events[1]![2]).toMatchObject({
      task_id: 'task-001',
      task_name: '后台扫描依赖',
      status: 'running',
      tool_use_id: 'toolu_a1',
      last_tool_name: 'Grep',
      elapsed_ms: 1200,
      total_tokens: 800,
      tool_uses: 4,
    });
    expect(events[2]![2]).toMatchObject({ last_tool_name: 'Read', elapsed_ms: 1600 });
    expect(events[3]![2]).toMatchObject({ last_tool_name: 'Bash', elapsed_ms: 1900 });
    // FR-01 终态 completed 带 summary/elapsed_ms（usage.duration_ms 服务端权威值）。
    expect(events[4]![2]).toStrictEqual({
      kind: 'agent_task_status',
      task_id: 'task-001',
      task_name: '后台扫描依赖',
      status: 'completed',
      tool_use_id: 'toolu_a1',
      summary: '扫描完成，产出 3 份报告',
      elapsed_ms: 5000,
    });
    // 全程挂靠派发 run（sessionId/runId 参数）。
    for (const [sid, rid] of events) {
      expect(sid).toBe('sess-1');
      expect(rid).toBe('run-1');
    }
  });

  it('FR-03 落行：[TASK_STARTED]/[TASK_PROGRESS]/[TASK_NOTIFICATION] flat 行（前缀+单行 JSON task_name 键 + parent_tool_use_id）', async () => {
    vi.useFakeTimers();
    const h = await createHarness();

    await h.emitMessage(
      msgTaskStarted({
        taskId: 'task-001',
        toolUseId: 'toolu_a1',
        description: '后台扫描依赖',
        subagentType: 'scanner',
      }),
    );
    await h.emitMessage(
      msgTaskProgress({
        taskId: 'task-001',
        lastToolName: 'Grep',
        durationMs: 1200,
        totalTokens: 800,
        toolUses: 4,
      }),
    );
    vi.advanceTimersByTime(300);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-001', lastToolName: 'Read', durationMs: 1600 }),
    );
    await h.emitMessage(
      msgTaskNotification({
        taskId: 'task-001',
        status: 'completed',
        summary: '扫描完成，产出 3 份报告',
        durationMs: 5000,
        toolUseId: 'toolu_a1',
      }),
    );

    const lines = taskLineCalls(h);
    // 短间隔 2 次 progress 只落 1 条 [TASK_PROGRESS]（R-03，详见下方节流专测）。
    expect(lines.map((c) => parseTaskLine(c).prefix)).toEqual([
      '[TASK_STARTED]',
      '[TASK_PROGRESS]',
      '[TASK_NOTIFICATION]',
    ]);

    const started = parseTaskLine(lines[0]!);
    expect(started.sessionId).toBe('sess-1');
    expect(started.runId).toBe('run-1');
    // flat 行形状：event_type:'text' / channel:'stdout' / 顶层 parent_tool_use_id。
    expect(started.flat.event_type).toBe('text');
    expect(started.flat.channel).toBe('stdout');
    expect(started.flat.parent_tool_use_id).toBe('toolu_a1');
    // 前缀 + 单行 JSON；键名统一 task_name（不用 name），async:true 为契约字段。
    expect(started.flat.content.startsWith('[TASK_STARTED] {')).toBe(true);
    expect(started.flat.content.includes('\n')).toBe(false);
    expect(started.json).toStrictEqual({
      task_id: 'task-001',
      tool_use_id: 'toolu_a1',
      task_name: '后台扫描依赖',
      subagent_type: 'scanner',
      async: true,
    });

    // [TASK_PROGRESS] 行载荷 = 首个 progress 的 usage/last_tool_name 快照。
    const progress = parseTaskLine(lines[1]!);
    expect(progress.flat.parent_tool_use_id).toBe('toolu_a1');
    expect(progress.json).toStrictEqual({
      task_id: 'task-001',
      elapsed_ms: 1200,
      total_tokens: 800,
      tool_uses: 4,
      last_tool_name: 'Grep',
    });

    // [TASK_NOTIFICATION] 行：task_id/status/elapsed_ms/summary，parent 挂靠注册键。
    const notification = parseTaskLine(lines[2]!);
    expect(notification.flat.parent_tool_use_id).toBe('toolu_a1');
    expect(notification.json).toStrictEqual({
      task_id: 'task-001',
      status: 'completed',
      elapsed_ms: 5000,
      summary: '扫描完成，产出 3 份报告',
    });

    // system/task_* 拦截后不透传：onTurnMessage 全部调用即上述 3 条 [TASK_*] 行。
    expect(h.deps.onTurnMessage.mock.calls).toHaveLength(3);
  });
});

// ── FR-03 / R-03：[TASK_PROGRESS] 落行节流 ──────────────────────────────────

describe('task-lifecycle FR-03 R-03 — [TASK_PROGRESS] 行 2000ms 节流（fake timers）', () => {
  it('短间隔多次 task_progress 只落 1 条；超窗后恢复落行；终态行不受节流', async () => {
    vi.useFakeTimers();
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-t1', toolUseId: 'toolu_t1', description: '节流验证' }),
    );

    // t0：首个 progress（lastLineAt 未设）必落。
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-t1', lastToolName: 'Grep', durationMs: 100 }),
    );
    expect(taskLineCalls(h).filter((c) => parseTaskLine(c).prefix === '[TASK_PROGRESS]')).toHaveLength(1);

    // t0+500：节流窗内 → 不落行，但 emit 不节流（事件到达）。
    vi.advanceTimersByTime(500);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-t1', lastToolName: 'Read', durationMs: 600 }),
    );
    // t0+1500：仍在窗内（锚点是上次落行时刻 t0）→ 不落行。
    vi.advanceTimersByTime(1000);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-t1', lastToolName: 'Bash', durationMs: 1400 }),
    );
    const progressLines = () =>
      taskLineCalls(h).filter((c) => parseTaskLine(c).prefix === '[TASK_PROGRESS]');
    expect(progressLines()).toHaveLength(1);
    expect(taskEventCalls(h)).toHaveLength(4); // started + 3 progress（emit 不节流）

    // t0+2100：距上次落行 >2000ms → 恢复落行（第 2 条），载荷取本条 progress。
    vi.advanceTimersByTime(600);
    await h.emitMessage(
      msgTaskProgress({ taskId: 'task-t1', lastToolName: 'Write', durationMs: 2000 }),
    );
    expect(progressLines()).toHaveLength(2);
    expect(parseTaskLine(progressLines()[1]!).json).toMatchObject({
      last_tool_name: 'Write',
      elapsed_ms: 2000,
    });

    // 终态行不节流：紧随其后（距上次落行 0ms < 2000ms）仍立即落 [TASK_NOTIFICATION]。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-t1', status: 'completed', summary: '完成', durationMs: 2200 }),
    );
    const notifLines = taskLineCalls(h).filter(
      (c) => parseTaskLine(c).prefix === '[TASK_NOTIFICATION]',
    );
    expect(notifLines).toHaveLength(1);
    expect(parseTaskLine(notifLines[0]!).json).toStrictEqual({
      task_id: 'task-t1',
      status: 'completed',
      elapsed_ms: 2200,
      summary: '完成',
    });
  });
});

// ── FR-01：task_updated 轻量信号 ─────────────────────────────────────────────

describe('task-lifecycle FR-01 — task_updated 仅 status/is_backgrounded 变化 emit、不落行', () => {
  it('patch.status 变化 → emit（completed/failed 直通、killed→stopped、其余→running；failed 附 patch.error 作 summary）', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-u1', toolUseId: 'toolu_u1', description: '辅助信号' }),
    );
    const baselineEvents = taskEventCalls(h).length;

    await h.emitMessage(msgTaskUpdated({ taskId: 'task-u1', patch: { status: 'running' } }));
    await h.emitMessage(msgTaskUpdated({ taskId: 'task-u1', patch: { status: 'killed' } }));
    await h.emitMessage(
      msgTaskUpdated({ taskId: 'task-u1', patch: { status: 'failed', error: 'boom' } }),
    );

    const events = taskEventCalls(h);
    expect(events).toHaveLength(baselineEvents + 3);
    expect(events[1]![2]).toStrictEqual({
      kind: 'agent_task_status',
      task_id: 'task-u1',
      task_name: '辅助信号',
      status: 'running',
      tool_use_id: 'toolu_u1',
    });
    // patch 六值 → SSE 四值映射：killed→stopped。
    expect(events[2]![2]).toMatchObject({ status: 'stopped' });
    // failed 直通 + patch.error 作 summary。
    expect(events[3]![2]).toMatchObject({ status: 'failed', summary: 'boom' });
    // 不落行：[TASK_*] 行仍只有 task_started 的 1 条。
    expect(taskLineCalls(h).map((c) => parseTaskLine(c).prefix)).toEqual(['[TASK_STARTED]']);
  });

  it('patch.is_backgrounded 变化 → emit running（复用注册字段）', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-u2', toolUseId: 'toolu_u2', description: '后台化观察' }),
    );
    await h.emitMessage(
      msgTaskUpdated({ taskId: 'task-u2', patch: { is_backgrounded: true } }),
    );
    const events = taskEventCalls(h);
    expect(events).toHaveLength(2);
    expect(events[1]![2]).toMatchObject({
      task_id: 'task-u2',
      task_name: '后台化观察',
      status: 'running',
      tool_use_id: 'toolu_u2',
    });
    expect(taskLineCalls(h)).toHaveLength(1); // 仅 [TASK_STARTED]，task_updated 不落行
  });

  it('patch 仅 end_time 等非关键字段 → 不 emit；task_notification 注销后 task_updated 无从挂靠 → 不 emit', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-u3', toolUseId: 'toolu_u3', description: '静默任务' }),
    );
    // 仅 end_time（非 status/is_backgrounded）→ 噪声控制，不转发。
    await h.emitMessage(
      msgTaskUpdated({ taskId: 'task-u3', patch: { end_time: '2026-08-27T09:00:00Z' } }),
    );
    expect(taskEventCalls(h)).toHaveLength(1);

    // 终态到达 → 任务表注销（权威终态是 task_notification）。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-u3', status: 'completed', summary: '完成' }),
    );
    expect(taskEventCalls(h)).toHaveLength(2);
    // 注销后再来的 task_updated（patch.status 变化）也无从挂靠 → 不 emit。
    await h.emitMessage(msgTaskUpdated({ taskId: 'task-u3', patch: { status: 'failed' } }));
    expect(taskEventCalls(h)).toHaveLength(2);
  });
});

// ── FR-01：注册口径边界 ──────────────────────────────────────────────────────

describe('task-lifecycle FR-01 — task_started 注册口径', () => {
  it('重复 task_started（SDK 重放）不重复 emit/落行，仅补全缺失 tool_use_id（终态行挂靠补全键）', async () => {
    const h = await createHarness();
    // 首发不带 tool_use_id（回执先到等极端时序）。
    await h.emitMessage(msgTaskStarted({ taskId: 'task-d1', description: '重放任务' }));
    expect(taskEventCalls(h)).toHaveLength(1);
    expect(taskLineCalls(h)).toHaveLength(1);

    // 重放带 tool_use_id → 仅补全关联键，不重复 emit/落行。
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-d1', toolUseId: 'toolu_d1', description: '重放任务' }),
    );
    expect(taskEventCalls(h)).toHaveLength(1);
    expect(taskLineCalls(h)).toHaveLength(1);

    // 终态消息自身不带 tool_use_id → 用注册表补全的 toolu_d1 挂靠（backfill 生效的可观察证明）。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-d1', status: 'completed', summary: '完成' }),
    );
    const events = taskEventCalls(h);
    expect(events[1]![2]).toMatchObject({ tool_use_id: 'toolu_d1' });
    const lines = taskLineCalls(h);
    expect(parseTaskLine(lines[1]!).flat.parent_tool_use_id).toBe('toolu_d1');
  });

  it('skip_transcript=true（ambient/housekeeping 任务）→ 不注册、不 emit、不落行', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-s1', skipTranscript: true, description: '压缩' }),
    );
    expect(taskEventCalls(h)).toHaveLength(0);
    expect(taskLineCalls(h)).toHaveLength(0);
    expect(h.deps.onTurnMessage.mock.calls).toHaveLength(0); // 也不透传
  });
});

// ── FR-01/FR-03：跨 turn 场景（注册时捕获的 runId） ─────────────────────────

describe('task-lifecycle FR-01/FR-03 — result 收尾后到达的 task_notification 用注册时捕获的 runId', () => {
  it('跨 turn：currentRunId 已清空，终态 emit/落行仍归派发 run', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-x1', toolUseId: 'toolu_x1', description: '跨轮任务' }),
    );
    // turn 收尾：status→active、currentRunId 清空（_onResult）。
    await h.emitResult(msgResultSuccess());
    expect(h.sm.get('sess-1')!.status).toBe('active');

    // 后台任务终态在本 turn 收尾后到达——runId 只能来自注册表。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'task-x1', status: 'completed', summary: '后台完成' }),
    );

    const events = taskEventCalls(h);
    expect(events.map(([, , e]) => (e as { status: string }).status)).toEqual([
      'running',
      'completed',
    ]);
    // emit 与 [TASK_NOTIFICATION] 行均挂注册时捕获的 run-1（非 currentRunId 兜底——已清空）。
    const [, terminalRunId] = events[1]!;
    expect(terminalRunId).toBe('run-1');
    const lines = taskLineCalls(h);
    expect(lines.map((c) => parseTaskLine(c).prefix)).toEqual([
      '[TASK_STARTED]',
      '[TASK_NOTIFICATION]',
    ]);
    expect(parseTaskLine(lines[1]!).runId).toBe('run-1');
    expect(parseTaskLine(lines[1]!).json).toStrictEqual({
      task_id: 'task-x1',
      status: 'completed',
      summary: '后台完成',
    });
  });
});
