/**
 * tests/dialog-result.test.ts —— task-04 轻重构⑥定向测试（design §5 Wave 1 / FR-05）。
 *
 * 覆盖 session-manager/permission.ts dialogResult 收敛 helper（dialogResultOf）及
 * 4 处调用点语义（原 session-manager.ts 1260/2224/2322/2478 行四份复制粘贴）：
 *   1. requestUserDialog（requestUserDialogImpl）：提取 / 缺省 → null；
 *   2. AskUserQuestion 拦截分支：提取 / 缺省 → 'no answer payload' 回退；
 *   3. ExitPlanMode 审批分支：answers 链（answers[0].answer，数组 join '；'，缺省 '（无）'）；
 *   4. buildOnUserDialogCallback：提取 / 缺省 → null。
 * 全部经 resolver 桩注入 allow/deny decision，断言收敛前后语义一致。
 */

import { describe, expect, it, vi } from 'vitest';

import {
  buildCanUseToolCallback,
  buildOnUserDialogCallback,
  dialogResultOf,
  requestUserDialog,
} from '../src/interactive/session-manager/permission.js';
import type { SessionManagerCore } from '../src/interactive/session-manager/types.js';
import type { CanUseToolDecision, SessionState } from '../src/interactive/types.js';

/** 构造最小 SessionManagerCore 桩：store + resolvers + wsClient（permission 簇所需）。 */
function makeMgr(decision: CanUseToolDecision): SessionManagerCore {
  const state: SessionState = {
    sessionId: 's1',
    status: 'running',
    currentRunId: 'run-1',
    lastActiveAt: Date.now(),
  } as unknown as SessionState;
  const resolver = {
    register: vi.fn(() => ({ promise: Promise.resolve(decision) })),
  };
  return {
    _store: new Map([['s1', state]]),
    _resolversBySession: new Map([['s1', resolver]]),
    _permissionWsClient: { send: vi.fn() },
  } as unknown as SessionManagerCore;
}

// ── helper 单元语义 ─────────────────────────────────────────────────────────

describe('dialogResultOf（decision 上 dialogResult 鸭子读取收敛）', () => {
  it('allow + dialogResult → 原样返回（同引用透传，不拷贝不吞 null）', () => {
    const dialogResult = { answers: [{ answer: 'A' }] };
    expect(dialogResultOf({ behavior: 'allow', dialogResult })).toBe(dialogResult);
    expect(dialogResultOf({ behavior: 'allow', dialogResult: null })).toBeNull(); // null 是合法"用户未答"值
  });

  it('allow 无 dialogResult / deny decision → undefined（不本地编造）', () => {
    expect(dialogResultOf({ behavior: 'allow' })).toBeUndefined();
    expect(dialogResultOf({ behavior: 'deny', message: 'x' })).toBeUndefined();
  });
});

// ── 调用点 1：requestUserDialog（requestUserDialogImpl）──────────────────────

describe('调用点① requestUserDialog：dialogResult 提取 / 缺省 → null', () => {
  it('allow + dialogResult → completed，result 原样回喂', async () => {
    const dialogResult = { picked: '选项1' };
    const ret = await requestUserDialog(makeMgr({ behavior: 'allow', dialogResult }), 's1', {
      dialogKind: 'custom_dialog',
      dialogPayload: { q: '?' },
    });
    expect(ret).toEqual({ behavior: 'completed', result: dialogResult });
  });

  it('allow 无 dialog_result（旧 backend 兼容）→ completed，result null', async () => {
    const ret = await requestUserDialog(makeMgr({ behavior: 'allow' }), 's1', {
      dialogKind: 'custom_dialog',
      dialogPayload: {},
    });
    expect(ret).toEqual({ behavior: 'completed', result: null });
  });

  it('deny / 超时 / abort → cancelled（fail-closed，不编造答案）', async () => {
    const ret = await requestUserDialog(makeMgr({ behavior: 'deny', message: 'timeout' }), 's1', {
      dialogKind: 'custom_dialog',
      dialogPayload: {},
    });
    expect(ret).toEqual({ behavior: 'cancelled' });
  });
});

// ── 调用点 2：AskUserQuestion 拦截分支 ──────────────────────────────────────

describe('调用点② AskUserQuestion 拦截：答案经 deny.message 回喂 Claude', () => {
  const askInput = { question: '继续吗？', options: [] };

  it('allow + dialogResult → User answered: <JSON 答案>', async () => {
    const cb = buildCanUseToolCallback(makeMgr({ behavior: 'allow', dialogResult: { answers: [{ answer: '继续' }] } }), 's1', false);
    const ret = await cb('AskUserQuestion', askInput, undefined);
    expect(ret).toEqual({
      behavior: 'deny',
      message: 'User answered: {"answers":[{"answer":"继续"}]}',
    });
  });

  it('allow + dialogResult null / 缺失 → 兜底文案 no answer payload', async () => {
    const cbNull = buildCanUseToolCallback(makeMgr({ behavior: 'allow', dialogResult: null }), 's1', false);
    expect(await cbNull('AskUserQuestion', askInput, undefined)).toEqual({
      behavior: 'deny',
      message: 'User answered: "no answer payload"',
    });
    const cbMissing = buildCanUseToolCallback(makeMgr({ behavior: 'allow' }), 's1', false);
    expect(await cbMissing('AskUserQuestion', askInput, undefined)).toEqual({
      behavior: 'deny',
      message: 'User answered: "no answer payload"',
    });
  });

  it('deny → 默认推荐项文案（不带用户消息时）', async () => {
    const cb = buildCanUseToolCallback(makeMgr({ behavior: 'deny' }), 's1', false);
    expect(await cb('AskUserQuestion', askInput, undefined)).toEqual({
      behavior: 'deny',
      message: 'User did not respond to the question. Proceed with the recommended option.',
    });
  });
});

// ── 调用点 3：ExitPlanMode 审批分支（answers 链）────────────────────────────

describe('调用点③ ExitPlanMode 审批：answers 链提取', () => {
  function callPlan(dialogResult: unknown): ReturnType<ReturnType<typeof buildCanUseToolCallback>> {
    const cb = buildCanUseToolCallback(makeMgr({ behavior: 'allow', dialogResult }), 's1', false);
    return cb('ExitPlanMode', { plan: 'P1' }, undefined);
  }

  it('answers[0].answer = 批准计划 → allow 放行（updatedInput 透传原 input）', async () => {
    const ret = await callPlan({ answers: [{ answer: '批准计划' }] });
    expect(ret).toEqual({ behavior: 'allow', updatedInput: { plan: 'P1' } });
  });

  it('answers[0].answer = 需要修改 → deny + 用户反馈文案', async () => {
    const ret = await callPlan({ answers: [{ answer: '需要修改' }] });
    expect(ret).toEqual({
      behavior: 'deny',
      message: '计划未批准。用户反馈：需要修改。请根据反馈修订计划后重新提交（ExitPlanMode）。',
    });
  });

  it('answer 为数组 → join \'；\'（多选答案）', async () => {
    const ret = await callPlan({ answers: [{ answer: ['改A', '改B'] }] });
    expect((ret as { message: string }).message).toBe(
      '计划未批准。用户反馈：改A；改B。请根据反馈修订计划后重新提交（ExitPlanMode）。',
    );
  });

  it('dialogResult 缺失 / answers 非数组 / answer 非字符串 → 反馈（无）', async () => {
    for (const dialogResult of [undefined, { answers: 'oops' }, { answers: [42] }, { answers: [] }, {}]) {
      const ret = await callPlan(dialogResult);
      expect(ret).toEqual({
        behavior: 'deny',
        message: '计划未批准。用户反馈：（无）。请根据反馈修订计划后重新提交（ExitPlanMode）。',
      });
    }
  });
});

// ── 调用点 4：buildOnUserDialogCallback ─────────────────────────────────────

describe('调用点④ buildOnUserDialogCallback：SDK request_user_dialog 路由', () => {
  it('allow + dialogResult → completed 原样回喂；缺省 → null', async () => {
    const dialogResult = { value: 42 };
    const cbWith = buildOnUserDialogCallback(makeMgr({ behavior: 'allow', dialogResult }), 's1');
    expect(await cbWith({ dialogKind: 'dialog', payload: {} }, undefined)).toEqual({
      behavior: 'completed',
      result: dialogResult,
    });

    const cbWithout = buildOnUserDialogCallback(makeMgr({ behavior: 'allow' }), 's1');
    expect(await cbWithout({ dialogKind: 'dialog', payload: {} }, undefined)).toEqual({
      behavior: 'completed',
      result: null,
    });
  });

  it('deny → cancelled（SDK 应用 dialog 默认行为）', async () => {
    const cb = buildOnUserDialogCallback(makeMgr({ behavior: 'deny' }), 's1');
    expect(await cb({ dialogKind: 'dialog', payload: {} }, undefined)).toEqual({ behavior: 'cancelled' });
  });
});
