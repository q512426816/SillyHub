/**
 * task-runner/skill-prompt.ts —— 超时/重试/技能 prompt/stats 兜底纯函数簇。
 *
 * task-03（2026-09-07-arch-large-file-split / D-004@v1）：原 task-runner.ts 的
 * resolveTimeout / resolveMaxRetries / isSpawnLevelFailure / buildSkillPrompt /
 * detectSkillInvoked / mergeAdapterUsage / attachBatchModelStats /
 * extractBudgetUsageTokens 模块级纯函数与 EMPTY_DIFF / MAX_RETRIES_HARD_CAP /
 * DEFAULT_TIMEOUT_FALLBACK / DEFAULT_MAX_RETRIES_FALLBACK /
 * SPAWN_FAILURE_PATTERNS / SpawnAttemptResult 原样搬移（零改写；
 * EMPTY_DIFF / SpawnAttemptResult 包内导出供 facade / spawn-stream 引用，
 * 不进 index 公共面）。
 *
 * @module task-runner/skill-prompt
 */

import type { DaemonConfig } from '../config.js';
import type { ProtocolAdapter } from '../adapters/protocol-adapter.js';
import type { LeaseCtx } from '../types.js';

export const EMPTY_DIFF = {
  patch: '',
  files_changed: 0,
  insertions: 0,
  deletions: 0,
  stats: '',
} as const;

// ── task-10 B2/B3：超时优先级链 + spawn 级失败重试（纯函数）─────────────────

/** resolveMaxRetries 硬上限（防止 config 误配大值导致无限重试拖垮 daemon）。 */
const MAX_RETRIES_HARD_CAP = 3;

/** 兜底默认超时秒数（ctx + config 都未配时）。 */
const DEFAULT_TIMEOUT_FALLBACK = 1800;

/** 兜底默认重试次数（config 未配时）。 */
const DEFAULT_MAX_RETRIES_FALLBACK = 1;

/**
 * spawn 级失败关键字（stderr / error 命中即判定为 spawn 级，可重试）。
 * claude 业务非零退出（无这些关键字）→ 保守不重试（R-10 side-effect 优先）。
 */
const SPAWN_FAILURE_PATTERNS = /spawn ENOENT|segfault|oom|killed/i;

/**
 * _spawnAndStream 单次尝试的返回结构（task-10 B3：新增 businessError 区分业务错误）。
 */
export interface SpawnAttemptResult {
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  exitCode: number;
  error?: string;
  stats?: Record<string, unknown>;
  /** claude 业务报错（result is_error=true）置 true，retry 判定优先看此字段。 */
  businessError?: boolean;
}

/**
 * 解析执行超时秒数（task-10 B2 优先级链）。
 *
 * 从高到低：ctx.timeoutSeconds > ctx.timeout（兼容旧字段）> config.default_timeout_seconds > 1800。
 *
 * 特殊语义：
 *   - timeoutSeconds/timeout = -1（负数）→ 返回 0（显式不限，看门狗不启动）
 *   - timeoutSeconds/timeout = 0 → 跳过（>0 判断），走 config/兜底
 *
 * 纯函数，不修改入参。
 */
export function resolveTimeout(ctx: LeaseCtx, config?: DaemonConfig): number {
  // 显式 -1（timeoutSeconds 或兼容 timeout）→ 不限
  const explicit = ctx.timeoutSeconds ?? ctx.timeout;
  if (typeof explicit === 'number' && explicit < 0) return 0;
  // 优先级 1：ctx.timeoutSeconds（lease.metadata 透传）
  if (typeof ctx.timeoutSeconds === 'number' && ctx.timeoutSeconds > 0) return ctx.timeoutSeconds;
  // 优先级 1b：ctx.timeout（兼容旧字段，既有测试 makeLease({ timeout }) 仍生效）
  if (typeof ctx.timeout === 'number' && ctx.timeout > 0) return ctx.timeout;
  // 优先级 2：config.default_timeout_seconds
  const cfg = config?.default_timeout_seconds;
  if (typeof cfg === 'number' && cfg > 0) return cfg;
  // 优先级 3：兜底 1800
  return DEFAULT_TIMEOUT_FALLBACK;
}

/**
 * 解析最大重试次数（task-10 B3）。
 *
 * config.max_retries 缺失/非法 → 兜底 1；> 3 → 截断 3（log warn）；0 → 禁用重试。
 *
 * 纯函数，不修改入参。
 */
export function resolveMaxRetries(config?: DaemonConfig): number {
  const cfg = config?.max_retries;
  if (typeof cfg !== 'number' || cfg < 0 || !Number.isFinite(cfg)) {
    return DEFAULT_MAX_RETRIES_FALLBACK;
  }
  if (cfg > MAX_RETRIES_HARD_CAP) {
    console.warn(
      `task_runner: max_retries_truncated value=${cfg} cap=${MAX_RETRIES_HARD_CAP}`,
    );
    return MAX_RETRIES_HARD_CAP;
  }
  return cfg;
}

/**
 * 判定单次 spawn 尝试结果是否为「spawn 级失败」（可重试）。
 *
 * 可重试（true）：timeout / spawn ENOENT / OOM / segfault / killed。
 * 不重试（false）：cancelled / businessError（claude is_error）/ completed /
 *   业务非零退出（无 spawn 关键字，保守不重试，R-10 side-effect 优先）。
 *
 * 纯函数，不修改入参。
 */
export function isSpawnLevelFailure(
  r: { status: string; exitCode: number; error?: string; businessError?: boolean },
): boolean {
  // 业务错误（claude result is_error=true）→ 不重试（最优先，避免与 failed 分支歧义）
  if (r.businessError) return false;
  if (r.status === 'timeout') return true;
  if (r.status === 'cancelled') return false;
  if (r.status === 'completed') return false;
  if (r.status === 'failed') {
    // 仅 spawn 级关键字命中才重试；业务非零退出（如 claude 逻辑错误返回非 0）不重试
    return SPAWN_FAILURE_PATTERNS.test(r.error ?? '');
  }
  return false;
}

/**
 * task-02 (2026-07-07-daemon-skill-execution): 构造 skill 调用 prompt。
 *
 * stage_dispatch 模式时，claude 不再收完整的 stage prompt（违反 D-005），
 * 改为简短 skill 指令 —— claude 启动后自动加载对应 skill 跑流程。
 *
 * 格式（设计 §5.1.1）：
 *   /{skill_name} --change {change_id} --stage {stage}
 *
 * stageMeta 缺 skill_name → 返回空串（无可用的 skill 指令）。
 * change_id / stage 缺 → 省略对应参数（不阻塞 skill 启动）。
 *
 * 纯函数，不修改入参。
 */
export function buildSkillPrompt(
  stageMeta?: Record<string, unknown>,
): string {
  if (!stageMeta) return '';
  const skillName = typeof stageMeta.skill_name === 'string' && stageMeta.skill_name
    ? stageMeta.skill_name
    : '';
  const changeId = typeof stageMeta.change_id === 'string' && stageMeta.change_id
    ? stageMeta.change_id
    : '';
  const stage = typeof stageMeta.stage === 'string' && stageMeta.stage
    ? stageMeta.stage
    : '';
  if (!skillName) return '';

  let prompt = `/${skillName}`;
  if (changeId) prompt += ` --change ${changeId}`;
  if (stage) prompt += ` --stage ${stage}`;
  return prompt;
}

/**
 * task-08（NFR-01 / design §5.1.1 gap 2）：检测 claude 是否成功调用了 skill。
 *
 * stage 投递（stageMeta.skill_name 非空）时，stage lease 收尾调用：
 *   - 输出含明确失败标记（skill not found / No skill named / unknown skill /
 *     skill 'x' not found）→ false（应标 failed）
 *   - 输出含 skill 调用痕迹（/<skill_name> 或 skill 名字符串）→ true
 *   - 灰区（无失败标记也无 skill 痕迹）→ 默认 true（不误杀，第①层 prompt 强指令是主保障）
 *
 * 非 stage lease（stageMeta 空 / 无 skill_name）→ true（不检测，零回归）。
 *
 * 纯函数，便于单测。
 */
export function detectSkillInvoked(
  output: string,
  stageMeta?: Record<string, unknown>,
): boolean {
  if (!stageMeta) return true;
  const skillName = typeof stageMeta.skill_name === 'string' ? stageMeta.skill_name : '';
  if (!skillName) return true; // 无 skill_name 不检测
  const lower = output.toLowerCase();
  // 明确失败标记
  const failMarkers = [
    'skill not found',
    'no skill named',
    'unknown skill',
    `skill '${skillName}' not found`,
    `skill "${skillName}" not found`,
  ];
  if (failMarkers.some((m) => lower.includes(m.toLowerCase()))) return false;
  // skill 调用痕迹
  if (lower.includes(`/${skillName.toLowerCase()}`) || lower.includes(skillName.toLowerCase())) {
    return true;
  }
  // 灰区 → 不误杀
  return true;
}

// ── task-16 (2026-06-24-runtime-usage-stats)：batch usage 兜底合并 ───────────

/**
 * ndjson adapter (task-03) 的 `getUsage()` 在 batch 路径原先无任何调用方：
 * stream-json 的 cache 走 `extractResultStats` 注入 complete 事件 metadata.stats
 * （→ lastStats → TaskResult.stats，cache 已就绪）；但 ndjson（opencode）**不产
 * complete stats 事件**，只通过 `getUsage()` 暴露 usage，导致 batch 路径
 * TaskResult.usage / cache 在 ndjson 下完全丢失（step9 符号影响面检查发现）。
 *
 * 本函数鸭子类型调用 `adapter.getUsage()`（仅 ndjson 实现；stream-json 用
 * extractResultStats，无 getUsage → 跳过，零回归），把 adapter 累积的 usage
 * 合并进 lastStats：
 *   - lastStats 已有的字段不覆盖（stream-json/codex 产 stats 时优先）。
 *   - lastStats 为空 → 整体用 getUsage()。
 *   - lastStats 缺 cache_read_tokens / cache_creation_tokens → 从 getUsage() 补。
 *   - getUsage() 缺失/抛错 → 原样返回 lastStats（不阻塞）。
 *
 * typeof === 'number' 守卫：非数字（含 undefined/NaN）不写，0 值合法不丢。
 *
 * @param adapter   ProtocolAdapter（鸭子类型，可能无 getUsage）
 * @param lastStats complete 事件 metadata.stats（可能 undefined）
 * @returns 合并后的 stats（可能 undefined —— 两处都无数据时）
 */
export function mergeAdapterUsage(
  adapter: ProtocolAdapter,
  lastStats: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  // 鸭子类型：仅 ndjson 实现 getUsage；stream-json 无此方法 → 直接返回原 stats。
  const getUsage = (adapter as { getUsage?: () => Record<string, unknown> }).getUsage;
  if (typeof getUsage !== 'function') {
    return lastStats;
  }
  let adapterUsage: Record<string, unknown> | undefined;
  try {
    adapterUsage = getUsage.call(adapter);
  } catch {
    // adapter getUsage 异常不阻塞主流程（对齐 _handleLine 单行容错策略）。
    return lastStats;
  }
  if (!adapterUsage || typeof adapterUsage !== 'object') {
    return lastStats;
  }
  // lastStats 为空 → 整体用 adapterUsage；否则合并缺失字段（lastStats 优先）。
  const merged: Record<string, unknown> = lastStats
    ? { ...lastStats }
    : {};
  // input/output / cache 两维 / num_turns / total_cost_usd 等所有 number 字段
  // 逐个补缺（lastStats 已有的不覆盖）。
  const FIELDS = [
    'input_tokens',
    'output_tokens',
    'cache_read_tokens',
    'cache_creation_tokens',
    'num_turns',
    'total_cost_usd',
  ];
  for (const key of FIELDS) {
    if (merged[key] === undefined) {
      const v = adapterUsage[key];
      if (typeof v === 'number') {
        merged[key] = v;
      }
    }
  }
  // 两处都无任何业务字段 → 返回 undefined（避免空对象污染下游）。
  if (Object.keys(merged).length === 0) {
    return lastStats;
  }
  return merged;
}

// ── task-07（2026-08-29-usage-by-provider-model）：batch stats 增补 model/api_requests ──

/**
 * task-07（FR-01-4 / FR-02-2 / design §3.2）：batch 终态 stats 增补两字段——
 *   - model：lease ProviderConfig.model，空则 "unknown"（backend complete_lease
 *     据此落 agent_run_model_usage 单行明细 + run.model 填充，design §4.1）；
 *   - api_requests：adapter 的 message_start 计数（batch API 调用次数口径，
 *     claude CLI 2.1.216 实测 == num_turns，design §2）。
 *
 * 鸭子类型门禁（对齐 resetAccumulator / getUsage 先例，不改 ProtocolAdapter 契约）：
 * 仅 StreamJsonAdapter 暴露 messageStartCount getter；ndjson / opencode 等其它
 * provider 无 getter → **两字段都不加**（stats 形态不变，老链路零回归）。
 *
 * stats 为 undefined（cancelled / spawn 失败等无 complete stats 的路径）→ 原样
 * 返回 undefined，不为两字段凭空造 stats 对象（_finish 对 undefined 语义敏感）。
 *
 * 不修改入参 stats（浅拷贝后加键）——lastStats 同一引用还被 budget onStats 回调
 * 持有，原地写键会污染外部观察快照。
 *
 * @param stats   mergeAdapterUsage 合并后的终态 stats（可能 undefined）
 * @param ctx     lease 上下文（provider_config.model 取模型名）
 * @param adapter ProtocolAdapter（鸭子类型读 messageStartCount）
 * @returns 增补后的 stats 新对象（或原 undefined）
 */
export function attachBatchModelStats(
  stats: Record<string, unknown> | undefined,
  ctx: LeaseCtx,
  adapter: ProtocolAdapter,
): Record<string, unknown> | undefined {
  const count = (adapter as { messageStartCount?: unknown }).messageStartCount;
  if (typeof count !== 'number' || stats === undefined) {
    return stats;
  }
  return {
    ...stats,
    model: ctx.provider_config?.model || 'unknown',
    api_requests: count,
  };
}

// ── task-08（D-006 / D-009）：budget 累计 + 软切断检查点 ──────────────────────

/**
 * task-08（D-009）：从 stats 提取 budget 累计口径 token 数。
 *
 * 口径**严格** = ``input_tokens + output_tokens``（**不含** cache_read /
 * cache_creation）。守卫：``undefined`` / ``NaN`` / 非数字均按 0，避免脏 stats
 * 误触发软切断。0 值合法（不丢）。
 *
 * @param stats adapter / complete 事件的 metadata.stats（可能 undefined）
 * @returns input_tokens + output_tokens 的有限数和
 */
export function extractBudgetUsageTokens(
  stats: Record<string, unknown> | undefined,
): number {
  if (!stats) return 0;
  const inp =
    typeof stats.input_tokens === 'number' && Number.isFinite(stats.input_tokens)
      ? stats.input_tokens
      : 0;
  const out =
    typeof stats.output_tokens === 'number' && Number.isFinite(stats.output_tokens)
      ? stats.output_tokens
      : 0;
  return inp + out;
}
