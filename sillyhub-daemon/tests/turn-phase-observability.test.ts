import { afterEach, describe, expect, it, vi } from 'vitest';

// 2026-10-26-turn-phase-prod-fix task-01：观测三态单测（FR-03）。

const {
  notePhaseEmit,
  warnOncePhaseFailure,
  resetTurnPhaseObservabilityForTest,
  turnPhaseTraceEnabled,
} = await import('../src/turn-phase-observability.js');

function makeLogger() {
  return { info: vi.fn(), warn: vi.fn() };
}

afterEach(() => {
  resetTurnPhaseObservabilityForTest();
  delete process.env.SILLYHUB_TURN_PHASE_TRACE;
});

describe('turnPhaseTraceEnabled', () => {
  it('缺省关 / =1 开', () => {
    expect(turnPhaseTraceEnabled()).toBe(false);
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    expect(turnPhaseTraceEnabled()).toBe(true);
  });
});

describe('notePhaseEmit（成功观测）', () => {
  it('默认静默（现状保持）', () => {
    const log = makeLogger();
    notePhaseEmit(log, 'inject', 's1', 'r1', 'inject_received');
    expect(log.info).not.toHaveBeenCalled();
  });

  it('TRACE=1 时记 info（含 point/phase/run_id）', () => {
    process.env.SILLYHUB_TURN_PHASE_TRACE = '1';
    const log = makeLogger();
    notePhaseEmit(log, 'events', 's1', 'r1', 'first_event');
    expect(log.info).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.info.mock.calls[0]!;
    expect(msg).toBe('turn_phase_emit');
    expect(fields).toMatchObject({ point: 'events', phase: 'first_event', run_id: 'r1' });
  });
});

describe('warnOncePhaseFailure（失败首警去重）', () => {
  it('首次 warn，同 session+phase 后续去重', () => {
    const log = makeLogger();
    warnOncePhaseFailure(log, 'daemon', 's1', 'r1', 'inject_received', new Error('HTTP 502'));
    warnOncePhaseFailure(log, 'daemon', 's1', 'r2', 'inject_received', new Error('HTTP 503'));
    expect(log.warn).toHaveBeenCalledTimes(1);
    const [fields, msg] = log.warn.mock.calls[0]!;
    expect(msg).toBe('turn_phase_report_failed_once');
    expect(fields).toMatchObject({ phase: 'inject_received', error: 'HTTP 502' });
  });

  it('不同 phase 各自首警；Error 之外的错误形态转字符串', () => {
    const log = makeLogger();
    warnOncePhaseFailure(log, 'daemon', 's1', 'r1', 'inject_received', 'boom');
    warnOncePhaseFailure(log, 'daemon', 's1', 'r1', 'first_event', { weird: true });
    expect(log.warn).toHaveBeenCalledTimes(2);
    expect(log.warn.mock.calls[0]![0]).toMatchObject({ error: 'boom' });
    expect(log.warn.mock.calls[1]![0]).toMatchObject({ phase: 'first_event' });
  });

  it('有界：超 512 键逐出最旧（新键可再警）', () => {
    const log = makeLogger();
    for (let i = 0; i < 512; i++) {
      warnOncePhaseFailure(log, 'daemon', `s${i}`, 'r', 'p', 'e');
    }
    expect(log.warn).toHaveBeenCalledTimes(512);
    warnOncePhaseFailure(log, 'daemon', 's0', 'r', 'p', 'e'); // 已在集合 → 静默
    expect(log.warn).toHaveBeenCalledTimes(512);
    warnOncePhaseFailure(log, 'daemon', 's_new', 'r', 'p', 'e'); // 逐出 s0 后新键入集
    expect(log.warn).toHaveBeenCalledTimes(513);
  });
});
