// tests/agent-task-notify-retry.test.ts
// 2026-10-30-task-resume-revive-notify-retry FR-04：agent_task_status 上报
// 有限退避重试单测——5xx/网络错误重试（1s/4s/16s）、4xx 不重试、重试耗尽
// 抛最后一次错误（调用方 catch 落 console.error，不阻塞主链路）。
//
// 背景：生产实测 daemon→平台 agent-task-status 上报多次 HTTP 502（平台网关
// 故障时段）事件永久丢失（cli.ts 桥仅 console.error）。重试安全性依据
// backend upsert 幂等（running latest-wins / 终态重放刷 finished_at 无害）。

import { describe, expect, it, vi } from 'vitest';

import {
  AGENT_TASK_NOTIFY_RETRY_DELAYS_MS,
  isRetryableAgentTaskNotifyError,
  notifyAgentTaskStatusWithRetry,
} from '../src/agent-task-notify-retry.js';
import { HubHttpError } from '../src/hub-client.js';

function hubError(status: number): HubHttpError {
  return new HubHttpError(status, '<html>', 'http://hub/api', 'POST');
}

describe('isRetryableAgentTaskNotifyError —— 重试判定', () => {
  it('5xx（含实测 502）可重试，4xx 不可', () => {
    expect(isRetryableAgentTaskNotifyError(hubError(502))).toBe(true);
    expect(isRetryableAgentTaskNotifyError(hubError(503))).toBe(true);
    expect(isRetryableAgentTaskNotifyError(hubError(500))).toBe(true);
    expect(isRetryableAgentTaskNotifyError(hubError(422))).toBe(false);
    expect(isRetryableAgentTaskNotifyError(hubError(404))).toBe(false);
  });

  it('传输层 Error（fetch TypeError 等）可重试；非 Error 形态不可', () => {
    expect(isRetryableAgentTaskNotifyError(new TypeError('fetch failed'))).toBe(true);
    expect(isRetryableAgentTaskNotifyError(new Error('connect ECONNRESET'))).toBe(true);
    expect(isRetryableAgentTaskNotifyError('string error')).toBe(false);
    expect(isRetryableAgentTaskNotifyError(undefined)).toBe(false);
  });
});

describe('notifyAgentTaskStatusWithRetry —— 退避调度', () => {
  function makeClient(script: Array<unknown>) {
    let call = 0;
    const notify = vi.fn(async () => {
      const step = script[Math.min(call, script.length - 1)];
      call++;
      if (step instanceof Error) throw step;
      return { ok: true };
    });
    const sleep = vi.fn(async (_ms: number) => {});
    return { notify, sleep };
  }

  it('502 两连后第三次成功：共 3 次调用、退避 [1000, 4000]', async () => {
    const { notify, sleep } = makeClient([hubError(502), hubError(502), null]);
    await notifyAgentTaskStatusWithRetry(
      { notifyAgentTaskStatus: notify } as never,
      ['s1', 'r1', 't1', '任务', 'running'] as never,
      { sleep },
    );
    expect(notify).toHaveBeenCalledTimes(3);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      AGENT_TASK_NOTIFY_RETRY_DELAYS_MS[0],
      AGENT_TASK_NOTIFY_RETRY_DELAYS_MS[1],
    ]);
  });

  it('4xx（422）不重试：单次调用即抛', async () => {
    const err = hubError(422);
    const { notify, sleep } = makeClient([err, err, err, err]);
    await expect(
      notifyAgentTaskStatusWithRetry(
        { notifyAgentTaskStatus: notify } as never,
        ['s1', 'r1', 't1', '任务', 'running'] as never,
        { sleep },
      ),
    ).rejects.toThrow('HTTP 422');
    expect(notify).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it('重试耗尽：1+3 次尝试后抛最后一次错误，退避序列全走', async () => {
    const { notify, sleep } = makeClient([new TypeError('fetch failed')]);
    await expect(
      notifyAgentTaskStatusWithRetry(
        { notifyAgentTaskStatus: notify } as never,
        ['s1', 'r1', 't1', '任务', 'completed'] as never,
        { sleep },
      ),
    ).rejects.toThrow('fetch failed');
    expect(notify).toHaveBeenCalledTimes(1 + AGENT_TASK_NOTIFY_RETRY_DELAYS_MS.length);
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([
      ...AGENT_TASK_NOTIFY_RETRY_DELAYS_MS,
    ]);
  });

  it('首次成功零退避；事件参数原样透传', async () => {
    const notify = vi.fn(async () => ({ ok: true }));
    const sleep = vi.fn(async () => {});
    const args = ['sess-A', 'run-B', 'task-C', '续唤任务', 'running' as const];
    await notifyAgentTaskStatusWithRetry(
      { notifyAgentTaskStatus: notify } as never,
      args as never,
      { sleep },
    );
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith(...args);
    expect(sleep).not.toHaveBeenCalled();
  });
});
