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
 * **非目标（design §3 / task-05 §6）**：
 *   - ❌ 不做文件内容读取（readFile / createReadStream）——FR-05 spec 走 bundle/sync。
 *   - ❌ 不做递归列举（depth 参数）——前端树形懒加载逐层展开。
 *   - ❌ 不做 hidden 文件过滤——返回全部 entries。
 *   - ❌ 不做 entries 体积上限——YAGNI，超大目录监控待性能问题出现再加。
 *
 * **已知限制（task-05 R-2）**：只校验 `path` 本身是否在 allowed_roots 内，
 * 不递归判定 readdir 出来的 symlink 是否指向 root 外。深层 symlink 沙箱属另一安全议题。
 *
 * @module file-rpc
 */

import { readdir, stat, lstat } from 'node:fs/promises';
import { resolve as pathResolve, sep } from 'node:path';
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
