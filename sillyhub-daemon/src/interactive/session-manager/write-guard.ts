/**
 * interactive/session-manager/write-guard.ts —— 写守卫/策略判定簇。
 *
 * task-02（2026-09-07-arch-large-file-split）：原 SessionManager 的
 * registerBorrowSandbox / getBorrowSandboxRoot / _clearBorrowSandbox /
 * _wrapWithWriteGuard / _sessionOverlayRoots / _judgeWriteViaPolicyEngine /
 * _extractWritePathsForTool / _shellKindOfTool /
 * _buildWriteOnlyCanUseToolCallback 方法体原样下沉（仅 ``this`` → ``mgr``
 * 改显式传参，行为零变化）。
 *
 * @module interactive/session-manager/write-guard
 */

import type { InteractiveProvider } from '../driver.js';
import {
  isPathUnderAnyRoot,
  resolveRealPath,
  UNC_REJECTED,
} from '../../policy/path-utils.js';
import {
  extractShellWritePaths,
  type ShellKind,
} from '../../policy/shell-paths.js';
import type { CanUseToolFn, SessionManagerCore } from './types.js';

/**
 * task-09 / D-007@v2（候选 B 主路径）：登记一个借用 session 的沙箱根目录。
 *
 * daemon ``_startInteractiveSession`` 检测 lease rootPath 上的
 * ``borrow-sandbox:<slug>`` marker 后调本方法：把 daemon 经 ``prepareWorkspace(slug)``
 * 创建的真实沙箱目录绝对路径登记到本 session。
 *
 * 登记后 ``_judgeWriteViaPolicyEngine`` 对本 session 的写校验**只允许落沙箱内**，
 * 不再查 PolicyEngine 的 runtime 缓存（避免命中 lender 的 allowed_roots 继承开发代码
 * 区写权限）。未登记的 session 走原有 runtime policy（开发人员自有任务零回归）。
 *
 * 幂等：重复登记覆盖旧值（daemon WS 重放时安全）。沙箱路径为空 → 不登记（退化到
 * runtime policy，fail-open 不卡 session）。
 */
export function registerBorrowSandbox(
  mgr: SessionManagerCore,
  sessionId: string,
  sandboxRoot: string,
): void {
  if (!sessionId || !sandboxRoot) return;
  mgr._borrowSandboxRoots.set(sessionId, sandboxRoot);
}

/** task-09：查询本 session 是否登记为借用沙箱（测试 + 内部写守卫用）。 */
export function getBorrowSandboxRoot(
  mgr: SessionManagerCore,
  sessionId: string,
): string | undefined {
  return mgr._borrowSandboxRoots.get(sessionId);
}

/** task-09：从借用沙箱注册表移除（end/fail/consume 退出时调，幂等）。 */
export function clearBorrowSandbox(
  mgr: SessionManagerCore,
  sessionId: string,
): void {
  mgr._borrowSandboxRoots.delete(sessionId);
}

/**
 * interactive CC 写拦截（2026-06-29）+ task-14（design §5.2 PolicyEngine）：
 * 包装一层写工具白名单前置守卫。
 *
 * **task-14 主路径（policyEngine 注入）**：
 *   - 写工具（Write/Edit/MultiEdit）：取 file_path/path，调
 *     `policyEngine.canWrite(runtimeId, path, provider, toolName)`；
 *   - Shell 工具（Bash/PowerShell/CMD）：经 policy/shell-paths 的
 *     `extractShellWritePaths(command, shell)` 提取写目标路径，逐条 canWrite，
 *     任一 deny 即拒绝（reason 取首个 deny）；
 *   - task-12（D-011）：state.effectiveAllowedRoots 非空时先做 session 级
 *     overlay 交集收紧（`_judgeWriteViaPolicyEngine` 内判定）；
 *   - deny → 返回 decision.reason（PolicyEngine 统一中文文案，含 provider/路径/原因）；
 *   - allow / 非写工具 / 提取不到写路径 → 交内层 callback（approvalReady=true 走
 *     远程人审；false 走直接 allow）。
 *
 * **fallback 路径（policyEngine 未注入，向后兼容 / 测试）**：复用旧
 * `allowedRootsProvider + isWriteWithinAllowedRoots` 语义。task-15 删 write-guard.ts
 * 时清理（届时 cli.ts 生产路径必注入 policyEngine）。
 *
 * @param sessionId  当前 session（runtimeIdProvider 闭包查询用）。
 * @param provider   session 归属 provider（透传 PolicyEngine.canWrite 第三参数）。
 * @param inner      内层 canUseTool（写校验通过后调用的真实审批 / allow 逻辑）。
 */
export function wrapWithWriteGuard(
  mgr: SessionManagerCore,
  sessionId: string,
  provider: InteractiveProvider,
  inner: CanUseToolFn,
): CanUseToolFn {
  return async (
    toolName: string,
    toolInput: Record<string, unknown>,
    options: Parameters<CanUseToolFn>[2],
  ): ReturnType<CanUseToolFn> => {
    // task-14 主路径：policyEngine 注入 → 走 canWrite（按 runtimeId 隔离 + 中文文案 + audit）。
    if (mgr._policyEngine) {
      const deny = judgeWriteViaPolicyEngine(
        mgr,
        sessionId,
        provider,
        toolName,
        toolInput,
      );
      if (deny) {
        return { behavior: 'deny', message: deny };
      }
      return inner(toolName, toolInput, options);
    }
    // fallback（policyEngine 未注入，向后兼容 / 测试）：复用与主路径相同的路径提取
    // （policy/shell-paths）+ isPathUnderAnyRoot 边界校验（迁移自 write-guard.ts，
    // task-15 删 write-guard.ts）。allowedRootsProvider 空数组 → 视为未启用放行。
    //
    // task-10（C-12 / D-013 / FR-11）：profile.effectiveAllowedRoots 存在则替代
    // provider 值，∩ 物理 provider 兜底（防 backend 算的 effective 含已失效/越界路径；
    // backend 服务端已校验 overlay⊆daemon_roots，这里仅防御 stale 缓存）。provider
    // 为空（未注入）时直接信任 effective（backend 已是 daemon∩overlay 的权威交集）。
    // effective undefined/空 → 用原 provider 值（FR-15 行为同今天）。roots 计算已抽
    // _sessionOverlayRoots 共享 helper（task-12，policyEngine 分支同判定）。
    const providerRoots = mgr._allowedRootsProvider?.() ?? [];
    const overlayRoots = sessionOverlayRoots(mgr, sessionId);
    const roots = overlayRoots ?? providerRoots;
    if (roots.length > 0) {
      const writePaths = extractWritePathsForTool(mgr, toolName, toolInput);
      const outside = writePaths.find((p) => !isPathUnderAnyRoot(p, roots));
      if (outside !== undefined) {
        return {
          behavior: 'deny',
          message: `path outside allowed_roots: ${outside}`,
        };
      }
    }
    return inner(toolName, toolInput, options);
  };
}

/**
 * task-12（2026-08-28-daemon-agent-share / D-011）：解析 session 级 overlay 写
 * roots——写守卫两个分支（policyEngine 主路径 / allowedRootsProvider fallback）
 * 的共享判定，从 task-10（C-12 / D-013）fallback 块原样抽出。
 *
 * 语义：``state.effectiveAllowedRoots`` 非空时返回 overlay roots = effective ∩
 * 物理 provider 兜底（``allowedRootsProvider`` 未注入/为空 → 直接信任 effective，
 * backend 已是权威交集；注入则滤掉越出物理边界的 stale 路径）。
 *
 * @returns null = 会话无 effectiveAllowedRoots（undefined/空数组，FR-15 用物理
 *   provider 值，行为同今天）；非 null = overlay 生效的 roots（可能为空数组 =
 *   effective 全被 provider 兜底滤掉——fallback 沿用「空 = 未启用」跳过检查，
 *   policyEngine 路径按交集语义任何路径都不命中 → deny，只收紧）。
 */
export function sessionOverlayRoots(
  mgr: SessionManagerCore,
  sessionId: string,
): string[] | null {
  const stateForRoots = mgr._store.get(sessionId);
  const effectiveRoots = stateForRoots?.effectiveAllowedRoots;
  if (!effectiveRoots || effectiveRoots.length === 0) return null;
  const providerRoots = mgr._allowedRootsProvider?.() ?? [];
  return providerRoots.length > 0
    ? effectiveRoots.filter((p) => isPathUnderAnyRoot(p, providerRoots))
    : effectiveRoots;
}

/**
 * task-14（design §5.1.3 / §5.2）：经 PolicyEngine 校验一次工具调用的写路径。
 *
 * 提取写目标路径（Write/Edit/MultiEdit 取 file_path/path；Bash/PowerShell/CMD
 * 经 extractShellWritePaths），逐条 `canWrite(runtimeId, path, provider, tool)`。
 * 任一 deny 即返回首个 deny 的 reason（统一中文文案）；全 allow / 无写路径返回 null。
 *
 * task-12（D-011 / spike-02 结论 B 修复）：借用沙箱分支之后、PolicyCache 循环
 * 之前插入 session 级 overlay 交集收紧——effectiveAllowedRoots 非空的会话写路径
 * 必须同时落 session roots 与 PolicyCache roots（见 `_sessionOverlayRoots`）。
 * 无该字段的会话零行为变化。
 *
 * runtimeId 由 runtimeIdProvider 闭包解析（daemon._registeredRuntimes.get(provider)）；
 * 解析为空串时 PolicyCache 未命中 → fail-closed deny（design D-007）。
 *
 * @returns deny 的 reason 字符串；null = 放行（交内层）。
 */
export function judgeWriteViaPolicyEngine(
  mgr: SessionManagerCore,
  sessionId: string,
  provider: InteractiveProvider,
  toolName: string,
  toolInput: Record<string, unknown>,
): string | null {
  const engine = mgr._policyEngine;

  // 提取写目标路径。
  const writePaths = extractWritePathsForTool(mgr, toolName, toolInput);
  if (writePaths.length === 0) return null; // 非写工具 / 提取不到 → 放行

  // task-09 / D-007@v2（候选 B 主路径）：借用 session 按 lease 隔离只读沙箱 root。
  // **不查 PolicyEngine runtime 缓存**——缓存键是 lender runtime_id，allowed_roots 是
  // lender 代码区，借用 agent 命中即继承 lender 写权限（R-02 核心坑）。借用 session
  // 只允许写沙箱目录内，沙箱外（含 lender 代码区）一律 deny。登记见
  // ``registerBorrowSandbox``（daemon _startInteractiveSession 检测 marker 后调）。
  const borrowRoot = mgr._borrowSandboxRoots.get(sessionId);
  if (borrowRoot) {
    for (const p of writePaths) {
      const np = resolveRealPath(p);
      if (np === UNC_REJECTED) {
        return (
          `借用任务沙箱隔离拒绝写入。\n` +
          `Agent：${provider}\n` +
          `目标路径：${p}\n` +
          `原因：UNC 路径（\\\\server\\share）不允许写入。`
        );
      }
      if (!isPathUnderAnyRoot(np, [borrowRoot])) {
        return (
          `借用任务沙箱隔离拒绝写入。\n` +
          `Agent：${provider}\n` +
          `目标路径：${np}\n` +
          `原因：借用 agent 仅可写沙箱目录（${borrowRoot}），不可写开发代码区。`
        );
      }
    }
    return null; // 全部落沙箱内 → 放行（交内层 allow / 审批）
  }

  // task-12（2026-08-28-daemon-agent-share / D-011 / spike-02 结论 B 修复）：
  // session 级 overlay 交集收紧——state.effectiveAllowedRoots 非空时（platform
  // 共享会话 backend 注入 [writable_dir]，沿 _borrowSandboxRoots per-session 先例），
  // 写路径必须**同时**满足：① 落在 session roots（_sessionOverlayRoots 共享
  // helper，与 fallback 块同判定）② 下方 PolicyCache canWrite 不 deny。只收紧
  // 不放宽：session roots 不命中 → deny（本块新增强制）；命中但 PolicyCache
  // deny → 仍 deny（下方循环，session roots 不得绕过机器级边界）。无该字段的
  // 会话 overlay=null → 跳过本块，行为逐字节不变（D-011 Non-Goal 边界）。
  const overlayRoots = sessionOverlayRoots(mgr, sessionId);
  if (overlayRoots !== null) {
    const outsideOverlay = writePaths.find(
      (p) => !isPathUnderAnyRoot(p, overlayRoots),
    );
    if (outsideOverlay !== undefined) {
      return `path outside allowed_roots: ${outsideOverlay}`;
    }
  }

  if (!engine) return null;

  const runtimeId = mgr._runtimeIdProvider?.(provider) ?? '';
  const tool = toolName; // PolicyEngine audit 字段（Write/Edit/Bash/...）。
  for (const p of writePaths) {
    const decision = engine.canWrite(runtimeId, p, provider, tool);
    if (!decision.allowed) {
      // 取首个 deny 的 reason（PolicyEngine 已组装中文文案）。
      return decision.reason;
    }
  }
  return null;
}

/**
 * task-14：从工具入参提取写目标路径。
 *
 *   - Write/Edit/MultiEdit：取 file_path / path；
 *   - Bash：extractShellWritePaths(command, 'bash')；
 *   - PowerShell：extractShellWritePaths(command, 'powershell')；
 *   - CMD：extractShellWritePaths(command, 'cmd')；
 *   - 其余工具 → []（读自由，不拦）。
 */
export function extractWritePathsForTool(
  mgr: SessionManagerCore,
  toolName: string,
  toolInput: Record<string, unknown>,
): string[] {
  // 显式写文件工具（Write/Edit/MultiEdit）
  if (toolName === 'Write' || toolName === 'Edit' || toolName === 'MultiEdit') {
    const fp = toolInput['file_path'];
    if (typeof fp === 'string' && fp.length > 0) return [fp];
    const p = toolInput['path'];
    if (typeof p === 'string' && p.length > 0) return [p];
    return [];
  }
  // Shell 间接写（Bash/PowerShell/CMD）
  // 注意：claude 只暴露 Bash tool（无独立 PowerShell/CMD tool），agent 常用
  // Bash tool 跑跨 shell 命令（如 `powershell -Command "Set-Content ..."`、
  // `cmd /c mkdir ...`）。若仅按 toolName 选 bash 提取，会漏 PowerShell cmdlet
  // 与 CMD 命令的写路径（真机回归 ql-20260703-001 发现 Set-Content 绕过）。
  // 因此对 shell 工具合并 bash + powershell + cmd 三种提取取并集（正则各自
  // 精确，PowerShell cmdlet 名不会误匹配 bash/cmd 命令，反之亦然，安全）。
  const shell = shellKindOfTool(toolName);
  if (shell) {
    const command = toolInput['command'];
    if (typeof command !== 'string' || command.length === 0) return [];
    const all = [
      ...extractShellWritePaths(command, 'bash'),
      ...extractShellWritePaths(command, 'powershell'),
      ...extractShellWritePaths(command, 'cmd'),
    ];
    return [...new Set(all)];
  }
  return [];
}

/** task-14：工具名 → ShellKind（非 shell 工具返回 undefined）。 */
export function shellKindOfTool(toolName: string): ShellKind | undefined {
  switch (toolName) {
    case 'Bash':
      return 'bash';
    case 'PowerShell':
      return 'powershell';
    case 'CMD':
      return 'cmd';
    default:
      return undefined;
  }
}

/**
 * interactive CC 写拦截（2026-06-29）：默认 chat（enableApproval=false）的 canUseTool
 * 内层逻辑——写校验通过后直接 allow（透传 updatedInput 满足 Claude CLI Zod record 校验，
 * 与 _buildCanUseToolCallback allow 分支同模式）。读工具 / 其他一律 allow。
 *
 * fail-closed 守卫：session 非 running turn → allow（无审批状态可守，回退到 SDK 内置
 * 行为；写拦截只在 running turn 有意义，且 _wrapWithWriteGuard 已先行 deny 越界写）。
 * 实际上 SDK 不会在非 running turn 调 canUseTool，此分支仅为类型完整 + 防御性。
 */
export function buildWriteOnlyCanUseToolCallback(
  _mgr: SessionManagerCore,
  _sessionId: string,
): CanUseToolFn {
  return async (
    _toolName: string,
    toolInput: Record<string, unknown>,
    _options: Parameters<CanUseToolFn>[2],
  ): ReturnType<CanUseToolFn> => {
    // toolInput 已是 record（SDK 契约）；原样透传满足 Claude CLI Zod record 校验
    //（allow 分支 updatedInput required）。
    return { behavior: 'allow', updatedInput: toolInput };
  };
}
