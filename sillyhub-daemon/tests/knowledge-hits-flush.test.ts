/**
 * 2026-10-27-knowledge-hits-flush-button task-02：daemon 知识遥测按需补数 RPC 全链路测试。
 *
 * 覆盖行为矩阵：
 *   - 参数守卫：非法 workspace_id（非 UUID）→ RpcError invalid_params（sillyspec_sync_change
 *     同款入口守卫先例）。
 *   - 强制上行：state/ 新路径有积压行 → 立即增量上行并回执 {ok:true}（读路径走
 *     task-01 双路径解析；mtime 短路在周期器层，flush 天然绕过）。
 *   - 无新行：offset 已追平 → 回执 {ok:true}（无新行不是错误）。
 *   - 上行失败：端点 500 → 回执 {ok:false, reason:'upload_failed'}（不向 RPC 层抛，
 *     backend 降级铁律期望结构化回执）。
 *   - in-flight 去重：慢上行期间第二次 flush 秒回 {ok:true, reason:'in_flight'}，
 *     上行器只执行一次（显式用户动作只防重入，无 TTL 防抖）。
 *
 * 策略：daemon 层照 sillyspec-sync-change-rpc.test.ts 惯例（手动调
 * _registerSillySpecRpcHandler 捕获 handler，不起 start() 循环）；上行器用真实
 * 实现（知识-hits-upload.test.ts 已单测），仅 mock resolveSpecDir（spec 树路径
 * → 临时目录）与 hub client（网络层）。homedir 隔离照 knowledge-hits-upload
 * 先例（状态文件落 daemonStateDir()）。
 *
 * @module knowledge-hits-flush.test
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// ── hoisted mocks（homedir / resolveSpecDir 必须在 daemon import 前替换）────
const hoisted = vi.hoisted(() => ({
  homedirMock: vi.fn((): string => '/nonexistent-hits-flush-test-home'),
  resolveSpecDirMock: vi.fn((wsId: string): string => `/nonexistent-spec-${wsId}`),
}));
vi.mock('node:os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:os')>();
  return { ...actual, homedir: hoisted.homedirMock };
});
// 按 vitest 模块解析：'../src/spec-sync.js'（本文件视角）与 daemon.ts 的
// './spec-sync.js' 解析到同一模块——部分替换仅 resolveSpecDir，其余真实导出保留。
vi.mock('../src/spec-sync.js', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, resolveSpecDir: hoisted.resolveSpecDirMock };
});
const FAKE_HOME = mkdtempSync(join(tmpdir(), 'hits-flush-test-home-'));
hoisted.homedirMock.mockReturnValue(FAKE_HOME);

import { Daemon } from '../src/daemon.js';
import type { DaemonConfig } from '../src/config.js';
import { RpcError } from '../src/ws-client.js';

// ── 公共 fixture（照 sillyspec-sync-change-rpc.test.ts 先例）────────────────

function makeConfig(overrides: Partial<DaemonConfig> = {}): DaemonConfig {
  return {
    server_url: 'http://127.0.0.1:8000',
    token: null,
    api_key: null,
    runtime_id: 'rt-hits-flush',
    profile: 'default',
    workspace_dir: '/tmp/ws-hits-flush',
    poll_interval: 9999,
    heartbeat_interval: 9999,
    max_concurrent_tasks: 5,
    log_level: 'debug',
    default_timeout_seconds: 1800,
    max_retries: 1,
    retry_max_attempts: 3,
    retry_base_delay_ms: 1000,
    retry_backoff_factor: 2,
    retry_jitter: 0.2,
    loop_restart_backoff_ms: 5000,
    max_loop_restarts: 10,
    outbox_max_per_run: 500,
    outbox_max_total: 5000,
    disconnect_log_threshold_sec: 30,
    terminal_observer_enabled: false,
    terminal_observer_mode: 'parsed',
    terminal_observer_close_on_exit: false,
    terminal_observer_command: null,
    lease_heartbeat_interval: 5,
    allowed_roots: [],
    spec_root_map: '',
    self_reload_check_interval_sec: 600,
    sillyspec_update_interval_sec: 9999,
    sillyspec_status_interval_sec: 0,
    sillyspec_command_timeout_sec: 120,
    ...overrides,
  };
}

const WS_ID = '11111111-2222-3333-4444-555555555555';

/** daemon harness：真实 Daemon 构造（client 携带 postKnowledgeHitsBatch），
 * 手动注册捕获 handler（照 sillyspec-sync-change-rpc 先例）。 */
function makeDaemonHarness(
  poster: { postKnowledgeHitsBatch: ReturnType<typeof vi.fn> },
) {
  const registered = new Map<string, (params: Record<string, unknown>) => Promise<unknown>>();
  const fakeWs = {
    registerRpcHandler: (method: string, handler: (p: Record<string, unknown>) => Promise<unknown>) => {
      registered.set(method, handler);
    },
  };
  const daemon = new Daemon(
    makeConfig(),
    { heartbeat: vi.fn(async () => ({})), ...poster } as never,
    null as never,
    { sessionManager: null, sillyspecManager: null },
  );
  (daemon as unknown as { _registerSillySpecRpcHandler: (ws: unknown) => void })._registerSillySpecRpcHandler(fakeWs);
  return { daemon, registered };
}

/** 每测试独立 spec 临时目录：state/ 新路径写 hits 文件（当前 CLI 形态）。 */
async function makeStateSpecDir(hitsRaw: string): Promise<string> {
  const specDir = join(
    FAKE_HOME,
    'specs-tmp',
    `d-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  await mkdir(join(specDir, '.runtime', 'state'), { recursive: true });
  if (hitsRaw.length > 0) {
    await writeFile(join(specDir, '.runtime', 'state', 'knowledge-hits.jsonl'), hitsRaw, 'utf-8');
  }
  hoisted.resolveSpecDirMock.mockReturnValue(specDir);
  return specDir;
}

function silenceConsole(): () => void {
  const spies = (['log', 'info', 'warn', 'error'] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => undefined),
  );
  return () => spies.forEach((s) => s.mockRestore());
}

describe('sillyspec_hits_flush handler', () => {
  let undo: () => void;

  beforeEach(async () => {
    undo = silenceConsole();
    hoisted.resolveSpecDirMock.mockReset();
    hoisted.resolveSpecDirMock.mockImplementation((wsId: string) => `/nonexistent-spec-${wsId}`);
    // 清 offset 状态与 spec 临时目录（跨测试污染防护，对齐 knowledge-hits-upload.test.ts）。
    await rm(join(FAKE_HOME, '.sillyhub', 'daemon'), { recursive: true, force: true }).catch(() => {});
    await rm(join(FAKE_HOME, 'specs-tmp'), { recursive: true, force: true }).catch(() => {});
  });
  afterEach(() => {
    undo();
  });

  it('非法 workspace_id（非 UUID）→ RpcError invalid_params（守卫先例同 sillyspec_sync_change）', async () => {
    const { registered } = makeDaemonHarness({
      postKnowledgeHitsBatch: vi.fn(),
    });
    const handler = registered.get('sillyspec_hits_flush');
    expect(handler).toBeDefined();
    await expect(handler!({ workspace_id: 'not-a-uuid' })).rejects.toThrow(RpcError);
    await expect(handler!({})).rejects.toThrow(RpcError);
  });

  it('state/ 新路径有积压行 → 强制上行并回执 {ok:true}（读路径走 task-01 双路径）', async () => {
    await makeStateSpecDir('{"type":"inject","n":1}\n{"type":"inject","n":2}\n');
    const poster = { postKnowledgeHitsBatch: vi.fn().mockResolvedValue({ ingested: 2, skipped_bad: 0, duplicates: 0 }) };
    const { registered } = makeDaemonHarness(poster);
    const handler = registered.get('sillyspec_hits_flush')!;
    const r = (await handler({ workspace_id: WS_ID })) as { ok: boolean; reason?: string };
    expect(r).toEqual({ ok: true });
    expect(poster.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);
    expect(poster.postKnowledgeHitsBatch).toHaveBeenCalledWith(WS_ID, [
      '{"type":"inject","n":1}',
      '{"type":"inject","n":2}',
    ]);
  });

  it('无新行（文件为空）→ 回执 {ok:true}（无数据不是错误，零端点调用）', async () => {
    await makeStateSpecDir('');
    const poster = { postKnowledgeHitsBatch: vi.fn().mockResolvedValue({ ingested: 0, skipped_bad: 0, duplicates: 0 }) };
    const { registered } = makeDaemonHarness(poster);
    const r = (await (registered.get('sillyspec_hits_flush')!)({ workspace_id: WS_ID })) as { ok: boolean };
    expect(r).toEqual({ ok: true });
    expect(poster.postKnowledgeHitsBatch).not.toHaveBeenCalled();
  });

  it('上行失败（端点 500）→ 回执 {ok:false, reason:"upload_failed"}，不向 RPC 层抛', async () => {
    await makeStateSpecDir('{"n":1}\n');
    const poster = { postKnowledgeHitsBatch: vi.fn().mockRejectedValue(new Error('HTTP 500')) };
    const { registered } = makeDaemonHarness(poster);
    const handler = registered.get('sillyspec_hits_flush')!;
    const r = (await handler({ workspace_id: WS_ID })) as { ok: boolean; reason?: string };
    expect(r).toEqual({ ok: false, reason: 'upload_failed' });
  });

  it('in-flight 去重：慢上行期间第二次 flush 秒回 {ok:true, reason:"in_flight"}，上行器只执行一次', async () => {
    await makeStateSpecDir('{"n":1}\n');
    let resolveUpload!: (v: { ingested: number; skipped_bad: number; duplicates: number }) => void;
    const poster = {
      postKnowledgeHitsBatch: vi.fn(
        () =>
          new Promise((resolve) => {
            resolveUpload = resolve;
          }),
      ),
    };
    const { registered } = makeDaemonHarness(poster);
    const handler = registered.get('sillyspec_hits_flush')!;
    const p1 = handler({ workspace_id: WS_ID });
    // 等第一轮真实推进到上报点（readFile/状态读是真实 IO，宏任务时序不可假设）：
    // poster 被调且未 resolve → 上行器挂起 → in-flight 标记在场，此刻触发第二次。
    await vi.waitFor(() => expect(poster.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1));
    const r2 = (await handler({ workspace_id: WS_ID })) as { ok: boolean; reason?: string };
    expect(r2).toEqual({ ok: true, reason: 'in_flight' });
    expect(poster.postKnowledgeHitsBatch).toHaveBeenCalledTimes(1);

    resolveUpload({ ingested: 1, skipped_bad: 0, duplicates: 0 });
    const r1 = (await p1) as { ok: boolean };
    expect(r1).toEqual({ ok: true });

    // 完成后再调：非 in-flight，正常再跑一轮（无 TTL 防抖——offset 已追平，零端点调用）。
    poster.postKnowledgeHitsBatch.mockClear();
    const r3 = (await handler({ workspace_id: WS_ID })) as { ok: boolean };
    expect(r3).toEqual({ ok: true });
    expect(poster.postKnowledgeHitsBatch).not.toHaveBeenCalled();
  });
});
