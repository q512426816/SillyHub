// tests/agent-log/liveness/hub-client-states.test.ts —— liveness 上报/拉取 helper 单测（task-06）。
//
// 覆盖：buildAgentLogStatePushGroups 分组与 D-012 第一方覆写、create 元信息合并、
// pushAgentLogStates 的 Bearer 头与载荷（fetch stub）/失败 best-effort、
// fetchRegisteredAgentLogs 解析与失败空数组。
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  buildAgentLogStatePushGroups,
  fetchRegisteredAgentLogs,
  pushAgentLogStates,
  type LivenessPushTargetMeta,
} from '../../../src/hub-client.js';

const NOW = Date.parse('2026-09-07T10:00:00Z');

const META_A: LivenessPushTargetMeta = {
  serverUrl: 'http://hub',
  token: 'shpsync_a',
  harness: 'zcode',
  format: 'zcode-model-io-jsonl',
  agentSessionId: 'sess-1',
};
const META_B: LivenessPushTargetMeta = { serverUrl: 'http://hub', token: 'shpsync_b' };

describe('buildAgentLogStatePushGroups（task-06）', () => {
  it('按 (serverUrl, token) 分组；无元数据目标跳过', () => {
    const groups = buildAgentLogStatePushGroups(
      [
        { logPath: 'a.jsonl', state: 'working', evidence: 'e1', derivedAt: NOW, lastEventAt: NOW - 1000 },
        { logPath: 'b.jsonl', state: 'idle', evidence: 'e2', derivedAt: NOW, lastEventAt: null },
        { logPath: 'unknown.jsonl', state: 'working', evidence: 'e3', derivedAt: NOW, lastEventAt: null },
      ],
      new Map([
        ['a.jsonl', META_A],
        ['b.jsonl', META_B],
      ]),
      () => false,
    );
    expect(groups.size).toBe(2);
    const ga = groups.get('http://hub|shpsync_a')!;
    expect(ga.items).toHaveLength(1);
    expect(ga.items[0]).toMatchObject({
      log_path: 'a.jsonl',
      state: 'working',
      harness: 'zcode',
      format: 'zcode-model-io-jsonl',
      agent_session_id: 'sess-1',
      last_event_at: new Date(NOW - 1000).toISOString(),
    });
    expect(groups.get('http://hub|shpsync_b')!.items[0]).not.toHaveProperty('harness');
  });

  it('D-012：第一方 pending 覆写 blocked + evidence=PERMISSION_REQUEST(pending)', () => {
    const groups = buildAgentLogStatePushGroups(
      [{ logPath: 'a.jsonl', state: 'working', evidence: 'mtime_fresh', derivedAt: NOW, lastEventAt: null }],
      new Map([['a.jsonl', META_A]]),
      (sid) => sid === 'sess-1',
    );
    expect(groups.get('http://hub|shpsync_a')!.items[0]).toMatchObject({
      state: 'blocked',
      evidence: 'PERMISSION_REQUEST(pending)',
    });
  });
});

describe('pushAgentLogStates / fetchRegisteredAgentLogs（task-06，fetch stub）', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('push：Bearer 头 + entries 载荷；非 2xx → false；异常 → false（best-effort）', async () => {
    const calls: Array<{ url: string; headers: Record<string, string>; body: string }> = [];
    vi.stubGlobal('fetch', (async (url: string, init: RequestInit) => {
      calls.push({ url, headers: init.headers as Record<string, string>, body: String(init.body) });
      return new Response('{"ok":true}', { status: 200 });
    }) as typeof fetch);
    const ok = await pushAgentLogStates('http://hub/', 'shpsync_x', [
      { log_path: 'a.jsonl', state: 'working', evidence: 'e', derived_at: new Date(NOW).toISOString() },
    ]);
    expect(ok).toBe(true);
    expect(calls[0]!.url).toBe('http://hub/api/agent-logs/states');
    expect(calls[0]!.headers.Authorization).toBe('Bearer shpsync_x');
    expect(JSON.parse(calls[0]!.body).entries).toHaveLength(1);
    vi.stubGlobal(
      'fetch',
      (() => new Response('nope', { status: 403 })) as unknown as typeof fetch,
    );
    expect(await pushAgentLogStates('http://hub', 't', [])).toBe(false);
    vi.stubGlobal(
      'fetch',
      (() => Promise.reject(new Error('net'))) as unknown as typeof fetch,
    );
    expect(await pushAgentLogStates('http://hub', 't', [])).toBe(false);
  });

  it('fetchRegisteredAgentLogs：解析 items（非法行 flatMap 丢弃）；失败 → 空数组', async () => {
    vi.stubGlobal(
      'fetch',
      (async () =>
        new Response(
          JSON.stringify({
            items: [
              { log_path: 'a.jsonl', format: 'zcode-model-io-jsonl', harness: 'zcode', session_id: 's1' },
              { harness: 'codex' },
            ],
          }),
          { status: 200 },
        )) as unknown as typeof fetch,
    );
    const rows = await fetchRegisteredAgentLogs('http://hub', 't');
    expect(rows).toEqual([{ log_path: 'a.jsonl', format: 'zcode-model-io-jsonl', harness: 'zcode', session_id: 's1' }]);
    vi.stubGlobal(
      'fetch',
      (() => Promise.reject(new Error('net'))) as unknown as typeof fetch,
    );
    expect(await fetchRegisteredAgentLogs('http://hub', 't')).toEqual([]);
  });
});
