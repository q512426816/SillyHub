/**
 * Daemon API client —— 会话内团队任务域。
 *
 * 2026-09-07-arch-large-file-split task-15：自原 lib/daemon.ts 按资源域原样搬移，
 * @/lib/daemon 导入面经 ./index 全量再导出保持零变化。
 */
import { apiFetch } from "@/lib/api";
import type {
  MainAgentConfig,
  WorkerPresetItem,
} from "@/lib/agent";

/* ---------- Session team mission (2026-08-22-team-session-unify task-12 / FR-07) ----------
 *
 * 会话内团队任务 client（design §5 Phase 3 / §7）：
 *   - POST /api/daemon/sessions/{id}/team-mission  触发（预建，活跃冲突 409）
 *   - GET  /api/daemon/sessions/{id}/team-missions 列表（TeamTaskBlock 数据源）
 *   - POST /api/missions/{id}/cancel               取消（保留端点，D-011）
 *
 * 消费方：TeamTaskBlock（task-12）/ team-trigger-popover（task-11）。活跃 mission
 * （planning/running/awaiting_input）的 5s 轮询由父层（task-11 session-panel）驱动，
 * 本文件只提供一次性请求。
 */

/**
 * mission 派生状态（task-02 扩展后 derive_status 判据矩阵产出，含 awaiting_input 档；
 * 存量 external mission 不进该档）。渲染层对未知值有兜底映射，新增取值不崩。
 */
export type TeamMissionStatus =
  | "planning"
  | "running"
  | "awaiting_input"
  | "done"
  | "degraded"
  | "failed"
  | "cancelled";

/**
 * 分身 run 概要（TeamMissionSummary.workers 单项）。后端仅收 role != orchestrator
 * 的分身 run（主控轮 D-009 不进列表）；status 为 AgentRunStatus（pending/running/
 * completed/failed/killed）。
 */
export interface TeamMissionWorkerSummary {
  run_id: string;
  role: string | null;
  status: string;
  objective: string | null;
  /** 分身执行工作区（ql-20260825-003：跨工作区派发后日志/产物端点按此鉴权）。 */
  workspace_id?: string | null;
  /**
   * 分身子会话形态（2026-08-25-team-subsession-governance）：子会话行非空，
   * 分身行点击据此打开 session-panel；存量 batch 行缺省。first_run_id 与
   * run_id 同源（首 run 双标记锚），get_worker_result 消费。
   */
  sub_session_id?: string | null;
  first_run_id?: string | null;
  /** 运行中分身最新动作预览（UX 走查③）：最新日志行截断摘要，仅 running 行。 */
  latest_action?: string | null;
  /** 已完成分身的结论摘要（UX 优化 2026-08-27）：worker_done 上报的 summary 前 120 字符。 */
  result_summary?: string | null;
}

/** scope 工作区引用（ql-20260825-003：id+名称 enriched 视图）。 */
export interface TeamWorkspaceRef {
  id: string;
  name: string | null;
}

/**
 * 会话团队任务概要（触发响应 / 列表项，对齐 backend daemon/schema.py
 * TeamMissionSummary）。scope_workspace_ids 为落库冻结快照（NULL 缺省回落 [anchor]）。
 *
 * task-14 gen:types 已核对：与生成版 components["schemas"]["TeamMissionSummary"]
 * 字段名一致，但形态有差异，按 task-14 规则保留手写并在此注释差异：
 *   1. 生成版 status 为裸 string（后端 DTO 声明 str 而非 Literal/enum），
 *      手写保留 TeamMissionStatus 联合以获得编译期取值收窄；
 *   2. 生成版 workers 为可选（pydantic default_factory → 生成器标 ?），后端实际
 *      总会序列化该数组，手写保持必填省去消费方判空。
 */
export interface TeamMissionSummary {
  mission_id: string;
  status: TeamMissionStatus;
  objective: string | null;
  scope_workspace_ids: string[];
  /** scope 工作区 id+名称 enriched 视图（ql-20260825-003，前端范围徽标名称化）。 */
  scope_workspaces?: TeamWorkspaceRef[];
  budget_usd: number | null;
  /**
   * ql-20260828-012-4425：编辑回显三件套（后端 mission 行直取；后端为宽松
   * dict 形态，前端按 WorkerPresetItem/MainAgentConfig 精确消费——结构同源，
   * trigger 侧 lib 类型即该形态的生成契约）。
   */
  project_id?: string | null;
  worker_preset?: WorkerPresetItem[] | null;
  main_agent_config?: MainAgentConfig | null;
  workers: TeamMissionWorkerSummary[];
}

/**
 * POST /api/daemon/sessions/{id}/team-mission 请求体（对齐 task-03
 * TeamMissionTriggerRequest）。objective 可空（落库占位，首条 inject 回填 CC-09）；
 * scope_workspace_ids 缺省 = 会话绑定工作区（会话无工作区且未传 → 422，CC-10）。
 */
export interface TeamMissionTriggerRequest {
  objective?: string | null;
  scope_workspace_ids?: string[] | null;
  project_id?: string | null;
  budget_usd?: number | null;
  worker_preset?: WorkerPresetItem[] | null;
  main_agent_config?: MainAgentConfig | null;
}

/**
 * POST /api/daemon/sessions/{session_id}/team-mission — 在当前会话预建团队任务
 *（2026-08-22-team-session-unify task-03 端点）。会话已有活跃 mission 时后端
 * 返回 409（R-07 单活跃约束，ApiError 透传给触发弹层提示）。
 */
export async function triggerSessionTeamMission(
  sessionId: string,
  req: TeamMissionTriggerRequest,
): Promise<TeamMissionSummary> {
  return apiFetch<TeamMissionSummary>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/team-mission`,
    { method: "POST", json: req },
  );
}

/**
 * GET /api/daemon/sessions/{session_id}/team-missions — 会话关联团队任务列表
 *（created_at 倒序）+ 分身概要。TeamTaskBlock 数据源；父层对活跃 mission 5s
 * 轮询本端点，终态停止（design §5 Phase 3）。
 */
export async function listSessionTeamMissions(
  sessionId: string,
): Promise<TeamMissionSummary[]> {
  return apiFetch<TeamMissionSummary[]>(
    `/api/daemon/sessions/${encodeURIComponent(sessionId)}/team-missions`,
  );
}

/**
 * POST /api/missions/{mission_id}/cancel — 取消团队任务（D-011 保留端点，workspace
 * 无关路径）。TeamTaskBlock 取消按钮用；lib/agent.ts 的 cancelMission 是 workspace
 * 前缀旧路由（task-13 清理对象），勿混用。响应为 MissionResponse，本卡只关心
 * 取消副作用（父层 onRefresh 重拉列表展示新状态），不消费具体字段。
 */
export async function cancelTeamMission(missionId: string): Promise<void> {
  await apiFetch(
    `/api/missions/${encodeURIComponent(missionId)}/cancel`,
    { method: "POST" },
  );
}

