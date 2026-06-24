/**
 * runtime-lock.test.ts —— daemon 启动单实例 lock 测试（ql-20260624-006）。
 *
 * 覆盖需求 7 场景 + force corrupt 补充：
 *   1. 首次 acquire 创建 lock
 *   2. 同 provider+host+server 第二个进程被拒绝
 *   3. stale pid lock 被回收
 *   4. releaseAll 后 lock 删除
 *   5. --force 回收 stale lock
 *   5b. --force 回收损坏 lock；非 force 拒绝损坏 lock
 *   6. 不同 provider 不互相阻塞
 *   7. 不同 server 不互相阻塞
 *
 * 每个用例用独立 tmp dir（mkdtemp），不污染真实 ~/.sillyhub/daemon/locks。
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  RuntimeLockManager,
  acquireLock,
  lockFilePath,
  computeLockKey,
  LockHeldError,
  type LockIdentity,
} from '../src/runtime-lock.js';

const BASE_IDENTITY: LockIdentity = {
  provider: 'claude',
  hostname: 'test-host',
  serverOrigin: 'http://localhost:8000',
};

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'runtime-lock-test-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** 构造 RuntimeLockManager（默认 claude/test-host/localhost，pid=当前进程）。 */
function mgr(
  overrides: Partial<{
    provider: string;
    hostname: string;
    serverOrigin: string;
    pid: number;
    version: string;
    force: boolean;
  }> = {},
): RuntimeLockManager {
  return new RuntimeLockManager({
    hostname: overrides.hostname ?? BASE_IDENTITY.hostname,
    serverOrigin: overrides.serverOrigin ?? BASE_IDENTITY.serverOrigin,
    pid: overrides.pid ?? process.pid,
    version: overrides.version ?? 'test-1.0.0',
    force: overrides.force,
    locksDir: dir,
  });
}

/** 直接写一个 holder lock 文件（模拟残留/stale/corrupt）。 */
async function seedHolder(
  identity: LockIdentity,
  holder: { pid: number; provider?: string; hostname?: string; version?: string },
): Promise<void> {
  const path = lockFilePath(computeLockKey(identity), dir);
  await writeFile(
    path,
    JSON.stringify({
      pid: holder.pid,
      provider: holder.provider ?? identity.provider,
      hostname: holder.hostname ?? identity.hostname,
      server_hash: 'deadbeef',
      started_at: '2026-06-24T00:00:00.000Z',
      updated_at: '2026-06-24T00:00:00.000Z',
      version: holder.version ?? 'old',
    }),
    'utf-8',
  );
}

async function readLockData(identity: LockIdentity): Promise<Record<string, unknown>> {
  const path = lockFilePath(computeLockKey(identity), dir);
  return JSON.parse(await readFile(path, 'utf-8')) as Record<string, unknown>;
}

describe('runtime-lock (ql-20260624-006)', () => {
  it('1. 首次 acquire 创建 lock 文件并写入 holder', async () => {
    const m = mgr();
    await m.acquire('claude');

    const path = lockFilePath(computeLockKey(BASE_IDENTITY), dir);
    expect(existsSync(path)).toBe(true);
    const data = await readLockData(BASE_IDENTITY);
    expect(data.pid).toBe(process.pid);
    expect(data.provider).toBe('claude');
    expect(data.hostname).toBe('test-host');
    expect(data.version).toBe('test-1.0.0');
    expect(m.acquiredCount).toBe(1);
  });

  it('2. 同 provider+host+server 第二个进程被拒绝（活跃 holder）', async () => {
    // 第一个「进程」acquire（pid=当前进程，活跃）
    await mgr({ pid: process.pid }).acquire('claude');
    // 第二个「进程」同 identity 再 acquire → 读到 holder.pid 活跃 → LockHeldError(active)
    await expect(mgr({ pid: process.pid }).acquire('claude')).rejects.toMatchObject({
      name: 'LockHeldError',
      reason: 'active',
    });
  });

  it('3. stale pid（不活跃）lock 被自动回收', async () => {
    // 残留 lock 持有的 pid 不存在（999999）→ stale
    await seedHolder(BASE_IDENTITY, { pid: 999999 });

    // acquire 不抛，自动回收覆盖
    await expect(mgr().acquire('claude')).resolves.toBeUndefined();
    const data = await readLockData(BASE_IDENTITY);
    expect(data.pid).toBe(process.pid); // 已被新 holder 接管
  });

  it('4. releaseAll 后 lock 文件被删除', async () => {
    const m = mgr();
    await m.acquire('claude');
    const path = lockFilePath(computeLockKey(BASE_IDENTITY), dir);
    expect(existsSync(path)).toBe(true);

    await m.releaseAll();

    expect(existsSync(path)).toBe(false);
    expect(m.acquiredCount).toBe(0);
  });

  it('5. --force 回收 stale pid lock', async () => {
    await seedHolder(BASE_IDENTITY, { pid: 999999 });

    await expect(mgr({ force: true }).acquire('claude')).resolves.toBeUndefined();
    const data = await readLockData(BASE_IDENTITY);
    expect(data.pid).toBe(process.pid);
  });

  it('5b. 非 force 拒绝损坏 lock；--force 回收损坏 lock', async () => {
    // 写一个损坏的（非 JSON）lock 文件
    const path = lockFilePath(computeLockKey(BASE_IDENTITY), dir);
    await writeFile(path, 'NOT VALID JSON {{{', 'utf-8');

    // 非 force → corrupt 拒绝
    await expect(mgr().acquire('claude')).rejects.toMatchObject({
      name: 'LockHeldError',
      reason: 'corrupt',
    });
    expect(existsSync(path)).toBe(true); // 未被覆盖

    // force → 回收覆盖
    await expect(mgr({ force: true }).acquire('claude')).resolves.toBeUndefined();
    const data = await readLockData(BASE_IDENTITY);
    expect(data.pid).toBe(process.pid);
  });

  it('5c. --force 不强杀活跃进程（仍拒绝活跃 holder）', async () => {
    // 活跃 holder（当前进程 pid）
    await seedHolder(BASE_IDENTITY, { pid: process.pid });

    // force 也不能回收活跃进程的 lock（需求：不建议默认强杀）
    await expect(mgr({ force: true }).acquire('claude')).rejects.toMatchObject({
      name: 'LockHeldError',
      reason: 'active',
    });
  });

  it('6. 不同 provider 不互相阻塞（不同 lock 文件）', async () => {
    const m = mgr();
    await m.acquire('claude');
    await m.acquire('codex'); // 不同 provider → 不同 lock

    expect(m.acquiredCount).toBe(2);
    const claudePath = lockFilePath(
      computeLockKey({ ...BASE_IDENTITY, provider: 'claude' }),
      dir,
    );
    const codexPath = lockFilePath(
      computeLockKey({ ...BASE_IDENTITY, provider: 'codex' }),
      dir,
    );
    expect(existsSync(claudePath)).toBe(true);
    expect(existsSync(codexPath)).toBe(true);
  });

  it('7. 不同 serverOrigin 不互相阻塞', async () => {
    await mgr({ serverOrigin: 'http://a.example:8000' }).acquire('claude');
    // 不同 server → 不同 lock，不冲突
    await expect(
      mgr({ serverOrigin: 'http://b.example:8000' }).acquire('claude'),
    ).resolves.toBeUndefined();
  });

  it('8. releaseAll 幂等（重复调用 no-op）', async () => {
    const m = mgr();
    await m.acquire('claude');
    await m.releaseAll();
    await expect(m.releaseAll()).resolves.toBeUndefined(); // 不抛
    expect(m.acquiredCount).toBe(0);
  });

  it('9. acquireLock 直接调用与 RuntimeLockManager 行为一致（活跃拒绝）', async () => {
    await acquireLock(BASE_IDENTITY, { pid: process.pid, version: 'v1', dir });
    await expect(
      acquireLock(BASE_IDENTITY, { pid: process.pid, version: 'v2', dir }),
    ).rejects.toBeInstanceOf(LockHeldError);
  });
});
