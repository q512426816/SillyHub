// tests/hub-client.test.ts
// task-17: HubClient REST 客户端（src/hub-client.ts）。
// 1:1 对齐 Python sillyhub_daemon/client.py（HubClient class，8 个 async 方法）+
// Python tests/test_client.py 的用例覆盖度。
// HTTP 用 Node 20 原生 fetch，全量 vi.stubGlobal('fetch') mock，不发真实网络请求。
//
// 对照：
//   - 蓝图 task-17.md §8（TDD 步骤给出测试骨架，本文件在其基础上扩充边界用例）
//   - Python test_client.py（register/heartbeat/claim/start/lease_heartbeat/
//     submit_messages/complete_lease + 错误处理 class TestErrorHandling）
//
// 验收标准 AC-01~AC-06 全部由以下 describe block 覆盖：
//   构造器 3 + lease 端点 6 + register 4 + getPendingLeases 1 + 错误 5 + trust_env 1 = 20 个 it

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, HubHttpError } from '../src/hub-client';
import { REST_PREFIX } from '../src/protocol';

// ── fetch mock 工具 ──────────────────────────────────────────────────────────
// 记录最后一次调用的 (url, init)，并返回可控 Response。

let lastCall: { url: string; init: RequestInit } | null = null;

/** 构造一个返回 2xx JSON 的 fetch 替身。status 默认 200。 */
function mockFetchOk(body: unknown, status = 200): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

/** 构造一个返回非 2xx 的 fetch 替身（body 为纯文本，用于断言 bodyText）。 */
function mockFetchStatus(status: number, bodyText: string): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: init ?? {} };
    return new Response(bodyText, { status });
  }) as typeof fetch;
}

beforeEach(() => {
  lastCall = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── AC-02：构造器（对齐 Python client.py:31-48 / test_client.py:TestInit）────

describe('HubClient 构造器', () => {
  it('去除尾部斜杠（对齐 Python _base_url = server_url.rstrip("/")）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ ok: true }));
    const c = new HubClient('http://x:8000///', 'tok');
    await c.heartbeat('rt-1');
    // 拼出的 URL 不应有 //api 这种双斜杠
    expect(lastCall!.url.startsWith('http://x:8000/api/daemon')).toBe(true);
    expect(lastCall!.url.includes('//api')).toBe(false);
  });

  it('无 token 时不发 Authorization 头（对齐 Python _auth_headers 返回 {}）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000');
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/json');
  });

  it('有 token 时发 Bearer 头（对齐 Python Authorization: Bearer {token}）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000', 'mytoken');
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer mytoken');
  });
});

// ── AC-01 核心：6 lease 端点 URL/method/body 契约（对齐 client.py:101-182）──

describe('HubClient — 6 个 lease/runtime 端点 URL/method/body 契约', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('claimLease: POST /leases/{id}/claim body {runtime_id}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.claimLease('lease-123', 'rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-123/claim`);
    expect(lastCall!.init.method).toBe('POST');
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ runtime_id: 'rt-1' });
  });

  it('startLease: POST /leases/{id}/start body {claim_token}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.startLease('lease-1', 'ctoken');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/start`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ claim_token: 'ctoken' });
  });

  it('leaseHeartbeat: POST /leases/{id}/heartbeat body {claim_token}', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.leaseHeartbeat('lease-1', 'ctoken');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/heartbeat`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ claim_token: 'ctoken' });
  });

  it('submitMessages: POST /leases/{id}/messages body {claim_token, agent_run_id, messages}', async () => {
    const c = new HubClient('http://x:8000', 't');
    const msgs = [{ type: 'text', content: 'hi' }];
    await c.submitMessages('lease-1', 'ctoken', 'run-9', msgs);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/messages`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      claim_token: 'ctoken',
      agent_run_id: 'run-9',
      messages: msgs,
    });
  });

  it('submitMessages: 空 messages 数组也透传（对齐 test_client.py:test_submit_empty_messages）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.submitMessages('lease-1', 'ctoken', 'run-1', []);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.messages).toEqual([]);
  });

  it('completeLease: POST /leases/{id}/complete body {claim_token, result}', async () => {
    const c = new HubClient('http://x:8000', 't');
    const result = { status: 'completed', patch: 'diff --git ...' };
    await c.completeLease('lease-1', 'ctoken', result);
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/leases/lease-1/complete`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      claim_token: 'ctoken',
      result,
    });
  });

  it('completeLease: result 含失败信息（exit_code=1）也照原样提交（test_complete_with_error_result）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({ status: 'completed' }));
    const c = new HubClient('http://x:8000', 't');
    const result = { exit_code: 1, error: 'boom' };
    const r = await c.completeLease('lease-1', 'ctoken', result);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      claim_token: 'ctoken',
      result: { exit_code: 1, error: 'boom' },
    });
    expect(r).toEqual({ status: 'completed' });
  });

  it('heartbeat(runtime): POST /heartbeat body {runtime_id}（非 lease 子路径）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({ runtime_id: 'rt-1' });
  });

  it('markOffline(runtime): POST /runtimes/{id}/offline without body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.markOffline('rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/runtimes/rt-1/offline`);
    expect(lastCall!.init.method).toBe('POST');
    expect(lastCall!.init.body).toBeUndefined();
  });
});

// ── register 条件 body 拼装（对齐 client.py:55-99 / test_client.py:TestRegister）──

describe('HubClient — register 条件 body 拼装', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ runtime_id: 'rt-new' })));

  it('必填字段总写入（即使空串）+ 条件字段省略', async () => {
    const c = new HubClient('http://x:8000', 't');
    const r = await c.register({
      name: 'host1',
      provider: 'claude',
      version: '2.1.0',
      os: 'darwin',
      arch: 'arm64',
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      name: 'host1',
      provider: 'claude',
      version: '2.1.0',
      os: 'darwin',
      arch: 'arm64',
    });
    expect(body.runtime_id).toBeUndefined();
    expect(body.protocol).toBeUndefined();
    expect(body.capabilities).toBeUndefined();
    expect(r).toEqual({ runtime_id: 'rt-new' });
  });

  it('runtimeId 提供时写入；protocol 非空写入；capabilities 提供写入', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      name: 'h',
      provider: 'p',
      version: 'v',
      os: 'o',
      arch: 'a',
      runtimeId: 'rt-1',
      protocol: 'stream_json',
      capabilities: { tools: true },
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.runtime_id).toBe('rt-1');
    expect(body.protocol).toBe('stream_json');
    expect(body.capabilities).toEqual({ tools: true });
  });

  it('protocol 空串不写入（对齐 Python `if protocol:`）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({ name: 'h', protocol: '' });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.protocol).toBeUndefined();
  });

  it('extra 透传字段（对应 Python **kwargs）展开进 body', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      name: 'h',
      extra: { custom_field: 'x', tags: ['a', 'b'] },
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.custom_field).toBe('x');
    expect(body.tags).toEqual(['a', 'b']);
  });
});

// ── getPendingLeases（GET，唯一非 POST，对齐 client.py:186-192）──────────────

describe('HubClient — getPendingLeases（GET，唯一非 POST）', () => {
  it('GET /runtimes/{id}/pending-leases 返回数组', async () => {
    vi.stubGlobal('fetch', mockFetchOk([{ lease_id: 'l1' }, { lease_id: 'l2' }]));
    const c = new HubClient('http://x:8000', 't');
    const list = await c.getPendingLeases('rt-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/runtimes/rt-1/pending-leases`);
    expect(lastCall!.init.method).toBe('GET');
    expect(lastCall!.init.body).toBeUndefined();
    expect(list).toEqual([{ lease_id: 'l1' }, { lease_id: 'l2' }]);
  });
});

// ── AC-03：错误处理（对齐 client.py raise_for_status / test_client.py:TestErrorHandling）──

describe('HubClient — 错误处理', () => {
  it('非 2xx 抛 HubHttpError 含 status/bodyText/url/method', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(409, '{"detail":"lease already claimed"}'));
    const c = new HubClient('http://x:8000', 't');
    await expect(c.claimLease('l1', 'rt-1')).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 409,
      bodyText: '{"detail":"lease already claimed"}',
      method: 'POST',
    });
    // 同时验证 instanceof
    await expect(c.claimLease('l1', 'rt-1')).rejects.toBeInstanceOf(HubHttpError);
  });

  it('401 token 无效可被 status 区分', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(401, '{"detail":"unauthorized"}'));
    const c = new HubClient('http://x:8000', 'bad');
    await expect(c.heartbeat('rt-1')).rejects.toMatchObject({ status: 401 });
  });

  it('500 服务器错误（对齐 test_client.py:test_register_server_error）', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(500, 'internal error'));
    const c = new HubClient('http://x:8000', 't');
    await expect(c.completeLease('l1', 'ct', {})).rejects.toMatchObject({ status: 500 });
  });

  it('HubHttpError.message 含 status/method/url/截断的 bodyText（≤200 字符）', async () => {
    const longBody = 'x'.repeat(500);
    vi.stubGlobal('fetch', mockFetchStatus(502, longBody));
    const c = new HubClient('http://x:8000', 't');
    try {
      await c.heartbeat('rt-1');
      expect.unreachable('应抛 HubHttpError');
    } catch (e) {
      expect(e).toBeInstanceOf(HubHttpError);
      const err = e as HubHttpError;
      // message 中嵌入的 bodyText 截断到 200 字符
      expect(err.message).toContain('HTTP 502 POST');
      expect(err.message).toContain('x'.repeat(200));
      expect(err.message).not.toContain('x'.repeat(201));
      // 原始 bodyText 字段保留全量
      expect(err.bodyText).toHaveLength(500);
    }
  });

  it('网络错误透传（fetch reject TypeError，不包装为 HubHttpError）', async () => {
    vi.stubGlobal('fetch', async () => {
      throw new TypeError('fetch failed');
    });
    const c = new HubClient('http://x:8000', 't');
    await expect(c.heartbeat('rt-1')).rejects.toThrow(TypeError);
    await expect(c.heartbeat('rt-1')).rejects.not.toBeInstanceOf(HubHttpError);
  });
});

// ── AC-04：trust_env=false 语义（Node fetch 默认不读 HTTP_PROXY）────────────

describe('HubClient — trust_env=false 语义', () => {
  it('fetch 调用 init 不含 dispatcher/proxy 字段（依赖 Node 默认不走 HTTP_PROXY）', async () => {
    vi.stubGlobal('fetch', mockFetchOk({}));
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('rt-1');
    expect(lastCall!.init.dispatcher).toBeUndefined();
    expect((lastCall!.init as any).agent).toBeUndefined();
  });
});

// ── close() no-op（对齐蓝图 R1：fetch 无连接池，close 仅 API 兼容）──────────

describe('HubClient — close()', () => {
  it('close 是 no-op，不抛错（fetch 无连接池）', () => {
    const c = new HubClient('http://x:8000', 't');
    expect(() => c.close()).not.toThrow();
  });
});

// ── daemon-api-key 变更：X-API-Key 鉴权路径 ──────────────────────────────────

describe('HubClient — API Key 鉴权（X-API-Key）', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({})));

  it('{ apiKey } → 发 X-API-Key 头，不发 Authorization', async () => {
    const c = new HubClient('http://x:8000', { apiKey: 'shk_live_xyz' });
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('shk_live_xyz');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('同时给 token 和 apiKey → apiKey 优先（对齐 backend X-API-Key 回退语义）', async () => {
    const c = new HubClient('http://x:8000', {
      token: 'short-lived',
      apiKey: 'shk_live_long',
    });
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('shk_live_long');
    expect(headers['Authorization']).toBeUndefined();
  });

  it('旧式 string 第二参仍可用（向后兼容）', async () => {
    const c = new HubClient('http://x:8000', 'legacy-token');
    await c.heartbeat('rt-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer legacy-token');
  });
});

// ── gap-3 / gap-4（D-002@v3 补丁 design §4 / §5）：daemon → server 反向通知 ──

describe('HubClient — gap-3 notifyRunResult + gap-4 notifySessionEnd', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('gap-3 notifyRunResult: POST /leases/{id}/runs/{runId}/result，X-Claim-Token header + body {status,is_error}', async () => {
    const c = new HubClient('http://x:8000', { apiKey: 'shk_daemon' });
    await c.notifyRunResult('lease-1', 'ctoken-lease', 'run-9', {
      status: 'success',
      is_error: false,
    });
    expect(lastCall!.url).toBe(
      `http://x:8000${REST_PREFIX}/leases/lease-1/runs/run-9/result`,
    );
    expect(lastCall!.init.method).toBe('POST');
    const headers = lastCall!.init.headers as Record<string, string>;
    // lease 级 claim_token 走 header（design §4），区别于 sync 的 body
    expect(headers['X-Claim-Token']).toBe('ctoken-lease');
    // 端点基础鉴权：daemon 长期 api-key（_headers 既有逻辑）
    expect(headers['X-API-Key']).toBe('shk_daemon');
    expect(headers['Content-Type']).toBe('application/json');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({ status: 'success', is_error: false });
  });

  it('gap-3 notifyRunResult: error_during_execution subtype + result_summary 全字段透传', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyRunResult('lease-1', 'ct', 'run-1', {
      status: 'error_during_execution',
      is_error: true,
      subtype: 'error_max_turns',
      result_summary: 'turn aborted',
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({
      status: 'error_during_execution',
      is_error: true,
      subtype: 'error_max_turns',
      result_summary: 'turn aborted',
    });
  });

  it('gap-3 notifyRunResult: 非 2xx → HubHttpError（含 status/bodyText/url/method）', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(401, 'invalid claim token'));
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifyRunResult('lease-1', 'bad', 'run-1', {
        status: 'success',
        is_error: false,
      }),
    ).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 401,
      method: 'POST',
    });
  });

  it('gap-3 notifyRunResult: url encode leaseId/runId（含特殊字符）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifyRunResult('lease 1', 'ct', 'run/2', {
      status: 'success',
      is_error: false,
    });
    expect(lastCall!.url).toContain('/leases/lease%201/runs/run%2F2/result');
  });

  it('gap-4 notifySessionEnd: POST /sessions/{id}/end，body {status,reason}，鉴权走 api-key', async () => {
    const c = new HubClient('http://x:8000', { apiKey: 'shk_daemon' });
    await c.notifySessionEnd('sess-1', 'ended', 'idle_timeout');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/sessions/sess-1/end`);
    expect(lastCall!.init.method).toBe('POST');
    const headers = lastCall!.init.headers as Record<string, string>;
    // session end 走 api-key（无 claim_token header）
    expect(headers['X-API-Key']).toBe('shk_daemon');
    expect(headers['X-Claim-Token']).toBeUndefined();
    expect(JSON.parse(lastCall!.init.body as string)).toEqual({
      status: 'ended',
      reason: 'idle_timeout',
    });
  });

  it('gap-4 notifySessionEnd: failed status 也透传（driver error 收口）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.notifySessionEnd('sess-1', 'failed', 'driver_error');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body).toEqual({ status: 'failed', reason: 'driver_error' });
  });

  it('gap-4 notifySessionEnd: 非 2xx → HubHttpError', async () => {
    vi.stubGlobal('fetch', mockFetchStatus(404, 'session not found'));
    const c = new HubClient('http://x:8000', 't');
    await expect(
      c.notifySessionEnd('sess-x', 'ended', 'manual'),
    ).rejects.toMatchObject({ name: 'HubHttpError', status: 404 });
  });
});

