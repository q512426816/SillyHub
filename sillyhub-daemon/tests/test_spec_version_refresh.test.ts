// tests/test_spec_version_refresh.ts
// task-11（2026-07-02-workspace-config-flow）daemon 侧 D-010 日常保鲜单测：
//   - readLocalSpecVersion：读 rootPath/.sillyspec-platform.json.spec_version
//     （缺失/损坏/合法/null rootPath）
//   - shouldRefreshSpec：版本比对纯函数全分支
//     （lease 缺失→false / local null→true / 相等→false / 不等→true）
//   - bumpLocalSpecVersion：pull 后回写 spec_version + synced_at
//     （文件不存在跳过 / 字段保留 / synced_at 更新 / 非法原文件 warn 不抛）
//
// 覆盖：design.md §5 日常保鲜 / §10 W3（A 重扫递增、B 落后自动 pull）；decisions.md D-010。
// vitest.config.ts: globals=false → 显式 import；include=tests/**/*.test.ts。

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  readLocalSpecVersion,
  shouldRefreshSpec,
  bumpLocalSpecVersion,
  PLATFORM_CONFIG_FILENAME,
} from '../src/spec-sync.js';

describe('readLocalSpecVersion (task-11 / D-010)', () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'spec-ver-read-'));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it('rootPath=undefined → null（无本地路径可读）', async () => {
    expect(await readLocalSpecVersion(undefined)).toBeNull();
  });

  it('platform.json 不存在 → null（首次初始化前，视为无版本记录）', async () => {
    expect(await readLocalSpecVersion(rootPath)).toBeNull();
  });

  it('platform.json 合法且 spec_version=3 → 3', async () => {
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({
        workspace_id: 'ws-1',
        server_origin: 'http://localhost:8001',
        strategy: 'platform-managed',
        spec_version: 3,
        cache_root: '/tmp/cache',
        synced_at: '2026-07-02T10:00:00Z',
      }),
    );
    expect(await readLocalSpecVersion(rootPath)).toBe(3);
  });

  it('spec_version=0 → 0（首次扫描后递增前的合法值，非 null）', async () => {
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({ spec_version: 0 }),
    );
    expect(await readLocalSpecVersion(rootPath)).toBe(0);
  });

  it('JSON 损坏 → null（吞异常，保守视为无版本记录）', async () => {
    await writeFile(join(rootPath, PLATFORM_CONFIG_FILENAME), '{ not valid json');
    expect(await readLocalSpecVersion(rootPath)).toBeNull();
  });

  it('spec_version 缺失 → null', async () => {
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({ workspace_id: 'ws-1' }),
    );
    expect(await readLocalSpecVersion(rootPath)).toBeNull();
  });

  it('spec_version 非整数（字符串/小数/NaN）→ null', async () => {
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({ spec_version: '3' }),
    );
    expect(await readLocalSpecVersion(rootPath)).toBeNull();
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({ spec_version: 3.5 }),
    );
    expect(await readLocalSpecVersion(rootPath)).toBeNull();
  });
});

describe('shouldRefreshSpec (task-11 / D-010 比对纯函数)', () => {
  it('leaseVersion=undefined → false（旧 backend 未透传，保持旧行为不强制刷新）', () => {
    expect(shouldRefreshSpec(3, undefined)).toBe(false);
  });

  it('leaseVersion=null → false（同上，snake/camel 都缺失）', () => {
    expect(shouldRefreshSpec(3, null)).toBe(false);
  });

  it('localVersion=null + leaseVersion=5 → true（首次初始化前 / platform.json 未写，视为落后）', () => {
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

describe('bumpLocalSpecVersion (task-11 / D-010 pull 后保鲜)', () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'spec-ver-bump-'));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it('rootPath=undefined → 静默跳过（无路径可写）', async () => {
    await expect(bumpLocalSpecVersion(undefined, 5)).resolves.toBeUndefined();
  });

  it('platform.json 不存在 → 不创建文件（init lease 职责，保鲜不越界）', async () => {
    await bumpLocalSpecVersion(rootPath, 5);
    const { readFile: rf } = await import('node:fs/promises');
    await expect(rf(join(rootPath, PLATFORM_CONFIG_FILENAME))).rejects.toThrow();
  });

  it('已有 platform.json → 更新 spec_version + synced_at，保留其他字段', async () => {
    const configPath = join(rootPath, PLATFORM_CONFIG_FILENAME);
    await writeFile(
      configPath,
      JSON.stringify({
        workspace_id: 'ws-bump',
        server_origin: 'http://localhost:8001',
        strategy: 'platform-managed',
        spec_version: 2,
        cache_root: '/tmp/cache',
        synced_at: '2026-07-02T10:00:00Z',
      }),
    );
    await bumpLocalSpecVersion(rootPath, 5);
    const after = JSON.parse(await readFile(configPath, 'utf-8')) as Record<string, unknown>;
    expect(after.spec_version).toBe(5);
    expect(after.workspace_id).toBe('ws-bump');
    expect(after.server_origin).toBe('http://localhost:8001');
    expect(after.strategy).toBe('platform-managed');
    expect(after.cache_root).toBe('/tmp/cache');
    // synced_at 应被更新为合法 ISO 时间（非原值）。
    expect(typeof after.synced_at).toBe('string');
    expect(after.synced_at).not.toBe('2026-07-02T10:00:00Z');
    expect(Number.isNaN(Date.parse(after.synced_at as string))).toBe(false);
  });

  it('spec_version=0 也能正确写入（零版本合法）', async () => {
    const configPath = join(rootPath, PLATFORM_CONFIG_FILENAME);
    await writeFile(configPath, JSON.stringify({ spec_version: 3 }));
    await bumpLocalSpecVersion(rootPath, 0);
    const after = JSON.parse(await readFile(configPath, 'utf-8')) as { spec_version: number };
    expect(after.spec_version).toBe(0);
  });

  it('原 platform.json 是损坏 JSON → warn 不抛（保鲜 best-effort，不阻塞 pull 已落地缓存）', async () => {
    const configPath = join(rootPath, PLATFORM_CONFIG_FILENAME);
    await writeFile(configPath, '{ broken');
    await expect(bumpLocalSpecVersion(rootPath, 5)).resolves.toBeUndefined();
    // 损坏文件原样保留（bump 未改写）
    expect(await readFile(configPath, 'utf-8')).toBe('{ broken');
  });
});

describe('D-010 端到端保鲜序列（read → shouldRefresh → bump）', () => {
  let rootPath: string;

  beforeEach(async () => {
    rootPath = await mkdtemp(join(tmpdir(), 'spec-ver-e2e-'));
  });

  afterEach(async () => {
    await rm(rootPath, { recursive: true, force: true });
  });

  it('验收标准 §10 W3：A 重扫递增 → B 下次任务前比对到落后 → bump 后再比对一致', async () => {
    const configPath = join(rootPath, PLATFORM_CONFIG_FILENAME);

    // 初始：本地版本 3（A 上次初始化/同步后）
    await writeFile(configPath, JSON.stringify({ spec_version: 3 }));

    // A 重扫，backend spec_version 递增到 5，lease 下发 latest_spec_version=5
    const leaseVersionAfterRescan = 5;
    const localBefore = await readLocalSpecVersion(rootPath);
    expect(shouldRefreshSpec(localBefore, leaseVersionAfterRescan)).toBe(true); // 落后 → pull

    // daemon pullSpecBundle 成功后保鲜回写
    await bumpLocalSpecVersion(rootPath, leaseVersionAfterRescan);

    // B 下次任务前再比对：本地已是 5，与 lease 一致 → 跳过 pull
    const localAfter = await readLocalSpecVersion(rootPath);
    expect(localAfter).toBe(5);
    expect(shouldRefreshSpec(localAfter, leaseVersionAfterRescan)).toBe(false);
  });

  it('版本一致不重复 pull：本地与 lease 均 5 → shouldRefresh=false', async () => {
    await writeFile(
      join(rootPath, PLATFORM_CONFIG_FILENAME),
      JSON.stringify({ spec_version: 5 }),
    );
    const local = await readLocalSpecVersion(rootPath);
    expect(shouldRefreshSpec(local, 5)).toBe(false);
  });
});
