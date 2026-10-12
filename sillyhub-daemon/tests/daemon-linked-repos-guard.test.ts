// tests/daemon-linked-repos-guard.test.ts
// 2026-10-12-daemon-path-guard-completion：linked_repos_sync / linked_repos_snapshot
// 两 RPC 处理器的 allowed_roots 归属守卫。
//
// 背景（24h 风险审查 P2-3）：两 handler 是写/读宿主路径的入口，af5daeca2 只收了
// 「非空 + 绝对形态」（linked-repos-sync.ts / linked-repos-snapshot.ts 内），失陷
// backend 可下发宿主任意绝对路径（如启动目录）让 daemon 在其下落 .sillyspec/projects
// 结构。对齐同文件 get_spec_bundle DA-2 先例：入口 assertWithinAllowedRoots
//（realpath 穿透判定），越界 RpcError forbidden 经 _dispatchRpc 原样回填。
//
// 本文件测 daemon.ts 的 handler 接线守卫（形态校验后、spawn/fs 前）：
//   - root_path 在 allowed_roots 内 → 放行（业务函数被调用、payload 透传）
//   - root_path 越界 → RpcError forbidden，业务函数零调用（零 spawn/零 fs）
// 业务函数内部行为（逐层结果体/相对形态校验）见 linked-repos-sync.test.ts /
// linked-repos-snapshot.test.ts（本文件 vi.mock 隔离真实 spawn）。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Daemon } from '../src/daemon.js';
import { RpcError } from '../src/ws-client.js';
import type { DaemonConfig } from '../src/config.js';

const runSyncMock = vi.hoisted(() => vi.fn(async () => ({ results: [] })));
const runSnapshotMock = vi.hoisted(() => vi.fn(async () => ({ repos: [] })));

vi.mock('../src/linked-repos-sync.js', () => ({
  runLinkedReposSync: runSyncMock,
}));
vi.mock('../src/linked-repos-snapshot.js', () => ({
  runLinkedReposSnapshot: runSnapshotMock,
}));

const IS_WIN = process.platform === 'win32';

describe('linked_repos RPC allowed_roots 守卫（2026-10-12-daemon-path-guard-completion）', () => {
  let tmpRoot: string;

  beforeEach(async () => {
    tmpRoot = await mkdtemp(join(tmpdir(), 'linked-repos-guard-'));
    runSyncMock.mockClear();
    runSnapshotMock.mockClear();
  });

  afterEach(async () => {
    await rm(tmpRoot, { recursive: true, force: true });
    vi.restoreAllMocks();
  });

  /** 构造 Daemon 并捕获 linked_repos 两 RPC handler（config.allowed_roots=[tmpRoot]）。 */
  function buildHandlers(): Map<string, (params: unknown) => Promise<unknown>> {
    const config = {
      server_url: 'http://127.0.0.1:8000',
      token: 'test-token',
      runtime_id: 'runtime-uuid-123',
      profile: 'default',
      workspace_dir: join(tmpRoot, 'ws'),
      poll_interval: 0.02,
      heartbeat_interval: 0.02,
      max_concurrent_tasks: 5,
      log_level: 'debug',
      allowed_roots: [tmpRoot],
    } as DaemonConfig;
    const daemon = new Daemon(config, {} as never);
    const handlers = new Map<string, (params: unknown) => Promise<unknown>>();
    const fakeWs = {
      registerRpcHandler: (name: string, fn: (params: unknown) => Promise<unknown>) => {
        handlers.set(name, fn);
      },
    };
    (
      daemon as unknown as {
        _registerLinkedReposRpcHandler: (ws: unknown) => void;
      }
    )._registerLinkedReposRpcHandler(fakeWs);
    return handlers;
  }

  function syncPayload(rootPath: string): Record<string, unknown> {
    return {
      workspace_id: 'ws-1',
      root_path: rootPath,
      repos: [{ name: 'alpha', rel_path: 'alpha', repo_url: null, abs_path: null }],
    };
  }

  it('linked_repos_sync：root_path 在 allowed_roots 内 → 放行（业务函数被调、payload 透传）', async () => {
    const handlers = buildHandlers();
    await handlers.get('linked_repos_sync')!(syncPayload(tmpRoot));
    expect(runSyncMock).toHaveBeenCalledTimes(1);
    expect(runSyncMock.mock.calls[0]![0]).toMatchObject({
      workspace_id: 'ws-1',
      root_path: tmpRoot,
    });
  });

  it('linked_repos_sync：root_path 越界 → forbidden 且业务函数零调用（零 spawn）', async () => {
    const handlers = buildHandlers();
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    await expect(handlers.get('linked_repos_sync')!(syncPayload(evil))).rejects.toBeInstanceOf(
      RpcError,
    );
    await expect(handlers.get('linked_repos_sync')!(syncPayload(evil))).rejects.toMatchObject({
      code: 'forbidden',
    });
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it('linked_repos_snapshot：root_path 在 allowed_roots 内 → 放行', async () => {
    const handlers = buildHandlers();
    await handlers.get('linked_repos_snapshot')!({ root_path: tmpRoot });
    expect(runSnapshotMock).toHaveBeenCalledTimes(1);
    expect(runSnapshotMock).toHaveBeenCalledWith(tmpRoot);
  });

  it('linked_repos_snapshot：root_path 越界 → forbidden 且业务函数零调用', async () => {
    const handlers = buildHandlers();
    const evil = IS_WIN ? 'C:\\Windows' : '/etc';
    await expect(handlers.get('linked_repos_snapshot')!({ root_path: evil })).rejects.toMatchObject(
      {
        code: 'forbidden',
      },
    );
    expect(runSnapshotMock).not.toHaveBeenCalled();
  });
});
