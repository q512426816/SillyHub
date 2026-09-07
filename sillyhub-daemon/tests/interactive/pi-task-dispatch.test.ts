// tests/interactive/pi-task-dispatch.test.ts
// 2026-09-07-pi-task-events task-03：pi 任务事件经 session-manager 分派集成用例
//（FR-02 / D-002@v1 / D-004；蓝图 .sillyspec/changes/2026-09-07-pi-task-events/tasks/task-03.md）。
//
// 证明链路：pi rpc JSONL → PiEventNormalizer.normalizeRpcLine（task-01 turnTask
// 派生，producer 契约真实，不经手写 status 事件）→ TurnMessageEnvelope →
// SessionManager._onMessage → _dispatchStatusEvent → _handleAgentTaskStatusEvent
// （注册表口径）→ deps.onSessionEvent 收 kind='agent_task_status'。
//
// pi envelope 无 Task/Agent tool_use → envelopeHasTaskToolUse=false（session-manager
// _onMessage 前置判定），agent_task_status 不走 tool_use 派生 emit 分支（仅 emit 裸
// {task_id, task_name, status:'running'}、不落行），而走注册表口径：running 首发注册
// + [TASK_STARTED] 落行、刷新 emit 携带 last_tool_name/tool_uses/summary + 
// [TASK_PROGRESS] 落行、终态 emit completed/failed（FR-02：session-manager 对 pi
// 零 provider 特判，全链路与 claude system/task_* 事件同一消费面）。
//
// harness 复用：tests/interactive/session-manager.test.ts 的 makeMockDriver/makeDeps
// 范式 + session-manager-provider-routing.test.ts 的 deps.drivers 注册表注入先例
//（fake InteractiveDriver 以 drivers:{pi:...} 注入，create({provider:'pi'})）。
// 事件源：真实 fixture（tests/fixtures/pi-rpc-events/manual-success-turn.jsonl /
// real-error-turn.jsonl，本机实跑采样）逐行喂 normalizeRpcLine，把产出 envelope
// 经捕获的 onTurnMessage 回调注入（与 PiEventNormalizer 文件头的 driver 用法契约一致）。

import { describe, it, expect, vi } from 'vitest';

import { SessionManager } from '../../src/interactive/session-manager.js';
import { PiEventNormalizer } from '../../src/interactive/pi-events.js';
import { safeParseAgentEvent } from '../../src/agent-event-schema.js';
import type { AgentEvent, SessionEventForBackend } from '../../src/types.js';
import type {
  InteractiveDriver,
  InteractiveDriverCallbacks,
  InteractiveDriverHandle,
  TurnMessageEnvelope,
} from '../../src/interactive/driver.js';
import { loadLines } from '../helpers';

// ── harness（复用 session-manager.test.ts 范式 + provider-routing 注册表注入）────

type AgentTaskStatusEvent = Extract<
  SessionEventForBackend,
  { kind: 'agent_task_status' }
>;

/** fake pi driver：捕获 start 的 consume 回调手柄，测试按需注入 envelope。 */
function makeFakePiDriver() {
  const handle: InteractiveDriverHandle = {
    provider: 'pi',
    processId: 9002,
    close: vi.fn(async () => {}),
  };
  let captured: InteractiveDriverCallbacks | null = null;
  const driver: InteractiveDriver = {
    start: vi.fn(async () => handle),
    consume: vi.fn(
      async (
        _h: InteractiveDriverHandle,
        cb: InteractiveDriverCallbacks,
      ): Promise<void> => {
        captured = cb;
        // 不自动 yield；测试按需注入 envelope。
      },
    ),
    interrupt: vi.fn(async (_h: InteractiveDriverHandle | null) => true),
  };
  return {
    driver,
    handle,
    /** 经捕获的 onTurnMessage 注入 envelope（真实 _onMessage 分派链路）。 */
    emitEnvelope: async (envelope: TurnMessageEnvelope): Promise<void> => {
      const cb = captured;
      if (!cb?.onTurnMessage) {
        throw new Error('driver.consume 回调未捕获（create 未启动消费协程）');
      }
      await cb.onTurnMessage(envelope);
    },
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async (_s: string, _r: string, _m: unknown) => {}),
    onSessionEnd: vi.fn(async (_s: string, _st: string) => {}),
    /** task-03 观测点：_emitSessionEvent 产出（session-manager.ts 消费点）。 */
    onSessionEvent: vi.fn(
      async (
        _sessionId: string,
        _runId: string,
        _event: SessionEventForBackend,
      ) => {},
    ),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-pi-task',
  leaseId: 'lease-pi',
  claimToken: 'token-pi',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'pi' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\pi.exe',
};

/** 建带 pi driver 注册的 SessionManager + 会话内 normalizer + feed 注入口。 */
async function setupPiSession() {
  const pi = makeFakePiDriver();
  const deps = makeDeps();
  const sm = new SessionManager({ drivers: { pi: pi.driver }, ...deps }, {});
  await sm.create(BASE_INPUT);

  // per-session 实例（PiEventNormalizer 文件头契约：单实例不可跨会话复用）。
  const normalizer = new PiEventNormalizer();
  /**
   * 喂一行 pi JSONL：normalizeRpcLine 产出 envelope（零产出行不注入——driver
   * 真实行为是产出空数组时不发 envelope）经捕获回调进入 _onMessage。
   * @returns 本行注入的事件（供 envelope 结构断言 / schema 校验收集）。
   */
  const feed = async (line: string): Promise<AgentEvent[]> => {
    const events = normalizer.normalizeRpcLine(line);
    if (events.length === 0) return [];
    await pi.emitEnvelope({ events });
    return events;
  };
  return { sm, deps, feed };
}

// ── fixture 行选取（真实实跑采样，行形状不手写）───────────────────────────────

const SUCCESS_LINES = loadLines('pi-rpc-events/manual-success-turn.jsonl');
const ERROR_LINES = loadLines('pi-rpc-events/real-error-turn.jsonl');

/** 取 fixture 中首个指定 type 的行（缺行抛错，防 fixture 漂移静默空转）。 */
function lineOfType(lines: string[], type: string): string {
  const line = lines.find((l) => {
    try {
      return (JSON.parse(l) as Record<string, unknown>).type === type;
    } catch {
      return false;
    }
  });
  if (line === undefined) throw new Error(`fixture 无 ${type} 行`);
  return line;
}

/** deps.onSessionEvent 收到的全部 agent_task_status 事件（按 emit 序）。 */
function taskEventsOf(deps: ReturnType<typeof makeDeps>): AgentTaskStatusEvent[] {
  return deps.onSessionEvent.mock.calls
    .map((c) => c[2])
    .filter((e): e is AgentTaskStatusEvent => e.kind === 'agent_task_status');
}

/** deps.onTurnMessage 收到的 [TASK_*] 落行 payload（legacy flat 行解析回对象）。 */
function taskLinePayloads(
  deps: ReturnType<typeof makeDeps>,
  prefix: '[TASK_STARTED]' | '[TASK_PROGRESS]',
): Record<string, unknown>[] {
  return deps.onTurnMessage.mock.calls
    .map((c) => c[2] as Record<string, unknown>)
    .filter(
      (m) =>
        typeof m['content'] === 'string' &&
        (m['content'] as string).startsWith(`${prefix} `),
    )
    .map((m) => JSON.parse((m['content'] as string).slice(prefix.length)) as Record<string, unknown>);
}

// ── 测试 ─────────────────────────────────────────────────────────────────────

describe('pi 任务事件经 session-manager 分派（task-03 / FR-02 / D-002@v1）', () => {
  it('turn_start → agent_task_status(running) emit + 注册表登记（task_id=pi-t1 / task_name=执行任务）', async () => {
    const { deps, feed } = await setupPiSession();

    await feed(lineOfType(SUCCESS_LINES, 'turn_start'));

    expect(deps.onSessionEvent).toHaveBeenCalledTimes(1);
    expect(deps.onSessionEvent).toHaveBeenCalledWith(
      'sess-pi-task',
      'run-1', // create 首轮 currentRunId（capture 派发 runId 登记）
      expect.objectContaining({
        kind: 'agent_task_status',
        task_id: 'pi-t1', // task-01 契约：pi-t<seq> 前缀
        task_name: '执行任务',
        status: 'running',
      }),
    );
    // 注册表口径证据：[TASK_STARTED] 落行（tool_use 派生口径只 emit 不落行）。
    const started = taskLinePayloads(deps, '[TASK_STARTED]');
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({
      task_id: 'pi-t1',
      task_name: '执行任务',
      async: true,
    });
  });

  it('tool_execution_start → running 刷新 emit（last_tool_name/tool_uses/summary，注册表口径而非 tool_use 派生口径）', async () => {
    const { deps, feed } = await setupPiSession();
    await feed(lineOfType(SUCCESS_LINES, 'turn_start'));

    const toolLine = lineOfType(SUCCESS_LINES, 'tool_execution_start');
    const events = await feed(toolLine);

    // 口径前置锚：本 envelope 的 status 事件先行、tool_use 工具名非 Task/Agent
    // → session-manager 前置判定 envelopeHasTaskToolUse=false。
    expect(events[0]).toMatchObject({ type: 'status', subtype: 'agent_task_status' });
    const toolEv = events.find((e) => e.type === 'tool_use');
    expect(toolEv).toBeDefined();
    expect(toolEv!.tool_name === 'Task' || toolEv!.tool_name === 'Agent').toBe(false);

    // 刷新 emit：注册表路径独有字段（tool_use 派生 emit 分支恒为裸三键）。
    expect(deps.onSessionEvent).toHaveBeenCalledTimes(2);
    expect(taskEventsOf(deps)[1]).toMatchObject({
      kind: 'agent_task_status',
      task_id: 'pi-t1',
      task_name: '执行任务',
      status: 'running',
      last_tool_name: 'bash',
      tool_uses: 1,
      summary: '正在调用 bash',
    });
    // 注册表口径另一证据：[TASK_PROGRESS] 落行（派生口径不落行）；
    // [TASK_STARTED] 不重复（注册幂等，同一任务行）。
    expect(taskLinePayloads(deps, '[TASK_PROGRESS]')).toHaveLength(1);
    expect(taskLinePayloads(deps, '[TASK_STARTED]')).toHaveLength(1);
  });

  it('turn_end(stop) → completed 终态 emit（pi-t1 running→completed 序列闭环）', async () => {
    const { deps, feed } = await setupPiSession();

    await feed(lineOfType(SUCCESS_LINES, 'turn_start'));
    await feed(lineOfType(SUCCESS_LINES, 'tool_execution_start'));
    await feed(lineOfType(SUCCESS_LINES, 'turn_end'));

    const statuses = taskEventsOf(deps)
      .filter((e) => e.task_id === 'pi-t1')
      .map((e) => e.status);
    expect(statuses).toEqual(['running', 'running', 'completed']);
    // 终态 emit 形状（registry task_name 回填；无 failed 漂移）。
    const terminal = taskEventsOf(deps).at(-1);
    expect(terminal).toMatchObject({
      kind: 'agent_task_status',
      task_id: 'pi-t1',
      task_name: '执行任务',
      status: 'completed',
    });
    expect(statuses).not.toContain('failed');
  });

  it('turn_end(stopReason=error) → failed 终态 + summary emit（实跑 429 fixture 形状）', async () => {
    const { deps, feed } = await setupPiSession();

    await feed(lineOfType(ERROR_LINES, 'turn_start'));
    const errorEndLine = ERROR_LINES.find((l) => {
      try {
        const o = JSON.parse(l) as { type?: string; message?: { stopReason?: string } };
        return o.type === 'turn_end' && o.message?.stopReason === 'error';
      } catch {
        return false;
      }
    });
    expect(errorEndLine).toBeDefined();
    await feed(errorEndLine!);

    const statuses = taskEventsOf(deps)
      .filter((e) => e.task_id === 'pi-t1')
      .map((e) => e.status);
    expect(statuses).toEqual(['running', 'failed']);
    const failed = taskEventsOf(deps).at(-1);
    expect(failed).toMatchObject({
      kind: 'agent_task_status',
      task_id: 'pi-t1',
      task_name: '执行任务',
      status: 'failed',
    });
    // summary 载 errorMessage（pi-events deriveTurnEnd：failed → summary=errorMessage）。
    expect(failed?.summary).toBeDefined();
    expect(failed?.summary).toContain('429');
  });

  it('全部经手 envelope 事件过 safeParseAgentEvent（producer 契约真实，agent_task_status 形状锚定）', async () => {
    const { feed } = await setupPiSession();

    const produced: AgentEvent[] = [];
    for (const line of SUCCESS_LINES) {
      produced.push(...(await feed(line)));
    }
    // 错误轮续喂同一状态机（成功轮已收行 open=false → turn_start 开 pi-t2 新行，
    // 顺带覆盖 task-01 的跨轮序号递增；归一化器自身形状已由 pi-events.test.ts 锚定）。
    produced.push(...(await feed(lineOfType(ERROR_LINES, 'turn_start'))));
    const errorEndLine = ERROR_LINES.find((l) => {
      try {
        const o = JSON.parse(l) as { type?: string; message?: { stopReason?: string } };
        return o.type === 'turn_end' && o.message?.stopReason === 'error';
      } catch {
        return false;
      }
    });
    produced.push(...(await feed(errorEndLine!)));

    expect(produced.length).toBeGreaterThan(0);
    for (const ev of produced) {
      const r = safeParseAgentEvent(ev);
      expect(r.success).toBe(true);
    }
    // 派生事件契约形状（task-01 D-001）：task_id 恒 pi-t 前缀 + task_name 恒名
    // + status 闭合枚举（成功轮 3 发 + 错误轮 2 发 ≥ 4）。
    const derived = produced.filter(
      (e) => e.type === 'status' && e.subtype === 'agent_task_status',
    );
    expect(derived.length).toBeGreaterThanOrEqual(4);
    for (const ev of derived) {
      const meta = ev.metadata as Record<string, unknown>;
      expect(String(meta['task_id'])).toMatch(/^pi-t\d+$/);
      expect(meta['task_name']).toBe('执行任务');
      expect(['running', 'completed', 'failed']).toContain(meta['status']);
    }
  });
});
