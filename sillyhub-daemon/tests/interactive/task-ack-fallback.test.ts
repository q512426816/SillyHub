// tests/interactive/task-ack-fallback.test.ts
// 2026-08-27-background-subagent-progress task-04：daemon 侧异步启动回执兜底单测
//（FR-02 / design §5 P1.2；被测实现 task-03 _registerAsyncReceiptTask）。
//
// 覆盖 spike 两种结论路径的 secondary 侧（CLI 不发 task_* 的旧版/异常场景）：
//   - FR-02：user tool_result 文本含 "Async agent launched successfully …
//     agentId: <hex>" → 正则提取 agentId，以 tool_use_id 为关联键注册 async 任务
//     （task_id=agentId）+ emit running（必带 tool_use_id + async:true，design §8
//     「async 回执兜底路径必发」——防前端把 0.1s 配对的 tool_result 当完成信号）；
//     任务名/子代理类型从 _agentToolUseMeta（assistant Task tool_use 登记）回填；
//   - 普通 tool_result（无回执关键词 / 无 agentId）不误触发；
//   - 与 task_started 双注册防重（primary 路径已注册同 tool_use_id → 回执仅佐证，
//     不产生第二条 [TASK_STARTED] 行 / running emit）。
//
// 路径说明：任务卡 allowed_paths 写的是 src/interactive/__tests__/，但
// vitest.config.ts include 仅 tests/**/*.test.ts（src 下测试文件 vitest 直接拒跑），
// 故按仓库 harness 惯例落位 tests/interactive/（复用 session-plan-bash-events.test.ts
// 的 fake driver 捕获 consume 回调驱动 _onMessage 的先例）。不起真 CLI。

import { describe, it, expect, vi } from 'vitest';
import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
} from '../../src/interactive/driver.js';
import type { SessionManagerDeps } from '../../src/interactive/types.js';

// ── harness（与 task-lifecycle.test.ts 同款，复用既有先例） ──────────────────

interface Harness {
  sm: SessionManager;
  deps: {
    onTurnResult: ReturnType<typeof vi.fn>;
    onTurnMessage: ReturnType<typeof vi.fn>;
    onSessionEnd: ReturnType<typeof vi.fn>;
    onSessionEvent: ReturnType<typeof vi.fn>;
  };
  emitMessage: (msg: Record<string, unknown>) => Promise<void>;
}

async function createHarness(
  sessionId = 'sess-2',
  runId = 'run-2',
): Promise<Harness> {
  let capturedMessage:
    | ((msg: Record<string, unknown>) => Promise<void>)
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
      capturedMessage = callbacks.onTurnMessage as unknown as (
        msg: Record<string, unknown>,
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
    cwd: '/tmp/task-ack-test',
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
  };
}

// ── 伪 SDK 消息构造 ──────────────────────────────────────────────────────────

/** assistant message 含 Task tool_use（触发 _agentToolUseMeta 登记，回执回填源）。 */
function msgAssistantTaskToolUse(
  toolUseId: string,
  input: { description?: string; subagent_type?: string },
): Record<string, unknown> {
  return {
    type: 'assistant',
    parent_tool_use_id: null,
    message: {
      content: [
        {
          type: 'tool_use',
          id: toolUseId,
          name: 'Task',
          input,
        },
      ],
    },
  };
}

/** user message 含 tool_result（异步启动回执载体）。 */
function msgUserToolResult(
  toolUseId: string,
  content: string,
): Record<string, unknown> {
  return {
    type: 'user',
    parent_tool_use_id: null,
    content: [
      { type: 'tool_result', tool_use_id: toolUseId, content, is_error: false },
    ],
  };
}

/** system/task_started（primary 路径，双注册防重对照）。 */
function msgTaskStarted(o: {
  taskId: string;
  toolUseId?: string;
  description?: string;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_started',
    task_id: o.taskId,
    ...(o.toolUseId ? { tool_use_id: o.toolUseId } : {}),
    ...(o.description !== undefined ? { description: o.description } : {}),
  };
}

function msgTaskNotification(o: {
  taskId: string;
  status: 'completed' | 'failed' | 'stopped';
  summary?: string;
}): Record<string, unknown> {
  return {
    type: 'system',
    subtype: 'task_notification',
    task_id: o.taskId,
    status: o.status,
    ...(o.summary !== undefined ? { summary: o.summary } : {}),
  };
}

// ── 断言辅助 ─────────────────────────────────────────────────────────────────

function taskLineCalls(h: Harness) {
  return h.deps.onTurnMessage.mock.calls.filter(
    ([, , m]) =>
      !!m && typeof m === 'object' && typeof (m as { content?: unknown }).content === 'string' &&
      ((m as { content: string }).content.startsWith('[TASK_')),
  );
}

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

function taskEventCalls(h: Harness) {
  return h.deps.onSessionEvent.mock.calls.filter(
    ([, , e]) => (e as { kind?: string }).kind === 'agent_task_status',
  );
}

// ── FR-02：回执兜底注册 ──────────────────────────────────────────────────────

describe('task-ack-fallback FR-02 — 异步启动回执注册 async 任务', () => {
  it('tool_result 文本含 "Async agent launched successfully … agentId: abcd1234ef" → 注册 + emit running(async:true, tool_use_id) + [TASK_STARTED] 行（任务名/子代理类型回填）', async () => {
    const h = await createHarness();
    // 派发 turn：assistant Task tool_use（登记 _agentToolUseMeta，回执回填源）。
    // 注：此消息本身会 emit 一条不带 async 的 running（既有 tool_use 识别路径），
    // 下方按 task_id 过滤后断言回执路径。
    await h.emitMessage(
      msgAssistantTaskToolUse('toolu_r1', {
        description: '调研索引方案',
        subagent_type: 'researcher',
      }),
    );

    // 异步启动回执（0.1s 内配对到达的 tool_result）。
    await h.emitMessage(
      msgUserToolResult(
        'toolu_r1',
        'Async agent launched successfully. agentId: abcd1234ef',
      ),
    );

    // FR-02 emit：running 且必带 tool_use_id + async:true（design §8）。
    const receiptEvents = taskEventCalls(h).filter(
      ([, , e]) => (e as { task_id?: string }).task_id === 'abcd1234ef',
    );
    expect(receiptEvents).toHaveLength(1);
    const [sid, rid, ev] = receiptEvents[0]!;
    expect(sid).toBe('sess-2');
    expect(rid).toBe('run-2');
    expect(ev).toStrictEqual({
      kind: 'agent_task_status',
      task_id: 'abcd1234ef',
      task_name: '调研索引方案',
      status: 'running',
      tool_use_id: 'toolu_r1',
      async: true,
    });

    // FR-03 [TASK_STARTED] 行：task_id=agentId，任务名/子代理类型自 tool_use meta 回填。
    const lines = taskLineCalls(h);
    expect(lines.map((c) => parseTaskLine(c).prefix)).toEqual(['[TASK_STARTED]']);
    const started = parseTaskLine(lines[0]!);
    expect(started.flat.event_type).toBe('text');
    expect(started.flat.channel).toBe('stdout');
    expect(started.flat.parent_tool_use_id).toBe('toolu_r1');
    expect(started.json).toStrictEqual({
      task_id: 'abcd1234ef',
      tool_use_id: 'toolu_r1',
      task_name: '调研索引方案',
      subagent_type: 'researcher',
      async: true,
    });

    // 注册确实落在任务表（可观察证明）：后续该 agentId 的 task_notification 终态
    // 能消费注册条目（task_name 回填 + runId 归派发 run）并落 [TASK_NOTIFICATION] 行。
    await h.emitMessage(
      msgTaskNotification({ taskId: 'abcd1234ef', status: 'completed', summary: '调研完成' }),
    );
    const finalEvents = taskEventCalls(h).filter(
      ([, , e]) => (e as { task_id?: string }).task_id === 'abcd1234ef',
    );
    expect(finalEvents).toHaveLength(2);
    expect(finalEvents[1]![2]).toMatchObject({
      status: 'completed',
      task_name: '调研索引方案',
      tool_use_id: 'toolu_r1',
    });
    expect(
      taskLineCalls(h).filter((c) => parseTaskLine(c).prefix === '[TASK_NOTIFICATION]'),
    ).toHaveLength(1);
  });
});

// ── FR-02：不误触发 ──────────────────────────────────────────────────────────

describe('task-ack-fallback FR-02 — 普通 tool_result 不触发回执兜底', () => {
  it('普通文本 tool_result → 不注册、不 emit、不落 [TASK_STARTED] 行', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgAssistantTaskToolUse('toolu_n1', { description: '前台任务' }),
    );
    await h.emitMessage(msgUserToolResult('toolu_n1', 'done'));

    // 仅剩 tool_use 识别路径的 running（task_id=tool_use_id，无 async 标记）。
    const events = taskEventCalls(h);
    expect(events).toHaveLength(1);
    expect(events[0]![2]).toMatchObject({ task_id: 'toolu_n1' });
    expect((events[0]![2] as { async?: boolean }).async).toBeUndefined();
    expect(taskLineCalls(h)).toHaveLength(0);
  });

  it('回执文本含关键词但提取不到 agentId（非 hex）→ 不触发', async () => {
    const h = await createHarness();
    await h.emitMessage(
      msgUserToolResult(
        'toolu_n2',
        'Async agent launched successfully. agentId: xyz-not-hex',
      ),
    );
    expect(taskEventCalls(h)).toHaveLength(0);
    expect(taskLineCalls(h)).toHaveLength(0);
  });
});

// ── FR-02：与 task_started 双注册防重 ───────────────────────────────────────

describe('task-ack-fallback FR-02 — 与 task_started 双注册防重（primary 路径优先）', () => {
  it('task_started 已注册同 tool_use_id → 回执仅佐证：不重复 emit、无双 [TASK_STARTED] 行、不产 agentId 任务', async () => {
    const h = await createHarness();
    // primary 路径：CLI system/task_started 先注册（task_id=task-222）。
    await h.emitMessage(
      msgTaskStarted({ taskId: 'task-222', toolUseId: 'toolu_dup1', description: '主路径任务' }),
    );
    expect(taskEventCalls(h)).toHaveLength(1);
    expect(taskLineCalls(h)).toHaveLength(1);

    // secondary 回执后到（同 tool_use_id，携带另一 agentId）→ 查重跳过。
    await h.emitMessage(
      msgUserToolResult(
        'toolu_dup1',
        'Async agent launched successfully. agentId: beef9999dead',
      ),
    );

    // 不产生 agentId=beef9999dead 的事件/行；running emit 仍只有 task-222 一条。
    const events = taskEventCalls(h);
    expect(events).toHaveLength(1);
    expect(events[0]![2]).toMatchObject({ task_id: 'task-222' });
    expect(
      events.filter(([, , e]) => (e as { task_id?: string }).task_id === 'beef9999dead'),
    ).toHaveLength(0);

    // [TASK_STARTED] 行仍只有 primary 的 1 条（无双行）。
    const lines = taskLineCalls(h);
    expect(lines).toHaveLength(1);
    expect(parseTaskLine(lines[0]!).json).toMatchObject({ task_id: 'task-222' });
    expect(
      lines.filter((c) => parseTaskLine(c).json['task_id'] === 'beef9999dead'),
    ).toHaveLength(0);
  });
});
