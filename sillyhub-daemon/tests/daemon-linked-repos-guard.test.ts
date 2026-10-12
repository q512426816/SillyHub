// tests/daemon-linked-repos-guard.test.ts
// 2026-10-12-daemon-path-guard-completion（初版 allowed_roots 白名单守卫）→
// 2026-10-12-regression-review-remediation（语义修正为 ql-20260831-006 存在性检查）：
// linked_repos_sync / linked_repos_snapshot 两 RPC 的 root_path 守卫。
//
// 演进：初版按 get_spec_bundle DA-2 先例加机器白名单——回归复审 F1 指出与
// ql-20260831-006 产品决策冲突（工作区绑定根不在机器白名单属合法形态，仓内
// 生产实证 E:\sgm / F:\WorkNew；会话 cwd 守卫为此专门跳过白名单），现网存量
// 部署会被首次 forbidden 拒止。现语义：root_path 与会话 lease workspaceRoot
// 同源同信任级 → 机器白名单不拦，错机派发保护由存在性检查承担（stat 目录
// 必存性；错机上目录必不存在）。
//
// 本文件测 daemon.ts 的 handler 接线守卫（形态校验后、spawn/fs 前）：
//   - root_path 存在（白名单内外皆可）→ 放行（业务函数被调用、payload 透传）
//   - root_path 不存在/非目录 → 抛错，业务函数零调用（零 spawn/零 fs）
// 业务函数内部行为（逐层结果体/相对形态校验）见 linked-repos-sync.test.ts /
// linked-repos-snapshot.test.ts（本文件 vi.mock 隔离真实 spawn）。

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Daemon } from '../src/daemon.js';
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

  it('linked_repos_sync：root_path 白名单外但存在 → ql-20260831-006 语义放行（机器白名单不拦工作区根）', async () => {
    // 回归复审 F1（2026-10-12-regression-review-remediation）：白名单守卫与
    // ql-20260831-006 产品决策冲突（工作区绑定根不在机器白名单属合法形态，
    // 仓内生产实证 E:\sgm / F:\WorkNew）——守卫语义修正为存在性检查。
    const handlers = buildHandlers();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'linked-repos-outside-'));
    try {
      await handlers.get('linked_repos_sync')!(syncPayload(outsideRoot));
      expect(runSyncMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
  });

  it('linked_repos_sync：root_path 不存在 → 抛错且业务函数零调用（错机派发保护）', async () => {
    const handlers = buildHandlers();
    const ghost = join(tmpRoot, 'does-not-exist');
    await expect(handlers.get('linked_repos_sync')!(syncPayload(ghost))).rejects.toThrow(
      /不存在或非目录/,
    );
    expect(runSyncMock).not.toHaveBeenCalled();
  });

  it('linked_repos_snapshot：root_path 在 allowed_roots 内 → 放行', async () => {
    const handlers = buildHandlers();
    await handlers.get('linked_repos_snapshot')!({ root_path: tmpRoot });
    expect(runSnapshotMock).toHaveBeenCalledTimes(1);
    expect(runSnapshotMock).toHaveBeenCalledWith(tmpRoot);
  });

  it('linked_repos_snapshot：root_path 白名单外但存在 → 放行（ql-20260831-006）；不存在 → 抛错零调用', async () => {
    const handlers = buildHandlers();
    const outsideRoot = await mkdtemp(join(tmpdir(), 'linked-repos-snap-out-'));
    try {
      await handlers.get('linked_repos_snapshot')!({ root_path: outsideRoot });
      expect(runSnapshotMock).toHaveBeenCalledTimes(1);
    } finally {
      await rm(outsideRoot, { recursive: true, force: true });
    }
    const ghost = join(tmpRoot, 'missing-dir');
    await expect(handlers.get('linked_repos_snapshot')!({ root_path: ghost })).rejects.toThrow(
      /不存在或非目录/,
    );
    expect(runSnapshotMock).toHaveBeenCalledTimes(1); // 不存在那次未新增调用
  });
});
