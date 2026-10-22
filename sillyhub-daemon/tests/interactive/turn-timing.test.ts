/**
 * interactive/turn-timing 单测 —— 每轮 TTFT / attempt 派生 + 接线
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-025@v1 / D-026@v1 /
 *  FR-11, FR-15 / task-10）。
 *
 * 覆盖（= TaskCard acceptance ①②③④⑤ + 接线断言）：
 *   ① 首 token 锚点：轮首 + 两条 delta → `ttftMs` = 首条 delta − 轮首（第二条不覆盖）；
 *   ② 同一轮多次 attempt：tool_use 切分、tool_result 之后的最后一条为下一段起点；
 *   ③ 空流 / 只有生命周期事件 / 轮首时间缺失 → `null`（不是 `{ttftMs: 0}`）；
 *   ④ 时间戳缺失 → `basis="approx"` 且 `ttftMs`/`firstTokenAt` 为 null（不伪造 0）；
 *   ⑤ 工具时间不计入模型占用：attempt 区间与工具区间零重叠（含并行工具批）；
 *   另：`_onResult` 采集仍不阻塞终态；`timing` 与 `file_changes` 走**同一次**上报
 *   （reporter 只被调一次、daemon 唯一组装点同一 payload），键集合不含 design 之外的
 *   旁路键（无 `timingCapability`）。
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SDKResultMessage } from '@anthropic-ai/claude-agent-sdk';

/** 受控采集状态（vi.mock 工厂里只能引用 `vi.hoisted` 的值）。 */
const hoisted = vi.hoisted(() => {
  const calls: Record<string, unknown>[] = [];
  const pending: Array<{
    resolve: (value: unknown) => void;
    reject: (error: unknown) => void;
  }> = [];
  return { calls, pending };
});

vi.mock('../../src/interactive/turn-file-changes.js', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../src/interactive/turn-file-changes.js')>();
  return {
    ...actual,
    readBaselineHead: vi.fn(async () => 'head-sha-0'),
    collectTurnFileChanges: vi.fn((input: Record<string, unknown>) => {
      hoisted.calls.push(input);
      return new Promise((resolve, reject) => {
        hoisted.pending.push({ resolve, reject });
      });
    }),
  };
});

import { SessionManager } from '../../src/interactive/session-manager.js';
import type {
  InteractiveDriverCallbacks,
  TurnMessageEnvelope,
} from '../../src/interactive/driver.js';
import type { ClaudeSdkDriver } from '../../src/interactive/claude-sdk-driver.js';
import type {
  TurnFileChangesSnapshot,
  TurnSnapshotReport,
} from '../../src/interactive/turn-file-changes-types.js';
import {
  deriveTurnTiming,
  timingEventFromAgentEvent,
  type TurnTimingEvent,
  type TurnTimingSnapshot,
} from '../../src/interactive/turn-timing.js';
import { buildRunSnapshotPayload } from '../../src/daemon.js';

/* ── 夹具 ────────────────────────────────────────────────────────────────── */

/** 固定基准时刻（UTC，避免本地时区影响 ISO 断言）。 */
const T0 = Date.UTC(2026, 9, 21, 9, 0, 0);

/** epoch ms → ISO（与派生输出同口径）。 */
function iso(ms: number): string {
  return new Date(ms).toISOString();
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function flush(): Promise<void> {
  return (async () => {
    await sleep(0);
    await sleep(0);
  })();
}

type Interval = { start: number; end: number };

/** 半开区间交叠长度（0 = 零重叠，端点相接不算交叠）。 */
function overlapMs(a: Interval, b: Interval): number {
  return Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
}

/** ISO 字符串 → epoch ms（DTO → 区间断言用）。 */
function at(isoString: string | null): number | null {
  return isoString === null ? null : Date.parse(isoString);
}

/* ══════════════════════════════════════════════════════════════════════════
 * ① 首 token 锚点
 * ══════════════════════════════════════════════════════════════════════════ */

describe('deriveTurnTiming × 首 token 锚点', () => {
  it('首条 delta − 轮首 = ttft；后续 delta 不覆盖 firstTokenAt', () => {
    const events: TurnTimingEvent[] = [
      { kind: 'text', atMs: T0 + 300 },
      { kind: 'text', atMs: T0 + 900 },
    ];
    const snapshot = deriveTurnTiming(events, {
      runId: 'run-1',
      turnStartedAtMs: T0,
      turnEndedAtMs: T0 + 2_000,
      model: 'claude-sonnet-4',
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.runId).toBe('run-1');
    expect(snapshot!.basis).toBe('approx');
    expect(snapshot!.ttftMs).toBe(300);
    expect(snapshot!.totalMs).toBe(2_000);
    expect(snapshot!.attempts).toHaveLength(1);

    const attempt = snapshot!.attempts[0]!;
    expect(attempt.index).toBe(0);
    expect(attempt.startedAt).toBe(iso(T0));
    expect(attempt.firstTokenAt).toBe(iso(T0 + 300)); // 首条，不是 T0+900
    expect(attempt.endedAt).toBe(iso(T0 + 2_000));
    expect(attempt.model).toBe('claude-sonnet-4');
    expect(at(attempt.firstTokenAt)! - at(attempt.startedAt)!).toBe(300);
  });

  it('thinking 也算首 token；事件自带 model / tokens 覆盖会话模型', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'thinking', atMs: T0 + 120, model: 'claude-opus-4' },
        {
          kind: 'text',
          atMs: T0 + 400,
          tokens: { input: 1_200, output: 80 },
        },
      ],
      { runId: 'run-2', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_000 },
    );

    expect(snapshot!.ttftMs).toBe(120);
    expect(snapshot!.attempts[0]!.model).toBe('claude-opus-4');
    expect(snapshot!.attempts[0]!.inputTokens).toBe(1_200);
    expect(snapshot!.attempts[0]!.outputTokens).toBe(80);
  });

  it('纯函数：同输入恒同输出，且不改写入参数组', () => {
    const events: TurnTimingEvent[] = [{ kind: 'text', atMs: T0 + 250 }];
    const opts = {
      runId: 'run-3',
      turnStartedAtMs: T0,
      turnEndedAtMs: T0 + 900,
      model: 'claude-sonnet-4',
    };
    const first = deriveTurnTiming(events, opts);
    const second = deriveTurnTiming(events, opts);
    expect(second).toEqual(first);
    expect(events).toEqual([{ kind: 'text', atMs: T0 + 250 }]);
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ② 同一轮多次 attempt（工具切分）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('deriveTurnTiming × 多次 attempt（工具切分）', () => {
  it('tool_use 收口当前 attempt，tool_result 之后开下一段', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'thinking', atMs: T0 + 100 },
        { kind: 'text', atMs: T0 + 200 },
        { kind: 'tool_use', atMs: T0 + 400 }, // 第 1 段结束
        { kind: 'tool_result', atMs: T0 + 900 },
        { kind: 'text', atMs: T0 + 1_000 }, // 第 2 段首 token
        { kind: 'tool_use', atMs: T0 + 1_300 }, // 第 2 段结束
        { kind: 'tool_result', atMs: T0 + 1_500 },
        { kind: 'text', atMs: T0 + 1_600 }, // 第 3 段首 token
      ],
      {
        runId: 'run-multi',
        turnStartedAtMs: T0,
        turnEndedAtMs: T0 + 2_000,
      },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.attempts).toHaveLength(3);
    expect(snapshot!.attempts.map((a) => a.index)).toEqual([0, 1, 2]);
    expect(snapshot!.attempts.map((a) => at(a.startedAt))).toEqual([
      T0,
      T0 + 900,
      T0 + 1_500,
    ]);
    expect(snapshot!.attempts.map((a) => at(a.endedAt))).toEqual([
      T0 + 400,
      T0 + 1_300,
      T0 + 2_000,
    ]);
    expect(snapshot!.attempts.map((a) => at(a.firstTokenAt))).toEqual([
      T0 + 100,
      T0 + 1_000,
      T0 + 1_600,
    ]);
    // 轮级 TTFT 只取首段（多段各自的延迟由 firstTokenAt − startedAt 现算）。
    expect(snapshot!.ttftMs).toBe(100);
    expect(snapshot!.totalMs).toBe(2_000);
  });

  it('一次工具批含多条 result：下一段起点取「最后一条 result」（避免跨工具区间）', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'text', atMs: T0 + 50 },
        { kind: 'tool_use', atMs: T0 + 200 },
        { kind: 'tool_use', atMs: T0 + 250 },
        { kind: 'tool_result', atMs: T0 + 700 },
        { kind: 'tool_result', atMs: T0 + 1_100 },
        { kind: 'text', atMs: T0 + 1_200 },
      ],
      { runId: 'run-batch', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_500 },
    );

    expect(snapshot!.attempts).toHaveLength(2);
    expect(snapshot!.attempts[1]!.startedAt).toBe(iso(T0 + 1_100)); // 不是 T0+700
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ③ 空流 / 无模型输出 → null（不返回空壳、不伪造 0）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('deriveTurnTiming × 无法派生 → null', () => {
  it('零事件 → null（不是 { ttftMs: 0 }）', () => {
    expect(
      deriveTurnTiming([], {
        runId: 'run-empty',
        turnStartedAtMs: T0,
        turnEndedAtMs: T0 + 1_000,
      }),
    ).toBeNull();
  });

  it('只有生命周期事件（status / error / turn_result，无模型输出）→ null', () => {
    expect(
      deriveTurnTiming(
        [
          { kind: 'status', atMs: T0 + 10 },
          { kind: 'error', atMs: T0 + 20 },
          { kind: 'turn_result', atMs: T0 + 30 },
        ],
        { runId: 'run-lifecycle', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_000 },
      ),
    ).toBeNull();
  });

  it('轮首时间缺失 → null（没有总时长与首段起点，派生即猜测）', () => {
    expect(
      deriveTurnTiming([{ kind: 'text', atMs: T0 + 100 }], {
        runId: 'run-no-start',
        turnEndedAtMs: T0 + 1_000,
      }),
    ).toBeNull();
    expect(
      deriveTurnTiming([{ kind: 'text', atMs: T0 + 100 }], {
        runId: 'run-no-start-2',
        turnStartedAtMs: null,
        turnEndedAtMs: T0 + 1_000,
      }),
    ).toBeNull();
  });

  it('runId 为空 / 轮长为零或负 → null（不可作键、画不出区间）', () => {
    expect(
      deriveTurnTiming([{ kind: 'text', atMs: T0 + 100 }], {
        runId: '',
        turnStartedAtMs: T0,
        turnEndedAtMs: T0 + 1_000,
      }),
    ).toBeNull();
    expect(
      deriveTurnTiming([{ kind: 'text', atMs: T0 }], {
        runId: 'run-zero',
        turnStartedAtMs: T0,
        turnEndedAtMs: T0,
      }),
    ).toBeNull();
  });

  it('只有工具调用、模型没产文本：attempt 照出但 firstTokenAt/ttftMs 为 null', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'tool_use', atMs: T0 + 400 },
        { kind: 'tool_result', atMs: T0 + 900 },
      ],
      { runId: 'run-tool-only', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_200 },
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot!.attempts).toHaveLength(1);
    expect(snapshot!.attempts[0]!.firstTokenAt).toBeNull();
    expect(snapshot!.ttftMs).toBeNull(); // 不填 0 冒充
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ④ 时间戳缺失 → basis="approx" 且不伪造 ttft
 * ══════════════════════════════════════════════════════════════════════════ */

describe('deriveTurnTiming × 时间戳缺失', () => {
  it('首 token 事件无 atMs → 有 attempt、ttft 为 null、口径仍是 approx', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'text' }, // 知道有首 token，但不知道它什么时候到
        { kind: 'text', atMs: T0 + 500 },
      ],
      { runId: 'run-untimed', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_000 },
    );

    expect(snapshot).not.toBeNull();
    expect(snapshot!.basis).toBe('approx');
    expect(snapshot!.ttftMs).toBeNull(); // 禁填 0 冒充
    expect(snapshot!.attempts).toHaveLength(1);
    expect(snapshot!.attempts[0]!.startedAt).toBe(iso(T0));
    expect(snapshot!.attempts[0]!.firstTokenAt).toBeNull();
    expect(snapshot!.attempts[0]!.endedAt).toBe(iso(T0 + 1_000));
    // 有 attempt 区间但无首 token：不是「伪造的 0」
    expect(at(snapshot!.attempts[0]!.firstTokenAt)).toBeNull();
  });

  it('全部事件无时间戳但轮首/轮终已知 → 一段无首 token 的 attempt（不猜时刻）', () => {
    const snapshot = deriveTurnTiming(
      [{ kind: 'thinking' }, { kind: 'text' }],
      { runId: 'run-untimed-2', turnStartedAtMs: T0, turnEndedAtMs: T0 + 800 },
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot!.ttftMs).toBeNull();
    expect(snapshot!.attempts).toHaveLength(1);
    expect(snapshot!.totalMs).toBe(800);
  });

  it('无时间戳的工具事件不参与切分（区间保持零重叠，不靠猜）', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'text', atMs: T0 + 100 },
        { kind: 'tool_use' }, // 无时间戳：不开工具区间、不收口
        { kind: 'tool_result' },
        { kind: 'text', atMs: T0 + 600 },
      ],
      { runId: 'run-untimed-tool', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_000 },
    );
    expect(snapshot).not.toBeNull();
    expect(snapshot!.attempts).toHaveLength(1);
    expect(snapshot!.attempts[0]!.endedAt).toBe(iso(T0 + 1_000));
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * ⑤ 工具时间不计入模型占用（attempt × tool 零重叠）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('deriveTurnTiming × 工具区间与 attempt 零重叠', () => {
  /** 并行工具批 + 两段模型的固定夹具（含先后返回的 result）。 */
  const events: TurnTimingEvent[] = [
    { kind: 'thinking', atMs: T0 + 100 },
    { kind: 'text', atMs: T0 + 200 },
    { kind: 'tool_use', atMs: T0 + 300 },
    { kind: 'tool_use', atMs: T0 + 350 },
    { kind: 'tool_result', atMs: T0 + 800 },
    { kind: 'tool_result', atMs: T0 + 1_200 },
    { kind: 'text', atMs: T0 + 1_300 },
    { kind: 'tool_use', atMs: T0 + 1_500 },
    { kind: 'tool_result', atMs: T0 + 1_900 },
    { kind: 'text', atMs: T0 + 2_000 },
  ];
  /** 由夹具事件直接读出的工具区间（半开）：与派生实现独立。 */
  const tools: Interval[] = [
    { start: T0 + 300, end: T0 + 800 },
    { start: T0 + 350, end: T0 + 1_200 },
    { start: T0 + 1_500, end: T0 + 1_900 },
  ];

  it('每个 attempt 与每个工具区间交叠长度恒为 0', () => {
    const snapshot = deriveTurnTiming(events, {
      runId: 'run-overlap',
      turnStartedAtMs: T0,
      turnEndedAtMs: T0 + 2_400,
    });

    expect(snapshot).not.toBeNull();
    expect(snapshot!.attempts).toHaveLength(3);
    const attempts: Interval[] = snapshot!.attempts.map((a) => ({
      start: at(a.startedAt)!,
      end: at(a.endedAt)!,
    }));
    for (const attempt of attempts) {
      for (const tool of tools) {
        expect(overlapMs(attempt, tool)).toBe(0);
      }
    }
  });

  it('attempt 总时长 + 工具区间并集 = 轮总时长（工具时间没被算进模型占用）', () => {
    const snapshot = deriveTurnTiming(events, {
      runId: 'run-overlap-2',
      turnStartedAtMs: T0,
      turnEndedAtMs: T0 + 2_400,
    });
    const attemptTotal = snapshot!.attempts.reduce(
      (sum, a) => sum + (at(a.endedAt)! - at(a.startedAt)!),
      0,
    );
    // 工具区间并集：[300,1200) + [1500,1900) = 900 + 400
    const toolUnionTotal = 900 + 400;
    expect(attemptTotal).toBe(2_400 - toolUnionTotal);
  });

  it('工具执行期到达的 text/thinking 不计入模型占用（子代理/回显噪声）', () => {
    const snapshot = deriveTurnTiming(
      [
        { kind: 'text', atMs: T0 + 100 },
        { kind: 'tool_use', atMs: T0 + 200 },
        // 工具执行中（200→900）到达的"模型输出"：不属于主模型占用。
        { kind: 'text', atMs: T0 + 500 },
        { kind: 'thinking', atMs: T0 + 600 },
        { kind: 'tool_result', atMs: T0 + 900 },
        { kind: 'text', atMs: T0 + 1_000 },
      ],
      { runId: 'run-tool-noise', turnStartedAtMs: T0, turnEndedAtMs: T0 + 1_400 },
    );

    expect(snapshot!.attempts).toHaveLength(2);
    expect(snapshot!.attempts[0]!.endedAt).toBe(iso(T0 + 200));
    expect(snapshot!.attempts[1]!.startedAt).toBe(iso(T0 + 900));
    expect(snapshot!.attempts[1]!.firstTokenAt).toBe(iso(T0 + 1_000)); // 不是 T0+500
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 事件映射（AgentEvent → 派生输入）
 * ══════════════════════════════════════════════════════════════════════════ */

describe('timingEventFromAgentEvent × 只读既有字段', () => {
  it('4 类参与派生的事件映射 kind / atMs / usage；生命周期事件返回 null', () => {
    expect(timingEventFromAgentEvent({ type: 'text' }, T0 + 10)).toEqual({
      kind: 'text',
      atMs: T0 + 10,
    });
    expect(timingEventFromAgentEvent({ type: 'thinking' }, T0 + 11)).toEqual({
      kind: 'thinking',
      atMs: T0 + 11,
    });
    expect(timingEventFromAgentEvent({ type: 'tool_use' }, T0 + 12)).toEqual({
      kind: 'tool_use',
      atMs: T0 + 12,
    });
    expect(timingEventFromAgentEvent({ type: 'tool_result' }, T0 + 13)).toEqual({
      kind: 'tool_result',
      atMs: T0 + 13,
    });
    expect(
      timingEventFromAgentEvent(
        {
          type: 'text',
          usage: { input_tokens: 100, output_tokens: 20 },
          metadata: { model: 'claude-sonnet-4' },
        },
        T0 + 14,
      ),
    ).toEqual({
      kind: 'text',
      atMs: T0 + 14,
      model: 'claude-sonnet-4',
      tokens: { input: 100, output: 20 },
    });
    for (const type of ['status', 'error', 'turn_result', 'complete']) {
      expect(timingEventFromAgentEvent({ type }, T0)).toBeNull();
    }
  });
});

/* ══════════════════════════════════════════════════════════════════════════
 * 接线（session-manager / daemon 唯一组装点）
 * ══════════════════════════════════════════════════════════════════════════ */

function resultSuccess(text: string): SDKResultMessage {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: text,
    num_turns: 1,
    duration_ms: 1,
    duration_api_ms: 1,
    stop_reason: 'end_turn',
    total_cost_usd: 0,
    usage: { input_tokens: 1, output_tokens: 1 },
    modelUsage: {},
    permission_denials: [],
    session_id: 'sdk-sess',
    uuid: 'r1',
  } as unknown as SDKResultMessage;
}

function makeMockDriver() {
  let captured: InteractiveDriverCallbacks | null = null;
  const driver = {
    start: vi.fn(async () => ({ interrupt: vi.fn(async () => {}) })),
    consume: vi.fn(async (_handle: unknown, cb: InteractiveDriverCallbacks) => {
      captured = cb; // 不自动 yield：测试按需注入
    }),
    interrupt: vi.fn(async () => true),
  } as unknown as ClaudeSdkDriver;
  return {
    driver,
    emitResult: (r: SDKResultMessage) => captured?.onTurnResult?.(r),
    emitMessage: (m: TurnMessageEnvelope) => captured?.onTurnMessage?.(m),
  };
}

function makeDeps() {
  return {
    onTurnResult: vi.fn(async () => {}),
    onTurnMessage: vi.fn(async () => {}),
    onSessionEnd: vi.fn(async () => {}),
  };
}

const BASE_INPUT = {
  sessionId: 'sess-timing',
  leaseId: 'lease-timing',
  firstPrompt: 'hi',
  firstRunId: 'run-1',
  cwd: 'C:\\work',
  provider: 'claude' as const,
  pathToClaudeCodeExecutable: 'C:\\bin\\claude.exe',
  model: 'claude-sonnet-4',
};

/** 一份形状合法的快照桩（采集器被 mock，内容不重要，形状要对）。 */
function snapshotStub(): TurnFileChangesSnapshot {
  return {
    runId: 'run-1',
    baselineHead: 'head-sha-0',
    collectedAt: new Date().toISOString(),
    collectMs: 12,
    status: 'ok',
    files: [],
    concurrentSessionsHint: true,
  };
}

beforeEach(() => {
  hoisted.calls.length = 0;
  hoisted.pending.length = 0;
});

describe('session-manager × turn-timing：同一次上报 + 不阻塞终态', () => {
  it('timing 与 file_changes 同一次 report（reporter 只 1 次）；_onResult 不等采集', async () => {
    const { driver, emitResult, emitMessage } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reports: TurnSnapshotReport[] = [];
    sm.setTurnSnapshotReporter((r) => {
      reports.push(r);
    });

    await sm.create(BASE_INPUT);
    await flush(); // E1 基线解析（mock：head-sha-0）

    // 轮首之后才出现首 token：TTFT > 0（真实墙钟，观察时刻由 _onMessage 取）。
    await sleep(15);
    await emitMessage({ events: [{ type: 'text', content: 'hello' }] });
    await sleep(5);

    const started = Date.now();
    // 采集被 deferred 挂住：若 _onResult await 了它，这里必然撞 300ms 超时臂。
    const winner = await Promise.race([
      (emitResult(resultSuccess('turn-1')) as Promise<void>).then(() => 'done'),
      sleep(300).then(() => 'timeout'),
    ]);
    expect(winner).toBe('done');
    expect(Date.now() - started).toBeLessThan(300);
    expect(hoisted.calls).toHaveLength(1); // 本轮一次采集
    expect(reports).toHaveLength(0); // 快照后到：上报尚未发生

    const snapshot = snapshotStub();
    hoisted.pending[0]!.resolve(snapshot);
    await flush();

    // 一轮只上报一次：timing 没有另起调用（hub 侧调用次数不增加）。
    expect(reports).toHaveLength(1);
    expect(hoisted.calls).toHaveLength(1); // 采集也只 1 次
    const report = reports[0]!;
    expect(report.runId).toBe('run-1');
    expect(report.fileChanges).toEqual(snapshot);
    // report 键集合：只有 task-09 四字段 + timing（无 `timingCapability` 旁路键）。
    expect(Object.keys(report).sort()).toEqual(
      ['sessionId', 'runId', 'workspaceRoot', 'fileChanges', 'timing'].sort(),
    );
    expect('timingCapability' in report).toBe(false);

    expect(report.timing).toBeDefined();
    const timing = report.timing as unknown as TurnTimingSnapshot;
    expect(timing.runId).toBe('run-1');
    expect(timing.basis).toBe('approx');
    expect(timing.attempts).toHaveLength(1);
    expect(timing.ttftMs).not.toBeNull();
    expect(timing.ttftMs!).toBeGreaterThan(0); // 真的量到了首 token 延迟
    expect(timing.totalMs).toBeGreaterThanOrEqual(timing.ttftMs!);
    expect(timing.attempts[0]!.model).toBe('claude-sonnet-4');
    expect(timing.attempts[0]!.firstTokenAt).not.toBeNull();
    expect(at(timing.attempts[0]!.endedAt)!).toBeGreaterThanOrEqual(
      at(timing.attempts[0]!.startedAt)!,
    );

    // 键集合 == design「1b 承载面与读模型字段」的 TurnTimingSnapshot 字段集合：
    // 不出现 `timingCapability` 之类旁路键（契约纪律）。
    expect(Object.keys(timing).sort()).toEqual(
      ['attempts', 'basis', 'runId', 'totalMs', 'ttftMs'].sort(),
    );
    const attemptKeys = [
      'index',
      'startedAt',
      'firstTokenAt',
      'endedAt',
      'model',
      'inputTokens',
      'outputTokens',
    ];
    const actualAttemptKeys = Object.keys(timing.attempts[0]!);
    expect(actualAttemptKeys.sort()).toEqual(
      expect.arrayContaining(['index', 'startedAt', 'firstTokenAt', 'endedAt', 'model'].sort()),
    );
    // 无 design 之外的键（tokens 两个可选键本轮无 usage → 不出现）。
    expect(actualAttemptKeys.every((key) => attemptKeys.includes(key))).toBe(true);
    // 无 usage 事件 → tokens 两个可选键都不写（不伪造 0）。
    expect('inputTokens' in timing.attempts[0]!).toBe(false);
    expect('outputTokens' in timing.attempts[0]!).toBe(false);

    // daemon 唯一组装点：同一 payload 里同时带 file_changes 与 timing（无第二次调用）。
    const payload = buildRunSnapshotPayload({
      terminal: { status: 'success', is_error: false },
      fileChanges: report.fileChanges,
      ...(report.timing !== undefined ? { timing: report.timing } : {}),
      daemonVersion: '0.1.1',
    });
    expect(payload.file_changes).toBe(report.fileChanges);
    expect(payload.timing).toBe(report.timing);
    expect(Object.keys(payload).sort()).toEqual(
      ['status', 'is_error', 'file_changes', 'timing', 'daemon_version'].sort(),
    );
    expect('timingCapability' in payload).toBe(false);
  });

  it('零事件轮：上报体里没有 timing 键（版本门控：整体省略，不是空对象）', async () => {
    const { driver, emitResult } = makeMockDriver();
    const sm = new SessionManager({ driver, ...makeDeps() });
    const reports: TurnSnapshotReport[] = [];
    sm.setTurnSnapshotReporter((r) => {
      reports.push(r);
    });

    await sm.create(BASE_INPUT);
    await flush();
    await sleep(2); // 让轮时长 > 0，确保 null 的原因是「没有模型输出」而不是零时长
    await (emitResult(resultSuccess('turn-1')) as Promise<void>);
    hoisted.pending[0]!.resolve(snapshotStub());
    await flush();

    expect(reports).toHaveLength(1);
    expect('timing' in reports[0]!).toBe(false);
    expect(reports[0]!.timing).toBeUndefined();
    // 同一 payload 组装点在 timing 缺失时也不写键（不做 basis 壳）。
    const payload = buildRunSnapshotPayload({
      terminal: { status: 'success', is_error: false },
      fileChanges: reports[0]!.fileChanges,
    });
    expect('timing' in payload).toBe(false);
  });
});
