// tests/daemon-report-smoke.test.ts
// task-06（2026-08-04-daemon-version）：gen 重构后的 daemon 上报冒烟守卫。
//
// 背景：task-01 重构了 BUILD_ID 生成链路（gen-build-id.mjs 注入 src/build-id.ts），
// task-03/04 调整了 hub-client register/heartbeat 的版本字段填充。本测试是这些
// 改动落定后的「上报契约冒烟守卫」—— 不重复 gen-build-id.test.ts 的格式细节
// （那已在 task-05 覆盖），只守三件事：
//   1. 当前打包进 src/build-id.ts 的 BUILD_ID 是 gen 真实注入的值，
//      而非历史硬编码占位 / unknown fallback / 空串（一旦 gen 链路被绕过或
//      退化成手写常量，本测试变红）；
//   2. HubClient.register() 构造的 RegisterBody 仍带 daemon_version=DAEMON_VERSION
//      + daemon_build_id=BUILD_ID（hub-client.ts:337-338 行为不变，gen 重构未破坏契约）；
//   3. HubClient.heartbeat() 构造的 HeartbeatBody 同样带两字段（hub-client.ts:365
//      行为不变）。
//
// 全量 mock fetch（vi.stubGlobal），不连真实 hub，对齐 hub-client.test.ts 的 mock 风格。
//
// 约束（对照 task-06.md constraints）：
//   - 不修改 hub-client.ts 上报字段，只加测试守卫；
//   - 不连真实 hub，全部 mock；
//   - 不手改 BUILD_ID 常量绕过断言（直接 import 真实产物）。

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { HubClient } from '../src/hub-client';
import { REST_PREFIX } from '../src/protocol';
import { DAEMON_VERSION } from '../src/daemon-version';
import { BUILD_ID } from '../src/build-id';

// ── fetch mock 工具（风格对齐 hub-client.test.ts）────────────────────────────
// 记录最后一次调用的 (url, init)，并返回可控 2xx JSON Response。

let lastCall: { url: string; init: RequestInit } | null = null;

function mockFetchOk(body: unknown, status = 200): typeof fetch {
  return (async (url: any, init?: any) => {
    lastCall = {
      url: typeof url === 'string' ? url : url.toString(),
      init: init ?? {},
    };
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }) as typeof fetch;
}

beforeEach(() => {
  lastCall = null;
});
afterEach(() => {
  vi.unstubAllGlobals();
});

// ── BUILD_ID 注入守卫 ────────────────────────────────────────────────────────
// task-01 gen-build-id.mjs 产物。一旦 gen 链路被绕过 / 退化成手写硬编码 / git
// fallback 到 unknown，下面的断言会变红，强制回到「gen 注入」契约。

describe('task-06: BUILD_ID gen 注入冒烟守卫', () => {
  it('BUILD_ID 非空串（gen 必须注入非空值，不允许 "" 绕过）', () => {
    expect(BUILD_ID, 'BUILD_ID 不能是空串').not.toBe('');
    expect(typeof BUILD_ID, 'BUILD_ID 必须是字符串').toBe('string');
    expect(BUILD_ID.length, 'BUILD_ID 字符串长度 > 0').toBeGreaterThan(0);
  });

  it('BUILD_ID 非 unknown 占位（gen 失败 fallback 的 unknown-<ts> 不应进发布产物）', () => {
    // gen-build-id.mjs 在 git 缺失 / 非 git 目录时 fallback 成 `unknown-<14位时间戳>`。
    // 发布物里的 BUILD_ID 必须是真实 git sha（8 位 hex），不应是 unknown 前缀。
    expect(
      BUILD_ID,
      `BUILD_ID 不应是 unknown fallback（实际: ${BUILD_ID}），说明 gen 跑在了非 git 环境`,
    ).not.toStartWith('unknown');
    expect(BUILD_ID, 'BUILD_ID 不能字面量为 "unknown"').not.toBe('unknown');
  });

  it('BUILD_ID 非历史硬编码占位（旧 4c238ebe-20260729112052 已被 gen 替换）', () => {
    // 旧版手写硬编码值；gen 重构后必须每次构建动态注入新值，绝不回到这个常量。
    const LEGACY_HARDCODED = '4c238ebe-20260729112052';
    expect(
      BUILD_ID,
      `BUILD_ID 仍是历史硬编码 ${LEGACY_HARDCODED}，gen 未生效或被手改回退`,
    ).not.toBe(LEGACY_HARDCODED);
  });

  it('BUILD_ID 格式合法（<8位hex>-<14位时间戳>，与 gen-build-id.test.ts 格式契约一致）', () => {
    // 与 gen-build-id.test.ts:46 BUILD_ID_FORMAT_RE 同源，但这里只做正向断言
    // （gen-build-id.test.ts 已覆盖反向敏感性 / 正则提取细节，此处不重复）。
    expect(BUILD_ID).toMatch(/^[0-9a-f]{8}-\d{14}$/);
  });
});

// ── register body 守卫（hub-client.ts:337-338 行为不变）──────────────────────
// HubClient.register 内部填充 daemon_version=DAEMON_VERSION、daemon_build_id=BUILD_ID，
// gen 重构后这两行行为必须保持。捕获真实下发的 body 比对。

describe('task-06: HubClient.register 上报 body 守卫', () => {
  beforeEach(() =>
    vi.stubGlobal(
      'fetch',
      mockFetchOk({
        daemon_instance_id: 'srv-inst',
        runtimes: [{ provider: 'claude', runtime_id: 'rt-new' }],
      }),
    ),
  );

  it('register body 含 daemon_version（= DAEMON_VERSION，hub-client.ts:337）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'host1',
      providers: [{ provider: 'claude', status: 'online' }],
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.daemon_version, 'daemon_version 必填字段').toBeDefined();
    expect(body.daemon_version).toBe(DAEMON_VERSION);
  });

  it('register body 含 daemon_build_id（= BUILD_ID，hub-client.ts:338）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'host1',
      providers: [{ provider: 'claude' }],
    });
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.daemon_build_id, 'daemon_build_id 必填字段').toBeDefined();
    expect(body.daemon_build_id).toBe(BUILD_ID);
    // 间接守卫：BUILD_ID 非占位（上面 describe 已直接断言），这里再确认 body 落到的
    // 值不是空 / unknown —— 防止 hub-client 这一层把 BUILD_ID 又改回字面量占位。
    expect(body.daemon_build_id).not.toBe('');
    expect(body.daemon_build_id).not.toBe('unknown');
  });

  it('register 端点路径 + method 不变（POST {REST_PREFIX}/register）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'host1',
      providers: [{ provider: 'claude' }],
    });
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/register`);
    expect(lastCall!.init.method).toBe('POST');
  });
});

// ── heartbeat body 守卫（hub-client.ts:365 行为不变）────────────────────────
// HubClient.heartbeat 内部填充 daemon_version / daemon_build_id（与 register 同源），
// 心跳链路同样不能因 gen 重构退化。

describe('task-06: HubClient.heartbeat 上报 body 守卫', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('heartbeat body 含 daemon_version（= DAEMON_VERSION，hub-client.ts:365）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }]);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.daemon_version).toBeDefined();
    expect(body.daemon_version).toBe(DAEMON_VERSION);
  });

  it('heartbeat body 含 daemon_build_id（= BUILD_ID，hub-client.ts:365）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1', [{ provider: 'claude', status: 'online' }]);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.daemon_build_id).toBeDefined();
    expect(body.daemon_build_id).toBe(BUILD_ID);
    // 同 register：守 body 落到的值不是字面量占位。
    expect(body.daemon_build_id).not.toBe('');
    expect(body.daemon_build_id).not.toBe('unknown');
  });

  it('heartbeat body daemon_local_id + providers 透传（hub-client.ts:365 其余字段不变）', async () => {
    const c = new HubClient('http://x:8000', 't');
    const providers = [{ provider: 'claude', status: 'online' }];
    await c.heartbeat('dlid-1', providers);
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.daemon_local_id).toBe('dlid-1');
    expect(body.providers).toEqual(providers);
  });

  it('heartbeat 端点路径 + method 不变（POST {REST_PREFIX}/heartbeat）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1');
    expect(lastCall!.url).toBe(`http://x:8000${REST_PREFIX}/heartbeat`);
    expect(lastCall!.init.method).toBe('POST');
  });

  it('heartbeat providers 缺省 → 空数组（hub-client.ts:365 ?? [] 行为不变）', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.heartbeat('dlid-1');
    const body = JSON.parse(lastCall!.init.body as string);
    expect(body.providers).toEqual([]);
    // 即便 providers 空，版本字段仍带（心跳不丢版本）。
    expect(body.daemon_version).toBe(DAEMON_VERSION);
    expect(body.daemon_build_id).toBe(BUILD_ID);
  });
});

// ── register + heartbeat 一致性：同一份 DAEMON_VERSION / BUILD_ID ────────────
// 守 register 和 heartbeat 上报的版本字段来自同一来源（避免出现 register 用一份、
// heartbeat 用另一份的回归）。这是 gen 重构后最容易踩的隐性漂移点。

describe('task-06: register 与 heartbeat 版本字段同源一致性', () => {
  beforeEach(() => vi.stubGlobal('fetch', mockFetchOk({ ok: true })));

  it('register 与 heartbeat 上报的 daemon_version / daemon_build_id 完全一致', async () => {
    const c = new HubClient('http://x:8000', 't');
    await c.register({
      daemonLocalId: 'dlid-1',
      serverUrl: 'http://x:8000',
      hostname: 'host1',
      providers: [{ provider: 'claude' }],
    });
    const registerBody = JSON.parse(lastCall!.init.body as string);

    await c.heartbeat('dlid-1', [{ provider: 'claude' }]);
    const heartbeatBody = JSON.parse(lastCall!.init.body as string);

    expect(heartbeatBody.daemon_version).toBe(registerBody.daemon_version);
    expect(heartbeatBody.daemon_build_id).toBe(registerBody.daemon_build_id);
    // 两者都必须等于源头常量。
    expect(registerBody.daemon_version).toBe(DAEMON_VERSION);
    expect(registerBody.daemon_build_id).toBe(BUILD_ID);
  });
});
