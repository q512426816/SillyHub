/**
 * `list_roots` RPC handler —— daemon 端磁盘根列举业务层（task-01 / FR-1 / D-001）。
 *
 * 用途：供前端「远程文件夹选择器」拿到「这台机器上有哪些磁盘根」作为浏览起点。
 * 与 `list_dir`（file-rpc.ts）语义分离：
 *   - `list_dir` 列举「某个目录下的子项」，需要客户端先给一个起点路径；
 *   - `list_roots` 回答「起点本身是什么」——Windows 是各盘符根，Unix 是单一的 `/`。
 *   前端流程：先 `list_roots` 拿起点 → 再 `list_dir` 逐层展开（design §7.1）。
 *
 * 跨平台差异：
 *   - Windows：枚举 `A:\` ~ `Z:\`，用 `existsSync` 同步探测存在的盘符，返回**带尾部反斜杠**
 *     的根（如 `C:\`、`D:\`），与 ql-20260702-007 pathResolve 后根已含尾 sep 的约定一致，
 *     避免下游拼接路径时缺分隔符（`C:` + `Users` ≠ `C:\Users`）。
 *   - Linux/macOS：单一文件系统树，返回 `['/']`。
 *
 * **非目标**：
 *   - ❌ 不做权限/白名单校验——根列表本身不涉敏感数据，且 `list_dir` 已对后续浏览做沙箱校验
 *     （file-rpc.ts assertWithinAllowedRoots）。根列举是「展示」，不是「放行」。
 *   - ❌ 不做挂载点枚举（Unix `mounts`、`df`）——YAGNI，Unix 下 `/` 已是合法浏览起点，
 *     挂载点细节待真实需求出现再加。
 *   - ❌ 不做盘符卷标/容量/类型（可移动/网络）等元数据——前端只做路径导航。
 *
 * **已知限制（R-x）**：
 *   - ❌ 不枚举 UNC 网络路径（`\\host\share`）——Windows 网络盘通常也映射成盘符，
 *     未映射的 UNC 无法用 `A:\~Z:\` 探测覆盖；如需支持需另走 `GetLogicalDriveStrings`
 *     原生 API，超出 task-01 范围。
 *   - ❌ 单盘探测仅靠 `existsSync`，无法区分「盘符保留但无介质」（如空光驱）——
 *     实测这类盘符 `existsSync` 通常返回 false，会被跳过，符合预期。
 *
 * @module roots-rpc
 */

import { existsSync } from 'node:fs';
import { platform } from 'node:os';

// ── 类型定义（与 backend schema / 前端类型三端对齐）──────────────────────────

/**
 * `list_roots` 成功返回结构。与 design §7.1 / backend schema / 前端类型三端一致：
 * 只有一个 `roots` 键，元素为 OS 原生根路径（带尾部分隔符）。
 */
export interface ListRootsResult {
  /** 磁盘根列表，每项带 OS 原生尾部分隔符（Windows `\`，Unix `/`）。 */
  roots: string[];
}

// ── listRoots（跨平台磁盘根枚举）──────────────────────────────────────────────

/**
 * 列举当前机器可浏览的磁盘根，供前端文件夹选择器作为浏览起点。
 *
 * 平台分支：
 *   - Windows（`platform() === 'win32'`）：遍历 `A:\` ~ `Z:\`，逐个 `existsSync` 探测，
 *     收集存在的盘符（带尾 `\`）。单盘探测 try/catch 包裹，失败则跳过该盘不中断枚举
 *     （防御个别盘符 `existsSync` 抛错，如权限异常的保留盘符）。
 *   - Linux/macOS：固定返回 `['/']`（POSIX 单一文件系统树）。
 *
 * 整体兜底：外层 try/catch 捕获未预期异常（全盘探测失败等），返回 `{ roots: [] }`
 * **不向上抛**——根列举失败不应阻断前端初始化，前端拿到空数组自行降级（如用
 * homedir 作为默认起点）。与 file-rpc.ts 的 RpcError 风格一致：内部错误经 RpcError
 * 映射后吞掉，保证调用方拿到稳定结果结构。
 *
 * @returns `{ roots: [...] }`；探测全失败时 `roots: []`（不抛异常）。
 */
export async function listRoots(): Promise<ListRootsResult> {
  // 整体兜底：任何未预期异常都不向上抛，降级为空数组（保证返回结构稳定）。
  try {
    if (platform() === 'win32') {
      return { roots: listWindowsDrives() };
    }
    // Linux/macOS：POSIX 单一文件系统树，根恒为 '/'。
    return { roots: ['/'] };
  } catch (e) {
    // 不抛：根列举失败时前端降级（空数组）。落一条 warn 日志便于排查，保证返回结构稳定。
    console.warn('listRoots fallback: returning empty roots:', e);
    return { roots: [] };
  }
}

// ── listWindowsDrives（A:\ ~ Z:\ 盘符枚举，内部辅助）──────────────────────────

/**
 * 枚举 Windows 下存在的盘符根（`A:\` ~ `Z:\`）。
 *
 * 实现细节：
 *   - 盘符范围 `A`~`Z`（大写 ASCII，`A` = 65、`Z` = 90）。
 *   - 每个盘符拼成 `X:\`（带尾反斜杠），`existsSync` 同步探测。
 *   - 单盘 try/catch：个别盘符探测抛错（权限异常等）跳过该盘，不中断整体枚举。
 *   - 返回项带尾 `\`，与 ql-20260702-007（pathResolve 后根含尾 sep）约定一致。
 *
 * @returns 存在的盘符根数组（如 `['C:\\', 'D:\\']`），全部不存在时为 `[]`。
 */
function listWindowsDrives(): string[] {
  const roots: string[] = [];
  // A(65) ~ Z(90)：标准盘符范围；超出范围的盘符 Windows 不支持。
  for (let code = 65; code <= 90; code++) {
    const drive = `${String.fromCharCode(code)}:\\`;
    try {
      if (existsSync(drive)) {
        roots.push(drive);
      }
    } catch {
      // 单盘探测失败（权限异常等）：跳过该盘，不中断枚举（acceptance「单盘失败不中断」）。
      continue;
    }
  }
  return roots;
}
