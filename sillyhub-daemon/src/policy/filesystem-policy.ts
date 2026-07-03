/**
 * policy/filesystem-policy.ts —— PolicyEngine 核心（task-05 / D-001 D-006 D-008）。
 *
 * daemon 统一的文件系统权限中心。所有 agent（claude/codex/...）的读/写类工具调用
 * 必须经此引擎裁决：
 *
 *   - canRead：**默认全 allow**，且**不记 audit**（读操作量大，D-008 仅审计写类）；
 *   - canWrite / canCreate / canDelete / canRename：resolveRealPath → PolicyCache 查询
 *     → isPathUnderAnyRoot 边界校验 → 产出 PolicyDecision → **ALLOW/DENY 均记 audit**
 *     （D-006 全量审计，用于安全溯源）；
 *   - 策略严格按 runtime_id 隔离（D-002），**PolicyEngine 不自己 fallback homedir**
 *     （D-007）：cache 未命中即 deny，留给调用方 task-12 决定兜底语义。
 *
 * @module policy/filesystem-policy
 */

import type { PolicyCache, RuntimePolicy } from './runtime-policy.js';
import type { AuditEvent, AuditSink } from './audit-sink.js';
import { isPathUnderAnyRoot, resolveRealPath, UNC_REJECTED } from './path-utils.js';

// ── 类型 ────────────────────────────────────────────────────────────────────

/** 权限裁决结果。 */
export interface PolicyDecision {
  /** 是否允许。 */
  allowed: boolean;
  /** deny 时的中文理由（allow 为空串）。 */
  reason: string;
  /** 规范化（realpath + 大小写归一）后的目标路径。 */
  normalizedPath: string;
}

// ── 常量 ────────────────────────────────────────────────────────────────────

/** allow 决策（复用，避免重复构造）。 */
const ALLOW_DECISION = '';

/**
 * 组装统一中文 deny 文案（design §7 / task-05 constraints）。
 *
 *   Runtime Policy 拒绝本次写入。
 *   Agent：<provider>
 *   目标路径：<normalizedPath>
 *   原因：<cause>
 */
function buildDenyReason(provider: string, normalizedPath: string, cause: string): string {
  return (
    `Runtime Policy 拒绝本次写入。\n` +
    `Agent：${provider}\n` +
    `目标路径：${normalizedPath}\n` +
    `原因：${cause}`
  );
}

/** 「目标目录未配置为可写目录」cause（最常见）。 */
const CAUSE_NOT_CONFIGURED = '目标目录未配置为可写目录。';
/** UNC cause。 */
const CAUSE_UNC = 'UNC 路径（\\\\server\\share）不允许写入。';
/** 策略未加载 cause。 */
const CAUSE_POLICY_NOT_LOADED = '策略未加载（Runtime Policy 未为此 agent 配置可写目录）。';

// ── PolicyEngine ─────────────────────────────────────────────────────────────

/**
 * 文件系统权限引擎。
 *
 * 装配：task-11 注入真实 PolicyCache（由心跳/WS 维护）+ AuditSink（攒批上报）。
 * 测试：注入 mock sink + 真实 PolicyCache set 测试数据。
 */
export class PolicyEngine {
  constructor(
    private readonly cache: PolicyCache,
    private readonly auditSink: AuditSink,
  ) {}

  // ── canRead（D-008：全 allow，不 audit）────────────────────────────────────

  /**
   * 读权限裁决：默认全 allow，**不记 audit**（读操作不审计）。
   *
   * 仍返回 normalizedPath，方便调用方对齐路径展示。
   *
   * @param runtimeId runtime_id（per-runtime 隔离）
   * @param path      原始路径
   * @param _provider agent 种类（保留参数签名对称性，读不审计故未使用）
   * @param _tool     触发工具（同上）
   */
  canRead(runtimeId: string, path: string, _provider = '', _tool = ''): PolicyDecision {
    // 读全 allow，但仍做规范化以便调用方拿到真实路径（不抛错、不审计）。
    const normalizedPath = resolveRealPath(path);
    return { allowed: true, reason: ALLOW_DECISION, normalizedPath };
  }

  // ── canWrite / canCreate / canDelete（统一写类裁决）────────────────────────

  /**
   * 写权限裁决（Write/Edit 等覆盖既有文件）。
   *
   * 流程：
   *   1. resolveRealPath（防 symlink/junction/UNC 绕过）；
   *   2. PolicyCache.get(runtimeId) → 未命中 deny（不 throw，不 fallback homedir）；
   *   3. isPathUnderAnyRoot 边界校验；
   *   4. 产出 decision → ALLOW/DENY 均记 audit（D-006）→ 返回。
   */
  canWrite(
    runtimeId: string,
    path: string,
    provider: string,
    tool: string,
  ): PolicyDecision {
    return this.judgeWrite(runtimeId, path, provider, tool);
  }

  /** 创建新文件裁决（流程同 {@link canWrite}）。 */
  canCreate(
    runtimeId: string,
    path: string,
    provider: string,
    tool: string,
  ): PolicyDecision {
    return this.judgeWrite(runtimeId, path, provider, tool);
  }

  /** 删除裁决（流程同 {@link canWrite}）。 */
  canDelete(
    runtimeId: string,
    path: string,
    provider: string,
    tool: string,
  ): PolicyDecision {
    return this.judgeWrite(runtimeId, path, provider, tool);
  }

  // ── canRename（两端皆需 allow）─────────────────────────────────────────────

  /**
   * 重命名/移动裁决：oldPath 与 newPath 两者皆需 allow，任一越界 → deny。
   *
   * reason 区分源端/目标端越界，便于排查。两端各记一次 audit（D-006 全量）。
   */
  canRename(
    runtimeId: string,
    oldPath: string,
    newPath: string,
    provider: string,
    tool: string,
  ): PolicyDecision {
    const fromDecision = this.judgeWrite(runtimeId, oldPath, provider, tool);
    if (!fromDecision.allowed) {
      // 源端越界：reason 顶部追加「源路径」标识。
      return {
        allowed: false,
        reason: `[源路径] ${fromDecision.reason}`,
        normalizedPath: fromDecision.normalizedPath,
      };
    }
    const toDecision = this.judgeWrite(runtimeId, newPath, provider, tool);
    if (!toDecision.allowed) {
      return {
        allowed: false,
        reason: `[目标路径] ${toDecision.reason}`,
        normalizedPath: toDecision.normalizedPath,
      };
    }
    // 两端均 allow：返回目标端 decision（normalizedPath 指向新路径）。
    return toDecision;
  }

  // ── 内部：单次写类裁决 ──────────────────────────────────────────────────────

  /**
   * 单条路径的写类裁决核心。
   *
   * canWrite/canCreate/canDelete 共用，canRename 对两端各调一次。
   */
  private judgeWrite(
    runtimeId: string,
    path: string,
    provider: string,
    tool: string,
  ): PolicyDecision {
    const normalizedPath = resolveRealPath(path);
    const ts = Date.now();

    // UNC → deny（reason 注明 UNC 不允许）
    if (normalizedPath === UNC_REJECTED) {
      const reason = buildDenyReason(provider, path, CAUSE_UNC);
      this.recordAudit('DENY', runtimeId, provider, tool, normalizedPath, reason, ts);
      return { allowed: false, reason, normalizedPath };
    }

    // cache 查询：未命中 → deny（不 throw、不 fallback homedir，D-007）
    const policy = this.cache.get(runtimeId);
    if (!policy) {
      const reason = buildDenyReason(provider, normalizedPath, CAUSE_POLICY_NOT_LOADED);
      this.recordAudit('DENY', runtimeId, provider, tool, normalizedPath, reason, ts);
      return { allowed: false, reason, normalizedPath };
    }

    // 边界校验
    const underRoot = isPathUnderAnyRoot(normalizedPath, policy.allowedRoots);
    if (underRoot) {
      // allow：reason 空串，仍记 audit（D-006 全量）
      this.recordAudit('ALLOW', runtimeId, provider, tool, normalizedPath, ALLOW_DECISION, ts);
      return { allowed: true, reason: ALLOW_DECISION, normalizedPath };
    }

    // deny：统一中文文案
    const reason = buildDenyReason(provider, normalizedPath, CAUSE_NOT_CONFIGURED);
    this.recordAudit('DENY', runtimeId, provider, tool, normalizedPath, reason, ts);
    return { allowed: false, reason, normalizedPath };
  }

  /** 记 audit（D-006：ALLOW 与 DENY 都记）。 */
  private recordAudit(
    decision: 'ALLOW' | 'DENY',
    runtimeId: string,
    provider: string,
    tool: string,
    normalizedPath: string,
    reason: string,
    ts: number,
  ): void {
    const event: AuditEvent = {
      decision,
      runtimeId,
      provider,
      tool,
      path: normalizedPath,
      reason,
      ts,
    };
    this.auditSink.record(event);
  }
}
