// tests/task-09-hub-client-spec.test.ts
// task-09: HubClient.getSpecBundle / postSpecSync（spec 按需 bundle pull / sync push）。
//
// 对照蓝图 task-09.md §4.1 / §4.2 + §8 第 1 步测试骨架 + AC-01~AC-03 / AC-13。
// 端点（与 task-06 后端实际挂载点对齐，design §7.2）：
//   GET  /api/workspaces/{wsId}/spec-workspace/bundle  → 200 application/x-tar（Buffer）
//   POST /api/workspaces/{wsId}/spec-workspace/sync    body=application/x-tar → 200 {ok, reparsed}
//
// 关键不变式（与 execution-context.test.ts 端点前缀约束一致）：
//   - 用 /api（spec_workspace router 挂载点），不用 REST_PREFIX（/api/daemon）。
//   - 二进制请求/响应绕过 _request（JSON 专用），单独 fetch + arrayBuffer/Buffer body。
//   - 鉴权头复用 _headers() 的 Bearer/X-API-Key 优先级，但 Content-Type 显式覆盖。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient, HubHttpError } from '../src/hub-client';

let lastCall: { url: string; init: RequestInit } | null = null;

function mockFetchResponse(
  body: BodyInit,
  init: { status?: number; headers?: Record<string, string> } = {},
): typeof fetch {
  return (async (url: any, initReq?: any) => {
    lastCall = { url: typeof url === 'string' ? url : url.toString(), init: initReq ?? {} };
    return new Response(body, {
      status: init.status ?? 200,
      headers: init.headers ?? {},
    });
  }) as typeof fetch;
}

beforeEach(() => {
  lastCall = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── getSpecBundle ────────────────────────────────────────────────────────────

describe('task-09 HubClient.getSpecBundle', () => {
  it('GET /api/workspaces/{wsId}/spec-workspace/bundle，返回 tar Buffer，Accept=application/x-tar + Bearer', async () => {
    const tarBytes = new Uint8Array([0x1f, 0x8b, 0x08, 0x00, 0x74, 0x61, 0x72]);
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(tarBytes, {
        status: 200,
        headers: { 'Content-Type': 'application/x-tar' },
      }),
    );

    const c = new HubClient('http://hub:8000', 'tok-1');
    const buf = await c.getSpecBundle('ws-1');

    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(Array.from(buf.subarray(0, 4))).toEqual([0x1f, 0x8b, 0x08, 0x00]);
    expect(lastCall!.url).toBe(
      'http://hub:8000/api/workspaces/ws-1/spec-workspace/bundle',
    );
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers.Accept).toBe('application/x-tar');
    expect(headers.Authorization).toBe('Bearer tok-1');
    // GET 无 body
    expect(lastCall!.init.body).toBeUndefined();
    expect(lastCall!.init.method).toBe('GET');
  });

  it('wsId 含特殊字符时 encodeURIComponent 生效', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'application/x-tar' },
      }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    await c.getSpecBundle('ws/a b');
    expect(lastCall!.url).toContain('/api/workspaces/ws%2Fa%20b/spec-workspace/bundle');
  });

  it('HTTP 404 → 抛 HubHttpError(status=404)，bodyText 透传', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse('spec workspace not bootstrapped', { status: 404 }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    await expect(c.getSpecBundle('ws-x')).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 404,
      method: 'GET',
    });
  });

  it('HTTP 500 → 抛 HubHttpError(status=500)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse('server boom', { status: 500 }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    await expect(c.getSpecBundle('ws-x')).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 500,
    });
  });

  it('无 token / apiKey → 请求不带 Authorization / X-API-Key', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(new Uint8Array([0]), {
        status: 200,
        headers: { 'Content-Type': 'application/x-tar' },
      }),
    );
    const c = new HubClient('http://hub:8000');
    await c.getSpecBundle('ws-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
    expect(headers.Accept).toBe('application/x-tar');
  });

  it('apiKey 设置 → header 含 X-API-Key（apiKey 胜出，不发 Authorization）', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(new Uint8Array([0]), {
        status: 200,
        headers: { 'Content-Type': 'application/x-tar' },
      }),
    );
    const c = new HubClient('http://hub:8000', { apiKey: 'k-1' });
    await c.getSpecBundle('ws-1');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k-1');
    expect(headers.Authorization).toBeUndefined();
  });
});

// ── postSpecSync ─────────────────────────────────────────────────────────────

describe('task-09 HubClient.postSpecSync', () => {
  it('POST /api/workspaces/{wsId}/spec-workspace/sync，Content-Type=application/x-tar，body 是传入 Buffer，返回 {ok, reparsed}', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(JSON.stringify({ ok: true, reparsed: 3 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const c = new HubClient('http://hub:8000', 'tok-2');
    const tarBuf = Buffer.from([0xde, 0xad, 0xbe, 0xef]);
    const resp = await c.postSpecSync('ws-1', tarBuf);

    expect(resp).toEqual({ ok: true, reparsed: 3 });
    expect(lastCall!.url).toBe(
      'http://hub:8000/api/workspaces/ws-1/spec-workspace/sync',
    );
    expect(lastCall!.init.method).toBe('POST');
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-tar');
    expect(headers.Authorization).toBe('Bearer tok-2');
    // body 透传为 Buffer（不能被 JSON.stringify）
    expect(lastCall!.init.body).toBe(tarBuf);
  });

  it('HTTP 413 → 抛 HubHttpError(status=413)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse('payload too large', { status: 413 }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    await expect(c.postSpecSync('ws-1', Buffer.alloc(10))).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 413,
      method: 'POST',
    });
  });

  it('HTTP 500 → 抛 HubHttpError(status=500)', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse('internal error', { status: 500 }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    await expect(c.postSpecSync('ws-1', Buffer.alloc(10))).rejects.toMatchObject({
      name: 'HubHttpError',
      status: 500,
    });
  });

  it('apiKey 设置 → POST header 含 X-API-Key（apiKey 胜出）', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(JSON.stringify({ ok: true, reparsed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = new HubClient('http://hub:8000', { apiKey: 'k-2' });
    await c.postSpecSync('ws-1', Buffer.alloc(0));
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['X-API-Key']).toBe('k-2');
    expect(headers.Authorization).toBeUndefined();
    expect(headers['Content-Type']).toBe('application/x-tar');
  });

  it('无 auth 时 POST 仅含 Content-Type', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse(JSON.stringify({ ok: true, reparsed: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    const c = new HubClient('http://hub:8000');
    await c.postSpecSync('ws-1', Buffer.alloc(0));
    const headers = lastCall!.init.headers as Record<string, string>;
    expect(headers['Content-Type']).toBe('application/x-tar');
    expect(headers.Authorization).toBeUndefined();
    expect(headers['X-API-Key']).toBeUndefined();
  });
});

// 反例：HubHttpError 实例确实可被 instanceof 识别（调用方按 err.status 分支）
describe('task-09 HubHttpError 实例化', () => {
  it('HTTP 错误抛出的是 HubHttpError 实例', async () => {
    vi.stubGlobal(
      'fetch',
      mockFetchResponse('nope', { status: 403 }),
    );
    const c = new HubClient('http://hub:8000', 'tok');
    try {
      await c.getSpecBundle('ws-1');
      expect.fail('should throw');
    } catch (e) {
      expect(e).toBeInstanceOf(HubHttpError);
      expect((e as HubHttpError).status).toBe(403);
    }
  });
});
