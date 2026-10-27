import { afterEach, describe, expect, it, vi } from 'vitest';

// 2026-10-26-turn-phase-prod-fix task-01：观测三态单测（FR-03）。
// (event, kv) 形态对齐 daemon Logger；注入 log fn 断言（缺省 console 形态由
// daemon.log 实证收纳，不在单测里跑真 console）。

const {
  notePhaseEmit,
  warnOncePhaseFailure,
  resetTurnPhaseObservabilityForTest,
  turnPhaseTraceEnabled,
} = await import('../src/turn-phase-observability.js');

function makeLog(): ReturnType<typeof vi.fn> {
  return vi.fn();
}

afterEach(() => {
  resetTurnPhaseObservabilityForTest();
  delete process.env.SILLYHUB_TURN_PHASE_TRACE;
});

describe('turnPhaseTraceEnabled', () => {
  it('缺省关 / =1 开', () => {
    // 并发批次下其他测试文件可能残留同名 env——显式清零起点，不依赖外部干净态。
    delete process.env.SILLYHUB_TURN_PHASE_TRACE;
    expect(turnPhaseTraceEnabled()).toBe(false);
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    expect(turnPhaseTraceEnabled()).toBe(true);
  });
});

describe('notePhaseEmit（成功观测）', () => {
  it('默认静默（现状保持）', () => {
    const log = makeLog();
    notePhaseEmit('turn_control_inject', 's1', 'r1', 'inject_received', log);
    expect(log).not.toHaveBeenCalled();
  });

  it('TRACE=1 时记 info（(event, kv) 形态，含 point/phase/run_id）', () => {
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    const log = makeLog();
    notePhaseEmit('events', 's1', 'r1', 'first_event', log);
    expect(log).toHaveBeenCalledTimes(1);
    const [event, kv] = log.mock.calls[0]!;
    expect(event).toBe('turn_phase_emit');
    expect(kv).toMatchObject({ point: 'events', phase: 'first_event', run_id: 'r1' });
  });

  // 2026-10-27-task-wakeup-inject-retry FR-05：per(point,session,run) 防重——
  // session-manager 侧每 envelope 无状态直发（D-013④），TRACE 开启时同 run 记点
  // 曾随 envelope 数刷 30+ 行（daemon.log 323219-323256 实证）；首记保留断链
  // 配对能力，同键后续静默。
  it('同 (point,session,run) 键防重仅首记输出；不同 run 各自首记', () => {
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    const log = makeLog();
    notePhaseEmit('events_first_event', 's1', 'r1', 'first_event', log);
    notePhaseEmit('events_first_event', 's1', 'r1', 'first_event', log);
    notePhaseEmit('events_first_event', 's1', 'r1', 'first_event', log);
    expect(log).toHaveBeenCalledTimes(1);
    // 不同 run / 不同 point 不受影响（新键首记）。
    notePhaseEmit('events_first_event', 's1', 'r2', 'first_event', log);
    notePhaseEmit('daemon_bridge_first_event', 's1', 'r1', 'first_event', log);
    expect(log).toHaveBeenCalledTimes(3);
  });

  it('有界：超 512 键逐出最旧（被逐键可再记）', () => {
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    const log = makeLog();
    for (let i = 0; i < 512; i++) {
      notePhaseEmit('p', `s${i}`, 'r', 'first_event', log);
    }
    expect(log).toHaveBeenCalledTimes(512);
    notePhaseEmit('p', 's0', 'r', 'first_event', log); // 已在集合 → 静默
    expect(log).toHaveBeenCalledTimes(512);
    notePhaseEmit('p', 's_new', 'r', 'first_event', log); // 逐出 s0 后新键入集
    expect(log).toHaveBeenCalledTimes(513);
  });
});

describe('warnOncePhaseFailure（失败首警去重）', () => {
  it('首次 warn，同 session+phase 后续去重', () => {
    const log = makeLog();
    warnOncePhaseFailure('daemon', 's1', 'r1', 'inject_received', new Error('HTTP 502'), log);
    warnOncePhaseFailure('daemon', 's1', 'r2', 'inject_received', new Error('HTTP 503'), log);
    expect(log).toHaveBeenCalledTimes(1);
    const [event, kv] = log.mock.calls[0]!;
    expect(event).toBe('turn_phase_report_failed_once');
    expect(kv).toMatchObject({ phase: 'inject_received', error: 'HTTP 502' });
  });

  it('不同 phase 各自首警；Error 之外的错误形态转字符串', () => {
    const log = makeLog();
    warnOncePhaseFailure('daemon', 's1', 'r1', 'inject_received', 'boom', log);
    warnOncePhaseFailure('daemon', 's1', 'r1', 'first_event', { weird: true }, log);
    expect(log).toHaveBeenCalledTimes(2);
    expect(log.mock.calls[0]![1]).toMatchObject({ error: 'boom' });
    expect(log.mock.calls[1]![1]).toMatchObject({ phase: 'first_event' });
  });

  it('有界：超 512 键逐出最旧（被逐键可再警）', () => {
    const log = makeLog();
    for (let i = 0; i < 512; i++) {
      warnOncePhaseFailure('daemon', `s${i}`, 'r', 'p', 'e', log);
    }
    expect(log).toHaveBeenCalledTimes(512);
    warnOncePhaseFailure('daemon', 's0', 'r', 'p', 'e', log); // 已在集合 → 静默
    expect(log).toHaveBeenCalledTimes(512);
    warnOncePhaseFailure('daemon', 's_new', 'r', 'p', 'e', log); // 逐出 s0 后新键入集
    expect(log).toHaveBeenCalledTimes(513);
  });
});
