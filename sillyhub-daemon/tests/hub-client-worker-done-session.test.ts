// tests/hub-client-worker-done-session.test.ts
// 2026-09-10-review-dispatch-platform-fixes task-02（FR-01 / D-001@v1）：
// HubClient.workerDone 第 4 参 ``opts?: { sessionId?: string }``——一次性
// X-Session-Id 覆盖（daemon 主客户端无会话头时代报分身 worker_done，分身会话
// 身份经 header 单跳传递；design §5.1「X-Session-Id 承载分身身份」）。
//
// 依据：tasks/task-02.md、design.md §5.1/§6/§7、hub-client.ts X_SESSION_ID_HEADER
// 单一来源 + _sessionIdHeaders 合并惯例（task-10 既有形态）。测试手法与
// hub-client.test.ts 同款（vi.stubGlobal fetch + lastCall 断言真实发出的
// url/method/headers/body）。
//
// 覆盖点（与任务卡 acceptance 对齐）：
//   1. 传 sessionId → 请求带 X-Session-Id 头且值为该参（header-only 主形态
//      ws/mid 缺省 + 显式 ws/mid 两形态）；
//   2. 未传 opts / 传 {} → 与改前逐字一致（无实例级 sessionId 时不带头；
//      有实例级时带实例级值——auth.sessionId 行为零变化）；
//   3. 空串守卫：opts.sessionId='' 视为不覆盖（不写空头，实例级值保留/无实例
//      级时不带头）；
//   4. opts.sessionId 覆盖实例级 _sessionIdHeaders 同名头（前者胜）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, X_SESSION_ID_HEADER } from '../src/hub-client';

// ── fetch mock 工具（hub-client.test.ts 同款） ───────────────────────────────

let lastCall: { url: string; init: RequestInit } | null = null;

/** 构造一个返回 2xx JSON 的 fetch 替身。 */
function mockFetchOk(body: unknown): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  lastCall = null;
  vi.stubGlobal('fetch', mockFetchOk({ mission_id: 'mis-1', all_workers_done: false }));
});
afterEach(() => {
  vi.unstubAllGlobals();
});

/** 读取最近一次请求的 headers（瘦对象形态）。 */
function lastHeaders(): Record<string, string> {
  return lastCall!.init.headers as Record<string, string>;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('HubClient — workerDone 一次性 sessionId 覆盖（task-02 / FR-01）', () => {
  it('opts.sessionId 传值 → 请求带 X-Session-Id 头（header-only 主形态，daemon 代报）', async () => {
    // daemon 主 hubClient：无实例级 sessionId（无 auth.sessionId）
    const c = new HubClient('http://x:8000', 't');
    await c.workerDone(undefined, undefined, { summary: '全文总结' }, { sessionId: 's1' });

    expect(lastCall!.url).toBe('http://x:8000/api/missions/worker_done');
    expect(lastCall!.init.method).toBe('POST');
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBe('s1');
    // 鉴权头与 body 不受影响（body 无 ws/mid 锚——backend 沿 parent 链解析）
    expect(lastHeaders()['Authorization']).toBe('Bearer t');
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ summary: '全文总结' });
  });

  it('显式 ws/mid + opts.sessionId → 头照带（越权锚形态与覆盖参数正交）', async () => {
    const c = new HubClient('http://x:8000', { apiKey: 'key' });
    await c.workerDone('ws-1', 'mis-1', { summary: 's' }, { sessionId: 's-ov' });

    expect(lastCall!.url).toBe(
      'http://x:8000/api/workspaces/ws-1/missions/mis-1/worker_done',
    );
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBe('s-ov');
    expect(lastHeaders()['X-API-Key']).toBe('key');
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      summary: 's',
      workspace_id: 'ws-1',
      mission_id: 'mis-1',
    });
  });

  it('opts.sessionId 覆盖实例级 _sessionIdHeaders 同名头（前者胜）', async () => {
    const c = new HubClient('http://x:8000', { token: 't', sessionId: 'inst-1' });
    await c.workerDone(undefined, undefined, { summary: 's' }, { sessionId: 's1' });
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBe('s1');
  });

  it('未传 opts / 传 {} → 与改前逐字一致（无实例级 sessionId 时不带头）', async () => {
    const c = new HubClient('http://x:8000', 't');
    // 3 参既有调用形态
    await c.workerDone(undefined, undefined, { summary: 'a' });
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBeUndefined();
    // 显式 undefined / 空对象——空展开零差
    await c.workerDone(undefined, undefined, { summary: 'b' }, undefined);
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBeUndefined();
    await c.workerDone(undefined, undefined, { summary: 'c' }, {});
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBeUndefined();
  });

  it('未传 opts 且实例级有 sessionId → 带实例级头（auth.sessionId 行为零变化）', async () => {
    const c = new HubClient('http://x:8000', { token: 't', sessionId: 'inst-1' });
    await c.workerDone(undefined, undefined, { summary: 's' });
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBe('inst-1');
  });

  it('空串守卫：opts.sessionId="" 视为不覆盖（实例级保留；无实例级时不写空头）', async () => {
    // 有实例级：空串不覆盖实例级值
    const withInst = new HubClient('http://x:8000', { token: 't', sessionId: 'inst-1' });
    await withInst.workerDone(undefined, undefined, { summary: 's' }, { sessionId: '' });
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBe('inst-1');

    // 无实例级：空串不产生空头（缺失不附）
    const noInst = new HubClient('http://x:8000', 't');
    await noInst.workerDone(undefined, undefined, { summary: 's' }, { sessionId: '' });
    expect(lastHeaders()[X_SESSION_ID_HEADER]).toBeUndefined();
  });
});
