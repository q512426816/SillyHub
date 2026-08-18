/**
 * `list_dir` RPC handler —— daemon 端文件 RPC 业务层（task-05 / FR-03 / FR-04）。
 *
 * 实现 design §5 Phase 2 的 daemon 端目录列举：
 *   1. 权限校验改调 `PolicyEngine.canRead(runtimeId, path)`（design §5.2 / task-18）：
 *      读操作默认全 allow、**不产 audit**（D-008 仅审计写类）。读自由语义不变，
 *      仅把数据源从「全局 config.allowed_roots」换成「per-runtime PolicyEngine」，
 *      并透传 runtimeId 供后续写类隔离裁决。policyEngine 为 null 时 fallback
 *      到旧的 `assertWithinAllowedRoots`（向后兼容，cli 未注入引擎的边界场景）。
 *   2. 目标必须存在且是目录：lstat 判定本体，避免 symlink 误穿透；不存在/非目录抛 `not_found`。
 *   3. readdir + 逐项 stat（follow symlink）：返回 `{ entries: [{ name, type }] }`。
 *
 * 与 ws-client.ts 的关系：本模块是**业务层**，由 daemon.ts 包装成 RpcHandler
 * 注册到 WsClient。ws-client 只负责收发/分发，不内嵌 fs 逻辑（design 职责分离）。
 *
 * 2026-08-18-workspace-file-browser（task-01）新增 explorer 只读系列：
 *   `explorerListDir` / `explorerReadFile` / `explorerSearch` —— 工作区文件浏览器链路
 *   （backend 按成员绑定的 root_path 透传 root，daemon 做 realpath 落点 + allowed_roots
 *   双重校验后才读盘；接口契约见该变更 design §7.1）。
 *
 * **非目标（listDir 语义不变；2026-08-18-workspace-file-browser 更新）**：
 *   - ❌ listDir 仍不做文件内容读取——读能力**仅经 `explorerReadFile` 暴露**。
 *      2026-06 旧变更「不读文件内容（FR-05 spec 走 bundle/sync）」的非目标已被本变更
 *      design §1/§7.1 显式推翻（spec 同步场景不读内容 ≠ 代码浏览场景不读内容），
 *      守卫测试同步改写为「listDir 不读内容、读能力只经 explorerReadFile」。
 *   - ❌ 不做递归列举（depth 参数）——前端树形懒加载逐层展开
 *      （explorerSearch 的递归遍历仅服务按名搜索，不构成递归列举通道）。
 *   - ❌ 不做 hidden 文件过滤——返回全部 entries。
 *   - ❌ 不做 entries 体积上限——YAGNI，超大目录监控待性能问题出现再加。
 *
 * **已知限制（task-05 R-2）**：只校验 `path` 本身是否在 allowed_roots 内，
 * 不递归判定 readdir 出来的 symlink 是否指向 root 外。深层 symlink 沙箱属另一安全议题
 * （explorer 系列的读取路径已由 realpath 落点校验覆盖该逃逸面，见该变更 design §3/R-01）。
 *
 * @module file-rpc
 */

import { readdir, stat, lstat, realpath, open } from 'node:fs/promises';
import { resolve as pathResolve, sep, basename } from 'node:path';
import type { Dirent } from 'node:fs';
import { RpcError } from './ws-client.js';
import type { PolicyEngine } from './policy/filesystem-policy.js';

// ── 类型定义（与 backend schema / 前端类型三端对齐）──────────────────────────

/**
 * 单条目录项。`type` 严格 `'dir' | 'file'`，不暴露 symlink/block/socket 等细分
 *（前端只做树形展示，YAGNI；与 backend task-04 schema、前端 task-11 类型一致）。
 */
export interface DirEntry {
  /** 条目名（不含父路径）。 */
  name: string;
  /** 类型：dir 优先展示，file 兜底（含 dangling symlink / stat 失败项）。 */
  type: 'dir' | 'file';
}

/**
 * `list_dir` 成功返回结构。与 design §7.1 / backend task-04 schema /
 * 前端 task-11 类型三端一致：只有 `entries` 一个键。
 */
export interface ListDirResult {
  entries: DirEntry[];
}

// ── assertWithinAllowedRoots（D-002 白名单校验）──────────────────────────────

/**
 * 校验 `path` 落在某个 `allowed_root` 之下（含等于 root 本身）。
 *
 * 防穿越策略（task-05 §5.5）：
 *   1. `pathResolve(path)` 折叠相对路径 / `..` 段（防 `..` 穿越 + 相对路径绕过）。
 *   2. 边界敏感前缀比较：`resolved === root` 或 `resolved.startsWith(root + sep)`，
 *      杜绝 `/home/user` 误匹配 `/home/user-evil`（兄弟撞名）。
 *   3. Windows 盘符大小写归一（NTFS 不区分大小写）：比较走 `toLowerCase`。
 *
 * @throws {RpcError} `code='forbidden'`：
 *   - path 为空 / 非字符串
 *   - allowed_roots 为空数组（task-02 保证非空，此处兜底防御）
 *   - resolved path 不在任何 root 之下
 */
export function assertWithinAllowedRoots(
  path: string,
  allowed_roots: string[],
): void {
  if (typeof path !== 'string' || path.length === 0) {
    throw new RpcError('forbidden', 'path is empty');
  }
  if (!Array.isArray(allowed_roots) || allowed_roots.length === 0) {
    // task-02 loadConfig 保证默认 [homedir()]，此处兜底防御（R-3 配置错误时直接拒）。
    throw new RpcError('forbidden', 'no allowed_roots configured');
  }
  const resolved = pathResolve(path);
  // Windows 平台判定：sep==='\\'（Node 在 win32 设置）；额外兜底盘符前缀形态。
  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(resolved);
  /** 大小写归一比较（仅 Windows；POSIX 大小写敏感不归一，R-3）。 */
  const eq = (a: string, b: string): boolean =>
    isWin ? a.toLowerCase() === b.toLowerCase() : a === b;
  /** 边界敏感「在 root 之下」判定。 */
  const under = (root: string): boolean => {
    const r = pathResolve(root);
    if (eq(resolved, r)) return true;
    // 必须以 `root + sep` 开头：避免 /home/user 匹配 /home/user-evil。
    return isWin
      ? resolved.toLowerCase().startsWith(r.toLowerCase() + sep)
      : resolved.startsWith(r + sep);
  };
  if (!allowed_roots.some(under)) {
    throw new RpcError('forbidden', `path outside allowed_roots: ${resolved}`);
  }
}

// ── listDir（readdir + stat + 排序）──────────────────────────────────────────

/**
 * 列举 `path` 下的一级子项（非递归）。
 *
 * 流程（task-05 §5.3）：
 *   1. `assertWithinAllowedRoots` 白名单校验。
 *   2. `lstat(path)` 判定目标必须是目录（lstat 不跟随 symlink，避免 symlink-to-file
 *      被当成目录误列举；非目录 → `not_found`，前端只期望列目录）。
 *   3. `readdir(path)` 拿一级子项名。
 *   4. 逐项 `stat(child)`（follow symlink）：symlink-to-dir 归 dir、symlink-to-file 归 file。
 *      单项 stat 失败（dangling symlink / 权限不足）→ 兜底 file + 不中断整体（B3/B4）。
 *   5. 排序：dir 优先，同类按 name 字符序（前端展示友好；YAGNI 不做 i18n）。
 *
 * @param path           客户端要浏览的目录（任意形态：相对/绝对/含 `..`）。
 * @param policyEngine   PolicyEngine 引用（task-11 注入）；非空时走 `canRead`（读全 allow、
 *                       不产 audit，D-008），仅透传 runtimeId 供后续写类隔离。
 * @param runtimeId      发起本次 list_dir 的 runtime id（从 RPC 上下文取，per-runtime 隔离）。
 * @param fallbackRoots  policyEngine 为 null 时的兜底白名单（向后兼容；cli 未注入引擎场景）。
 * @returns `{ entries: [...] }`；目录为空 → `entries: []`（非 error）。
 * @throws {RpcError} `code='forbidden'`（policyEngine 为 null 兜底场景下 path 越界 / 空 / roots 空）。
 * @throws {RpcError} `code='not_found'`（path 不存在 / 不是目录）。
 * @throws {RpcError} `code='internal'`（权限不足 / 其他 fs 错误）。
 */
export async function listDir(
  path: string,
  policyEngine: PolicyEngine | null,
  runtimeId: string,
  fallbackRoots: string[] = [],
): Promise<ListDirResult> {
  // 1. 权限校验（task-18 / design §5.2）：
  //    - policyEngine 非空：走 canRead（读全 allow，不 audit，D-008），仅透传 runtimeId。
  //    - policyEngine 为 null + fallbackRoots 非空：fallback 旧 assertWithinAllowedRoots。
  //    - policyEngine 为 null + fallbackRoots 空：跳过权限校验（目录浏览器，读自由）。
  if (policyEngine) {
    policyEngine.canRead(runtimeId, path);
  } else if (fallbackRoots.length > 0) {
    assertWithinAllowedRoots(path, fallbackRoots);
  }
  const abs = pathResolve(path);

  // 2. 目标必须存在且是目录。用 lstat 判定本体（不跟随 symlink）。
  let info;
  try {
    info = await lstat(abs);
  } catch (e) {
    throw toRpcError(e, 'listDir.lstat');
  }
  if (!info.isDirectory()) {
    // 文件 / 符号链接 / 特殊文件 → not_found（前端期望只列目录，B6）。
    throw new RpcError('not_found', `path is not a directory: ${path}`);
  }

  // 3. readdir 拿一级子项名。
  let names: string[];
  try {
    names = await readdir(abs);
  } catch (e) {
    throw toRpcError(e, 'listDir.readdir');
  }

  // 4. 逐项 stat（follow symlink）：symlink-to-dir 归 dir，符合树形浏览直觉。
  //    单项 stat 失败 → 兜底 file + 不中断（B3 dangling symlink / B4 权限不足）。
  const entries: DirEntry[] = [];
  for (const name of names) {
    const childAbs = pathResolve(abs, name);
    try {
      const s = await stat(childAbs); // stat 跟随 symlink
      entries.push({ name, type: s.isDirectory() ? 'dir' : 'file' });
    } catch {
      // 单项失败不影响整体列举（task-05 §5.3 step4 / B3 / B4）。
      entries.push({ name, type: 'file' });
    }
  }

  // 5. 稳定排序：dir 优先，同类 name 字符序（YAGNI：不做 i18n 排序）。
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return { entries };
}

// ── toRpcError（fs 错误码 → RpcError 映射）────────────────────────────────────

/**
 * 把 fs 错误映射成稳定的 RpcError code（task-05 §6 B2/B4）。
 *
 *   - ENOENT / ENOTDIR → `not_found`（path 不存在或路径某段不是目录）
 *   - EACCES / EPERM   → `internal`（权限不足；不暴露具体权限信息给前端，
 *     message 统一为 "permission denied"，避免信息泄漏）
 *   - 其他              → `internal`（原 message 透传，便于排查）
 *
 * `where` 前缀（如 `'listDir.lstat'`）便于日志定位。
 */
function toRpcError(e: unknown, where: string): RpcError {
  const code =
    typeof e === 'object' && e !== null && 'code' in e
      ? (e as { code: string }).code
      : '';
  if (code === 'ENOENT' || code === 'ENOTDIR') {
    return new RpcError('not_found', `${where}: not found`);
  }
  if (code === 'EACCES' || code === 'EPERM') {
    return new RpcError('internal', `${where}: permission denied`);
  }
  const msg = e instanceof Error ? e.message : String(e);
  return new RpcError('internal', `${where}: ${msg}`);
}

// ── explorer 系列（2026-08-18-workspace-file-browser design §5/§7.1）──────────

/** 文本预览读取上限（D-004@v1：10MB）。超限截断且**截断在 daemon 侧先于传输**（R-04，
 * 防 base64 膨胀逼近 WS maxPayload 造成 1009 断连）。 */
export const EXPLORER_MAX_READ_BYTES = 10 * 1024 * 1024;

/**
 * explorer_search 递归遍历时**整支跳过**的噪声目录名（仅 search 用；tree 全量返回，
 * design §5 关键安全设计第 5 点 / R-03 性能）。按目录名精确匹配（不递归、不命中匹配）。
 */
export const EXPLORER_EXCLUDED_NAMES: ReadonlySet<string> = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '__pycache__',
  '.next',
  '.venv',
  'venv',
  'target',
]);

/** explorer_search 结果数上限默认值（design §7.1「上限默认 100」）。 */
export const EXPLORER_DEFAULT_MAX_RESULTS = 100;

// ── explorer 类型（与 backend explorer schema / 前端三端对齐，design §7.1）────

/** explorer_list_dir 单条目录项。 */
export interface ExplorerDirEntry {
  /** 条目名（不含父路径）。 */
  name: string;
  /** 类型：dir 优先展示，file 兜底（含 dangling symlink，与 listDir 归类语义一致）。 */
  type: 'dir' | 'file';
  /** 字节数（stat 语义；目录为目录元数据大小）。 */
  size: number;
  /** 修改时间，ISO 8601 串（`new Date(mtime)` 可直接解析）。 */
  mtime: string;
}

/** explorer_list_dir 成功返回结构（design §7.1：只有 `entries` 一个键）。 */
export interface ExplorerListDirResult {
  entries: ExplorerDirEntry[];
}

/** explorer_read_file 成功返回结构（design §7.1）。 */
export interface ExplorerReadFileResult {
  /** 文件名（不含父路径；取 realpath 落点名，与 size/mtime/content 同一文件本体）。 */
  name: string;
  /** 原始文件大小（字节，未截断值）。 */
  size: number;
  /** 修改时间，ISO 8601 串。 */
  mtime: string;
  /** true=二进制（NUL 探测或严格 UTF-8 解码失败），此时 content 为 base64 兜底。 */
  binary: boolean;
  /** true=超过 EXPLORER_MAX_READ_BYTES，content 只含前 10MB（截断先于传输）。 */
  truncated: boolean;
  /** utf8 文本→原文（截断裁到有效多字节边界，不产生 U+FFFD）；二进制或
   * encoding='base64'→base64 串（download 链路强制，FR-03）。 */
  content: string;
}

/** explorer_search 单条命中（design §7.1）。 */
export interface ExplorerSearchMatch {
  /** 相对 root 的路径，统一 POSIX 风格 `/` 分隔（三平台行为一致，design §9）。 */
  path: string;
  /** 条目名。 */
  name: string;
  /** 类型（symlink 按真实落点归类，dangling 兜底 file）。 */
  type: 'dir' | 'file';
}

/** explorer_search 成功返回结构（design §7.1）。 */
export interface ExplorerSearchResult {
  matches: ExplorerSearchMatch[];
  /** true=达 maxResults 上限提前收敛，树中可能还有未遍历的命中。 */
  truncated: boolean;
}

// ── explorer 私有 helper ─────────────────────────────────────────────────────

/**
 * explorer 系列主防线（design §5 关键安全设计第 1 点，R-01）——两层校验都过才碰盘：
 *
 *   1. **realpath 落点校验**：`fs.realpath(path)` 与 `fs.realpath(root)` 双方解析符号
 *      链接后做边界敏感比较（相等或 `startsWith(realRoot + sep)`，杜绝兄弟撞名；
 *      Windows 盘符大小写归一）。root 本身是 symlink/junction 不误拒（双方都解析）；
 *      工作区内 symlink 指向 root 外 → 落点在 realRoot 外 → `forbidden`。
 *   2. **allowed_roots 白名单**：realpath 后路径再过 `assertWithinAllowedRoots`
 *      （roots 取 daemon `_effectiveAllowedRoots()` 现值；roots 条目也先 realpath 归一，
 *      允许白名单以 symlink/junction 形态配置而不误拒）。
 *
 * @returns realpath 后的绝对路径，供后续 fs 调用复用（不再二次解析）。
 * @throws {RpcError} `forbidden`（空参数 / realpath 落点在 root 外 / 不在 allowed_roots）。
 * @throws {RpcError} `not_found`（path 或 root 不存在，含 root 已删场景）。
 */
async function assertWithinExplorerRoot(
  path: string,
  root: string,
  roots: string[],
): Promise<string> {
  if (typeof path !== 'string' || path.length === 0) {
    throw new RpcError('forbidden', 'path is empty');
  }
  if (typeof root !== 'string' || root.length === 0) {
    throw new RpcError('forbidden', 'root is empty');
  }
  let realPath: string;
  try {
    realPath = await realpath(path);
  } catch (e) {
    // ENOENT → not_found（路径不存在；design §7.1 错误映射）。
    throw toRpcError(e, 'explorer.realpath(path)');
  }
  let realRoot: string;
  try {
    realRoot = await realpath(root);
  } catch (e) {
    throw toRpcError(e, 'explorer.realpath(root)');
  }
  // 边界敏感前缀比较（与 assertWithinAllowedRoots 同款语义，但双方都用 realpath 结果，
  // 覆盖「root 是 symlink/junction」与「path 借 symlink 逃出 root」两个方向）。
  const isWin = sep === '\\' || /^[A-Za-z]:[\\/]/.test(realPath);
  const norm = (p: string): string => (isWin ? p.toLowerCase() : p);
  const np = norm(realPath);
  const nr = norm(realRoot);
  if (np !== nr && !np.startsWith(nr + sep)) {
    throw new RpcError(
      'forbidden',
      `path escapes root after realpath: ${realPath} (root: ${realRoot})`,
    );
  }
  // 第二层：daemon 本地 allowed_roots 白名单。roots 条目先 realpath——
  // 白名单以 symlink/junction 形态配置时按真实落点比较（条目不存在则原样保留，
  // 边界比较必不中，等价于该 root 不生效）。
  const resolvedRoots = await Promise.all(
    roots.map(async (r) => {
      try {
        return await realpath(r);
      } catch {
        return r;
      }
    }),
  );
  assertWithinAllowedRoots(realPath, resolvedRoots);
  return realPath;
}

/** 严格 UTF-8 解码器（fatal：非法序列抛错而非产出 U+FFFD，用于二进制嗅探判定）。 */
const UTF8_FATAL_DECODER = new TextDecoder('utf-8', { fatal: true });

/**
 * 裁掉 UTF-8 截断窗口尾部**不完整**的多字节序列（最多 4 字节），用于：
 *   1. 严格解码不把「截断误切的合法文本」误判为二进制（task-01 验收）；
 *   2. `toString('utf8')` 不在末尾产生替换符 U+FFFD（乱码）。
 * 序列完整（截断点恰在字符边界）或数据本身非法 → 原样返回（非法性交给严格解码判 binary）。
 */
function trimIncompleteUtf8Tail(buf: Buffer): Buffer {
  let pos = buf.length;
  let contCount = 0;
  // 从尾部向前数连续的延续字节（10xxxxxx），最多 3 个（UTF-8 序列最长 4 字节）。
  while (
    contCount < 3 &&
    pos > 0 &&
    (buf[pos - 1]! & 0b1100_0000) === 0b1000_0000
  ) {
    pos--;
    contCount++;
  }
  if (pos === 0) return buf; // 全是延续字节：非法序列，交给严格解码判定
  const lead = buf[pos - 1] ?? 0;
  const expected =
    lead >= 0xf0 && lead <= 0xf4
      ? 3
      : lead >= 0xe0 && lead <= 0xef
        ? 2
        : lead >= 0xc2 && lead <= 0xdf
          ? 1
          : 0;
  // 领头字节期望的延续字节数不足（含「截断在领头字节后、0 个延续字节」形态）→ 裁掉领头字节。
  if (expected > contCount) {
    return buf.subarray(0, pos - 1);
  }
  return buf;
}

/**
 * 二进制嗅探（design §7.1 explorer_read_file）：
 *   1. 窗口含 NUL 字节 → 二进制（文本文件几乎不可能含 0x00）；
 *   2. 严格 UTF-8 解码失败 → 二进制。
 * `decodeTarget` 为已裁过截断边界的窗口（truncated 时由调用方先 trim）。
 */
function isBinaryBuffer(raw: Buffer, decodeTarget: Buffer): boolean {
  if (raw.includes(0)) return true;
  try {
    UTF8_FATAL_DECODER.decode(decodeTarget);
    return false;
  } catch {
    return true;
  }
}

/**
 * 搜索命中项类型判定：dirent 本体判目录；symlink/junction 单独 stat 解析真实类型
 * （仅对命中项 stat，控制 R-03 开销；dangling / stat 失败兜底 file）。
 */
async function resolveSearchEntryType(
  parentAbs: string,
  d: Dirent,
): Promise<'dir' | 'file'> {
  if (d.isDirectory()) return 'dir';
  if (!d.isSymbolicLink()) return 'file';
  try {
    return (await stat(pathResolve(parentAbs, d.name))).isDirectory()
      ? 'dir'
      : 'file';
  } catch {
    return 'file';
  }
}

// ── explorerListDir（只列一层，非递归）──────────────────────────────────────

/**
 * 列举工作区目录 `path` 下的一级子项（含 size/mtime；只列一层）。
 *
 * 流程（design §5/§7.1，task-01）：
 *   1. `assertWithinExplorerRoot` 双重校验（realpath 落点 + allowed_roots）。
 *   2. lstat 判定必须是目录（abs 已 realpath，lstat/stat 等价；非目录 → `not_found`）。
 *   3. readdir 逐项 stat（follow symlink，与 listDir 归类语义一致）取 size/mtime；
 *      stat 失败（dangling symlink）→ lstat 兜底取链接自身元数据；两级都失败
 *      （竞态消失）→ 跳过该项，不伪造数据。
 *   4. 排序：dir 优先，同类按 name 字符序（与 listDir 一致）。
 *
 * @param path  要浏览的目录（绝对路径；相对形态由 realpath 解析后裁决）。
 * @param root  本次浏览的工作区根（backend 按成员绑定 root_path 透传）。
 * @param roots daemon allowed_roots 现值（`_effectiveAllowedRoots()`）。
 * @returns `{ entries: [{ name, type, size, mtime }] }`；空目录 → `entries: []`。
 * @throws {RpcError} `forbidden`（越界/空参数）/ `not_found`（不存在或非目录）/ `internal`。
 */
export async function explorerListDir(
  path: string,
  root: string,
  roots: string[],
): Promise<ExplorerListDirResult> {
  const abs = await assertWithinExplorerRoot(path, root, roots);

  let info;
  try {
    info = await lstat(abs);
  } catch (e) {
    throw toRpcError(e, 'explorerListDir.lstat');
  }
  if (!info.isDirectory()) {
    throw new RpcError('not_found', `path is not a directory: ${path}`);
  }

  let names: string[];
  try {
    names = await readdir(abs);
  } catch (e) {
    throw toRpcError(e, 'explorerListDir.readdir');
  }

  const entries: ExplorerDirEntry[] = [];
  for (const name of names) {
    const childAbs = pathResolve(abs, name);
    let s;
    try {
      s = await stat(childAbs); // stat 跟随 symlink（symlink→dir 归 dir）
    } catch {
      try {
        s = await lstat(childAbs); // dangling symlink：取链接自身元数据
      } catch {
        continue; // 竞态消失（列举瞬间被删）：跳过，不伪造 size/mtime
      }
    }
    entries.push({
      name,
      type: s.isDirectory() ? 'dir' : 'file',
      size: s.size,
      mtime: s.mtime.toISOString(),
    });
  }

  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });

  return { entries };
}

// ── explorerReadFile（限读取上限字节，截断先于传输）─────────────────────────

/**
 * 读取工作区文件 `path` 内容（只读，限 EXPLORER_MAX_READ_BYTES=10MB）。
 *
 * 流程（design §5/§7.1，task-01；D-004@v1 截断 10MB、R-04 截断先于传输）：
 *   1. `assertWithinExplorerRoot` 双重校验。
 *   2. stat 拿原始 size/mtime；非普通文件（目录/设备等）→ `not_found`。
 *   3. `open + read` 定长读前 min(size, 10MB) 字节——**不整读大文件入内存**，
 *      超限置 `truncated=true`。
 *   4. 编码裁决：
 *      - `encoding='utf8'`（默认）：NUL 探测 + 严格 UTF-8 解码嗅探二进制；
 *        二进制 → `binary=true` + content 转 base64 兜底（不报错）；文本 → 原文。
 *        truncated 时先裁掉尾部不完整多字节序列再解码/转串——截断误切不得误判
 *        binary、不得在 content 末尾产生 U+FFFD 乱码。
 *      - `encoding='base64'`（download 链路强制，FR-03）：content 直接 base64
 *        （字节精确，用未裁剪的原始窗口）；binary 嗅探结果照实返回。
 *
 * @param path     要读的文件（绝对路径）。
 * @param root     本次浏览的工作区根。
 * @param roots    daemon allowed_roots 现值。
 * @param encoding `'utf8'`（默认）| `'base64'`。
 * @returns `{ name, size, mtime, binary, truncated, content }`（name 取 realpath
 *          落点名，与 size/mtime/content 描述同一文件本体）。
 * @throws {RpcError} `forbidden` / `not_found`（不存在、非普通文件）/ `internal`。
 */
export async function explorerReadFile(
  path: string,
  root: string,
  roots: string[],
  encoding: 'utf8' | 'base64' = 'utf8',
): Promise<ExplorerReadFileResult> {
  const abs = await assertWithinExplorerRoot(path, root, roots);

  let st;
  try {
    st = await stat(abs);
  } catch (e) {
    throw toRpcError(e, 'explorerReadFile.stat');
  }
  if (!st.isFile()) {
    throw new RpcError('not_found', `path is not a regular file: ${path}`);
  }

  const truncated = st.size > EXPLORER_MAX_READ_BYTES;
  const readLen = truncated ? EXPLORER_MAX_READ_BYTES : st.size;

  // open + read 只读上限字节（不 readFile 整读大文件）；截断在 daemon 侧先于传输（R-04）。
  let data: Buffer;
  try {
    const fh = await open(abs, 'r');
    try {
      const buf = Buffer.alloc(readLen);
      const { bytesRead } = await fh.read(buf, 0, readLen, 0);
      data = buf.subarray(0, bytesRead);
    } finally {
      await fh.close();
    }
  } catch (e) {
    throw toRpcError(e, 'explorerReadFile.read');
  }

  // truncated 时先裁掉尾部不完整多字节序列：嗅探不误判 + 文本 content 不产生 U+FFFD。
  const decodeBuf = truncated ? trimIncompleteUtf8Tail(data) : data;
  const binary = isBinaryBuffer(data, decodeBuf);
  let content: string;
  if (encoding === 'base64' || binary) {
    // base64 用原始窗口（字节精确，download 语义）；截断边界裁剪仅作用于 utf8 文本转串。
    content = data.toString('base64');
  } else {
    content = decodeBuf.toString('utf8');
  }

  return {
    name: basename(abs),
    size: st.size,
    mtime: st.mtime.toISOString(),
    binary,
    truncated,
    content,
  };
}

// ── explorerSearch（按名递归搜索，纯 Node fs，三平台一致）──────────────────

/**
 * 在工作区 `root` 全树按**名字**递归搜索（大小写不敏感子串；不做内容 grep，D-005@v1）。
 *
 * 流程（design §5/§7.1，task-01；R-03 性能）：
 *   1. root 自身过 `assertWithinExplorerRoot` 双重校验；空 query / 非法 maxResults
 *      → `forbidden`（与 assertWithinAllowedRoots 对空 path 的 forbidden 语义对齐）。
 *   2. 纯 Node `fs` 递归遍历（不 shell out，Win/Mac/Linux 行为一致，design §9）：
 *      `readdir { withFileTypes: true }` 单遍拿名字+类型（避免逐项 stat 双开销）；
 *      目录名排序保证遍历顺序确定；单目录读失败 → 跳过该子树不中断整体。
 *   3. `EXPLORER_EXCLUDED_NAMES` 命中的目录**整支跳过**（不匹配、不递归；仅 search
 *      排除，tree 全量返回——design §5 第 5 点）。symlink/junction 不跟随递归
 *      （防环；其命中类型按真实落点 stat 归类，dangling 兜底 file）。
 *   4. 名字匹配（`name.toLowerCase().includes(query.toLowerCase())`）→ 收集命中，
 *      `path` 相对 root 用 POSIX `/` 分隔；命中数达 `maxResults` 即停并置
 *      `truncated=true`（若恰在遍历自然结束时达上限，说明树上已无未遍历内容，
 *      此时 truthfully 返回 `truncated=false`）。
 *
 * @param root       搜索起点（=工作区根，绝对路径）。
 * @param query      关键词（非空，大小写不敏感子串匹配文件名/目录名）。
 * @param roots      daemon allowed_roots 现值。
 * @param maxResults 结果上限（默认 EXPLORER_DEFAULT_MAX_RESULTS=100）。
 * @returns `{ matches: [{ path, name, type }], truncated }`。
 * @throws {RpcError} `forbidden`（空 query / 非法 maxResults / root 越界）、
 *                   `not_found`（root 不存在）/ `internal`。
 */
export async function explorerSearch(
  root: string,
  query: string,
  roots: string[],
  maxResults: number = EXPLORER_DEFAULT_MAX_RESULTS,
): Promise<ExplorerSearchResult> {
  if (typeof query !== 'string' || query.length === 0) {
    throw new RpcError('forbidden', 'query is empty');
  }
  if (
    typeof maxResults !== 'number' ||
    !Number.isInteger(maxResults) ||
    maxResults <= 0
  ) {
    throw new RpcError('forbidden', `invalid maxResults: ${String(maxResults)}`);
  }
  const realRoot = await assertWithinExplorerRoot(root, root, roots);

  const queryLower = query.toLowerCase();
  const matches: ExplorerSearchMatch[] = [];
  let truncated = false;

  const walk = async (absDir: string, relDir: string): Promise<void> => {
    let dirents: Dirent[];
    try {
      dirents = await readdir(absDir, { withFileTypes: true });
    } catch {
      return; // 单目录读失败（权限/竞态消失）→ 跳过该子树，不中断整体
    }
    // 名字排序：遍历顺序确定（测试可复现、上游分页语义稳定）。
    dirents.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    for (const d of dirents) {
      if (matches.length >= maxResults) {
        truncated = true; // 提前收敛：仍有未遍历内容
        return;
      }
      if (EXPLORER_EXCLUDED_NAMES.has(d.name)) continue; // 噪声目录整支跳过
      const rel = relDir === '' ? d.name : `${relDir}/${d.name}`;
      if (d.name.toLowerCase().includes(queryLower)) {
        matches.push({
          path: rel,
          name: d.name,
          type: await resolveSearchEntryType(absDir, d),
        });
      }
      // 只递归真实目录；symlink/junction 不跟随（防环 + 防越 root 递归）。
      if (d.isDirectory()) {
        await walk(pathResolve(absDir, d.name), rel);
      }
    }
  };

  await walk(realRoot, '');
  return { matches, truncated };
}
