// sillyhub-daemon/src/spec-sync.ts
// task-04 / D-007@v1：spec bundle 同步共享 utility（纯函数 + client 参数注入）。
//
// 从 task-runner.ts 等价迁移（除新增的 404 容错分支外，行为对齐）：
//   - resolveSpecDir   ← task-runner.ts:1444-1449（_resolveSpecDir）
//   - pullSpecBundle   ← task-runner.ts:1417-1438（_pullSpecBundle）+ 新增 404 容错
//   - extractTar       ← task-runner.ts:1464-1505（_extractTar，含 Tar Slip 防护）；
//                        审计 P1-5 补 PAX 'x' / GNU 'L' / ustar prefix 长路径读取
//                        （backend build_bundle 用 Python tarfile mode "w" PAX 格式）
//   - packSpecDir      ← task-runner.ts:1512-1533（_packSpecDir）
//   - walkDir/buildTarHeader/readTarString ← task-runner.ts:1951/1993/1934（模块内 helper）
//   - postSpecSync     ← task-runner.ts:482-486 等价逻辑抽提（pack + client.postSpecSync）
//
// 设计原则（D-007@v1）：纯模块级函数 + client 作参数注入，不读 TaskRunner 实例状态，
// 使 interactive 路径（无 TaskRunner 实例）可直接调用。
//
// 覆盖：design.md §5.0/§5.2/§7.2 E-01/§7.3/§10 R-02；decisions.md D-003@v1（双向同步）/
// D-007@v1（utility 抽离）/ D-008（pull 前回灌，task-12）/ D-010（spec_version 保鲜，task-11）；
// 蓝图 task-04.md / task-12.md / task-11.md。

import { createHash } from 'node:crypto';
import { spawn as cpSpawn, type ChildProcess } from 'node:child_process';
import { homedir } from 'node:os';
import { join, relative, isAbsolute, dirname, resolve, basename, sep as pathSep } from 'node:path';
import { mkdir, rm, readdir, stat, lstat, readlink, symlink, cp, readFile, writeFile, rename } from 'node:fs/promises';
import type { HubClient } from './hub-client.js';
import type { FileOp } from './hub-client.js';
import { daemonStateDir } from './config.js';
import { writeLocalYaml } from './local-yaml-writer.js';

// ── resolveSpecDir ────────────────────────────────────────────────────────────

/**
 * 计算 workspace spec 本地解包/打包目录：~/.sillyhub/daemon/specs/{wsId}。
 *
 * 迁自 task-runner.ts:1444-1449。wsId 含路径分隔符（/ \）时拒绝（防御性，正常是 UUID，
 * design §5 E-07），抛 Error。与 backend resolve_prompt_spec_root tar 分支输出的
 * `~/.sillyhub/daemon/specs/{ws_id}` 字符串展开后必须一致（R-01：daemon 侧用 homedir()
 * 展开，prompt 侧 tilde 由 daemon 注入 sillyspec 命令前展开）。
 *
 * 纯函数，无 IO，无 client 依赖。
 */
export function resolveSpecDir(wsId: string): string {
  if (!wsId || /[\\/]/.test(wsId)) {
    throw new Error(`invalid workspace_id for spec dir: ${JSON.stringify(wsId)}`);
  }
  // daemonStateDir()：SILLYHUB_DAEMON_DIR 隔离时 specs 一并重定向（与 backend 约定的
  // `~/.sillyhub/daemon/specs/{ws_id}` 在默认态下逐字一致）
  return join(daemonStateDir(), 'specs', wsId);
}

// ── pullSpecBundle ────────────────────────────────────────────────────────────

export interface PullSpecBundleOptions {
  /** execution-context 已带 spec_root 时跳过（防御，对齐 task-runner.ts:1423）。 */
  existingSpecRoot?: string | null;
  /**
   * spec 同步策略（2026-06-28-daemon-client-spec-sync-strategy，D-001/D-002/D-005）。
   * 缺省 platform-managed（拉平台 bundle）。repo-mirrored 首次从源项目 .sillyspec 单次
   * fs.cp；repo-native 建 junction 缓存→源项目 .sillyspec。
   */
  strategy?: string;
  /** 源项目根路径（repo-mirrored/repo-native 从 rootPath/.sillyspec 读）。 */
  rootPath?: string;
  /**
   * pull 前回灌检查（D-008，task-12）：传入「本地是否有未回灌改动」判定函数。
   *
   * 缺省 = 文件系统判定器 hasUnsyncedLocalChanges（查 specDir/.runtime/pending_push
   * 标记 + specDir 本地 mtime 新于 platform.json.synced_at）。返回 true 时 pullSpecBundle
   * 在覆盖本地之前先调 postSpecSync 回灌到 backend，回灌失败抛 SpecPushBeforePullError
   * abort pull（不强行覆盖本地）。
   *
   * 测试可注入自定义判定器（mock 未回灌标记 / mtime 比对），绕过文件系统副作用。
   * 传 `() => false` 显式禁用回灌检查（保持旧行为）。
   */
  unsyncedChecker?: (specDir: string) => Promise<boolean>;
}

/**
 * 从 backend 拉 spec bundle 解到本地 ~/.sillyhub/daemon/specs/{wsId}（覆盖语义）。
 *
 * 迁自 task-runner.ts:1417-1438（_pullSpecBundle），改为纯函数 + client 参数注入。
 * 返回值：
 *   - 成功解包 → 返回本地 specDir 绝对路径（非 null）
 *   - 404 容错（首次 scan，backend 无 bundle，R-02/E-01）→ mkdir 空本地目录，返回 specDir 路径（非 null）
 *   - 跳过（无 wsId / existingSpecRoot 已有 / client 未实现 getSpecBundle）→ 返回 null
 *
 * 失败语义（除 404 外，向上抛由调用方 catch）：
 *   - getSpecBundle 抛 HubHttpError(status !== 404) → 透传（5xx 等）
 *   - 网络/超时 → 透传
 *   - extractTar IO 错 / Tar Slip → 透传
 *
 * @param client HubClient 实例（batch=TaskRunner.client，interactive=daemon 持有的 client）
 * @param wsId workspace id（claim payload 透传的 workspaceId）
 * @param opts.existingSpecRoot 防御性跳过（execution-context 已带 spec_root 时）
 */
export async function pullSpecBundle(
  client: HubClient,
  wsId: string | undefined,
  opts: PullSpecBundleOptions = {},
): Promise<string | null> {
  if (!wsId) return null; // 防御兜底：quick-chat / 共享 session 等无 workspace 场景（2026-07-10-remove-server-local-workspace-mode 后 wsId 永远非空，server-local 已移除）
  if (opts.existingSpecRoot) return null; // 防御：execution-context 已带

  // resolveSpecDir 先做 wsId 路径分隔符校验（§5 E-07），抛错即被调用方 catch。
  const specDir = resolveSpecDir(wsId);
  const strategy = opts.strategy || 'platform-managed';

  // ── repo-native（D-005）：建 junction 让缓存指向源项目 .sillyspec，跳过 pull 覆盖 ──
  // scan 直接写源项目（实时双向）。R-01：repo-native 不走 rm/不覆盖，避免顺链删源项目。
  if (strategy === 'repo-native' && opts.rootPath) {
    const sourceSillyspec = join(opts.rootPath, '.sillyspec');
    if (await pathExists(sourceSillyspec)) {
      const ok = await ensureSpecJunction(specDir, sourceSillyspec);
      if (ok) {
        console.info('spec_sync: repo_native_junction_ready', wsId, specDir, '->', sourceSillyspec);
        return specDir; // junction 就绪，scan 在源项目跑，postSpecSync 打包源项目回灌
      }
      // 普通目录残留阻塞 junction → 降级 pull（不删数据）
      console.warn('spec_sync: repo_native_junction_blocked_fallback', wsId, specDir);
    } else {
      // 源项目无 .sillyspec → 降级 repo-mirrored（首次复制空操作，最终走 pull）
      console.warn('spec_sync: repo_native_source_missing_fallback', wsId, sourceSillyspec);
    }
  }

  // ── repo-mirrored（D-002）：首次（缓存空）从源项目 .sillyspec 单次 fs.cp ──────────
  // 源项目已有内容立即可用，不污染源项目。非首次（缓存非空）/ 源项目无 .sillyspec → 走 pull。
  if (strategy === 'repo-mirrored' && opts.rootPath) {
    const sourceSillyspec = join(opts.rootPath, '.sillyspec');
    const cacheEmpty = !(await dirHasContent(specDir));
    if (cacheEmpty && (await pathExists(sourceSillyspec))) {
      try {
        await rm(specDir, { recursive: true, force: true });
      } catch (e) {
        console.warn('spec_sync: repo_mirrored_prerm_failed', specDir, e);
      }
      try {
        await cp(sourceSillyspec, specDir, { recursive: true, force: true });
        console.info('spec_sync: repo_mirrored_copied', wsId, sourceSillyspec, '->', specDir);
        return specDir;
      } catch (e) {
        console.warn('spec_sync: repo_mirrored_cp_failed', specDir, e); // 回落 pull
      }
    }
  }

  // ── 默认（platform-managed / repo-mirrored 非首次 / repo-native 降级）：拉平台 bundle ──
  if (typeof client.getSpecBundle !== 'function') return null; // mock client 未实现

  // ── D-008（task-12）：pull 前回灌未提交的本地改动 ──
  // 平台 pull 路径会 rm+覆盖 specDir，本地未回灌改动会丢。先查未回灌标记（默认查
  // .runtime/pending_push 或本地 mtime 新于 platform.json.synced_at），有则先 postSpecSync
  // 回灌；回灌失败抛 SpecPushBeforePullError abort pull（不强行覆盖本地），由调用方决定
  // lease failed 终态。repo-native（junction 已 return）/ repo-mirrored 首次 cp（cacheEmpty）
  // 不会覆盖本地改动，故不触发回灌（上面分支已 return）。
  const checker = opts.unsyncedChecker ?? hasUnsyncedLocalChanges;
  let hasUnsynced = false;
  try {
    hasUnsynced = await checker(specDir);
  } catch (e) {
    // 判定器自身异常（如 stat 失败）→ 不阻塞 pull（保守：宁可多拉一次，不因检测错中断）。
    console.warn('spec_sync: unsynced_check_failed_continue_pull', wsId, specDir, e);
  }
  if (hasUnsynced) {
    console.info('spec_sync: push_before_pull_triggered', wsId, specDir);
    if (typeof client.postSpecSync === 'function') {
      try {
        await postSpecSync(client, wsId!, specDir);
      } catch (e) {
        // 回灌失败 → abort pull，保留本地改动（design §7.3 D-008）。
        const err = new SpecPushBeforePullError(wsId!, specDir, e);
        console.warn('spec_sync: push_before_pull_failed_abort', err.message);
        throw err;
      }
    }
    // postSpecSync 未实现（mock client）→ 视为回灌跳过，继续 pull（mock 测试不要求 abort）。
  }

  let tarBuf: Buffer;
  try {
    tarBuf = await client.getSpecBundle(wsId);
  } catch (e) {
    // R-02 / E-01：首次 scan backend 无 spec bundle → 404 容错。
    // mkdir 空本地目录返回 specDir（非 null），保证后续 postSpecSync 链路触发。
    if (isHubHttp404(e)) {
      await mkdir(specDir, { recursive: true });
      console.info('spec_sync: pull_404_empty_created', wsId, specDir);
      return specDir;
    }
    throw e; // 其他 status / 网络错透传
  }

  // ql-20260904-016（会话首响优化）：tmp 目录解包 + 目录交换，替代原「rm -rf 旧缓存
  // + 原地逐文件解包」。实测（会话 f0f76381，Windows）：3563 文件 / 30MB 全量拉取
  // 串行 rm+写盘 ~30s，占交互会话首响延迟 2/3。三处改进：
  //   1) extractTar 有界并行写（16 并发）——原逐文件 await 串行，Windows 每文件
  //      ~8ms 延迟（含杀软扫描）×3563 ≈ 28s 是主瓶颈；
  //   2) 解包到同级 tmp 目录后原子交换（旧目录改名让位 + tmp 改名顶上，改名瞬时），
  //      旧目录 3563 文件的删除成本移出关键路径转后台异步清理；
  //   3) 解包失败旧缓存完好无损（原实现 rm 先行，坏 tar 会把缓存打成残缺半解包）。
  // 交换失败（Windows EBUSY 等句柄占用重试仍败）→ 退回原地解包（旧语义：容忍残留
  // 覆盖写，agent 侧覆盖读取），行为不劣于原实现。
  const parent = dirname(specDir);
  const base = basename(specDir);
  const tmpDir = join(parent, `${base}.tmp-${process.pid}-${Date.now()}`);
  await sweepStalePullScraps(parent, base);
  try {
    await extractTar(tarBuf, tmpDir);
  } catch (e) {
    // 坏 tar：tmp best-effort 清理，旧缓存原样保留，透传给调用方（R-03 容错：
    // pull 失败不阻塞 session 启动）。
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    throw e;
  }
  try {
    await swapExtractedDir(tmpDir, specDir);
  } catch (e) {
    console.warn('spec_sync: swap_failed_fallback_inplace_extract', wsId, specDir, e);
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
    await extractTar(tarBuf, specDir);
  }
  return specDir;
}

/**
 * ql-20260904-016：把解包完成的 tmp 目录交换到 specDir 位置（pullSpecBundle 用）。
 *
 * - specDir 不存在（首拉）→ 直接 rename tmp→specDir；
 * - specDir 是符号链接/junction 残留 → 只删链接本身（rm force 不递归不跟随目标），
 *   防「改名成 trash 后后台 recursive 清理」误删 junction 指向的源项目；
 * - 普通目录 → rename specDir→trash（瞬时）+ rename tmp→specDir（瞬时），trash
 *   后台异步 rm（删除成本移出 pull 关键路径）。
 *
 * rename 经 renameWithRetry（Windows 索引器/杀软短暂持有句柄的 EBUSY/EPERM 暂态失败）。
 */
async function swapExtractedDir(tmpDir: string, specDir: string): Promise<void> {
  let oldStat: Awaited<ReturnType<typeof lstat>> | null = null;
  try {
    oldStat = await lstat(specDir);
  } catch {
    oldStat = null;
  }
  if (oldStat) {
    if (oldStat.isSymbolicLink()) {
      await rm(specDir, { force: true });
    } else {
      const trash = join(
        dirname(specDir),
        `${basename(specDir)}.trash-${process.pid}-${Date.now()}`,
      );
      await renameWithRetry(specDir, trash);
      void rm(trash, { recursive: true, force: true }).catch((e) => {
        console.warn('spec_sync: trash_cleanup_failed', trash, e);
      });
    }
  }
  await renameWithRetry(tmpDir, specDir);
}

/** rename + 暂态占用重试（EBUSY/EPERM/EACCES × 3 次 × 200ms，其余错误立抛）。 */
async function renameWithRetry(from: string, to: string, attempts = 3): Promise<void> {
  for (let i = 0; ; i++) {
    try {
      return await rename(from, to);
    } catch (e) {
      if (i >= attempts - 1) throw e;
      const code = (e as NodeJS.ErrnoException)?.code;
      if (code !== 'EBUSY' && code !== 'EPERM' && code !== 'EACCES') throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

/**
 * ql-20260904-016：清理本 workspace 上一次崩溃 pull 留下的 tmp/trash 残留
 * （`${wsId}.tmp-*` / `${wsId}.trash-*` 同级兄弟目录）。仅清 mtime 距今超 10 分钟的
 * ——进行中的并发 pull（tmp 名含 pid+ts，必然新鲜）不受影响。best-effort，失败静默。
 */
async function sweepStalePullScraps(parent: string, base: string): Promise<void> {
  const STALE_SCRAP_AGE_MS = 10 * 60 * 1000;
  let entries: string[];
  try {
    entries = await readdir(parent);
  } catch {
    return;
  }
  const now = Date.now();
  await Promise.all(
    entries
      .filter((n) => n.startsWith(`${base}.tmp-`) || n.startsWith(`${base}.trash-`))
      .map(async (n) => {
        const p = join(parent, n);
        try {
          const st = await lstat(p);
          if (now - st.mtimeMs > STALE_SCRAP_AGE_MS) {
            await rm(p, { recursive: true, force: true });
            console.warn('spec_sync: stale_scrap_swept', p);
          }
        } catch {
          /* best-effort */
        }
      }),
  );
}

// ── repo-native / repo-mirrored helper（2026-06-28）───────────────────────────

/**
 * pull 前回灌失败错误（D-008 / task-12）。
 *
 * pullSpecBundle 检测到本地有未回灌改动后先 postSpecSync 回灌，回灌失败时抛本错误 abort
 * pull（不强行覆盖本地）。调用方（task-runner.ts / daemon.ts）应据此让 lease 进入 failed
 * 终态并提示用户先手动同步。
 *
 * `cause` 透传 postSpecSync 的原始错误（网络 / HTTP 非 2xx / IO），便于诊断。
 */
export class SpecPushBeforePullError extends Error {
  readonly workspaceId: string;
  readonly specDir: string;
  constructor(workspaceId: string, specDir: string, cause?: unknown) {
    // ql-20260904-016：message 带内因摘要——wrapper 原只报「push 失败」，内层
    //（conflict / timeout / 网络）只挂 .cause，daemon warn 打 message 时丢失，
    // 排查要靠猜（03:55 实证：conflict 被误读为超时）。
    const causeMsg = cause instanceof Error ? cause.message : cause === undefined ? '' : String(cause);
    super(
      `spec_sync: postSpecSync before pull failed (local changes preserved)` +
        ` ws=${workspaceId} dir=${specDir}` +
        (causeMsg ? ` cause=${causeMsg.slice(0, 300)}` : ''),
    );
    this.name = 'SpecPushBeforePullError';
    this.workspaceId = workspaceId;
    this.specDir = specDir;
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

/**
 * pull 前回灌检查的默认判定器（D-008 / task-12）。
 *
 * 两路信号任一命中即视为「本地有未回灌改动」：
 *   1. specDir/.runtime/pending_push 标记存在（postSpecSync 失败时 daemon 写入的兜底标记）。
 *   2. specDir 本地最新 spec 文档 mtime 新于 specDir/.runtime/spec-version.json 的 synced_at
 *      （D-001@v1：synced_at 迁到 daemon 状态文件；newestMtime 跳过 .runtime/ 子目录，
 *      只比 spec 文档）。状态文件不存在 / 缺 synced_at 时，只要本地有内容即视为有改动。
 *
 * 纯文件系统判定，无 client 依赖。任何 stat/readFile 失败均视为「未检测到未回灌」
 * （保守，不阻塞 pull）；测试可注入自定义 checker 绕过文件系统副作用。
 *
 * @param specDir 本地 spec 目录（pullSpecBundle 解析的 specDir = resolveSpecDir(wsId)）
 */
export async function hasUnsyncedLocalChanges(specDir: string): Promise<boolean> {
  // 信号 1：pending_push 标记（postSpecSync 失败兜底）。
  if (await pathExists(join(specDir, '.runtime', 'pending_push'))) {
    return true;
  }
  // 信号 2：本地 spec mtime 新于 daemon 状态文件的 synced_at（D-001@v1：从
  // .runtime/spec-version.json 读，不再读 .sillyspec-platform.json）。
  // 无状态文件 / 无 synced_at 时，只要本地有内容（非空）即视为未回灌（首次初始化前手改本地）。
  const localMtime = await newestMtime(specDir);
  if (localMtime === null) return false; // 本地 specDir 不存在 / 空 → 无本地改动可丢
  const statePath = join(specDir, DAEMON_STATE_FILENAME);
  let syncedAtMs: number | null = null;
  try {
    const raw = await readFile(statePath, 'utf-8');
    const obj = JSON.parse(raw) as { synced_at?: string };
    if (obj.synced_at) {
      const t = Date.parse(obj.synced_at);
      if (!Number.isNaN(t)) syncedAtMs = t;
    }
  } catch {
    // 状态文件不存在 / 解析失败 → syncedAtMs 保持 null（下方「本地有内容」兜底）。
  }
  if (syncedAtMs === null) {
    return true; // 状态文件缺失但本地有内容 → 视为有未回灌改动
  }
  return localMtime > syncedAtMs;
}

/** 取目录树中最新的 mtime（ms）。目录不存在 / 空 / 全失败 → null。
 *  跳过 `.runtime/` 子目录（D-001@v1：daemon 运行时产物如 spec-version.json / pending_push
 *  在 specDir/.runtime/ 下，不计入 spec 文档改动判定，否则 synced_at 自身会被 newestMtime 捕获
 *  导致 hasUnsyncedLocalChanges 恒判 true）。*/
async function newestMtime(dir: string): Promise<number | null> {
  let newest: number | null = null;
  async function recurse(d: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(d);
    } catch {
      return;
    }
    for (const name of names) {
      if (name === '.runtime') continue; // 跳过 daemon 运行时产物（D-001@v1）
      const abs = join(d, name);
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
        await recurse(abs);
      } else if (st.isFile()) {
        if (newest === null || st.mtimeMs > newest) newest = st.mtimeMs;
      }
    }
  }
  await recurse(dir);
  return newest;
}

/** 路径存在（file 或 dir）。 */
async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/** 目录存在且含至少一个条目（repo-mirrored 判缓存空）。 */
async function dirHasContent(dir: string): Promise<boolean> {
  try {
    const names = await readdir(dir);
    return names.length > 0;
  } catch {
    return false;
  }
}

/**
 * 建/复用 specDir→target junction（repo-native，D-005；R-01 防误删/R-02 降级）。
 *
 * - 不存在 → 建（Win fs.symlink('junction') 无需提权 / Linux·macOS 普通 symlink）。
 * - 已是符号链接/junction 且目标一致 → 复用，返回 true。
 * - 已是符号链接但目标不一致 → 移除重建。
 * - 是普通目录（历史残留）→ 不自动删（防误删数据），返回 false 让上层降级 pull。
 *
 * @returns true=junction 就绪；false=被普通目录阻塞，上层应降级
 */
async function ensureSpecJunction(specDir: string, target: string): Promise<boolean> {
  let existing: string | null = null;
  let isLink = false;
  let isPlainDir = false;
  try {
    const lst = await lstat(specDir);
    if (lst.isSymbolicLink()) {
      isLink = true;
      existing = await readlink(specDir);
    } else if (lst.isDirectory()) {
      isPlainDir = true;
    }
  } catch {
    // 不存在，继续建
  }
  if (isPlainDir) return false; // 普通目录残留，不自动删（防误删），上层降级
  if (isLink) {
    const existingNorm = existing ? resolve(existing) : null;
    if (existingNorm === resolve(target)) return true; // 目标一致，复用
    try {
      await rm(specDir, { recursive: true, force: true });
    } catch (e) {
      console.warn('spec_sync: junction_rebuild_prerm_failed', specDir, e);
      return false;
    }
  }
  await mkdir(dirname(specDir), { recursive: true });
  // Win 用 junction（目录联接，fs.symlink type='junction' 无需提权）；
  // Linux·macOS 用普通 symlink。target 须绝对路径（rootPath/.sillyspec 是绝对路径）。
  if (process.platform === 'win32') {
    await symlink(target, specDir, 'junction');
  } else {
    await symlink(target, specDir);
  }
  return true;
}

// ── 本地清单缓存（change 2026-08-13-platform-managed-file-sync / R-03/BL-4）───────
//
// 增量 diff 依赖本地 per-file 清单（hash/version/mtime）。缓存必须**移出 specDir**
// （~/.sillyhub/daemon/specs/{ws}）——否则被 pull 的 rm -rf specDir 清掉（BL-4），
// 放 ~/.sillyhub/daemon/manifests/{ws}.json（R-03）。
//
// 格式：{ version: 1, files: { [path]: { hash, version, mtime } } }
//   - hash：SHA-256 hex；version：该文件本地认为的服务器版本（base_version 用）；
//   - mtime：上次 hash 时的文件 mtime（ms）——未变则跳过重算 hash（R-05 性能优化）。

/** 本地清单缓存文件路径（移出 specDir）。派生自 daemonStateDir()（隔离一并重定向）。 */
export function resolveManifestCachePath(wsId: string): string {
  return join(daemonStateDir(), 'manifests', `${wsId}.json`);
}

/** 单文件清单条目。 */
interface ManifestFileEntry {
  hash: string;
  version: number;
  mtime: number;
}

/** 本地清单缓存（schema version=1）。 */
interface LocalManifest {
  version: number;
  files: Record<string, ManifestFileEntry>;
}

/** 读本地清单缓存；不存在/解析失败 → null（视为首同步，走旧 tar 全量）。 */
async function readLocalManifest(wsId: string): Promise<LocalManifest | null> {
  const p = resolveManifestCachePath(wsId);
  let raw: string;
  try {
    raw = await readFile(p, 'utf-8');
  } catch {
    return null;
  }
  try {
    const obj = JSON.parse(raw) as { version?: unknown; files?: unknown };
    if (typeof obj.files !== 'object' || obj.files === null) return null;
    const files: Record<string, ManifestFileEntry> = {};
    for (const [path, v] of Object.entries(obj.files as Record<string, ManifestFileEntry>)) {
      if (v && typeof v === 'object' && typeof v.hash === 'string') {
        files[path] = {
          hash: v.hash,
          version: typeof v.version === 'number' ? v.version : 0,
          mtime: typeof v.mtime === 'number' ? v.mtime : 0,
        };
      }
    }
    return { version: 1, files };
  } catch {
    return null;
  }
}

/** 写本地清单缓存；失败仅 warn 不抛（缓存写失败不阻塞推送主流程）。 */
async function writeLocalManifest(wsId: string, m: LocalManifest): Promise<void> {
  try {
    const p = resolveManifestCachePath(wsId);
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, JSON.stringify(m, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.warn('spec_sync: manifest_cache_write_failed', wsId, e);
  }
}

// ── 上传链路统一排除（2026-08-15-init-trigger-sillyspec-init / task-07 / FR-06 / D-008@v2）──
//
// projects/ 目录（projects/<name>.yaml 含成员机器绝对路径等本地环境信息）从 daemon 全部
// 三条上传链路排除：computeIncrementalOps 增量 walk（diff 用）、buildFullManifest 全量
// 快照（首同步/回退 tar 后写缓存用）、packSpecDir 回退 tar 打包。三处必须共用本常量
//（N-01 复核收口：只改增量会引入「缓存有 projects 行 + walk 无 → delete op 误删服务器行」）。
// pull 路径（extractTar 解包）**不**排除——服务器已有（历史遗留）projects 行 pull 仍落地本地无妨。
const UPLOAD_EXCLUDE_TOP_BASE = new Set(['.runtime', 'runtime', 'projects']);
const UPLOAD_PRUNE_NAMES_BASE = new Set(['worktrees']);

/** relPath 是否命中上传排除（对齐 walkDir 剪枝口径：pruneTop 看首段 / pruneNames 看任意段 basename）。
 *  computeIncrementalOps 对缓存残留行（旧状态曾上传、现在 walk 已排除的路径）跳过 diff 用，
 *  防生成 delete op 误删服务器行（task-07 acceptance 第 4 条）。 */
function isUploadExcludedPath(relPath: string): boolean {
  const segs = relPath.split('/');
  if (UPLOAD_EXCLUDE_TOP_BASE.has(segs[0] ?? '')) return true;
  return segs.some((s) => UPLOAD_PRUNE_NAMES_BASE.has(s));
}

/** 全量快照清单（旧 tar 落盘后/首同步用）：version=0（服务器清单已清 Q7，下次增量 R-07 重建）。 */
async function buildFullManifest(specRoot: string): Promise<LocalManifest> {
  const files: Record<string, ManifestFileEntry> = {};
  // 三处排除统一（task-07）：UPLOAD_EXCLUDE_TOP_BASE / UPLOAD_PRUNE_NAMES_BASE
  //（与 computeIncrementalOps / packSpecDir 共用常量，勿各自内联——防再漂移）。
  const entries = await walkDir(specRoot, UPLOAD_EXCLUDE_TOP_BASE, UPLOAD_PRUNE_NAMES_BASE);
  for (const e of entries) {
    if (e.isDir) continue;
    const content = await readFile(e.absPath);
    files[e.relPath] = {
      hash: createHash('sha256').update(content).digest('hex'),
      version: 0,
      mtime: Math.floor(e.mtimeMs),
    };
  }
  return { version: 1, files };
}

/**
 * 增量冲突错误（NFR-02）：base_version 过期服务器返 conflict=true，不静默覆盖。
 *
 * 由调用方（syncSpecTreeIfNeeded / task-runner）catch 后仅 warn 不阻塞，提示用户
 * 人工拍板（design §7：409 由 daemon 侧据 conflict 字段提示，不自动重试）。
 */
export class SpecPushConflict extends Error {
  readonly workspaceId: string;
  readonly serverVersions: Record<string, number>;
  constructor(workspaceId: string, serverVersions: Record<string, number>) {
    super(
      `spec_sync: incremental push conflict detected ws=${workspaceId} server_versions=${JSON.stringify(serverVersions)}`,
    );
    this.name = 'SpecPushConflict';
    this.workspaceId = workspaceId;
    this.serverVersions = serverVersions;
  }
}

// ── postSpecSync ──────────────────────────────────────────────────────────────

/**
 * 推送本地 spec 改动到服务器（change 2026-08-13-platform-managed-file-sync 增量改造）。
 *
 * 原为「整树 tar 全量覆盖」（D-004），现改为**文件级增量 diff**（本地 hash 与清单缓存
 * 比对只发变化 op；首同步/回退仍走旧 tar）。签名与返回值不变（{ ok, reparsed } | null），
 * 调用点零改动（design §7.5 薄封装原则）。
 *
 * 流程：
 *   1. 读本地清单缓存 ~/.sillyhub/daemon/manifests/{ws}.json（移出 specDir，BL-4/R-03）。
 *   2. **首同步**（无缓存）：走旧 tar `client.postSpecSync(wsId, packSpecDir(specRoot))`，
 *      成功后写全量快照缓存（R-07：version=0，服务器清单已清）。
 *   3. **增量路径**：walk specDir（排除 .runtime(有点)/runtime(无点)/worktrees/projects，
 *      D-006 + task-07）逐文件 hash（mtime 未变复用缓存 hash，R-05）→ 与缓存 diff 生成 ops
 *      （新文件 add / 内容变 update / 缓存有本地无 delete / 同 hash 异路径 rename 不重传
 *      内容，R-02 注意 Windows 大小写）；op 带 per-file base_version（缓存 version，无 0）。
 *   4. `client.postSpecSyncIncremental(wsId, ops, changeWriteId, changeDirs)`：
 *      - changeDirs（task-01 / D-005@v1）：从 ops 提取的本次涉及变更目录名集合
 *        （`changes/<name>/` 与 `changes/archive/<name>/` 前缀分组 key，去重成 string[]；
 *        best-effort 计算失败降级 []，backend 无标注路径检测兜底，不阻断同步主流程）。
 *      - 成功 → 按 new_versions 回写缓存 version（+ 刷新 hash/mtime），返回 { ok: true, reparsed: 0 }。
 *      - conflict=true → 抛 SpecPushConflict（调用方 catch 后 warn 不阻塞，人工拍板 NFR-02）。
 *      - 404（旧后端无端点）/ 网络失败 / 端点错误 → **回退旧 tar** 全量，写全量快照缓存。
 *   5. 缓存写失败 try/catch warn 不阻塞推送主流程。
 *
 * 失败语义：网络/HTTP 非 2xx / IO → 向上抛（调用方 catch 后仅 warn 不阻塞，对齐
 * design R-03：sync 失败不改写 agent 结果/不阻塞 session 终态）。
 *
 * @param client HubClient（batch/interactive 各自持有的实例）
 * @param wsId workspace id
 * @param specRoot 本地 spec 目录（pullSpecBundle/packSpecDir 返回的路径）
 */
async function postSpecSyncImpl(
  client: HubClient,
  wsId: string,
  specRoot: string,
  /** 逐文件进度：daemon 的 outbox task_id，透传给 backend apply 循环内回写 files_processed。
   *  缺省（undefined）→ 不带 X-Change-Write-Id 头，后端不回写 processed（向后兼容旧 daemon）。 */
  changeWriteId?: string,
  /**
   * ql-20260813-spec-sync-visibility task-12（FR-06 + BL-2）：过程进度回调。
   * 调用点：增量 computeIncrementalOps 后（total=ops.length, processed=0）；全量
   * packSpecDir onWalkComplete 时（total=filesCount, processed=0）。终态上报
   * （processed=total）由 task-runner 在 complete 前做（task-08），本回调只报过程起点。
   */
  onProgress?: (p: { files_total?: number; files_processed?: number }) => void,
): Promise<{ ok: boolean; reparsed: number; filesTotal?: number } | null> {
  if (typeof client.postSpecSync !== 'function') return null; // mock client 未实现

  // 1. 读本地清单缓存
  const cached = await readLocalManifest(wsId);

  // 2. 首同步（无缓存）→ 旧 tar 全量 + 写快照
  if (cached === null) {
    const tarBuf = await packSpecDir(specRoot, {
      // BL-2：walk 完成立即上报 total（tar 还没拼，全量首同步进度窗口）
      onWalkComplete: (filesCount) => onProgress?.({ files_total: filesCount, files_processed: 0 }),
    });
    const resp = await client.postSpecSync(wsId, tarBuf, changeWriteId);
    const fullManifest = await buildFullManifest(specRoot);
    await writeLocalManifest(wsId, fullManifest);
    // filesTotal = 全量快照文件数（spec 文档数）
    return { ...resp, filesTotal: Object.keys(fullManifest.files).length };
  }

  // 3. 增量 diff → ops
  const { ops, localFiles } = await computeIncrementalOps(specRoot, cached);
  // task-12：增量路径起点上报 total=ops.length（变化文件数）
  if (ops.length > 0) {
    onProgress?.({ files_total: ops.length, files_processed: 0 });
  }
  if (ops.length === 0) {
    // 无变化 → 不发请求，仅按需刷新缓存 mtime（当前缓存已是最新本地态）
    await writeLocalManifest(wsId, buildManifestFromLocal(cached, localFiles, {}));
    return { ok: true, reparsed: 0, filesTotal: 0 };
  }

  // 4. 增量客户端缺失（mock 旧客户端）→ 回退旧 tar
  if (typeof client.postSpecSyncIncremental !== 'function') {
    const tarBuf = await packSpecDir(specRoot);
    const resp = await client.postSpecSync(wsId, tarBuf, changeWriteId);
    const fullManifest = await buildFullManifest(specRoot);
    await writeLocalManifest(wsId, fullManifest);
    return { ...resp, filesTotal: Object.keys(fullManifest.files).length };
  }

  // D-005@v1（task-01）：从本次增量 ops 提取 change_dirs（`changes/<name>/` 与
  // `changes/archive/<name>/` 前缀分组 key，去重），随请求体透传给 backend 触发 scoped
  // reparse。best-effort：计算失败降级 []（backend 无标注路径检测兜底），不阻断同步主流程。
  let changeDirs: string[] = [];
  try {
    changeDirs = extractChangeDirs(ops);
  } catch (e) {
    console.warn('spec_sync: change_dirs_extract_failed_fallback_empty', wsId, e);
  }

  try {
    const result = await client.postSpecSyncIncremental(wsId, ops, changeWriteId, changeDirs);
    if (result.conflict) {
      throw new SpecPushConflict(wsId, result.server_versions ?? {});
    }
    // 成功 → 按 new_versions 回写缓存 version
    await writeLocalManifest(wsId, buildManifestFromLocal(cached, localFiles, result.new_versions));
    // filesTotal = 本次增量 ops 数（变化的文件数）
    return { ok: true, reparsed: 0, filesTotal: ops.length };
  } catch (e) {
    // conflict 不回退（人工拍板）；404/网络/端点错误 → 回退旧 tar 全量
    if (e instanceof SpecPushConflict) throw e;
    const tarBuf = await packSpecDir(specRoot);
    const resp = await client.postSpecSync(wsId, tarBuf, changeWriteId);
    const fullManifest = await buildFullManifest(specRoot);
    await writeLocalManifest(wsId, fullManifest);
    return { ...resp, filesTotal: Object.keys(fullManifest.files).length };
  }
}

/**
 * pending_push 标记（ql-20260816-003）：postSpecSync 失败的防御兜底（hasUnsyncedLocalChanges 信号 1）。
 *
 * 曾只读不写（死代码）：hasUnsyncedLocalChanges 检查 ``specDir/.runtime/pending_push`` 但
 * 全仓无写入点。本包装器实装设计意图——push 失败（网络/服务端终止/daemon 中断）写标记，
 * 成功清除。作用：mtime 信号（信号 2）依赖 fs 时间戳比对（时钟偏移 / 粗粒度 fs 可能漏判），
 * 标记是显式「本地有未回灌改动」声明，pull-before-push（D-008）据其保证中断场景下本地改动
 * 不被 pull 覆盖，且下次同步自动重推。
 *
 * 语义：
 *   - 成功（result 非 null）→ 清除标记（本地已与服务器一致）。
 *   - 失败（抛错）→ 写标记（best-effort，失败仅 warn）。
 *   - conflict（SpecPushConflict）→ 不动标记（需人工拍板，非传输失败，自动重推会再冲突）。
 *   - mock client（postSpecSync 非函数）→ 返回 null，不动标记。
 * 标记写/清均 best-effort：IO 失败不阻断同步主流程（对齐 R-03）。
 *
 * @param client HubClient（batch/interactive 各自持有的实例）
 * @param wsId workspace id
 * @param specRoot 本地 spec 目录（pullSpecBundle/packSpecDir 返回的路径）
 * @param changeWriteId 透传（见 impl）
 * @param onProgress 透传（见 impl）
 */
export async function postSpecSync(
  client: HubClient,
  wsId: string,
  specRoot: string,
  changeWriteId?: string,
  onProgress?: (p: { files_total?: number; files_processed?: number }) => void,
): Promise<{ ok: boolean; reparsed: number; filesTotal?: number } | null> {
  try {
    const result = await postSpecSyncImpl(client, wsId, specRoot, changeWriteId, onProgress);
    // 真实 push 成功（result 非 null）→ 清除 pending_push（本地已与服务器一致）。
    if (result !== null) {
      await rmPendingPushMarker(specRoot);
    }
    return result;
  } catch (e) {
    // 传输失败（网络 / 服务端不可用 / 5xx）→ 写标记；conflict 除外（人工拍板，见上方语义）。
    if (!(e instanceof SpecPushConflict)) {
      await writePendingPushMarker(specRoot);
    }
    throw e;
  }
}

/** 写 pending_push 标记（specDir/.runtime/pending_push，best-effort）。 */
async function writePendingPushMarker(specRoot: string): Promise<void> {
  try {
    const p = join(specRoot, '.runtime', 'pending_push');
    await mkdir(dirname(p), { recursive: true });
    await writeFile(p, `${new Date().toISOString()}\n`, 'utf-8');
  } catch (e) {
    console.warn('spec_sync: pending_push_marker_write_failed', specRoot, e);
  }
}

/** 清 pending_push 标记（best-effort）。 */
async function rmPendingPushMarker(specRoot: string): Promise<void> {
  try {
    await rm(join(specRoot, '.runtime', 'pending_push'), { force: true });
  } catch (e) {
    console.warn('spec_sync: pending_push_marker_rm_failed', specRoot, e);
  }
}

/**
 * 计算增量 ops + 本地文件态（hash/mtime）。
 *
 * 返回 ops（add/update/delete/rename，带 base_version）+ localFiles（本次 walk 的
 * 本地文件 hash/mtime，供成功回写缓存用）。rename 检测：缓存里有、本地没有的路径与
 * 本地有、缓存没有的路径内容 hash 相同 → rename op（不重传内容，R-02）。
 */
async function computeIncrementalOps(
  specRoot: string,
  cached: LocalManifest,
): Promise<{ ops: FileOp[]; localFiles: Record<string, { hash: string; mtime: number }> }> {
  // 三处排除统一（task-07）：UPLOAD_EXCLUDE_TOP_BASE / UPLOAD_PRUNE_NAMES_BASE
  //（与 buildFullManifest / packSpecDir 共用常量，勿各自内联——防再漂移）。
  const entries = await walkDir(specRoot, UPLOAD_EXCLUDE_TOP_BASE, UPLOAD_PRUNE_NAMES_BASE);

  // 第一遍：逐文件 hash（R-05：mtime 未变复用缓存 hash），保留 content buffer 供 add/update。
  const localFiles: Record<string, { hash: string; mtime: number }> = {};
  const contentBufs = new Map<string, Buffer>();
  for (const e of entries) {
    if (e.isDir) continue;
    const mtime = Math.floor(e.mtimeMs);
    const cachedEntry = cached.files[e.relPath];
    if (cachedEntry && cachedEntry.mtime === mtime) {
      localFiles[e.relPath] = { hash: cachedEntry.hash, mtime };
    } else {
      const content = await readFile(e.absPath);
      contentBufs.set(e.relPath, content);
      localFiles[e.relPath] = {
        hash: createHash('sha256').update(content).digest('hex'),
        mtime,
      };
    }
  }

  const localPaths = Object.keys(localFiles);
  const localSet = new Set(localPaths);
  // task-07（关键边界）：缓存残留的排除路径行（旧状态曾上传的 projects/ 等文件）不参与
  // diff——不剔除会因「缓存有、本地无」生成 delete/rename op 误删服务器行。剔除后该行
  // 自然从回写缓存（buildManifestFromLocal 只装 localFiles）中消失，下次 diff 不再出现。
  const cacheSet = new Set(
    Object.keys(cached.files).filter((p) => !isUploadExcludedPath(p)),
  );

  // rename 检测：旧路径（缓存有、本地无）↔ 新路径（本地有、缓存无）内容 hash 相同。
  const renames: Array<{ oldPath: string; newPath: string }> = [];
  const consumedNew = new Set<string>();
  for (const oldPath of cacheSet) {
    if (localSet.has(oldPath)) continue;
    const cachedEntry = cached.files[oldPath]!;
    for (const newPath of localPaths) {
      if (cacheSet.has(newPath)) continue;
      if (consumedNew.has(newPath)) continue;
      if (localFiles[newPath]!.hash === cachedEntry.hash) {
        renames.push({ oldPath, newPath });
        consumedNew.add(newPath);
        break;
      }
    }
  }
  const renamedOld = new Set(renames.map((r) => r.oldPath));
  const renamedNew = new Set(renames.map((r) => r.newPath));

  const ops: FileOp[] = [];
  for (const r of renames) {
    ops.push({
      op: 'rename',
      path: r.oldPath,
      new_path: r.newPath,
      base_version: cached.files[r.oldPath]!.version,
      // ms → s：backend _apply_file_mtime 的 os.utime 要 Unix 秒（ql-008 毫秒 bug 修复）
      mtime: Math.floor(localFiles[r.newPath]!.mtime / 1000),
    });
  }
  for (const p of cacheSet) {
    if (renamedOld.has(p)) continue;
    const cachedEntry = cached.files[p]!;
    if (localSet.has(p)) {
      if (cachedEntry.hash !== localFiles[p]!.hash) {
        ops.push({
          op: 'update',
          path: p,
          hash: localFiles[p]!.hash,
          content: contentBufs.get(p)!.toString('base64'),
          base_version: cachedEntry.version,
          // ms → s（os.utime 要秒）
          mtime: Math.floor(localFiles[p]!.mtime / 1000),
        });
      }
    } else {
      // 本地已删 → delete op（软删，服务器移备份区）。delete 无源文件，不带 mtime。
      ops.push({ op: 'delete', path: p, base_version: cachedEntry.version });
    }
  }
  for (const p of localPaths) {
    if (renamedNew.has(p)) continue;
    if (!cacheSet.has(p)) {
      ops.push({
        op: 'add',
        path: p,
        hash: localFiles[p]!.hash,
        content: contentBufs.get(p)!.toString('base64'),
        base_version: 0,
        // ms → s（os.utime 要秒）
        mtime: Math.floor(localFiles[p]!.mtime / 1000),
      });
    }
  }

  return { ops, localFiles };
}

/**
 * 从增量 ops 提取本次涉及的变更目录名集合（change_dirs 标注，D-005@v1 / task-01）。
 *
 * 对每个 op 的路径（rename 含新旧路径），取 `changes/<name>/` 或 `changes/archive/<name>/`
 * 前缀分组的 key（去掉前缀、取第一段目录名），去重成 string[]。归档路径
 * （`changes/archive/<name>/`）同样归入该 name——backend（task-02）据 ops 判定路径是否含
 * archive 段走全量 reparse，daemon 侧只需把 name 传上来。非 changes 前缀路径（如
 * `.runtime/`、`docs/`、`changes` 本身）不进 change_dirs。
 *
 * 路径分隔符防御：walkDir 的 relPath 已是 POSIX `/`，但 manifest 缓存 / 调用方可能传入
 * Windows `\`，统一归一化再匹配前缀。纯函数不抛错；调用方仍按 best-effort 包裹降级 []。
 *
 * 例：
 *   - `changes/2026-08-14-foo/design.md`           → "2026-08-14-foo"
 *   - `changes/archive/2026-08-13-bar/design.md`   → "2026-08-13-bar"
 *   - `.runtime/spec-version.json` / `docs/a.md`    → 不进
 */
export function extractChangeDirs(ops: FileOp[]): string[] {
  const dirs = new Set<string>();
  for (const op of ops) {
    collectChangeDir(dirs, op.path);
    if (op.new_path) collectChangeDir(dirs, op.new_path);
  }
  return [...dirs];
}

/** 单个 op 路径 → 变更目录名（非 `changes/` 前缀不进）。 */
function collectChangeDir(dirs: Set<string>, p: string): void {
  // Windows `\` 与 POSIX `/` 统一为 `/`（walkDir relPath 已是 `/`，此处仅防御）。
  const norm = p.split(/[\\/]/).join('/');
  // 归档前缀必须先判（`changes/archive/` 以 `changes/` 开头，倒序会误取 `archive`）。
  let rest: string;
  if (norm.startsWith('changes/archive/')) {
    rest = norm.slice('changes/archive/'.length);
  } else if (norm.startsWith('changes/')) {
    rest = norm.slice('changes/'.length);
  } else {
    return; // 非 changes 路径不进 change_dirs
  }
  const first = rest.split('/')[0];
  if (first) dirs.add(first);
}

/** 由本地文件态 + 缓存版本 + 服务器 new_versions 组装新缓存。 */
function buildManifestFromLocal(
  cached: LocalManifest,
  localFiles: Record<string, { hash: string; mtime: number }>,
  newVersions: Record<string, number>,
): LocalManifest {
  const files: Record<string, ManifestFileEntry> = {};
  for (const [path, lf] of Object.entries(localFiles)) {
    files[path] = {
      hash: lf.hash,
      version: cached.files[path]?.version ?? 0,
      mtime: lf.mtime,
    };
  }
  for (const [path, version] of Object.entries(newVersions)) {
    if (files[path]) {
      files[path].version = version;
    } else {
      // rename 的 new_path 在本地文件态里已有（hash/mtime 保留），仅补 version
      const local = localFiles[path];
      files[path] = {
        hash: local?.hash ?? '',
        version,
        mtime: local?.mtime ?? 0,
      };
    }
  }
  return { version: 1, files };
}

// ── syncSpecTreeIfNeeded ──────────────────────────────────────────────────────

/**
 * interactive 路径 spec 树回灌的 ctx-guarded 薄封装（task-06 / D-002@v1）。
 *
 * 抽离自 daemon `_postInteractiveSpecSync`（onSessionEnd 兜底）与 scan run 终态收尾点，
 * 使两处复用同一段 no-op / sync 逻辑。行为：
 *   - `ctx` 为 null/undefined → 直接 return（no-op：quick-chat/shared 不 set ctx 自然不触发，
 *     onSessionEnd 反查 leaseId 失败也安全）。
 *   - 否则等价 `postSpecSync(client, ctx.workspaceId, resolveSpecDir(ctx.workspaceId))`，
 *     内部 try/catch，失败仅 warn 不抛（对齐 R-03：sync 尽力而为，不改写 run/session 终态）。
 *   - client 未实现 `postSpecSync` → postSpecSync 自身返回 null（mock 容错），无副作用。
 *
 * 与 postSpecSync 的差异：postSpecSync 失败会向上抛（batch task-runner 路径由调用方 catch）；
 * 本函数失败仅 warn 不抛（interactive 两处调用方均期望 fire-and-forget 语义）。
 *
 * @param ctx spec 同步上下文（null/undefined → no-op）
 * @param client HubClient 实例（interactive = daemon 持有的 client）
 */
export async function syncSpecTreeIfNeeded(
  ctx: { workspaceId: string } | null | undefined,
  client: HubClient,
): Promise<void> {
  if (!ctx) return; // quick-chat / shared / 反查失败 → no-op
  try {
    await postSpecSync(client, ctx.workspaceId, resolveSpecDir(ctx.workspaceId));
  } catch (e) {
    // R-03：sync 失败仅 warn 不抛，不改写 run/session 终态。
    console.warn('spec_sync: sync_tree_if_needed_failed', ctx.workspaceId, e);
  }
}

// ── packSpecDir ───────────────────────────────────────────────────────────────

/**
 * 把本地 spec 目录整树打包成 tar Buffer（零依赖手工 ustar）。
 *
 * 运行时产物默认排除（ql-20260813-004 + ql-20260813-007，import/push 路径都生效）：
 *   - `runtime/`（无点，顶层）：daemon scan-runs 历史日志，文件名形如
 *     `<change名>-brainstorm-stepNN-<timestamp>.txt` 极易超 100 字节，曾触发 ustar name
 *     截断 → 后端 `_write_spec_root` read_bytes FileNotFoundError → HTTP 500。
 *   - `.runtime/`（**有点**，顶层）：sillyspec 运行时目录——进度库 sillyspec.db（SQLite 二进制，
 *     天然含 NUL 字节）、audit.log、gate-status.json、扫描历史、current-execute-run-id-* 等，
 *     **无一是 spec 规范文档**。曾因 sillyspec.db 的 NUL 字节写进后端 scan_documents 文本列
 *     触发 asyncpg `invalid byte sequence 0x00` → 整批 INSERT 回滚 HTTP 500 →「同步到服务器」
 *     恒失败（ql-20260813-007 根治）。进度库不跨机同步，服务器侧进度以 platform_sync 投影为准。
 *   - `worktrees`（任意深度）：sillyspec worktree 工作区，可达 GB，非 spec 数据。
 *   - `projects`（顶层）：projects/<name>.yaml 含成员机器绝对路径等本地环境信息，
 *     非平台可同步的 spec 数据（task-07 / FR-06 / D-008@v2——三链路统一排除，常量
 *     UPLOAD_EXCLUDE_TOP_BASE）。
 *
 * 契约（ql-20260813-007）：`.runtime` 整树**默认排除**（与 backend `build_bundle` 的 pull 方向
 * 任意深度排除对称，不再有 D-003@v1 的 push/pull 非对称）。`opts.excludeRuntime` 保留为冗余开关
 * （向后兼容 daemon.ts:2301 import 路径调用，语义与默认等价）。
 *
 * name 超 100 字节时写 GNU LongLink 扩展头（buildLongLinkHeader），避免 ustar 截断。
 * 仅 regular file + directory；symlink 跳过（walkDir 不收集）。结尾追加 2×512 zero block。
 *
 * 纯目录打包，无 client 依赖（client 调用在 postSpecSync）。
 */
export async function packSpecDir(
  specDir: string,
  opts: {
    excludeRuntime?: boolean;
    excludeNames?: string[];
    /** ql-20260813-spec-sync-visibility task-12（BL-2）：walkDir 收集完 entry、拼 tar 前
     *  回调，filesCount=非目录文件数。全量首同步路径在此刻能拿到 total 上报进度
     *  （walk 完 total 已知，tar 还没拼，有真实上报窗口）。 */
    onWalkComplete?: (filesCount: number) => void;
  } = {},
): Promise<Buffer> {
  // 三处排除统一（task-07 / FR-06 / D-008@v2）：base 用共享常量
  // UPLOAD_EXCLUDE_TOP_BASE（含 projects——成员机器绝对路径不上传）/
  // UPLOAD_PRUNE_NAMES_BASE，与 computeIncrementalOps / buildFullManifest 共用，勿漂移。
  const excludeTop = new Set<string>([
    ...(opts.excludeNames ?? []),
    ...UPLOAD_EXCLUDE_TOP_BASE,
  ]);
  // ql-20260813-007：.runtime 同时加 pruneNames（任意深度 basename）——防止嵌套子目录里的
  // .runtime（如 sub/.runtime/cache）漏排。对齐 backend build_bundle 的 any(part==".runtime")。
  const pruneNames = new Set([...UPLOAD_PRUNE_NAMES_BASE, '.runtime']);
  const chunks: Buffer[] = [];
  // excludeTop(顶层首段) + pruneNames(任意深度 basename) 传 walkDir 剪枝：命中目录不收集、
  // 不递归，既省 tar 写入也省遍历（.runtime 2G worktrees / changes 万级文件 不递归进去）。
  const entries = await walkDir(specDir, excludeTop, pruneNames);
  // BL-2（task-12）：walk 完成立即回调 total（tar 还没拼，全量路径上报窗口）。
  if (opts.onWalkComplete) {
    opts.onWalkComplete(entries.filter((e) => !e.isDir).length);
  }
  for (const e of entries) {
    const entryName = e.relPath + (e.isDir ? '/' : '');
    // ql-20260813-004：name 超 ustar 100 字节 → 先写 GNU LongLink 扩展头（Python tarfile
    // r:* / GNU tar / bsdtar 均支持读取），否则 name 被 header.write 静默截断。
    if (Buffer.byteLength(entryName, 'utf-8') > 100) {
      chunks.push(...(await buildLongLinkHeader(entryName)));
    }
    const header = await buildTarHeader(entryName, e.isDir ? 0 : e.size, e.isDir, e.mtimeMs);
    chunks.push(header);
    if (!e.isDir) {
      const data = await readFile(e.absPath);
      chunks.push(data);
      const padLen = (512 - (data.length % 512)) % 512;
      if (padLen > 0) chunks.push(Buffer.alloc(padLen, 0));
    }
  }
  chunks.push(Buffer.alloc(1024, 0)); // 2×512 zero block 结尾
  return Buffer.concat(chunks);
}

// ── 模块内 helper（不 export，迁自 task-runner.ts）────────────────────────────

/**
 * 解包 tar Buffer 到目标目录（手工 ustar + PAX/GNU 扩展实现，零依赖）。
 *
 * PAX/GNU 长路径兼容（审计 P1-5）：backend build_bundle 用 Python tarfile.open
 * (mode="w")（3.8+ 默认 PAX 格式）打包，输出含三类纯 ustar 之外的形态——
 *   - typeflag 'x'（PAX 扩展头）：磁盘成员 mtime 为 float（st_mtime）时每成员前
 *     必现（data 形如 "28 mtime=1788005616.38\n"）；路径 >100 字节时完整路径只在
 *     其 path 记录（"<len> path=<完整路径>\n"），紧随实体头 name 字段被截断到
 *     100 字节。本函数解析记录取 path 应用到下一实体头，其余键（mtime 等）忽略，
 *     扩展头自身不落盘（不处理会把文件落到截断的错误路径 / 每成员一条告警噪音）。
 *   - typeflag 'L'（GNU LongLink）：data 是 NUL 结尾完整长名，应用到下一实体头
 *     （daemon 打包侧 buildLongLinkHeader 的对偶读取）。
 *   - ustar prefix 字段（345-500，155 字节）：magic 'ustar' + version '00' 且非空
 *     时 name = prefix + '/' + name。
 * typeflag 'g'（PAX 全局扩展头）/ 'K'（GNU 长链接目标）忽略跳过（spec 树无符号链接）。
 * 实现与 CLI 侧 sillyspec src/sync.js _parseSpecTar 对齐（两仓行为一致）。
 *
 * 路径穿越防护（§5 E-05/E-06，Zip Slip 类）——校验对象是 PAX/prefix/L 拼接后的
 * 最终 name：
 *   - entry.name 含 '..' 段 → 抛错。
 *   - entry.name 绝对路径（/ 开头 / win 盘符 `[A-Z]:`）→ 抛错。
 *   - join 后 path.relative(targetDir, fullPath) 必须不以 '..' 开头。
 *
 * 仅支持 regular file（typeflag '0' 或 '\\0'）+ directory（'5'）。
 * symlink / hardlink / 其他 → 跳过 + warn（daemon spec 树不应含）。
 *
 * 调用方负责先 rm -rf（见 pullSpecBundle，覆盖语义）。
 */
/** extractTar 文件写的并行度（ql-20260904-016：Windows 串行逐文件写是 30s 大头）。 */
const EXTRACT_WRITE_CONCURRENCY = 16;

/**
 * ql-20260904-016：两段式解包——先解析+校验全部 entry（任何路径非法在任何写盘前
 * 抛出，配合 pullSpecBundle 的 tmp 交换语义：坏 tar 不留半解包残缺目录），再有界
 * 并行写盘（目录先行 dedupe mkdir，文件 worker pool 并发写）。解析逻辑（PAX 'x' /
 * GNU 'L' / ustar prefix / Tar Slip 双重校验）与原逐条写实现逐字一致，仅重排 IO。
 */
async function extractTar(tarBuf: Buffer, targetDir: string): Promise<void> {
  // 根目录先建（空 tar 零 entry 时也保证目标目录存在，pullSpecBundle 交换语义依赖）。
  await mkdir(targetDir, { recursive: true });
  // 第 1 段：解析全部 entry（纯内存，无 IO）。
  const dirs = new Set<string>();
  const files: Array<{ fullPath: string; data: Buffer }> = [];
  let offset = 0;
  // PAX 'x' path 记录 / GNU 'L' 长名：覆盖下一实条目的 name（扩展头与实体头成对，
  // Python/GNU tar 打包器均紧邻输出）。
  let pendingPath: string | null = null;
  while (offset + 512 <= tarBuf.length) {
    const header = tarBuf.subarray(offset, offset + 512);
    // 结尾 zero block（全 0）→ 结束
    if (header.every((b) => b === 0)) break;

    const name = readTarString(header.subarray(0, 100));
    const sizeOctal = readTarString(header.subarray(124, 136)).replace(/\0.*$/, '').trim();
    const size = sizeOctal ? parseInt(sizeOctal, 8) : 0;
    const typeflag = String.fromCharCode(header[156] ?? 0);

    offset += 512;
    const data = tarBuf.subarray(offset, offset + size);
    offset += Math.ceil(size / 512) * 512;

    // PAX 扩展头（'x'）：不落盘，path 记录暂存应用到下一实体头，其余键忽略。
    if (typeflag === 'x') {
      const records = parsePaxRecords(data);
      if (records.path) pendingPath = records.path;
      continue;
    }
    // GNU LongLink（'L'）：data 是 NUL 结尾长名，应用到下一实体头。
    if (typeflag === 'L') {
      pendingPath = readTarString(data);
      continue;
    }
    // PAX 全局扩展头（'g'）/ GNU 长链接目标（'K'）：spec 树不含符号链接，静默跳过。
    if (typeflag === 'g' || typeflag === 'K') continue;

    // ustar prefix 字段（345-500）：magic 'ustar' + version '00' 时 name = prefix/name。
    // （GNU 旧格式 magic 'ustar ' version ' \0' 不满足 version 校验，天然不误拼。）
    let fullName = name;
    const magic = readTarString(header.subarray(257, 263));
    const version = readTarString(header.subarray(263, 265));
    if (magic === 'ustar' && version === '00') {
      const prefix = readTarString(header.subarray(345, 500));
      if (prefix) fullName = `${prefix}/${name}`;
    }
    // PAX path / GNU 长名覆盖（优先于 prefix 拼接——完整路径以扩展头记录为准）。
    if (pendingPath) {
      fullName = pendingPath;
      pendingPath = null;
    }

    if (!fullName) continue;

    // 路径穿越防护（join 前后双重校验，校验最终 name）
    if (fullName.includes('..') || isAbsolute(fullName) || /^[A-Za-z]:[\\/]/.test(fullName)) {
      throw new Error(`tar path traversal blocked: ${fullName}`);
    }
    const fullPath = join(targetDir, fullName);
    const rel = relative(targetDir, fullPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`tar path escapes target dir: ${fullName} -> ${fullPath}`);
    }

    if (typeflag === '5' || fullName.endsWith('/')) {
      dirs.add(fullPath);
      continue;
    }
    if (typeflag === '0' || typeflag === '\0') {
      // 显式目录 entry 与「文件父目录」（tar 可能省略目录 entry）统一进 dirs 集合。
      dirs.add(dirname(fullPath));
      files.push({ fullPath, data });
      continue;
    }
    // symlink / 其他 → 跳过 + warn（daemon spec 树不应含）
    console.warn('spec_sync: tar_skip_entry', { name: fullName, typeflag });
  }

  // 第 2 段：目录先行（dedupe 并行 mkdir，recursive 容忍并发 EEXIST），文件 worker pool 写。
  await Promise.all([...dirs].map((d) => mkdir(d, { recursive: true })));
  let cursor = 0;
  const workerCount = Math.min(EXTRACT_WRITE_CONCURRENCY, files.length);
  const workers: Promise<void>[] = [];
  for (let i = 0; i < workerCount; i++) {
    workers.push(
      (async () => {
        // cursor 抢占发生在 await 间隙之间的同步段，单线程事件循环下无竞态；
        // 越界 undefined（并发 worker 先抢完）由长度守卫前置拦截，断言仅过类型。
        while (cursor < files.length) {
          const f = files[cursor++];
          if (!f) break;
          await writeFile(f.fullPath, f.data);
        }
      })(),
    );
  }
  await Promise.all(workers);
}

interface WalkEntry {
  absPath: string;
  relPath: string;
  isDir: boolean;
  size: number;
  /** 文件 mtime（ms）。增量 diff R-05 优化用（mtime 未变跳过重算 hash）。 */
  mtimeMs: number;
}

/**
 * 递归遍历目录，收集所有 entry（含目录本身与子目录），相对路径用 POSIX 分隔符 `/`
 *（tar 标准是 forward slash；Windows 下 join 用 `\`，但 tar entry name 必须是 `/`）。
 */
async function walkDir(
  root: string,
  pruneTop?: Set<string>,
  pruneNames?: Set<string>,
): Promise<WalkEntry[]> {
  const out: WalkEntry[] = [];
  async function recurse(dir: string): Promise<void> {
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const abs = join(dir, name);
      let st;
      try {
        st = await stat(abs);
      } catch {
        continue;
      }
      const relToRoot = relative(root, abs).split(pathSep).join('/');
      // ql-003：剪枝——顶层排除目录(.runtime/changes 等)不收集、不递归，避免遍历
      // .runtime/worktrees(2G) + changes(万级文件) 拖慢 import 打包。
      const topName = relToRoot.split('/')[0] ?? '';
      if (pruneTop && pruneTop.has(topName)) {
        continue;
      }
      // ql-20260813-004：任意深度剪枝——按 basename 匹配，命中即不收集/不递归。用于 worktrees
      //（sillyspec worktree 工作区，可嵌在 .runtime/worktrees 等任意层，可达 GB，非 spec 数据）。
      // 与 pruneTop（只看路径首段）互补。
      if (pruneNames && pruneNames.has(name)) {
        continue;
      }
      if (st.isDirectory()) {
        out.push({ absPath: abs, relPath: relToRoot, isDir: true, size: 0, mtimeMs: st.mtimeMs });
        await recurse(abs);
      } else if (st.isFile()) {
        out.push({
          absPath: abs,
          relPath: relToRoot,
          isDir: false,
          size: st.size,
          mtimeMs: st.mtimeMs,
        });
      }
      // symlink / 其他 → 跳过（walkDir 不收集即跳过）
    }
  }
  await recurse(root);
  return out;
}

/**
 * 构造一个 512B ustar header（POSIX ustar 格式）。
 *
 * 字段布局（POSIX 1003.1）：
 *   name(100) | mode(8) | uid(8) | gid(8) | size(12) | mtime(12) | chksum(8)
 *   | typeflag(1) | linkname(100) | magic(6) | version(2) | uname(32) | gname(32)
 *   | devmajor(8) | devminor(8) | prefix(155) | pad(12)
 *
 * checksum：填充其余字段后，按 unsigned byte sum 计算（checksum 字段本身视为 8 个空格），
 * 写入 6 位 octal + NUL + 空格。
 */
async function buildTarHeader(
  name: string,
  size: number,
  isDir: boolean,
  mtimeMs: number = 0,
): Promise<Buffer> {
  const header = Buffer.alloc(512, 0);

  // name (0-99)
  header.write(name, 0, 'utf-8');
  // mode (100-107) — '0000644\0' for file, '0000755\0' for dir
  header.write(isDir ? '0000755' : '0000644', 100, 'ascii');
  header[107] = 0;
  // uid (108-115) — '0000000\0'
  header.write('0000000', 108, 'ascii');
  header[115] = 0;
  // gid (116-123) — '0000000\0'
  header.write('0000000', 116, 'ascii');
  header[123] = 0;
  // size (124-135) — 11 octal digits + NUL
  header.write(size.toString(8).padStart(11, '0'), 124, 'ascii');
  header[135] = 0;
  // mtime (136-147) — 11 octal digits + NUL。
  // ql-20260813-008：保留宿主真实 mtime（秒，八进制），不再固定 0。后端 changes.updated_at
  // 取变更目录文件 mtime max 填充，mtime=0（1970）会让"更新时间"语义失效。落盘的 tar member
  // mtime 被后端 _write_spec_root 读取作 source_mtime，进而反映到 updated_at。
  header.write(Math.floor(mtimeMs / 1000).toString(8).padStart(11, '0'), 136, 'ascii');
  header[147] = 0;
  // chksum (148-155) — 先填 8 个空格（计算时视为空格）
  header.write('        ', 148, 'ascii');
  // typeflag (156) — '0' regular file / '5' directory
  header[156] = isDir ? 0x35 : 0x30; // '5' or '0'
  // linkname (157-256) — 全 0
  // magic (257-262) — 'ustar\0'
  header.write('ustar', 257, 'ascii');
  header[262] = 0;
  // version (263-264) — '00'
  header.write('00', 263, 'ascii');
  // uname/gname/devmajor/devminor/prefix — 全 0（spec 同步不需要）

  // checksum：unsigned byte sum of all 512 bytes（chksum 字段此时是 8 个空格 = 0x20 * 8）
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  // 写入 6 octal digits + NUL + space
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');

  return header;
}

/**
 * 构造 GNU LongLink 扩展头（ql-20260813-004）。
 *
 * ustar name 字段仅 100 字节，超长文件名会被 `header.write(name, 0, 'utf-8')` 静默截断
 * （曾致后端 `_write_spec_root` read_bytes FileNotFoundError → HTTP 500）。GNU 扩展：
 * name > 100 字节时，先写一个 typeflag='L' 的 header，其 data 块是完整长名（NUL 结尾），
 * 紧跟正常的 entry header（name 字段填占位）。读取方（Python tarfile r:* / GNU tar /
 * bsdtar）遇 'L' 头会用其 data 覆盖下一个 entry 的 name，恢复完整路径。
 *
 * 返回 `[longLinkHeader, longLinkData]`（data 已按 512 对齐补零）。调用方紧接着写正常 header。
 */
async function buildLongLinkHeader(name: string): Promise<Buffer[]> {
  const nameBytes = Buffer.from(name, 'utf-8');
  // data = name + NUL 终止符，按 512 对齐补零。
  const dataSize = nameBytes.length + 1;
  const paddedSize = Math.ceil(dataSize / 512) * 512;
  const header = Buffer.alloc(512, 0);
  // GNU 惯例占位 name '././@LongLink'（≤100 字节，真正名字在 data 块）。
  header.write('././@LongLink', 0, 'ascii');
  header.write('0000000', 100, 'ascii'); // mode
  header[107] = 0;
  header.write('0000000', 108, 'ascii'); // uid
  header[115] = 0;
  header.write('0000000', 116, 'ascii'); // gid
  header[123] = 0;
  header.write(dataSize.toString(8).padStart(11, '0'), 124, 'ascii'); // size
  header[135] = 0;
  header.write('00000000000', 136, 'ascii'); // mtime
  header[147] = 0;
  header.write('        ', 148, 'ascii'); // chksum 占位（8 空格）
  header[156] = 0x4c; // typeflag 'L' = GNU LongLink
  // linkname (157-256) 全 0
  header.write('ustar', 257, 'ascii'); // magic
  header[262] = 0;
  header.write('00', 263, 'ascii'); // version
  // checksum：unsigned byte sum of all 512 bytes（chksum 字段视为 8 个空格 = 0x20*8）。
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += header[i] ?? 0;
  header.write(sum.toString(8).padStart(6, '0') + '\0 ', 148, 'ascii');
  const data = Buffer.alloc(paddedSize, 0);
  nameBytes.copy(data); // data[nameBytes.length] 已是 0（NUL 终止符）
  return [header, data];
}

/**
 * 读取 tar header 中的 NUL 结尾字符串字段（ASCII/UTF-8）。
 * 找到第一个 NUL 截断；无 NUL 则取整个 buf。
 */
function readTarString(buf: Buffer): string {
  const nul = buf.indexOf(0);
  const slice = nul < 0 ? buf : buf.subarray(0, nul);
  return slice.toString('utf-8');
}

/**
 * PAX 扩展头（typeflag 'x'/'g'）data 解析为 {key: value}（审计 P1-5）。
 * 记录形态 "<len> <key>=<value>\n" 重复（UTF-8），len 十进制**字节数**且含自身位数、
 * 空格与尾部 \n。畸形记录（len 非法/越界）容错截断后续解析，不抛错（解包不因扩展头坏
 * 记录中断）。与 CLI 侧 sillyspec src/sync.js _parsePaxRecords 对齐。
 *
 * 必须在 Buffer 上按字节偏移推进/切片：value 含非 ASCII（中文文件名——Python tarfile
 * 对任何非 ASCII 名都写 path 记录，即使 ≤100 字节）时，len（字节）> JS 字符串长度
 * （UTF-16 码元），按码元校验会首记录即 break、path 丢失 → 文件落实体头 name 的
 * ascii/replace 混淆路径并互相覆盖。分隔符（空格/'='/'\n'）均为 ASCII，多字节序列
 * 内不含它们，按字节定位边界安全；key 为 ASCII，仅 value 可能多字节。
 */
function parsePaxRecords(data: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let pos = 0;
  while (pos < data.length) {
    const sp = data.indexOf(0x20, pos);
    if (sp === -1) break;
    const len = parseInt(data.toString('utf-8', pos, sp), 10);
    if (!Number.isInteger(len) || len <= 0 || pos + len > data.length) break;
    const record = data.toString('utf-8', sp + 1, pos + len - 1); // 尾部 \n 不属于 value
    const eq = record.indexOf('=');
    if (eq > 0) out[record.slice(0, eq)] = record.slice(eq + 1);
    pos += len;
  }
  return out;
}

/**
 * HubHttpError 404 类型守卫（duck-type，避免硬依赖 hub-client.ts 导出）。
 *
 * HubHttpError 实例带 readonly status: number 字段；duck-type 守卫 `status === 404`
 * 对真实 HubHttpError 与测试构造的 `{status:404}` 伪对象都成立，规避对 hub-client.ts
 * 导出的硬依赖（即使未来 HubHttpError 改名也只影响守卫严格性，不影响 404 容错语义）。
 */
function isHubHttp404(e: unknown): boolean {
  return (
    typeof e === 'object' &&
    e !== null &&
    'status' in e &&
    (e as { status: unknown }).status === 404
  );
}

// ── spec_version 保鲜（D-010 / task-11）──────────────────────────────────────
//
// daemon 每次 agent/scan 任务执行前比对 lease payload 的 latest_spec_version 与本地
// `resolveSpecDir(wsId)/.runtime/spec-version.json.spec_version`（D-001@v1 迁移）：不一致 → pullSpecBundle 刷新缓存；
// 一致 → 跳过 pull（避免无谓整树覆盖）。pull 成功后 bumpLocalSpecVersion 把新版本回写
// platform.json，保持「本地缓存对应的文档版本」字段新鲜（design §5 日常保鲜 / §10 W3）。
//
// 平台配置文件由 init lease 处理（task-07）写入 6 字段；本节仅读 spec_version 字段 +
// pull 后回写，不依赖 task-07 的完整写入逻辑（最小依赖，platform.json 缺失时读返回 null）。
//
// 覆盖：design.md §5（日常保鲜）/ §10 W3（A 重扫递增、B 落后自动 pull）/ §6 spec_version
// 字段语义；decisions.md D-010。

/**
 * daemon 状态文件相对路径（相对于 spec 缓存根 resolveSpecDir(wsId)，即 ~/.sillyhub/daemon/specs/<ws>）。
 * D-001@v1：取代旧 PLATFORM_CONFIG_FILENAME——.sillyspec-platform.json 交 sillyspec 工具独占，
 * daemon 自己的 spec_version/synced_at 状态独立到 .runtime/spec-version.json。
 */
export const DAEMON_STATE_FILENAME = '.runtime/spec-version.json';

/**
 * 读本地 daemon 状态文件的 `spec_version`（D-010 保鲜比对值；D-001@v1 迁到 .runtime/spec-version.json）。
 *
 * 行为：
 *   - 文件不存在 / 解析失败 / 缺 spec_version 字段 / 非有限整数 → 返回 null
 *     （视为「本地无版本记录」，调用方据此触发 pull，对齐 design §10 W3「B 落后 → pull」）。
 *   - spec_version 为合法整数（含 0）→ 返回该值。
 *
 * 纯文件系统读取，无 client 依赖。任何 IO/JSON 异常吞掉返回 null（保守：宁可多 pull
 * 一次，不因读配置错中断任务）。
 *
 * @param specCacheRoot daemon spec 缓存根（resolveSpecDir(wsId)）
 */
export async function readLocalSpecVersion(specCacheRoot: string | undefined): Promise<number | null> {
  if (!specCacheRoot) return null;
  const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    return null; // 文件不存在 / 不可读 → 无版本记录
  }
  let obj: { spec_version?: unknown };
  try {
    obj = JSON.parse(raw) as { spec_version?: unknown };
  } catch {
    return null; // 损坏 JSON → 无版本记录
  }
  const v = obj.spec_version;
  if (typeof v === 'number' && Number.isFinite(v) && Number.isInteger(v)) {
    return v;
  }
  return null;
}

/**
 * 比对本地 spec_version 与 lease 下发的 latest_spec_version，决定是否刷新缓存（D-010）。
 *
 * 决策表：
 *   - leaseVersion 缺失（undefined/null）→ 返回 false（旧 lease 未透传
 *     latest_spec_version，保持旧行为：由调用点 existingSpecRoot 等既有逻辑决定是否 pull，
 *     不强制刷新，避免对未升级 backend 的回归）。
 *   - leaseVersion 存在但 localVersion 缺失（null：首次初始化前 / platform.json 未写）→
 *     返回 true（视为落后，触发首次 pull）。
 *   - 两者均存在且相等 → 返回 false（缓存新鲜，跳过 pull）。
 *   - 两者均存在且不等 → 返回 true（落后，触发 pull）。
 *
 * 纯函数，无 IO，便于单测覆盖全部分支。
 */
export function shouldRefreshSpec(
  localVersion: number | null,
  leaseVersion: number | null | undefined,
): boolean {
  if (leaseVersion === undefined || leaseVersion === null) return false;
  if (localVersion === null) return true;
  return localVersion !== leaseVersion;
}

/**
 * pull 成功后把新 spec_version 回写本地 daemon 状态文件（保鲜，D-010；D-001@v1 迁到
 * .runtime/spec-version.json）。
 *
 * 更新 spec_version + synced_at（ISO 8601 UTC）。文件**缺失时完整重建**（ql-20260820-007）：
 * pull 的覆盖语义会 rm -rf 整个缓存目录（含 .runtime/spec-version.json），旧实现「缺失即
 * 跳过」导致首次 pull 后保鲜永久失效（每次任务都判落后→全量 pull）。重建为完整 2 字段
 *（spec_version + synced_at，非半成品），与 init lease writeDaemonState 的首写对齐。
 *
 * 失败语义：read/parse/write 任一异常 → 仅 warn 不抛（保鲜是 best-effort，失败不影响
 * pull 已落地的缓存可用性；下次任务比对仍会因版本旧而再 pull，自愈）。
 *
 * @param specCacheRoot daemon spec 缓存根（resolveSpecDir(wsId)）
 * @param newVersion pull 拉到的最新 spec_version（lease 的 latest_spec_version）
 */
export async function bumpLocalSpecVersion(
  specCacheRoot: string | undefined,
  newVersion: number,
): Promise<void> {
  if (!specCacheRoot) return;
  const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(await readFile(statePath, 'utf-8')) as Record<string, unknown>;
  } catch {
    // 状态文件缺失（pull rm -rf 清掉 / 首次）→ 完整重建 2 字段（见 docstring）
    obj = {};
  }
  try {
    obj.spec_version = newVersion;
    obj.synced_at = new Date().toISOString();
    // .runtime 父目录可能随 pull 的 rm -rf 一并被清（bundle 不含 .runtime）→ 重建时补建
    await mkdir(dirname(statePath), { recursive: true });
    await writeFile(statePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.warn('spec_sync: bump_local_spec_version_failed', specCacheRoot, newVersion, e);
  }
}

// ── runSillyspecInit（2026-08-15-init-trigger-sillyspec-init / task-04 / D-006）──
//
// init lease 编排里的 `sillyspec init` 子进程执行器（D-001@v1 方案A：daemon spawn CLI，
// 单一真相源，不 import sillyspec 内部模块）。
//
// 两步：
//   步骤 0：版本门控（D-009）——spawn 'sillyspec --version'（shell:true，3s 超时），semver
//     低于 MIN_SILLYSPEC_VERSION_FOR_INIT → ok:false + sillyspec_init_cli_too_old（老 CLI
//     静默忽略 --no-skills/--tool 多值且 exit 0，preflight 仅启动跑一次不自愈，故每次
//     init 前独立门控；用户升级 CLI 后无需重启 daemon）。
//   步骤 1：spawn `sillyspec init --dir <rootPath> --spec-dir <specCacheRoot>
//     --workspace-id <wsId> --no-skills --tool <tools>`（60s 超时，D-006）。
//
// 超时杀树范式对齐 preflight.ts runWithTreeKill（私有未导出，此处自实现，不跨模块 import）：
// Windows taskkill /PID /T /F（npm.cmd wrapper 孙进程）/ POSIX detached:true 进程组 kill(-pid)。
//
// 覆盖：design.md §2（daemon 侧编排）/ §6（与 preflight 衔接）；decisions.md D-001@v1 /
// D-004@v1（--no-skills）/ D-006@v1（60s 超时）/ D-009@v1（版本门控）。

/**
 * init 所需 sillyspec CLI 最低版本（D-009 门控比对值）。
 *
 * 3.26.8：含 --no-skills 开关 + --tool 多值 + 平台模式跳过项目内清理段
 * （task-01/02/03 三项，本机 npm link 验证版）。正式 npm 发版后若版本号更高，
 * 本常量保持 3.26.8 即可（门控语义是"不低于最低要求"，无需跟随最新版）。
 */
export const MIN_SILLYSPEC_VERSION_FOR_INIT = '3.26.8';

/** 版本门控 spawn 超时（ms）。--version 是纯本地命令，3s 充裕。 */
const VERSION_CHECK_TIMEOUT_MS = 3_000;

/** sillyspec init spawn 超时（ms，D-006：init 纯本地 fs+SQLite 无网络，60s 充裕）。 */
const INIT_SPAWN_TIMEOUT_MS = 60_000;

/** error 信息里 stdout/stderr 收集的截断上限（便于排查又不刷屏）。 */
const INIT_OUTPUT_TRUNCATE = 2_000;

/** spawn 实现的最小接口（依赖注入：默认 node:child_process.spawn，测试注入 mock）。 */
export type SpawnFn = typeof cpSpawn;

/** runSillyspecInit 参数。 */
export interface RunSillyspecInitParams {
  /** 成员本地项目根（--dir）。 */
  rootPath: string;
  /** daemon spec 缓存根 = resolveSpecDir(wsId)（--spec-dir，外部规范目录）。 */
  specCacheRoot: string;
  /** 工作区 id（--workspace-id，平台模式信号 → CLI 落平台指针）。 */
  wsId: string;
  /** 目标 agent 工具列表（--tool 逗号连接；空数组/缺省兜底 ['claude']，D-005@v1）。 */
  tools?: string[];
}

/** runSillyspecInit 结果。 */
export interface RunSillyspecInitResult {
  ok: boolean;
  /** 失败原因。前缀：sillyspec_init_cli_too_old（版本门控）/ sillyspec_init_failed（退出码非 0 / 超时 / spawn 失败）。 */
  error?: string;
}

/**
 * 解析 'x.y.z' semver 为数字三元组。
 *
 * 容忍 'v' 前缀与尾缀（'v3.26.7' / '3.30.0-beta'——尾缀忽略，只比主段）；空段补 0
 * （'3.30' ≙ [3,30,0]）。任一主段非整数 → null（解析失败，门控 fail-safe 按不过处理）。
 * 纯函数，export 供单测直接覆盖。
 */
export function parseSemver(raw: string): [number, number, number] | null {
  const m = /^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(raw.trim());
  if (!m) return null;
  const seg = [m[1], m[2], m[3]].map((s) => (s === undefined ? 0 : Number.parseInt(s, 10)));
  if (seg.some((n) => !Number.isFinite(n))) return null;
  return [seg[0]!, seg[1]!, seg[2]!];
}

/** 两版本比较：a < b → -1 / a > b → 1 / 相等 → 0。任一解析失败 → null（门控 fail-safe）。 */
function compareSemver(a: string, b: string): number | null {
  const av = parseSemver(a);
  const bv = parseSemver(b);
  if (av === null || bv === null) return null;
  for (let i = 0; i < 3; i++) {
    if (av[i]! < bv[i]!) return -1;
    if (av[i]! > bv[i]!) return 1;
  }
  return 0;
}

/** 杀整个进程树（范式对齐 preflight.ts:360 killTree，自实现不跨模块 import）。 */
function killInitTree(child: ChildProcess, spawnFn: SpawnFn): void {
  const pid = child.pid;
  if (typeof pid !== 'number') return;
  try {
    if (process.platform === 'win32') {
      // taskkill /T 杀树（含 npm.cmd spawn 的孙 node.exe），/F 强制。
      spawnFn('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore',
      });
    } else {
      // 进程组 kill（spawn 时 detached:true 使子自成组长，负 pid 杀整组）；失败兜底单杀。
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
  } catch {
    // 杀树失败不抛（最坏孙进程残留；不阻塞 daemon）。
  }
}

/**
 * spawn 命令 + 超时杀树，收集 stdout/stderr（范式对齐 preflight.ts:393 runWithTreeKill，
 * 差异：额外捕获 stderr 进输出，供 error 信息排查）。
 *
 * 返回：exit 0 → { ok:true, output }；非 0 / 超时（timedOut=true）/ spawn error →
 * { ok:false, output, timedOut }。
 */
function runInitCmd(
  cmd: string,
  timeoutMs: number,
  spawnFn: SpawnFn,
): Promise<{ ok: boolean; output: string; timedOut: boolean }> {
  return new Promise((resolve) => {
    const child = spawnFn(cmd, {
      shell: true, // X-06：bare name（sillyspec）在 Windows 必 ENOENT，shell 解析 .cmd wrapper
      detached: process.platform !== 'win32', // POSIX 进程组 kill 前置条件
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const outChunks: Buffer[] = [];
    let settled = false;
    const finish = (ok: boolean, timedOut: boolean): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok,
        output: Buffer.concat(outChunks).toString('utf-8'),
        timedOut,
      });
    };
    if (child.stdout) child.stdout.on('data', (c: Buffer) => outChunks.push(c));
    if (child.stderr) child.stderr.on('data', (c: Buffer) => outChunks.push(c));
    child.on('error', () => finish(false, false)); // ENOENT 等 spawn 失败
    child.on('close', (code) => finish(code === 0, false));
    const timer = setTimeout(() => {
      killInitTree(child, spawnFn);
      finish(false, true);
    }, timeoutMs);
  });
}

/**
 * 执行 `sillyspec init`（平台模式参数，task-04 / design §2）。
 *
 * 步骤 0 版本门控（D-009）：`sillyspec --version`（shell:true，3s）< MIN_SILLYSPEC_VERSION_FOR_INIT
 * → ok:false + sillyspec_init_cli_too_old + 中文升级指引（重启 daemon 或 npm install -g
 * sillyspec@latest——升级 CLI 后无需重启 daemon，下次 init 门控即通过）。门控查询失败
 * （spawn 失败 / 超时 / 版本解析失败）同样 fail-safe 按门控不过（ok:false，cli_too_old 前缀），
 * 不冒险对一个版本未知的 CLI 发 --no-skills/--tool 多值（老 CLI 静默忽略且 exit 0，
 * 会产出错误骨架假成功）。
 *
 * 步骤 1 init spawn（60s 超时杀树，D-006）：
 *   sillyspec init --dir <rootPath> --spec-dir <specCacheRoot> --workspace-id <wsId>
 *                   --no-skills --tool <tools.join(',')>
 *   - 退出码 0 → ok:true
 *   - 非 0 / 超时 / spawn 失败 → ok:false + sillyspec_init_failed（stdout/stderr 截断收集进 error）
 *   - tools 空数组/缺省 → 兜底 ['claude']（D-005@v1）
 *
 * 纯编排函数：spawn 经 spawnFn 注入（默认 node:child_process.spawn），供单测 mock。
 *
 * @param params rootPath/specCacheRoot/wsId 必填；tools 可选
 * @param spawnFn 可选 spawn 实现（测试注入）；缺省 node:child_process.spawn
 */
export async function runSillyspecInit(
  params: RunSillyspecInitParams,
  spawnFn: SpawnFn = cpSpawn,
): Promise<RunSillyspecInitResult> {
  // ── 步骤 0：版本门控（D-009）───────────────────────────────────────────────
  // 查询失败 / 解析失败 → cmp=null → 走同一 fail-fast 分支（门控不过保守处理）。
  const ver = await runInitCmd('sillyspec --version', VERSION_CHECK_TIMEOUT_MS, spawnFn);
  const cmp = ver.ok ? compareSemver(ver.output.trim(), MIN_SILLYSPEC_VERSION_FOR_INIT) : null;
  if (cmp === null || cmp < 0) {
    const detected = ver.ok ? ver.output.trim().split(/\r?\n/)[0] ?? '' : '(版本查询失败)';
    return {
      ok: false,
      error: `sillyspec_init_cli_too_old: 本机 sillyspec 版本过低（探测到 ${detected || '未知'}，需 ≥ ${MIN_SILLYSPEC_VERSION_FOR_INIT}），未执行 init。请升级后重试：重启 daemon（preflight 自动升级）或手动执行 npm install -g sillyspec@latest；升级 CLI 后无需重启 daemon，下次 init 自动通过。`,
    };
  }

  // ── 步骤 1：spawn init（60s 超时杀树，D-006）───────────────────────────────
  const tools = params.tools && params.tools.length > 0 ? params.tools : ['claude']; // D-005 兜底
  // 路径值带双引号（Windows 项目路径常含空格，shell:true 下裸拼会被拆参）；wsId/tools
  // 是无空格 id（resolveSpecDir 已拒路径分隔符），不需要引号。
  const cmd = [
    'sillyspec init',
    `--dir "${params.rootPath}"`,
    `--spec-dir "${params.specCacheRoot}"`,
    `--workspace-id ${params.wsId}`,
    '--no-skills', // D-004：skills 只走 skill-manager 单渠道
    `--tool ${tools.join(',')}`,
  ].join(' ');
  const init = await runInitCmd(cmd, INIT_SPAWN_TIMEOUT_MS, spawnFn);
  if (init.ok) return { ok: true };
  const detail = init.output.trim().slice(0, INIT_OUTPUT_TRUNCATE);
  const reason = init.timedOut
    ? `超时（>${Math.round(INIT_SPAWN_TIMEOUT_MS / 1000)}s 已终止进程树）`
    : `退出码非 0`;
  return {
    ok: false,
    error: `sillyspec_init_failed: ${reason}${detail ? `；输出：${detail}` : ''}`,
  };
}

// ── daemon 状态文件 + init lease 编排（D-001@v1 / task-01~05）──────────────────
//
// D-001@v1：daemon 退出 .sillyspec-platform.json 写入（交 sillyspec 工具独占），
// 自己的 spec_version 保鲜状态独立到 ~/.sillyhub/daemon/specs/<ws>/.runtime/spec-version.json。
//
// init lease 处理（design §5 / §9 生命周期契约）：daemon 拉到 init lease →
//   1. writeDaemonState：写 2 字段 daemon 状态文件（spec_version + synced_at）到缓存根 .runtime/；
//   2. pullSpecBundle（复用，含 task-12 pull 前回灌保护）；
//   3. postSpecSync（若本地有改动 / pull 拿到内容，回灌到服务器权威 spec_root）；
//   4. 返回 { ok, spec_version } 供调用方 complete lease 上报 init_synced_at /
//      init_synced_spec_version（backend 更新 WorkspaceMemberRuntime）。
//
// 与保鲜的关系：readLocalSpecVersion/bumpLocalSpecVersion 读写状态文件 spec_version
// 单字段（已初始化项目保鲜用）；本节 writeDaemonState 是 init lease 的完整首写
//（2 字段一次性落盘）。三者复用 DAEMON_STATE_FILENAME 常量。
//
// 覆盖：design.md §7（daemon 状态 schema）/ §9（init lease 事件）/ §10 W2；
// decisions.md D-001@v1（daemon 退出 platform.json）/ D-002（init 重定义）/ D-009（init lease 下发）。

/**
 * daemon 状态文件 schema（D-001@v1）。
 *
 * 写到 daemon spec 缓存根的 .runtime/spec-version.json（~/.sillyhub/daemon/specs/<ws>/.runtime/）。
 * 字段：
 *   - spec_version：本地缓存对应的文档版本（D-010 保鲜比对值，pull 后回写）。
 *   - synced_at：上次同步时间（ISO 8601 UTC）。
 */
export interface DaemonState {
  spec_version: number;
  synced_at: string;
}

/**
 * 写 `{specCacheRoot}/.runtime/spec-version.json`（init lease 完整首写，2 字段）。
 *
 * 行为：
 *   - specCacheRoot 缺失 → 抛错（init lease 必带 workspaceId 可解析缓存根，缺失是异常）。
 *   - 先 mkdir {specCacheRoot}/.runtime（recursive，容忍已存在），再 writeFile（utf-8，2 空格缩进 + 尾换行）。
 *   - synced_at 用 ISO 8601 UTC（new Date().toISOString()，可由调用方覆盖）。
 *
 * 与 bumpLocalSpecVersion 的差异：bump 只在已存在状态文件上 patch spec_version + synced_at
 * （保鲜，不主动创建）；本函数是 init lease 的完整首写，一次性落 2 字段。后续保鲜仍走
 * bumpLocalSpecVersion（不破坏其他字段）。
 *
 * 失败语义：IO 异常 → 向上抛（init lease 失败 = lease 终态 failed，由调用方 catch 决定
 * complete 上报 init_failed）。不吞错（与保鲜 best-effort 不同：init 写失败意味着 daemon
 * 无版本基线，保鲜机制失效，必须显式失败）。
 *
 * @param specCacheRoot daemon spec 缓存根（resolveSpecDir(workspaceId)）
 * @param state 2 字段状态（spec_version 必填；synced_at 可省略，缺省取当前时间）
 */
export async function writeDaemonState(
  specCacheRoot: string,
  state: Omit<DaemonState, 'synced_at'> & { synced_at?: string },
): Promise<DaemonState> {
  if (!specCacheRoot) {
    throw new Error('writeDaemonState: specCacheRoot is required for init lease');
  }
  const full: DaemonState = {
    spec_version:
      typeof state.spec_version === 'number' && Number.isFinite(state.spec_version)
        ? Math.max(0, Math.trunc(state.spec_version))
        : 0,
    synced_at: state.synced_at ?? new Date().toISOString(),
  };
  const statePath = join(specCacheRoot, DAEMON_STATE_FILENAME);
  await mkdir(join(specCacheRoot, '.runtime'), { recursive: true });
  await writeFile(statePath, JSON.stringify(full, null, 2) + '\n', 'utf-8');
  return full;
}

/**
 * init lease 处理参数（handleInitLease 入参）。
 *
 * 来源：lease payload（backend task-06 start_init_dispatch 下发）。
 *   - workspaceId：归属工作区（必填，pull/push 路由 key + 解析 specCacheRoot 写状态文件）。
 *   - rootPath：成员本地项目根路径（必填，pull repo-mirrored/native 读源；D-001@v1 后不再写此目录）。
 *   - serverOrigin：平台地址（D-001@v1 后不再持久化到状态文件，仅 lease 上下文用）。
 *   - strategy：spec 同步策略三值（缺省 platform-managed）。
 *   - latestSpecVersion：lease 下发的服务器当前 spec_version（写状态文件.spec_version）。
 */
export interface HandleInitLeaseParams {
  workspaceId: string;
  rootPath: string;
  serverOrigin: string;
  strategy?: string;
  latestSpecVersion?: number;
  /**
   * init 下发的 local.yaml token 段（design §5.4 / §7.2）。
   *
   * task-07 task-runner 从 ctx.platformConfig.local_yaml 透传入此字段；缺失时跳过第 5 步
   * （向后兼容无 token 的旧 lease / mock client）。url 由 params.serverOrigin 提供
   * （task-07 从 task-runner.config.server_url 透传，不读 payload.server_origin，对齐 D-002）。
   */
  local_yaml?: { platform_token: string; mcp_token: string };
  /**
   * init 目标工具列表（task-05 / D-005@v1 / D-007@v1）：cli.ts 构造 TaskRunner 前
   * AgentDetector 探测结果映射 sillyspec VALID_TOOLS 同名交集后的子集，经 TaskRunner
   * detectedAgents 透传至此。缺省 / 空数组 → runSillyspecInit 内兜底 ['claude']。
   */
  tools?: string[];
  /**
   * spawn 实现（runSillyspecInit 依赖注入，task-04）：缺省 node:child_process.spawn；
   * 测试注入 mock 使 init 步骤恒成功/失败（test_init_lease.test.ts 既有全局 spawn mock
   * 返 null 会击穿本步骤，X-14）。
   */
  spawnFn?: SpawnFn;
}

/**
 * init lease 处理结果（handleInitLease 出参）。
 *
 * - ok=true：daemon 状态文件已写 + pull/post 完成，specVersion 为最终落盘的版本号（=
 *   latestSpecVersion 兜底 0，供 complete 上报 init_synced_spec_version）。
 * - ok=false：任一步失败（写状态文件 / pull / post）；error 含失败原因；specVersion
 *   兜底 0（complete 上报 0 让 backend 记录「初始化完成但版本未知」，前端可据此引导重扫）。
 */
export interface HandleInitLeaseResult {
  ok: boolean;
  specVersion: number;
  error?: string;
  /** daemon 状态文件内容（ok=true 时非 null）。D-001@v1：取代旧 platformConfig。 */
  daemonState: DaemonState | null;
  /** pullSpecBundle 返回的本地 specDir（null=未 pull / wsId 缺 / client 未实现）。 */
  specDir: string | null;
}

/**
 * init lease 完整处理（design §2 / §5 / §9 生命周期：config_written → bundle_pulled → init_run → local_pushed）。
 *
 * 编排 6 步（顺序严格，硬失败步骤即 abort；rev2 时序 D-002@v2：init 后置于 pull；
 * ql-20260820-007 rev3：writeDaemonState 后置于 pull）：
 *   1. **pullSpecBundle**：拉服务器权威 spec 到本地缓存（~/.sillyhub/daemon/specs/<ws>）。
 *      内部含 task-12 pull 前回灌保护（hasUnsyncedLocalChanges）+ task-11 三分支 strategy。
 *      失败 → ok=false abort（pull 失败客户端无缓存可用，init 无意义）。404 容错在
 *      pullSpecBundle 内部已处理（首次 scan backend 无 bundle → mkdir 空目录，不算失败）。
 *      整删重建语义保留（bundle 为权威内容）——init 骨架必须后置于 pull，否则被 rm -rf
 *      物理删除（D-002@v2）。
 *   2. **writeDaemonState**：写 2 字段 daemon 状态文件到 {resolveSpecDir(workspaceId)}/.runtime/。
 *      spec_version 取 latestSpecVersion（lease 下发）兜底 0。失败 → ok=false abort
 *      （状态文件是 daemon 保鲜基线，写失败后续保鲜失效，不降级）。D-001@v1：不再写 .sillyspec-platform.json。
 *      **rev3 后置于 pull 的原因**（ql-20260820-007）：先写会在缓存根创建 .runtime/ 普通目录，
 *      阻塞 pullSpecBundle 的 repo-native ensureSpecJunction（普通目录残留守卫）与
 *      repo-mirrored cacheEmpty 首拷判定——两分支静默降级 platform-managed；且 pull 的
 *      rm -rf 会把先写的状态文件删掉（保鲜失效）。后置后：junction 分支先建链、状态文件
 *      经 junction 落源项目 .sillyspec/.runtime（被 gitignore 的 .runtime 通配规则覆盖），
 *      platform-managed pull 覆盖后状态文件幸存。repo-native 时状态文件随 junction 落
 *      源项目属可接受副作用（读写路径 resolveSpecDir(wsId)/.runtime 三策略统一，D-001@v1）。
 *   3. **runSillyspecInit**（task-04 产物，硬失败 abort，D-003@v1）：spawn
 *      `sillyspec init --dir rootPath --spec-dir specCacheRoot --workspace-id wsId
 *      --no-skills --tool tools`（60s 超时杀树 + 版本门控 D-009）。失败 → ok=false abort
 *      且 postSpecSync/writeLocalYaml 不执行（init 产物是 init lease 核心目的而非锦上添花）。
 *   4. **postSpecSync**：若 pull 拿到 specDir 且本地有改动 → 回灌到服务器（init 新增骨架
 *      经增量 diff add op 回传，D-008@v2 同 hash no-op）。失败**不 abort**（R-03：sync
 *      失败仅 warn，状态文件已写、pull 缓存已就位，init 主体成功；本地改动下次任务前会
 *      再被 pull 前回灌保护触发重试，自愈）。
 *   5. **writeLocalYaml**（design §5.4 / D-003 严格契约）：仅当 params.local_yaml 存在
 *      （platformConfig.local_yaml 非空）时执行——向 {rootPath}/.sillyspec/local.yaml
 *      写 platform 段（权威覆盖）+ mcp 段（有才留）。url 用 params.serverOrigin（task-07
 *      从 config.server_url 透传，不读 payload.server_origin，对齐 D-002）。失败 → ok=false
 *      abort（对齐步骤 1/2 的逐步 catch 范式，不向上抛；D-003：写盘失败 = init 整体失败，
 *      _runInitLease 据 result.ok===false 走 _finish(false) → lease 标 failed）。
 *   6. 返回结果：specVersion = 状态文件落盘的 spec_version（= latestSpecVersion 兜底 0），
 *      供调用方 complete lease 上报 init_synced_spec_version。
 *
 * 设计取舍：
 *   - spec_version 写 latestSpecVersion 而非「pull 后探测」：init 语义是「拉到当前权威版本」，
 *     latestSpecVersion 是服务器权威值（SpecWorkspace.spec_version），与 pull 落地内容一致；
 *     若 pull 404（服务器无 bundle），latestSpecVersion 通常是 0，spec_version 写 0 符合
 *     「未扫描」状态（前端引导「请先扫描」）。
 *   - 纯函数 + client 参数注入（D-007@v1 原则）：不读 TaskRunner 实例状态，task-runner
 *     batch 路径与未来 interactive 路径可直接调用。
 *
 * @param client HubClient 实例（getSpecBundle / postSpecSync）
 * @param params init lease 参数（workspaceId / rootPath / serverOrigin / strategy /
 *   latestSpecVersion / local_yaml? / tools? / spawnFn?）
 */
export async function handleInitLease(
  client: HubClient,
  params: HandleInitLeaseParams,
): Promise<HandleInitLeaseResult> {
  const strategy = params.strategy || 'platform-managed';
  const specVersion =
    typeof params.latestSpecVersion === 'number' && Number.isFinite(params.latestSpecVersion)
      ? Math.max(0, Math.trunc(params.latestSpecVersion))
      : 0;
  const specCacheRoot = resolveSpecDir(params.workspaceId);

  // 步骤 1：pullSpecBundle（硬失败 abort；404 容错在 utility 内已处理返回空 specDir）。
  // ql-20260820-007 rev3：先 pull 后写状态文件——防 .runtime/ 占位阻塞 repo-native
  // junction / repo-mirrored 首拷分支（见上方函数 docstring）。
  let specDir: string | null = null;
  try {
    specDir = await pullSpecBundle(client, params.workspaceId, {
      strategy,
      rootPath: params.rootPath,
    });
  } catch (e) {
    // pull 失败（5xx / 网络 / SpecPushBeforePullError）→ init 主体失败。
    // 状态文件尚未写（rev3 后置于 pull）→ daemonState null。
    return {
      ok: false,
      specVersion,
      error: `spec_bundle_pull_failed: ${(e as Error)?.message ?? String(e)}`,
      daemonState: null,
      specDir: null,
    };
  }

  // 步骤 2：写 daemon 状态文件（硬失败 abort）。D-001@v1：取代旧 writePlatformConfig。
  // repo-native junction 已建：状态文件经 junction 落源项目 .sillyspec/.runtime（gitignored）。
  let daemonState: DaemonState;
  try {
    daemonState = await writeDaemonState(specCacheRoot, {
      spec_version: specVersion,
    });
  } catch (e) {
    return {
      ok: false,
      specVersion,
      error: `daemon_state_write_failed: ${(e as Error)?.message ?? String(e)}`,
      daemonState: null,
      specDir,
    };
  }

  // 步骤 3：runSillyspecInit（硬失败 abort，D-003@v1 / D-002@v2 rev2 时序：pull 后 post 前）。
  // pull 整删重建后 init 在幸存的 specCacheRoot 上重建 .runtime/（sillyspec.db 等）+ 项目根
  // 骨架/平台指针；失败 → 不执行 postSpecSync/writeLocalYaml（init 产物是核心目的）。
  // runSillyspecInit 自身按契约不抛（全失败路径返 ok:false），try/catch 是对齐步骤 1/2 的
  // 防御性兜底（如测试环境 spawn mock 返 null 的 TypeError），异常同样转硬失败不向上抛。
  let initResult: RunSillyspecInitResult;
  try {
    initResult = await runSillyspecInit(
      {
        rootPath: params.rootPath,
        specCacheRoot,
        wsId: params.workspaceId,
        tools: params.tools,
      },
      params.spawnFn,
    );
  } catch (e) {
    initResult = {
      ok: false,
      error: `sillyspec_init_failed: ${(e as Error)?.message ?? String(e)}`,
    };
  }
  console.info(
    'spec_sync: init_lease_sillyspec_init',
    params.workspaceId,
    initResult.ok ? 'ok' : 'failed',
  );
  if (!initResult.ok) {
    return {
      ok: false,
      specVersion,
      // 前缀透传（sillyspec_init_cli_too_old / sillyspec_init_failed），error 值域新增两前缀。
      error: initResult.error ?? 'sillyspec_init_failed: unknown',
      daemonState,
      specDir,
    };
  }

  // 步骤 4：postSpecSync（软失败，R-03 不 abort）。仅 specDir 非空（pull 成功 / 404 空目录）
  // 时尝试回灌本地改动到服务器。client 未实现 postSpecSync → postSpecSync 返回 null 跳过。
  if (specDir) {
    try {
      const resp = await postSpecSync(client, params.workspaceId, specDir);
      if (resp !== null) {
        console.info('spec_sync: init_lease_post_ok', params.workspaceId, resp);
      }
    } catch (e) {
      // R-03：sync 失败仅 warn 不 abort（状态文件 + pull 缓存已就位，init 主体成功）。
      console.warn('spec_sync: init_lease_post_failed', params.workspaceId, e);
    }
  }

  // 步骤 5：writeLocalYaml（design §5.4 / D-003 严格契约：写盘失败 = init 整体失败）。
  // 仅当 params.local_yaml 存在（platformConfig.local_yaml 非空）时执行；缺失则跳过（向后
  // 兼容无 token 的旧 lease / mock client）。url 用 params.serverOrigin（task-07 透传，
  // 不读 payload.server_origin，对齐 D-002）。
  if (params.local_yaml) {
    try {
      await writeLocalYaml(params.rootPath, params.local_yaml, params.serverOrigin);
    } catch (e) {
      // 写盘硬失败 abort（对齐步骤 1 writeDaemonState / 步骤 2 pullSpecBundle 的逐步 catch 范式，
      // 不向上抛——handleInitLease 是逐步 catch 返 ok:false/true 模型，非 task-runner 顶层 catch）。
      // _runInitLease 据 result.ok===false 走 _finish(false) → lease 标 failed（D-003）。
      console.warn('spec_sync: init_lease_local_yaml_failed', params.workspaceId, e);
      return {
        ok: false,
        specVersion,
        error: `local_yaml_write_failed: ${(e as Error)?.message ?? String(e)}`,
        daemonState,
        specDir,
      };
    }
  }

  // 步骤 6：返回成功（specVersion = 状态文件落盘值）。
  return {
    ok: true,
    specVersion: daemonState.spec_version,
    daemonState,
    specDir,
  };
}
