/**
 * turn_phase 上报链路观测（2026-10-26-turn-phase-prod-fix FR-03）。
 *
 * 背景：阶段上报（2026-10-26-session-stage-progress）为 fire-and-forget——
 * 成功静默、失败仅 debug，生产 info 级日志下完全黑盒，实证会话 221ac351
 * 断链后零线索可查。本模块补观测三态：
 *
 * - 失败首警：同一 (session_id, phase) 首次失败记 warn（含 run_id 与错误摘要），
 *   后续失败静默去重（防刷屏）；集合有界 512 逐出最旧（对齐 daemon.ts
 *   _turnPhaseFirstEventReported 防重 Set 惯例）。
 * - 成功默认静默（现状保持，不加日志成本）。
 * - 追踪开关：env SILLYHUB_TURN_PHASE_TRACE=1 时成功也记 info（定位用；
 *   逐次读取对齐 turnStartWatchdogMs 惯例，运行期改 env 即生效、测试可覆写）。
 *
 * 全部记点只读不拦截、不抛——观测不得改变 fire-and-forget 语义。
 *
 * 日志形态：daemon Logger 是 (event, kv) 双参（daemon.ts createLogger，输出经
 * 进程 stdout 落 daemon.log）；session-manager 侧无 logger 注入，缺省走带
 * `[turn-phase]` 前缀的 console（daemon.log 实证收纳 [session-manager] 前缀
 * console 行，同链路）。两侧统一 (event, kv) 形态。
 */

/** 与 daemon.ts Logger 同形的单方法形态（info/warn 各一）。 */
export type PhaseLogFn = (event: string, kv?: Record<string, unknown>) => void;

/** 去重键上限（超限逐出最旧，防长跑进程无界膨胀）。 */
const WARN_ONCE_MAX = 512;

const warnedKeys = new Set<string>();

/** 观测开关（逐次读取——运行期生效/测试可覆写，对齐 turnStartWatchdogMs）。 */
export function turnPhaseTraceEnabled(): boolean {
  return process.env.SILLYHUB_TURN_PHASE_TRACE === '1';
}

/** 缺省 console 适配（session-manager 侧用；[turn-phase] 前缀对齐 [session-manager] 惯例）。 */
const consoleInfo: PhaseLogFn = (event, kv) => {
  // eslint-disable-next-line no-console
  console.info('[turn-phase]', `[${event}]`, ...(kv ? Object.entries(kv).map(([k, v]) => `${k}=${v}`) : []));
};
const consoleWarn: PhaseLogFn = (event, kv) => {
  // eslint-disable-next-line no-console
  console.warn('[turn-phase]', `[${event}]`, ...(kv ? Object.entries(kv).map(([k, v]) => `${k}=${v}`) : []));
};

/** 发出点到达记点：TRACE 开时 info（默认静默）。 */
export function notePhaseEmit(
  point: string,
  sessionId: string,
  runId: string,
  phase: string,
  log: PhaseLogFn = consoleInfo,
): void {
  if (!turnPhaseTraceEnabled()) return;
  log('turn_phase_emit', { point, session_id: sessionId, run_id: runId, phase });
}

/** 失败首警：同 (session_id, phase) 首次 warn，后续去重。 */
export function warnOncePhaseFailure(
  point: string,
  sessionId: string,
  runId: string,
  phase: string,
  error: unknown,
  log: PhaseLogFn = consoleWarn,
): void {
  const key = `${sessionId}:${phase}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (warnedKeys.size > WARN_ONCE_MAX) {
    const oldest = warnedKeys.values().next().value;
    if (oldest !== undefined) warnedKeys.delete(oldest);
  }
  log('turn_phase_report_failed_once', {
    point,
    session_id: sessionId,
    run_id: runId,
    phase,
    error: error instanceof Error ? error.message : String(error),
  });
}

/** 测试清理（生产不调用——daemon 重启集合自然清零）。 */
export function resetTurnPhaseObservabilityForTest(): void {
  warnedKeys.clear();
}
