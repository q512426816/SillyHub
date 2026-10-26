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
 */

/** 鸭子类型 logger（daemon pino / 测试 mock 同形：方法收 structured 对象）。 */
interface ObservabilityLogger {
  info(fields: Record<string, unknown>, msg: string): void;
  warn(fields: Record<string, unknown>, msg: string): void;
}

/** 去重键上限（超限逐出最旧，防长跑进程无界膨胀）。 */
const WARN_ONCE_MAX = 512;

const warnedKeys = new Set<string>();

/** 观测开关（逐次读取——运行期生效/测试可覆写，对齐 turnStartWatchdogMs）。 */
export function turnPhaseTraceEnabled(): boolean {
  return process.env.SILLYHUB_TURN_PHASE_TRACE === '1';
}

/** 发出点到达记点：TRACE 开时 info（默认静默）。 */
export function notePhaseEmit(
  logger: ObservabilityLogger,
  point: string,
  sessionId: string,
  runId: string,
  phase: string,
): void {
  if (!turnPhaseTraceEnabled()) return;
  logger.info({ point, session_id: sessionId, run_id: runId, phase }, 'turn_phase_emit');
}

/** 失败首警：同 (session_id, phase) 首次 warn，后续去重。 */
export function warnOncePhaseFailure(
  logger: ObservabilityLogger,
  point: string,
  sessionId: string,
  runId: string,
  phase: string,
  error: unknown,
): void {
  const key = `${sessionId}:${phase}`;
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  if (warnedKeys.size > WARN_ONCE_MAX) {
    const oldest = warnedKeys.values().next().value;
    if (oldest !== undefined) warnedKeys.delete(oldest);
  }
  logger.warn(
    {
      point,
      session_id: sessionId,
      run_id: runId,
      phase,
      error: error instanceof Error ? error.message : String(error),
    },
    'turn_phase_report_failed_once',
  );
}

/** 测试清理（生产不调用——daemon 重启集合自然清零）。 */
export function resetTurnPhaseObservabilityForTest(): void {
  warnedKeys.clear();
}
