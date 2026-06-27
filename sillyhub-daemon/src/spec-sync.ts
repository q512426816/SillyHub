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
// D-007@v1（utility 抽离）；蓝图 task-04.md。

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
export async function packSpecDir(specDir: string): Promise<Buffer> {
  const chunks: Buffer[] = [];
  const entries = await walkDir(specDir);
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
async function walkDir(root: string): Promise<WalkEntry[]> {
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
