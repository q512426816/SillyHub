/**
 * 会话过程折叠判定（纯函数）—— 2026-10-20-session-page-dsh-alignment / D-009。
 *
 * 设计要点：
 * - **纯函数**：不 import React、不读 store、不看上下文；入参是轮次的结构化子集，
 *   便于单测覆盖「折叠资格」的全部边界（这也是把 2026-09-27 的性能债与本变更解耦的前提）。
 * - **资格来自 DSH 的折叠资格表**：只有「已闭合且无后续输入」的轮可整轮折叠；
 *   运行中 / 失败 / 停止（打断）轮一律保持过程可见，避免「把正在跑的轮折起来」。
 * - **档位只影响默认开合与标题信息量**，不改变数据、不改变单条 disclosure 的手动展开。
 *
 * 现状边界：本文件只做判定与文案，不承担渲染；渲染接线在 turn-timeline 的可选
 * `detailLevel` prop（不传＝现行为零变化）。
 */

/** 工作细节档位（三档；详细档不折叠）。 */
export type DetailLevel = "compact" | "standard" | "detailed";

/** 判定所需的最小轮次形状（结构化子集，避免与 turn-timeline 形成类型环）。 */
export interface FoldTurnLike {
  status: string;
  segments?: readonly { kind: string }[] | undefined;
  processItems?: readonly { kind: string }[] | undefined;
  apiDurationMs?: number | null | undefined;
}

/** 可整轮折叠的轮状态：仅「正常闭合」。 */
const FOLDABLE_STATUSES: readonly string[] = ["completed"];

/** 不计入「过程步数」的段类型（正文类，不是过程）。 */
const NON_PROCESS_KINDS: readonly string[] = ["text", "preamble", "compact"];

/**
 * 该轮是否具备整轮折叠资格。
 *
 * 资格＝状态为正常闭合。运行中（pending/running/interrupting）、失败（failed）、
 * 被打断（killed）都**不折**——它们的失败原因/中断提示本身就是正文的一部分。
 */
export function isTurnFoldable(turn: FoldTurnLike): boolean {
  return FOLDABLE_STATUSES.includes(turn.status);
}

/** 过程步数：段模型里非正文段的数量（工具/思考/stderr/子代理块各算一步）。 */
export function processStepCount(turn: FoldTurnLike): number {
  const list = turn.segments ?? turn.processItems ?? [];
  return list.filter((s) => !NON_PROCESS_KINDS.includes(s.kind)).length;
}

/** 折叠头耗时长度的展示格式；无可用数据返回 null（不伪造）。 */
export function formatFoldDuration(ms: number | null | undefined): string | null {
  if (ms == null || !Number.isFinite(ms) || ms <= 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  const totalSeconds = ms / 1000;
  if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds - minutes * 60);
  return `${minutes}m${seconds}s`;
}

/**
 * 折叠头标题文案。
 * - 精简档：只给步数（最安静）；
 * - 标准/详细档：步数 + 耗时（耗时缺失时不留空占位）。
 */
export function foldHeaderText(turn: FoldTurnLike, level: DetailLevel): string {
  const steps = processStepCount(turn);
  const base = steps > 0 ? `思考与工具 · ${steps} 步` : "过程";
  if (level === "compact") return base;
  const duration = formatFoldDuration(turn.apiDurationMs);
  return duration === null ? base : `${base} · ${duration}`;
}

/** 折叠态只保留正文段（过程段被隐藏，正文与流式光标照常渲染）。 */
export function textOnlySegments<T extends { kind: string }>(segments: readonly T[]): T[] {
  return segments.filter((s) => s.kind === "text");
}
