/**
 * thin 出身判定（2026-09-27-thin-display-fix）：归档 thin 变更 current_stage 翻成
 * archived、flow start 创建的 thin change_type=feature——出身信号只能多分支合成。
 * 独立模块避免 page ↔ change-stage-actions 循环依赖（评审 F3：双份拷贝漂移）。
 */

/** 标准工作流阶段痕迹（步骤 stage 命中任一即非 thin 出身）。 */
const THIN_LINEAGE_EXCLUDE_STAGES = ["brainstorm", "plan", "execute", "verify"];

/** thin 分流上线日（thin-badge-survives-archive D-001 口径）：此后变更才按轻量出身。 */
export const THIN_FLOW_LIVE_SINCE_MS = new Date("2026-09-25T00:00:00Z").getTime();

export interface ThinLineageShape {
  current_stage?: string | null;
  change_type?: string | null;
  created_at?: string | null;
  steps?: Array<{ stage?: string | null }> | null;
}

/** thin 出身判定（三分支，均带分流上线时间窗）：
 * ① active 期 stage=thin；
 * ② 平台 quick 分流（change_type=quick 且 created_at>=2026-09-25）；
 * ③ steps 兜底（steps 非空、全无标准四阶段痕迹、且 created_at>=2026-09-25——
 *   归档 flow-thin 的信号；时间窗双保险防历史非标 steps 误标，评审 F1）。 */
export function isThinLineageChange(c: ThinLineageShape): boolean {
  const sinceThinFlow =
    !c.created_at || new Date(c.created_at).getTime() >= THIN_FLOW_LIVE_SINCE_MS;
  if (!sinceThinFlow) return false;
  if (c.current_stage === "thin") return true;
  if (c.change_type === "quick") return true;
  const steps = c.steps ?? [];
  return (
    steps.length > 0 &&
    steps.every((st) => !THIN_LINEAGE_EXCLUDE_STAGES.includes(st.stage ?? ""))
  );
}
