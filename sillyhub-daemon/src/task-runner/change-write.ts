/**
 * task-runner/change-write.ts —— change-write 轻量分支的类型与路径校验。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * ChangeWriteFile / ChangeWriteCtx / ChangeWriteResult / validateChangeWritePath
 * 原样搬移（零改写）；runChangeWrite 编排本体保留在 facade 类内。
 *
 * @module task-runner/change-write
 */

import { isAbsolute } from 'node:path';

/**
 * task-11：change-write 待写入的单个文件（design §7.5 ``files[]{path, content}``）。
 *
 * ``path`` 通常相对于 spec_root（``changes/<changeKey>/...``，由 backend
 * proxy 下发）；兼容相对于 ``changes/<changeKey>/`` 的短路径。两种形态都会归一
 * 到 change 目录内相对路径，traversal 由 ``validateChangeWritePath`` 拦截。
 */
export interface ChangeWriteFile {
  path: string;
  content: string;
  /**
   * ql-20260816-002：kind=spec-sync 时 backend 透传的宿主仓库根（元信息，非待写文件）。
   * task-runner 据 presence 分流打包 <root_path>/.sillyspec；create/edit 恒无此字段。
   */
  root_path?: string;
}

/**
 * task-11：runChangeWrite 执行上下文。
 *
 * 字段来源：task-09 ``ChangeWriteClaimResponse``（claim 后拿到 claim_token + files）
 * 透传 runtimeId（仅日志/上下文用，不进 complete body）。
 */
export interface ChangeWriteCtx {
  /** DaemonChangeWrite.id（task-09 task_id）。 */
  taskId: string;
  /** change 标识（落到 changes/<changeKey>/ 子目录）。 */
  changeKey: string;
  /** workspace id（定位本地 spec 根 + sync 回灌）。 */
  workspaceId: string;
  /** claimChangeWrite 颁发的令牌（complete 校验）。 */
  claimToken: string;
  /** 待写入文件清单（path 相对 changes/<key>/，content utf-8）。 */
  files: ChangeWriteFile[];
  /**
   * 任务类型（2026-07-02-workspace-config-flow task-13 / D-012）：
   *   - ``create`` / ``edit``（默认）：写 changes/<key>/ 文件 + sync 回灌。
   *   - ``spec-sync``：整树回灌到服务器（postSpecSync），不写文件。
   * 缺省 ``create`` 与 backend ``DaemonChangeWrite.kind`` server_default 对齐。
   */
  kind?: string;
}

/** task-11：runChangeWrite 返回值（含 ok / 实际写入相对路径清单）。 */
export interface ChangeWriteResult {
  taskId: string;
  changeKey: string;
  ok: boolean;
  files: string[];
}

/**
 * task-11：change-write path traversal 四类校验（照搬 spec-sync.ts:230 范式）。
 *
 * 拒绝：
 *   1. ``path`` 含 ``..`` 段（防 ``foo/../../bar`` 越界）；
 *   2. ``path`` 是绝对路径（``/`` 开头）；
 *   3. ``path`` 含 Win 盘符（``[A-Za-z]:[\\/]``）；
 *   （第 4 类 join 后越界由调用方 ``relative`` 二次校验兜底。）
 *
 * 接受两种合法形态：
 *   - ``changes/<changeKey>/MASTER.md``（backend proxy 下发，path 相对 spec_root）
 *   - ``MASTER.md``（兼容旧测试/调用方，path 相对 changes/<changeKey>/）
 *
 * 其余 ``changes/<otherKey>/...``、绝对路径、Win 盘符、``..``/``.`` 段均拒绝。
 *
 * @returns 归一化后的 change 目录内相对路径（POSIX 分隔符，供写入和回执 files[]）
 */
export function validateChangeWritePath(
  filePath: string,
  changeKey: string,
): string {
  if (
    typeof filePath !== 'string' ||
    filePath === '' ||
    isAbsolute(filePath) ||
    /^[A-Za-z]:[\\/]/.test(filePath)
  ) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  const normalized = filePath.split('\\').join('/');
  if (normalized.endsWith('/')) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  const parts = normalized.split('/').filter((part) => part.length > 0);
  if (parts.length === 0 || parts.some((part) => part === '..' || part === '.')) {
    throw new Error(`change-write path traversal blocked: ${String(filePath)}`);
  }
  if (parts[0] === 'changes') {
    if (parts[1] !== changeKey || parts.length <= 2) {
      throw new Error(`change-write path outside change dir: ${String(filePath)}`);
    }
    return parts.slice(2).join('/');
  }
  return parts.join('/');
}
