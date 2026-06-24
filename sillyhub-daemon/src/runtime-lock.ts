/**
 * runtime-lock.ts —— daemon 启动单实例 lock。
 *
 * 强制 invariant：一 host + 一 user + 一 provider = 一个 daemon。
 *
 * 背景：backend runtime_id 按 (user_id, provider, hostname) upsert
 *（runtime/service.py:108-142），同机同 provider 双开两个 daemon 进程会命中
 * 同一 backend runtime 记录、共享 runtime_id → recoverSession ownership guard
 * 双双通过（双接管）+ WS ws_hub replaced(close 4000) 重连风暴。本模块在 daemon
 * 本地启动阶段强制单实例，堵住 upsert key 碰撞。
 *
 * lock 维度（对齐 backend upsert key，但用 serverOrigin 代理 user，避免泄漏 api key）：
 *   provider + hostname + serverOrigin(=config.server_url)
 *   - 同 provider + 同 host + 同 server → 命中同一 lock → 第二个进程拒绝启动
 *   - 不同 provider / 不同 server → 不同 lock，不互相阻塞
 *
 * **v1 保守锁 known limitation**：backend 真实 upsert key 是 user_id+provider+hostname
 *（runtime/service.py:108），本 lock key 未含 user_id 维度（用 serverOrigin 代理 user）。
 * 故会额外阻止「同 host+同 server+同 provider+不同用户/api-key」的多 daemon。v1 取舍：
 * 只防同机双开共享 runtime_id/ownership 双通过/WS 重连风暴；未来支持同机多账号 daemon
 * 需把 user_id 或 auth identity hash 纳入 key。
 *
 * lock 文件：<dir>/runtime-<key>.lock（dir 默认 ~/.sillyhub/daemon/locks，测试可注入）
 *   key = sha256(provider + '\0' + hostname + '\0' + serverOrigin) 前 16 hex
 *   （不含敏感信息；server_hash 是 serverOrigin 的短摘要，便于人工辨认归属）
 *
 * lock 内容（JSON）：pid / hostname / provider / server_hash / started_at /
 * updated_at / version。不含 claim token / api key / 凭证（白名单）。
 *
 * 生命周期：
 *   - acquire：O_EXCL('wx') 原子创建。已存在 → 读 holder：
 *       · holder 损坏/不可读 → 非 force 保守拒绝；force 回收覆盖。
 *       · holder.pid 不活跃（stale，孤儿 lock）→ 自动回收覆盖（force 与否）。
 *       · holder.pid 活跃 → 拒绝（LockHeldError）。force **不**强杀活跃进程，
 *         只提示用户先停旧 daemon（需求：不建议默认强杀）。
 *   - release：删 lock 文件（best-effort，幂等）。
 *   - 异常退出（SIGKILL/断电）不 release：下次启动靠 pid 存活检测回收 stale。
 *
 * 跨平台 pid 存活检测：process.kill(pid, 0) + ESRCH(不存在)/EPERM(存在无权限)，
 * 语义对齐 cli.ts isProcessAlive。
 *
 * @module runtime-lock
 */

import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdir, open, readFile, unlink, writeFile } from 'node:fs/promises';

/** lock 文件默认目录：~/.sillyhub/daemon/locks（与 sessions.json 同根）。 */
export const LOCKS_DIR = join(homedir(), '.sillyhub', 'daemon', 'locks');

/** lock 身份维度（对齐 backend upsert key，不含 user/api-key）。 */
export interface LockIdentity {
  provider: string;
  hostname: string;
  serverOrigin: string;
}

/** lock 文件落盘内容（白名单，无敏感字段）。 */
export interface LockFileData {
  pid: number;
  hostname: string;
  provider: string;
  server_hash: string;
  started_at: string;
  updated_at: string;
  version: string;
}

/** lock 被活跃进程持有时抛出（拒绝启动）。 */
export class LockHeldError extends Error {
  constructor(
    /** 已持有的 lock 内容（pid 活跃分支有值；损坏分支为占位空 data）。 */
    public readonly holder: LockFileData,
    public readonly lockPath: string,
    /** 区分「活跃进程持有」vs「损坏 lock 需 --force」。 */
    public readonly reason: 'active' | 'corrupt',
  ) {
    const hint =
      reason === 'active'
        ? `another daemon is running (pid ${holder.pid}, provider=${holder.provider}, host=${holder.hostname}); stop it first`
        : `lock file at ${lockPath} is unreadable/corrupt; run with --force to reclaim`;
    super(`runtime lock held: ${hint}`);
    this.name = 'LockHeldError';
  }
}

/**
 * 计算 lock key：sha256(provider + NUL + hostname + NUL + serverOrigin) 前 16 hex。
 * NUL 分隔避免 "ab"+"c" 与 "a"+"bc" 碰撞。不含敏感信息。
 */
export function computeLockKey(identity: LockIdentity): string {
  const raw = `${identity.provider}\0${identity.hostname}\0${identity.serverOrigin}`;
  return createHash('sha256').update(raw).digest('hex').slice(0, 16);
}

/** serverOrigin 短摘要（写入 lock 便于人工辨认归属，不参与 key）。 */
export function computeServerHash(serverOrigin: string): string {
  return createHash('sha256').update(serverOrigin).digest('hex').slice(0, 8);
}

/** lock 文件路径：<dir>/runtime-<key>.lock（dir 默认 LOCKS_DIR，测试可覆盖）。 */
export function lockFilePath(key: string, dir: string = LOCKS_DIR): string {
  return join(dir, `runtime-${key}.lock`);
}

/**
 * 跨平台 pid 存活检测。语义对齐 cli.ts isProcessAlive：
 *   - 进程存在 → true
 *   - ESRCH（不存在）→ false
 *   - EPERM（存在但无权限）→ true（保守判活，避免误回收他人进程的 lock）
 */
export function isPidAlive(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'ESRCH') return false;
    if (code === 'EPERM') return true;
    return false; // EINVAL 等保守判不存在
  }
}

/** 读 lock 文件并校验；损坏/不可读 → null。 */
async function readLock(path: string): Promise<LockFileData | null> {
  let text: string;
  try {
    text = await readFile(path, 'utf-8');
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(text) as Partial<LockFileData>;
    if (typeof obj.pid !== 'number' || !Number.isFinite(obj.pid)) return null;
    return {
      pid: obj.pid,
      hostname: typeof obj.hostname === 'string' ? obj.hostname : '',
      provider: typeof obj.provider === 'string' ? obj.provider : '',
      server_hash: typeof obj.server_hash === 'string' ? obj.server_hash : '',
      started_at: typeof obj.started_at === 'string' ? obj.started_at : '',
      updated_at: typeof obj.updated_at === 'string' ? obj.updated_at : '',
      version: typeof obj.version === 'string' ? obj.version : '',
    };
  } catch {
    return null; // 损坏 JSON → 当不可读
  }
}

export interface AcquireOptions {
  /** 当前进程 pid（写入 lock）。 */
  pid: number;
  /** daemon 版本（写入 lock，便于人工辨认）。 */
  version: string;
  /** 强制回收损坏/不可读的 lock（不强杀活跃进程）。 */
  force?: boolean;
  /** lock 目录（测试注入；默认 ~/.sillyhub/daemon/locks）。 */
  dir?: string;
  /** 注入时钟（测试用），默认 real-time ISO。 */
  now?: () => string;
}

/**
 * 获取 lock：原子创建，冲突时按 pid 存活 / force 决策。
 *
 * 决策表：
 *   lock 不存在                 → 创建（成功）
 *   存在 + holder 损坏 + 非 force → LockHeldError(corrupt)
 *   存在 + holder 损坏 + force   → 覆盖（回收）
 *   存在 + pid 不活跃（stale）   → 覆盖（自动回收，force 与否）
 *   存在 + pid 活跃              → LockHeldError(active)（force 也不强杀）
 */
export async function acquireLock(
  identity: LockIdentity,
  opts: AcquireOptions,
): Promise<void> {
  const key = computeLockKey(identity);
  const dir = opts.dir ?? LOCKS_DIR;
  const path = lockFilePath(key, dir);
  const ts = (opts.now ?? (() => new Date().toISOString()))();
  const data: LockFileData = {
    pid: opts.pid,
    hostname: identity.hostname,
    provider: identity.provider,
    server_hash: computeServerHash(identity.serverOrigin),
    started_at: ts,
    updated_at: ts,
    version: opts.version,
  };

  await mkdir(dir, { recursive: true });

  // O_EXCL 原子创建（'wx'：文件已存在则失败 EEXIST）。
  let fh;
  try {
    fh = await open(path, 'wx');
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code !== 'EEXIST') throw e; // 其他 IO 错透传
    // 文件已存在 → 按 holder 状态决策。
    const holder = await readLock(path);
    if (holder === null) {
      // 损坏/不可读：非 force 保守拒绝；force 回收覆盖。
      if (!opts.force) {
        throw new LockHeldError(emptyHolder(identity, opts), path, 'corrupt');
      }
      await writeLockFile(path, data);
      return;
    }
    if (!isPidAlive(holder.pid)) {
      // stale（pid 不活跃）：自动回收覆盖。
      await writeLockFile(path, data);
      return;
    }
    // pid 活跃：拒绝（force 也不强杀活跃进程）。
    throw new LockHeldError(holder, path, 'active');
  }
  await fh.writeFile(JSON.stringify(data, null, 2), 'utf-8');
  await fh.close();
}

/** 覆盖写 lock 文件（回收路径用，非原子但 lock 已确认归属本决策）。 */
async function writeLockFile(path: string, data: LockFileData): Promise<void> {
  await writeFile(path, JSON.stringify(data, null, 2), 'utf-8');
}

/** 损坏分支的占位 holder（pid/版本用当前值，便于错误信息可读）。 */
function emptyHolder(identity: LockIdentity, opts: AcquireOptions): LockFileData {
  return {
    pid: opts.pid,
    hostname: identity.hostname,
    provider: identity.provider,
    server_hash: computeServerHash(identity.serverOrigin),
    started_at: '',
    updated_at: '',
    version: opts.version,
  };
}

/**
 * 释放单个 lock（按 identity）。best-effort：文件不存在/删除失败均吞掉（幂等）。
 * daemon.stop 用 RuntimeLockManager.releaseAll 批量释放本次持有的 lock。
 */
export async function releaseLock(identity: LockIdentity, dir: string = LOCKS_DIR): Promise<void> {
  const path = lockFilePath(computeLockKey(identity), dir);
  try {
    await unlink(path);
  } catch {
    /* best-effort，幂等 */
  }
}

/** 按 key 释放 lock（RuntimeLockManager.releaseAll 用）。 */
export async function releaseLockByKey(key: string, dir: string = LOCKS_DIR): Promise<void> {
  try {
    await unlink(lockFilePath(key, dir));
  } catch {
    /* best-effort，幂等 */
  }
}

// ── RuntimeLockManager：daemon 启动期持有 + stop 释放 ──────────────────────────

export interface RuntimeLockManagerOptions {
  hostname: string;
  serverOrigin: string;
  pid: number;
  version: string;
  force?: boolean;
  /** lock 目录（测试注入；默认 ~/.sillyhub/daemon/locks）。 */
  locksDir?: string;
}

/**
 * daemon 启动期 lock 管理器：跟踪本次 acquire 的 key，stop 时批量释放。
 *
 * daemon.start 检测到 availableAgents 后，对每个 provider 调 acquire；
 * 任一失败（LockHeldError）由 daemon 回滚已持有 lock（releaseAll）后向上抛，
 * 阻止三循环启动。daemon.stop 调 releaseAll 释放本次持有的全部 lock。
 *
 * releaseAll 幂等：已释放的 key 重复调 no-op（Set 清空 + unlink 容错）。
 */
export class RuntimeLockManager {
  private readonly _acquired = new Set<string>();
  private readonly _opts: RuntimeLockManagerOptions;

  constructor(opts: RuntimeLockManagerOptions) {
    this._opts = opts;
  }

  async acquire(provider: string): Promise<void> {
    const identity: LockIdentity = {
      provider,
      hostname: this._opts.hostname,
      serverOrigin: this._opts.serverOrigin,
    };
    await acquireLock(identity, {
      pid: this._opts.pid,
      version: this._opts.version,
      force: this._opts.force,
      dir: this._opts.locksDir,
    });
    this._acquired.add(computeLockKey(identity));
  }

  async releaseAll(): Promise<void> {
    for (const key of this._acquired) {
      await releaseLockByKey(key, this._opts.locksDir ?? LOCKS_DIR);
    }
    this._acquired.clear();
  }

  /** 本次已持有的 key 数（测试/诊断用）。 */
  get acquiredCount(): number {
    return this._acquired.size;
  }
}
