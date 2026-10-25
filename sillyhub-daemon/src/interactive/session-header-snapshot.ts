/**
 * interactive/session-header-snapshot.ts —— 配置面请求头快照（纯函数 + 类型）。
 *
 * 2026-10-25-trajectory-source-model task-03/04：会话配置面（systemPrompt /
 * allowedTools / mcpServers）随 driver 生命周期重建而变化，前端轨迹页需要一份
 * 「该会话此刻用什么配置在跑」的快照做 prev diff 与溯源展示。daemon 在三处
 * driver 生命周期点（create 的 driver.start / reloadWithConfig 内核 / restore
 * AndReconnect）重建 spec 后采集快照，字段级比较决定是否上报，经既有
 * deps.onTurnMessage → daemon.onTurnMessage → backend submitMessages 通道发一条
 * channel=session_header 的消息（backend submit_steps 白名单透传 metadata.reason，
 * 见 backend run_sync/service/submit_steps.py FR-04 注释）。
 *
 * 纯函数与 IO 分离（design 约定）：本文件只做采集/比较/决策/消息形态构造，
 * 不持有状态、不做网络 IO；会话级缓存与上报接线在 SessionManager
 * （_captureSessionHeader / _flushPendingSessionHeader，session-manager.ts）。
 *
 * @module interactive/session-header-snapshot
 */

/**
 * 配置面请求头快照载荷。
 *
 * 三字段语义（design 契约，与 driver-factory DriverOptionsSpec 三数据点一一对应）：
 *   - systemPrompt：档案配置段**原值**（spec.systemPrompt，即 profile.system_prompt），
 *     非 driver 侧 preset:'claude_code' + append 的展开全文——快照展示的是「用户配置」
 *     而非「引擎最终人格」。null = 无档案（含取消档案 / codex 等不注入人格的引擎）。
 *   - allowedTools：spec.allowedTools 原序拷贝（无则 []）。
 *   - mcpServers：spec.mcpServers（profile.mcpRefs 过滤后的子集）的 server name 键，
 *     去重 + 字典序排序（对象键插入序不稳定，排序保证同一配置面恒产同一快照 →
 *     变更检测不被键序抖动误报 change）。
 */
export interface SessionHeaderSnapshot {
  systemPrompt: string | null;
  allowedTools: string[];
  mcpServers: string[];
}

/**
 * 快照采集入参：DriverOptionsSpec（session-manager/types.ts）三字段的窄化形状。
 * 结构兼容（systemPrompt?: string | null / allowedTools?: string[] /
 * mcpServers?: Record<string, McpServerConfigForDriver>）——传整只 spec 进来即可，
 * 类型上不依赖 session-manager/types（避免与 SessionManagerCore 扩字段时的
 * import 环）。
 */
export interface SessionHeaderSpecSource {
  systemPrompt?: string | null;
  allowedTools?: readonly string[];
  mcpServers?: Readonly<Record<string, unknown>>;
}

/** 上报原因：首条快照 / 与上一条不同。相同（无变化）不上报。 */
export type SessionHeaderReportReason = 'initial' | 'change';

/**
 * 采集时机无 runId（restoreAndReconnect 重建后 claimToken/currentRunId 均空）
 * 时的待上报条目：快照 + 决策时刻的 reason，等下一次 inject（有 runId）补发。
 */
export interface PendingSessionHeaderReport {
  snapshot: SessionHeaderSnapshot;
  reason: SessionHeaderReportReason;
}

/**
 * 从重建后的 spec 采集快照（纯函数）。
 *
 * - systemPrompt：spec 原值 ?? null（undefined = 无档案配置段 → null）。
 * - allowedTools：原序拷贝（防外部数组后续被原地改动污染快照基线）。
 * - mcpServers：键名 Set 去重（防御：JS 对象键天然唯一，Set 兜底归一化外部
 *   构造源）+ sort 排序。
 */
export function buildSessionHeaderSnapshot(
  spec: SessionHeaderSpecSource,
): SessionHeaderSnapshot {
  return {
    systemPrompt: spec.systemPrompt ?? null,
    allowedTools: [...(spec.allowedTools ?? [])],
    mcpServers: [...new Set(Object.keys(spec.mcpServers ?? {}))].sort(),
  };
}

/**
 * 快照字段级相等比较（纯函数）。
 *
 * systemPrompt 严格等（string | null）；allowedTools / mcpServers 数组逐项等
 * （allowedTools 保留 spec 原序——顺序变化即配置面变化，如实报 change；
 * mcpServers 采集时已排序，逐项等价集合等）。
 */
export function headerEquals(
  a: SessionHeaderSnapshot,
  b: SessionHeaderSnapshot,
): boolean {
  if (a.systemPrompt !== b.systemPrompt) return false;
  if (a.allowedTools.length !== b.allowedTools.length) return false;
  for (let i = 0; i < a.allowedTools.length; i++) {
    if (a.allowedTools[i] !== b.allowedTools[i]) return false;
  }
  if (a.mcpServers.length !== b.mcpServers.length) return false;
  for (let i = 0; i < a.mcpServers.length; i++) {
    if (a.mcpServers[i] !== b.mcpServers[i]) return false;
  }
  return true;
}

/**
 * 变更检测（纯函数）：决定本次采集是否上报、以什么 reason 上报。
 *
 * - prev === undefined（会话级缓存无基线：首条采集，或 daemon 重启缓存丢失）→
 *   'initial'。daemon 重启后恢复会话的首次采集即此态（design：视为 initial 可
 *   接受，前端 prev diff 为准会纠偏）。
 * - 与基线不等 → 'change'。
 * - 相等 → null（不上报，避免轮轮重复快照刷屏）。
 */
export function decideHeaderReport(
  prev: SessionHeaderSnapshot | undefined,
  next: SessionHeaderSnapshot,
): SessionHeaderReportReason | null {
  if (prev === undefined) return 'initial';
  return headerEquals(prev, next) ? null : 'change';
}

/**
 * 构造上报消息 dict（纯函数）。
 *
 * 形态对齐 backend submit_steps 的 legacy flat 消息轨（daemon.onTurnMessage 对
 * 无 type+seq 特征的 dict 原样 submitMessages 透传）：
 *   { event_type: "text", content: <快照 JSON>, channel: "session_header",
 *     metadata: { reason } }
 *
 * - content：快照 JSON.stringify（前端 JSON.parse 还原三字段）。
 * - channel: "session_header"：backend 落 AgentRunLog.channel 独立行。
 * - metadata.reason：backend 白名单键（FR-04），落 metadata_ 供前端区分首条/变更。
 */
export function buildHeaderReportMessage(
  snapshot: SessionHeaderSnapshot,
  reason: SessionHeaderReportReason,
): Record<string, unknown> {
  return {
    event_type: 'text',
    content: JSON.stringify(snapshot),
    channel: 'session_header',
    metadata: { reason },
  };
}
