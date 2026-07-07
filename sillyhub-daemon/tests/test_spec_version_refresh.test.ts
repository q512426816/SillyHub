// tests/test_spec_version_refresh.ts
// task-11（2026-07-02-workspace-config-flow）daemon 侧 D-010 日常保鲜单测
// + 2026-07-07-platform-json-contract-align（D-001@v1：迁到 .runtime/spec-version.json）：
//   - readLocalSpecVersion：读 {specCacheRoot}/.runtime/spec-version.json.spec_version
//     （缺失/损坏/合法/null specCacheRoot）
//   - shouldRefreshSpec：版本比对纯函数全分支
//     （lease 缺失→false / local null→true / 相等→false / 不等→true）
//   - bumpLocalSpecVersion：pull 后回写 spec_version + synced_at
//     （文件不存在跳过 / synced_at 更新 / 非法原文件 warn 不抛）
//
// 覆盖：design.md §5 日常保鲜 / §10 W3；decisions.md D-010 / D-001@v1。
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  DAEMON_STATE_FILENAME,
} from '../src/spec-sync.js';

describe('readLocalSpecVersion (task-11 / D-010 / D-001@v1)', () => {
  let specCacheRoot: string;

  beforeEach(async () => {
    specCacheRoot = await mkdtemp(join(tmpdir(), 'spec-ver-read-'));
    await mkdir(join(specCacheRoot, '.runtime'), { recursive: true });
  });

  afterEach(async () => {
    await rm(specCacheRoot, { recursive: true, force: true });
  });

  it('specCacheRoot=undefined → null（无本地路径可读）', async () => {
    expect(await readLocalSpecVersion(undefined)).toBeNull();
  });

  it('状态文件不存在 → null（首次初始化前，视为无版本记录）', async () => {
    expect(await readLocalSpecVersion(specCacheRoot)).toBeNull();
  });

  it('状态文件合法且 spec_version=3 → 3', async () => {
    await writeFile(
      join(specCacheRoot, DAEMON_STATE_FILENAME),
      JSON.stringify({ spec_version: 3, synced_at: '2026-07-02T10:00:00Z' }),
    );
    expect(await readLocalSpecVersion(specCacheRoot)).toBe(3);
  });

  it('spec_version=0 → 0（首次扫描后递增前的合法值，非 null）', async () => {
    await writeFile(
      join(specCacheRoot, DAEMON_STATE_FILENAME),
      JSON.stringify({ spec_version: 0 }),
    );
    expect(await readLocalSpecVersion(specCacheRoot)).toBe(0);
  });

  it('JSON 损坏 → null（吞异常，保守视为无版本记录）', async () => {
    await writeFile(join(specCacheRoot, DAEMON_STATE_FILENAME), '{ not valid json');
    expect(await readLocalSpecVersion(specCacheRoot)).toBeNull();
  });

  it('spec_version 缺失 → null', async () => {
    await writeFile(
      join(specCacheRoot, DAEMON_STATE_FILENAME),
      JSON.stringify({ synced_at: '2026-07-02T10:00:00Z' }),
    );
    expect(await readLocalSpecVersion(specCacheRoot)).toBeNull();
  });

  it('spec_version 非整数（字符串/小数/NaN）→ null', async () => {
    await writeFile(
      join(specCacheRoot, DAEMON_STATE_FILENAME),
      JSON.stringify({ spec_version: '3' }),
    );
    expect(await readLocalSpecVersion(specCacheRoot)).toBeNull();
    await writeFile(
      join(specCacheRoot, DAEMON_STATE_FILENAME),
      JSON.stringify({ spec_version: 3.5 }),
    );
    expect(await readLocalSpecVersion(specCacheRoot)).toBeNull();
  });
});

describe('shouldRefreshSpec (task-11 / D-010 比对纯函数)', () => {
  it('leaseVersion=undefined → false（旧 backend 未透传，保持旧行为不强制刷新）', () => {
    expect(shouldRefreshSpec(3, undefined)).toBe(false);
  });

  it('leaseVersion=null → false（同上，snake/camel 都缺失）', () => {
    expect(shouldRefreshSpec(3, null)).toBe(false);
  });

  it('localVersion=null + leaseVersion=5 → true（首次初始化前 / 状态文件未写，视为落后）', () => {
    expect(shouldRefreshSpec(null, 5)).toBe(true);
  });

  it('两者相等 → false（缓存新鲜，跳过 pull）', () => {
    expect(shouldRefreshSpec(5, 5)).toBe(false);
  });

  it('两者不等（本地落后）→ true（A 重扫后 lease 版本递增，B 比对到落后）', () => {
    expect(shouldRefreshSpec(3, 5)).toBe(true);
  });

  it('两者不等（本地超前，理论不应发生但保守触发刷新）→ true', () => {
    expect(shouldRefreshSpec(7, 5)).toBe(true);
  });

  it('localVersion=0 + leaseVersion=0 → false（零版本相等也视为新鲜）', () => {
    expect(shouldRefreshSpec(0, 0)).toBe(false);
  });
});

describe('bumpLocalSpecVersion (task-11 / D-010 pull 后保鲜 / D-001@v1)', () => {
  let specCacheRoot: string;

  beforeEach(async () => {
    specCacheRoot = await mkdtemp(join(tmpdir(), 'spec-ver-bump-'));
    await mkdir(join(specCacheRoot, '.runtime'), { recursive: true });
  });

  afterEach(async () => {
    await rm(specCacheRoot, { recursive: true, force: true });
  });

  it('specCacheRoot=undefined → 静默跳过（无路径可写）', async () => {
    await expect(bumpLocalSpecVersion(undefined, 5)).resolves.toBeUndefined();
  });

  it('状态文件不存在 → 不创建文件（init lease writeDaemonState 职责，保鲜不越界）', async () => {
    await bumpLocalSpecVersion(specCacheRoot, 5);
    await expect(readFile(join(specCacheRoot, DAEMON_STATE_FILENAME))).rejects.toThrow();
  });

  it('已有状态文件 → 更新 spec_version + synced_at', async () => {
    const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
    await writeFile(statePath, JSON.stringify({ spec_version: 2, synced_at: '2026-07-02T10:00:00Z' }));
    await bumpLocalSpecVersion(specCacheRoot, 5);
    const after = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
    expect(after.spec_version).toBe(5);
    // synced_at 应被更新为合法 ISO 时间（非原值）。
    expect(typeof after.synced_at).toBe('string');
    expect(after.synced_at).not.toBe('2026-07-02T10:00:00Z');
    expect(Number.isNaN(Date.parse(after.synced_at as string))).toBe(false);
  });

  it('spec_version=0 也能正确写入（零版本合法）', async () => {
    const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
    await writeFile(statePath, JSON.stringify({ spec_version: 3 }));
    await bumpLocalSpecVersion(specCacheRoot, 0);
    const after = JSON.parse(await readFile(statePath, 'utf-8')) as { spec_version: number };
    expect(after.spec_version).toBe(0);
  });

  it('原状态文件是损坏 JSON → warn 不抛（保鲜 best-effort，不阻塞 pull 已落地缓存）', async () => {
    const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
    await writeFile(statePath, '{ broken');
    await expect(bumpLocalSpecVersion(specCacheRoot, 5)).resolves.toBeUndefined();
    // 损坏文件原样保留（bump 未改写）
    expect(await readFile(statePath, 'utf-8')).toBe('{ broken');
  });
});

describe('D-010 端到端保鲜序列（read → shouldRefresh → bump）', () => {
  let specCacheRoot: string;

  beforeEach(async () => {
    specCacheRoot = await mkdtemp(join(tmpdir(), 'spec-ver-e2e-'));
    await mkdir(join(specCacheRoot, '.runtime'), { recursive: true });
  });

  afterEach(async () => {
    await rm(specCacheRoot, { recursive: true, force: true });
  });

  it('验收标准 §10 W3：A 重扫递增 → B 下次任务前比对到落后 → bump 后再比对一致', async () => {
    const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);

    // 初始：本地版本 3（A 上次初始化/同步后）
    await writeFile(statePath, JSON.stringify({ spec_version: 3 }));

    // A 重扫，backend spec_version 递增到 5，lease 下发 latest_spec_version=5
    const leaseVersionAfterRescan = 5;
    const localBefore = await readLocalSpecVersion(specCacheRoot);
    expect(shouldRefreshSpec(localBefore, leaseVersionAfterRescan)).toBe(true); // 落后 → pull

    // daemon pullSpecBundle 成功后保鲜回写
    await bumpLocalSpecVersion(specCacheRoot, leaseVersionAfterRescan);

    // B 下次任务前再比对：本地已是 5，与 lease 一致 → 跳过 pull
    const localAfter = await readLocalSpecVersion(specCacheRoot);
    expect(localAfter).toBe(5);
    expect(shouldRefreshSpec(localAfter, leaseVersionAfterRescan)).toBe(false);
  });

  it('版本一致不重复 pull：本地与 lease 均 5 → shouldRefresh=false', async () => {
    await writeFile(join(specCacheRoot, DAEMON_STATE_FILENAME), JSON.stringify({ spec_version: 5 }));
    const local = await readLocalSpecVersion(specCacheRoot);
    expect(shouldRefreshSpec(local, 5)).toBe(false);
  });
});
