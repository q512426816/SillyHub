/**
 * 每轮工作区快照的**上报 wire 形状**测试
 *（2026-10-20-session-page-dsh-alignment / 线 C 1b / D-023@v1 / task-09）。
 *
 * 覆盖范围（scope 扩展：daemon.ts / hub-client.ts 的附加字段）：
 *   1. `buildRunSnapshotPayload`（daemon.ts 的**唯一组装点**）：终态三字段 + 快照 +
 *      daemon_version；`timing` 缺省时键不出现（task-10 预留的扩展位）；
 *   2. `HubClient.notifyRunResult`：`file_changes` / `timing` / `daemon_version`
 *      按「字段存在才写」映射进 body（undefined → 不写，与 model_usage 同惯例）；
 *      **内部结构保持 camelCase**（后端 pydantic 镜像读写同形）。
 *
 * 真实上报时序（首报终态 → 后到快照补报）在 daemon 集成面验证成本高，本文件只锁
 * 形状与守卫；时序在 `session-manager-turn-file-changes.test.ts` 锁（fire-and-forget）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import { buildRunSnapshotPayload } from '../../src/daemon.js';
import { HubClient } from '../../src/hub-client.js';
import type { TurnFileChangesSnapshot } from '../../src/interactive/turn-file-changes-types.js';

const SNAPSHOT: TurnFileChangesSnapshot = {
  runId: 'run-42',
  baselineHead: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
  collectedAt: '2026-10-21T08:00:00.000Z',
  collectMs: 245,
  status: 'partial',
  reason: 'timeout',
  truncated: true,
  files: [
    {
      path: 'src/a.ts',
      status: 'modified',
      added: 3,
      deleted: 1,
      attribution: 'edit_patch',
      editToolNames: ['Edit'],
      source: 'git',
    },
    {
      path: 'logs/turn.log',
      status: 'added',
      added: 0,
      deleted: 0,
      attribution: 'command',
      source: 'mtime',
    },
  ],
  concurrentSessionsHint: true,
};

/* ── fetch mock（hub-client.test.ts 同款手法）────────────────────────────── */

let lastCall: { url: string; init: RequestInit } | null = null;

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
  vi.stubGlobal('fetch', mockFetchOk({ agent_run_id: 'run-42', status: 'completed' }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/* ── 1. 组装点（纯函数）──────────────────────────────────────────────────── */

describe('buildRunSnapshotPayload × 唯一组装点', () => {
  it('终态 + 快照 + daemon_version 全带；timing 缺省 → 键不出现', () => {
    const payload = buildRunSnapshotPayload({
      terminal: { status: 'error_during_execution', is_error: true, subtype: 'error_during_execution' },
      fileChanges: SNAPSHOT,
      daemonVersion: '0.1.1',
    });
    expect(payload).toMatchObject({
      status: 'error_during_execution',
      is_error: true,
      subtype: 'error_during_execution',
      daemon_version: '0.1.1',
    });
    expect(payload.file_changes).toBe(SNAPSHOT); // 同一引用，不复制不改写
    expect('timing' in payload).toBe(false); // 缺失就不写
  });

  it('终态缺失 → success/false 兜底；快照缺失 → file_changes 键不出现', () => {
    const payload = buildRunSnapshotPayload({ daemonVersion: '0.1.1' });
    expect(payload).toMatchObject({ status: 'success', is_error: false, daemon_version: '0.1.1' });
    expect('file_changes' in payload).toBe(false);
    expect('subtype' in payload).toBe(false);
    expect('timing' in payload).toBe(false);
  });

  it('timing 给了就写（task-10 扩展位，不用改调用面）', () => {
    const timing = { runId: 'run-42', ttftMs: 1200, totalMs: 9000, attempts: [] };
    const payload = buildRunSnapshotPayload({
      terminal: { status: 'success', is_error: false },
      fileChanges: SNAPSHOT,
      timing,
    });
    expect(payload.timing).toBe(timing);
    expect('daemon_version' in payload).toBe(false);
  });
});

/* ── 2. wire body（hub-client 守卫映射）──────────────────────────────────── */

describe('HubClient.notifyRunResult × 快照字段映射', () => {
  it('file_changes / timing / daemon_version 映射进 body；内部结构保持 camelCase', async () => {
    const client = new HubClient('http://x:8000', 't');
    await client.notifyRunResult(
      'lease-1',
      'claim-1',
      'run-42',
      buildRunSnapshotPayload({
        terminal: { status: 'success', is_error: false },
        fileChanges: SNAPSHOT,
        timing: { runId: 'run-42', ttftMs: 900 },
        daemonVersion: '0.1.1',
      }),
    );

    expect(lastCall!.url).toBe(
      'http://x:8000/api/daemon/leases/lease-1/runs/run-42/result',
    );
    const body = JSON.parse(lastCall!.init.body as string) as Record<string, unknown>;
    // 既有字段不受影响
    expect(body['status']).toBe('success');
    expect(body['is_error']).toBe(false);
    // 新增三字段
    expect(body['daemon_version']).toBe('0.1.1');
    expect(body['timing']).toEqual({ runId: 'run-42', ttftMs: 900 });
    expect(body['file_changes']).toEqual(SNAPSHOT);
    // 跨跳比对键逐字在场 + 内部结构 camelCase（后端 pydantic 镜像同形）
    const snap = body['file_changes'] as Record<string, unknown>;
    expect(Object.keys(snap)).toEqual(
      expect.arrayContaining([
        'runId',
        'baselineHead',
        'collectedAt',
        'collectMs',
        'status',
        'reason',
        'truncated',
        'files',
        'concurrentSessionsHint',
      ]),
    );
    expect(snap['concurrentSessionsHint']).toBe(true);
    const files = snap['files'] as Record<string, unknown>[];
    expect(files[0]).toMatchObject({ attribution: 'edit_patch', editToolNames: ['Edit'], source: 'git' });
    expect(files[1]).toMatchObject({ source: 'mtime', added: 0, deleted: 0 });
  });

  it('未带快照（老调用面）→ body 里三个新键都不出现（零回归）', async () => {
    const client = new HubClient('http://x:8000', 't');
    await client.notifyRunResult('lease-1', 'claim-1', 'run-42', {
      status: 'success',
      is_error: false,
    });
    const body = JSON.parse(lastCall!.init.body as string) as Record<string, unknown>;
    expect('file_changes' in body).toBe(false);
    expect('timing' in body).toBe(false);
    expect('daemon_version' in body).toBe(false);
  });
});
