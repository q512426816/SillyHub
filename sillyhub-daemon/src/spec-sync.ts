// sillyhub-daemon/src/spec-sync.ts
// task-04 / D-007@v1：spec bundle 同步共享 utility（纯函数 + client 参数注入）。
//
// 从 task-runner.ts 等价迁移（除新增的 404 容错分支外，行为对齐）：
//   - resolveSpecDir   ← task-runner.ts:1444-1449（_resolveSpecDir）
//   - pullSpecBundle   ← task-runner.ts:1417-1438（_pullSpecBundle）+ 新增 404 容错
//   - extractTar       ← task-runner.ts:1464-1505（_extractTar，含 Tar Slip 防护）
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

import { homedir } from 'node:os';
import { join, relative, isAbsolute, dirname, resolve, sep as pathSep } from 'node:path';
import { mkdir, rm, readdir, stat, lstat, readlink, symlink, cp, readFile, writeFile } from 'node:fs/promises';
import type { HubClient } from './hub-client.js';

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
  return join(homedir(), '.sillyhub', 'daemon', 'specs', wsId);
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
  if (!wsId) return null; // server-local / 非 daemon-client
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

  // 覆盖语义：先 rm -rf（容忍不存在），再解包。
  // Windows EBUSY 降级：忽略 rm 错误，仍 mkdir + 解包（容忍残留，agent 侧覆盖读取）。
  // R-01：仅 pull 路径走 rm（repo-native 已 return 不到此，junction 不会被 rm）。
  try {
    await rm(specDir, { recursive: true, force: true });
  } catch (e) {
    console.warn('spec_sync: spec_dir_rm_failed', specDir, e);
  }
  await extractTar(tarBuf, specDir);
  return specDir;
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
    super(
      `spec_sync: postSpecSync before pull failed (local changes preserved) ws=${workspaceId} dir=${specDir}`,
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

// ── postSpecSync ──────────────────────────────────────────────────────────────

/**
 * 打包本地 spec 整树并 POST 回传 backend（一次性整树，D-004）。
 *
 * 封装 packSpecDir + client.postSpecSync 两步（task-runner.ts:482-486 等价逻辑抽提）。
 * 返回 backend 响应 { ok, reparsed }；client 未实现 postSpecSync 时返回 null（mock 容错）。
 *
 * 失败语义：网络/HTTP 非 2xx / IO → 向上抛（调用方 catch 后仅 warn 不阻塞，对齐
 * task-runner.ts:488-490 与 design R-03：sync 失败不改写 agent 结果/不阻塞 session 终态）。
 *
 * @param client HubClient（batch/interactive 各自持有的实例）
 * @param wsId workspace id
 * @param specRoot 本地 spec 目录（pullSpecBundle/packSpecDir 返回的路径）
 */
export async function postSpecSync(
  client: HubClient,
  wsId: string,
  specRoot: string,
): Promise<{ ok: boolean; reparsed: number } | null> {
  if (typeof client.postSpecSync !== 'function') return null; // mock client 未实现
  const tarBuf = await packSpecDir(specRoot);
  return client.postSpecSync(wsId, tarBuf);
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
 * 迁自 task-runner.ts:1512-1533（_packSpecDir）。task-06（design §5.2 D-003 push 路径）：
 * **包含** `.runtime/`（含 daemon sillyspec.db 等），不再排除——daemon 侧 .runtime 需回灌到
 * backend（FR-06）。pull 路径 backend `build_bundle` 仍排除 .runtime，保持非对称（R7）。
 * 仅 regular file + directory；symlink 跳过（walkDir 不收集）。结尾追加 2×512 zero block。
 *
 * 纯目录打包，无 client 依赖（client 调用在 postSpecSync）。
 */
export async function packSpecDir(
  specDir: string,
  opts: { excludeRuntime?: boolean; excludeNames?: string[] } = {},
): Promise<Buffer> {
  // ql-20260701-002/003：import 路径(get_spec_bundle)排除非 spec 数据的顶层目录——
  // .runtime（运行时缓存含 worktrees，可达 GB）+ excludeNames（如 changes：SillySpec 流程
  // 档案，reparse 不读，可达十 MB + 万级文件，Windows 遍历慢，是 import 超时主因）。与
  // backend build_bundle 排除 .runtime 对称。postSpecSync 不传此选项，保持 task-06 含
  // .runtime 回灌(design §5.2 D-003)。
  const excludeTop = new Set<string>(opts.excludeNames ?? []);
  if (opts.excludeRuntime) excludeTop.add('.runtime');
  const chunks: Buffer[] = [];
  // 传 excludeTop 给 walkDir 剪枝（不递归进排除目录）。仅在循环里 filter 只省 tar 写入、
  // 不省遍历——.runtime(2G worktrees)/changes(万级文件) 仍会被 stat 一遍，打包照样 16s+。
  // ql-003。postSpecSync 不传 exclude → walkDir 不剪枝，保持含 .runtime 回灌。
  const entries = await walkDir(specDir, excludeTop);
  for (const e of entries) {
    // task-06：.runtime 段不再排除（design §5.2 D-003 push 路径），含 sillyspec.db 回灌。
    const header = await buildTarHeader(
      e.relPath + (e.isDir ? '/' : ''),
      e.isDir ? 0 : e.size,
      e.isDir,
    );
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
 * 解包 tar Buffer 到目标目录（手工 ustar 实现，零依赖）。
 *
 * 路径穿越防护（§5 E-05/E-06，Zip Slip 类）：
 *   - entry.name 含 '..' 段 → 抛错。
 *   - entry.name 绝对路径（/ 开头 / win 盘符 `[A-Z]:`）→ 抛错。
 *   - join 后 path.relative(targetDir, fullPath) 必须不以 '..' 开头。
 *
 * 仅支持 regular file（typeflag '0' 或 '\\0'）+ directory（'5'）。
 * symlink / hardlink / 其他 → 跳过 + warn（daemon spec 树不应含）。
 *
 * 调用方负责先 rm -rf（见 pullSpecBundle，覆盖语义）。
 */
async function extractTar(tarBuf: Buffer, targetDir: string): Promise<void> {
  await mkdir(targetDir, { recursive: true });
  let offset = 0;
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

    if (!name) continue;

    // 路径穿越防护（join 前后双重校验）
    if (name.includes('..') || isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) {
      throw new Error(`tar path traversal blocked: ${name}`);
    }
    const fullPath = join(targetDir, name);
    const rel = relative(targetDir, fullPath);
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error(`tar path escapes target dir: ${name} -> ${fullPath}`);
    }

    if (typeflag === '5' || name.endsWith('/')) {
      await mkdir(fullPath, { recursive: true });
      continue;
    }
    if (typeflag === '0' || typeflag === '\0') {
      await mkdir(dirname(fullPath), { recursive: true });
      await writeFile(fullPath, data);
      continue;
    }
    // symlink / 其他 → 跳过 + warn（daemon spec 树不应含）
    console.warn('spec_sync: tar_skip_entry', { name, typeflag });
  }
}

interface WalkEntry {
  absPath: string;
  relPath: string;
  isDir: boolean;
  size: number;
}

/**
 * 递归遍历目录，收集所有 entry（含目录本身与子目录），相对路径用 POSIX 分隔符 `/`
 *（tar 标准是 forward slash；Windows 下 join 用 `\`，但 tar entry name 必须是 `/`）。
 */
async function walkDir(root: string, pruneTop?: Set<string>): Promise<WalkEntry[]> {
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
      if (st.isDirectory()) {
        out.push({ absPath: abs, relPath: relToRoot, isDir: true, size: 0 });
        await recurse(abs);
      } else if (st.isFile()) {
        out.push({ absPath: abs, relPath: relToRoot, isDir: false, size: st.size });
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
async function buildTarHeader(name: string, size: number, isDir: boolean): Promise<Buffer> {
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
  // mtime (136-147) — 11 octal digits + NUL（固定 0，spec 同步不需要精确时间戳）
  header.write('00000000000', 136, 'ascii');
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
 * 读取 tar header 中的 NUL 结尾字符串字段（ASCII/UTF-8）。
 * 找到第一个 NUL 截断；无 NUL 则取整个 buf。
 */
function readTarString(buf: Buffer): string {
  const nul = buf.indexOf(0);
  const slice = nul < 0 ? buf : buf.subarray(0, nul);
  return slice.toString('utf-8');
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
 *   - leaseVersion 缺失（undefined/null）→ 返回 false（旧 lease / server-local 未透传
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
 * 仅更新 spec_version + synced_at（ISO 8601 UTC）。文件不存在时跳过（不主动创建——
 * 状态文件完整写入是 init lease writeDaemonState 的职责，本函数只在已初始化项目上
 * 保鲜版本号，避免半成品状态文件污染缓存目录）。
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
  let raw: string;
  try {
    raw = await readFile(statePath, 'utf-8');
  } catch {
    // 状态文件不存在（未初始化）→ 不主动创建，跳过（init lease writeDaemonState 负责）
    return;
  }
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    obj.spec_version = newVersion;
    obj.synced_at = new Date().toISOString();
    await writeFile(statePath, JSON.stringify(obj, null, 2) + '\n', 'utf-8');
  } catch (e) {
    console.warn('spec_sync: bump_local_spec_version_failed', specCacheRoot, newVersion, e);
  }
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
 * init lease 完整处理（design §5 / §9 生命周期：config_written → bundle_pulled → local_pushed）。
 *
 * 编排 4 步（顺序严格，任一硬失败即 abort）：
 *   1. **writeDaemonState**：写 2 字段 daemon 状态文件到 {resolveSpecDir(workspaceId)}/.runtime/。
 *      spec_version 取 latestSpecVersion（lease 下发）兜底 0。失败 → ok=false abort
 *      （状态文件是 daemon 保鲜基线，写失败后续保鲜失效，不降级）。D-001@v1：不再写 .sillyspec-platform.json。
 *   2. **pullSpecBundle**：拉服务器权威 spec 到本地缓存（~/.sillyhub/daemon/specs/<ws>）。
 *      内部含 task-12 pull 前回灌保护（hasUnsyncedLocalChanges）+ task-11 三分支 strategy。
 *      失败 → ok=false abort（pull 失败客户端无缓存可用，init 无意义）。404 容错在
 *      pullSpecBundle 内部已处理（首次 scan backend 无 bundle → mkdir 空目录，不算失败）。
 *   3. **postSpecSync**：若 pull 拿到 specDir 且本地有改动 → 回灌到服务器。失败**不 abort**
 *      （R-03：sync 失败仅 warn，状态文件已写、pull 缓存已就位，init 主体成功；
 *      本地改动下次任务前会再被 pull 前回灌保护触发重试，自愈）。
 *   4. 返回结果：specVersion = 状态文件落盘的 spec_version（= latestSpecVersion 兜底 0），
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
 * @param params init lease 参数（workspaceId / rootPath / serverOrigin / strategy / latestSpecVersion）
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

  // 步骤 1：写 daemon 状态文件（硬失败 abort）。D-001@v1：取代旧 writePlatformConfig。
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
      specDir: null,
    };
  }

  // 步骤 2：pullSpecBundle（硬失败 abort；404 容错在 utility 内已处理返回空 specDir）。
  let specDir: string | null = null;
  try {
    specDir = await pullSpecBundle(client, params.workspaceId, {
      strategy,
      rootPath: params.rootPath,
    });
  } catch (e) {
    // pull 失败（5xx / 网络 / SpecPushBeforePullError）→ init 主体失败。
    // 状态文件已写（步骤 1），但缓存不可用，complete 上报 failed 让前端引导重试。
    return {
      ok: false,
      specVersion,
      error: `spec_bundle_pull_failed: ${(e as Error)?.message ?? String(e)}`,
      daemonState,
      specDir: null,
    };
  }

  // 步骤 3：postSpecSync（软失败，R-03 不 abort）。仅 specDir 非空（pull 成功 / 404 空目录）
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

  // 步骤 4：返回成功（specVersion = 状态文件落盘值）。
  return {
    ok: true,
    specVersion: daemonState.spec_version,
    daemonState,
    specDir,
  };
}
