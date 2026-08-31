/**
 * interactive-cwd-guard.ts —— daemon 交互会话 cwd 守卫纯函数
 * （2026-08-28-fix-cross-machine-worker-dispatch task-05 / FR-05 / NFR-01 / D-004@v1）。
 *
 * 背景：错机派发时 daemon 认领 interactive lease 后会在错误机器上无差别 mkdir
 * 启动分身会话（灾难性静默失败）。本模块为 workspace 绑定会话的 cwd 提供认领段
 * 终检判定（daemon.ts 接线归 task-06）：
 *   1. 白名单终检先行：复用 `assertWithinAllowedRoots`（file-rpc.ts）——与 host_fs
 *      通道同一 containment 口径（pathResolve 折叠、边界敏感前缀比较、Windows 盘符
 *      大小写归一、symlink/junction realpath 落点），不重写第二套口径；
 *   2. 再存在性检查：正确机器上 worktree 必已存在（host_fs RPC 在绑定机器先建），
 *      存在性即「对机」试金石；越界且不存在（双违反）时 forbidden 优先——
 *      白名单先查，与 task-06 daemon.ts 接线口径统一。
 *
 * 纯函数约束：无 IO、无状态、无新依赖——`exists` 由调用方（task-06 侧 stat）传入，
 * 函数内不做任何 fs 存在性判定、不 mkdir；错误码与中文 message 仅供 daemon 内部与
 * notifyRunResult result_summary 消费，不新增对外 RPC/协议字段。
 *
 * @module interactive-cwd-guard
 */

import { assertWithinAllowedRoots } from './file-rpc.js';
import { RpcError } from './ws-client.js';

// ── 类型定义 ─────────────────────────────────────────────────────────────────

/**
 * cwd 守卫判定结果（design.md 接口定义）。
 *
 * - `ok: true`：白名单与存在性双检全过，允许启动分身会话；
 * - `ok: false`：拒绝形态——`code` 取 `cwd_forbidden`（越白名单，含 roots 为空
 *   数组的兜底拒绝）或 `cwd_not_found`（目录不存在，daemon 拒绝自动创建），
 *   `message` 为中文可诊断文案（含 cwd 原文与原因），task-06 映射
 *   notifyRunResult result_summary。
 */
export type CwdGuardVerdict =
  | { ok: true }
  | { ok: false; code: 'cwd_forbidden' | 'cwd_not_found'; message: string };

// ── checkWorkspaceBoundCwd ───────────────────────────────────────────────────

/**
 * workspace 绑定会话的候选 cwd 守卫判定（认领段终检，纯函数）。
 *
 * 判定顺序（双违反时 forbidden 优先——白名单先查，plan 审查统一口径）：
 *   1. `workspaceRoot` 提供且 cwd 在工作区根内（ql-20260831-006：按工作区范围
 *      直接放行，复用 assertWithinAllowedRoots 同一 containment 口径）→ 跳过
 *      机器白名单，直接进步骤 3 存在性检查；
 *   2. `assertWithinAllowedRoots(cwd, roots)` 越界（其抛出的 code='forbidden'
 *      的 RpcError，含空 path / 空 roots / 越界三种拒绝路径）→ `cwd_forbidden`；
 *   3. `exists === false` → `cwd_not_found`；
 *   4. 双检全过 → `{ ok: true }`。
 *
 * ql-20260831-006（用户决策 2026-08-31）：工作区绑定会话的默认工作目录就在
 * 工作区内，机器白名单不该拦截它（生产实证：wp 机会话 84cf91ab 的工作区根
 * E:\sgm 不在机器白名单，主会话/分身全被 cwd_forbidden 拒）。错机派发保护由
 * 存在性检查承担（错机上工作区目录必不存在，cwd_not_found 拒绝）。
 *
 * @param cwd    workspace 绑定会话的候选 cwd（rawRootPath 为非空字符串的形态）
 * @param exists daemon 侧 stat 结果（由调用方传入，本函数不做 fs 判定）
 * @param roots  `_effectiveAllowedRoots()` 白名单（本机 config ∪ PolicyCache 全部 runtime 根）
 * @param workspaceRoot 本次派发的工作区根（lease rootPath；缺省走纯白名单口径）
 * @returns 三态判定结果；非 forbidden 的 RpcError 异常上抛（不吞异常掩盖缺陷）
 */
export function checkWorkspaceBoundCwd(
  cwd: string,
  exists: boolean,
  roots: string[],
  workspaceRoot?: string,
): CwdGuardVerdict {
  // 1. 工作区范围内直接放行（cwd 在工作区根内 → 跳过机器白名单，进步骤 3）。
  //    containment 判定复用 assertWithinAllowedRoots（pathResolve 折叠/边界敏感
  //    前缀比较/盘符大小写归一，与 host_fs 通道同一口径，不重写第二套）。
  let withinWorkspace = false;
  if (workspaceRoot) {
    try {
      assertWithinAllowedRoots(cwd, [workspaceRoot]);
      withinWorkspace = true;
    } catch (err) {
      if (!(err instanceof RpcError) || err.code !== 'forbidden') {
        throw err;
      }
      // cwd 不在工作区根内 → 回落机器白名单口径（步骤 2）。
    }
  }

  // 2. 白名单终检（仅 cwd 不在工作区范围内时执行）。
  if (!withinWorkspace) {
    try {
      assertWithinAllowedRoots(cwd, roots);
    } catch (err) {
      if (!(err instanceof RpcError) || err.code !== 'forbidden') {
        throw err;
      }
      return {
        ok: false,
        code: 'cwd_forbidden',
        message: `会话工作目录 ${cwd} 超出本机 allowed_roots 白名单，可能为错机派发或机器白名单配置变更，拒绝启动分身会话`,
      };
    }
  }

  // 3. 存在性检查（daemon 拒绝自动创建目录——错机上 cwd 必不存在，fail-loud）。
  if (!exists) {
    return {
      ok: false,
      code: 'cwd_not_found',
      message: `会话工作目录 ${cwd} 不存在，可能为错机派发或工作区绑定机器路径错配，daemon 拒绝自动创建目录，拒绝启动分身会话`,
    };
  }

  // 4. 全检通过。
  return { ok: true };
}
