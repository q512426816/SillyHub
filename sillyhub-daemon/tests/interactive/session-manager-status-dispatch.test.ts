// 2026-10-28-model-retry-visible task-02：api_retry status 事件分发单测。
//
// 证明链路：claude-events 归一化器产出 status/api_retry 事件（task-01）→
// session-manager dispatchStatusEvent 新增 case → 落 [MODEL_RETRY] 单行 JSON
// stdout 协议行（形态对齐 ql-20260917-006 [COMPACT_STATUS] 先例，经
// deps.onTurnMessage 透传 backend 文本行落库 + SSE）。
//
// 直调 dispatchStatusEvent（跳过 SessionManager 全量 harness）：case 内仅消费
// mgr.deps.onTurnMessage / state.currentRunId / state.sessionId / ev.metadata，
// duck-type 最小替身即可（对齐 knowledge-hits-upload.ts 测试的最小替身惯例）。

import { describe, it, expect, vi } from 'vitest';

import { dispatchStatusEvent } from '../../src/interactive/session-manager/events.js';
import type { AgentEvent } from '../../src/types.js';

type OnTurnMessageReport = Record<string, unknown>;

/** 捕获 onTurnMessage 的最小 mgr 替身（本 case 消费面仅 deps.onTurnMessage）。 */
function makeMgr(captured: OnTurnMessageReport[]) {
  return {
    deps: {
      onTurnMessage: vi.fn(
        async (
          _sessionId: string,
          _runId: string,
          report: OnTurnMessageReport,
        ) => {
          captured.push(report);
        },
      ),
    },
  } as unknown as Parameters<typeof dispatchStatusEvent>[0];
}

/** 最小 state 替身（本 case 消费面仅 sessionId / currentRunId）。 */
function makeState(runId: string | undefined) {
  return {
    sessionId: 'sess-retry',
    currentRunId: runId,
  } as unknown as Parameters<typeof dispatchStatusEvent>[1];
}

function retryEvent(metadata: Record<string, unknown>): AgentEvent {
  return {
    type: 'status',
    subtype: 'api_retry',
    content: '',
    metadata,
  } as AgentEvent;
}

describe('dispatchStatusEvent — api_retry（2026-10-28-model-retry-visible）', () => {
  it('429 重试事件落 [MODEL_RETRY] 单行 JSON stdout 协议行（对齐 COMPACT_STATUS 形态）', async () => {
    const captured: OnTurnMessageReport[] = [];
    const mgr = makeMgr(captured);
    await dispatchStatusEvent(
      mgr,
      makeState('run-1'),
      retryEvent({
        attempt: 3,
        max_retries: 10,
        retry_delay_ms: 8000,
        error_status: 429,
        error: 'Request rejected (429) · [1311][当前订阅套餐暂未开放GLM-5.3]',
      }),
      false,
    );
    expect(captured).toHaveLength(1);
    expect(mgr.deps.onTurnMessage).toHaveBeenCalledWith(
      'sess-retry',
      'run-1',
      expect.anything(),
    );
    const report = captured[0]!;
    expect(report['event_type']).toBe('text');
    expect(report['channel']).toBe('stdout');
    const content = report['content'] as string;
    expect(content.startsWith('[MODEL_RETRY] ')).toBe(true);
    const payload = JSON.parse(content.slice('[MODEL_RETRY] '.length)) as Record<
      string,
      unknown
    >;
    expect(payload).toEqual({
      attempt: 3,
      max_retries: 10,
      retry_delay_ms: 8000,
      error_status: 429,
      error: 'Request rejected (429) · [1311][当前订阅套餐暂未开放GLM-5.3]',
    });
  });

  it('连接类重试 error_status=null 原样保留（不伪造 0、不省略键）', async () => {
    const captured: OnTurnMessageReport[] = [];
    await dispatchStatusEvent(
      makeMgr(captured),
      makeState('run-1'),
      retryEvent({ attempt: 1, max_retries: 10, retry_delay_ms: 500, error_status: null }),
      false,
    );
    const payload = JSON.parse(
      (captured[0]!['content'] as string).slice('[MODEL_RETRY] '.length),
    ) as Record<string, unknown>;
    expect(payload['error_status']).toBeNull();
    expect('error' in payload).toBe(false);
  });

  it('无活动轮（currentRunId 空）丢弃——不落行不报错（同 compact runId 空守卫口径）', async () => {
    const captured: OnTurnMessageReport[] = [];
    const mgr = makeMgr(captured);
    await dispatchStatusEvent(
      mgr,
      makeState(undefined),
      retryEvent({ attempt: 1 }),
      false,
    );
    expect(captured).toHaveLength(0);
    expect(mgr.deps.onTurnMessage).not.toHaveBeenCalled();
  });

  it('error 超 200 字符截断；缺字段键缺省不伪造', async () => {
    const captured: OnTurnMessageReport[] = [];
    await dispatchStatusEvent(
      makeMgr(captured),
      makeState('run-1'),
      retryEvent({ attempt: 2, error: 'y'.repeat(500) }),
      false,
    );
    const payload = JSON.parse(
      (captured[0]!['content'] as string).slice('[MODEL_RETRY] '.length),
    ) as Record<string, unknown>;
    expect(payload['attempt']).toBe(2);
    expect(payload['error']).toBe('y'.repeat(200));
    expect('max_retries' in payload).toBe(false);
    expect('retry_delay_ms' in payload).toBe(false);
    expect('error_status' in payload).toBe(false);
  });
});
