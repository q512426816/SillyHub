import { apiFetch } from "./api";
import type { components } from "./api-types";

/**
 * 变更摘要（列表项）。对齐后端 schema（components.schemas.ChangeSummary）。
 * 注：旧手写曾含 created_at，后端从不返回（phantom，0 调用方），迁移即消除。
 */
export type ChangeSummary = components["schemas"]["ChangeSummary"];

/**
 * 变更详情。对齐后端 schema（components.schemas.ChangeRead）。
 * pending_review：当前应展示的审核面板类型（StageProjectionService 投影）。
 *   取值：proposal_review | plan_review | human_test | archive_confirm | null
 */
export type ChangeRead = components["schemas"]["ChangeRead"];

/** 变更列表响应。items 元素为 ChangeSummary（无 created_at）。对齐后端 schema。 */
export type ChangeList = components["schemas"]["ChangeList"];

/** reparse 警告项。对齐后端 schema（components.schemas.ChangeWarning）。 */
export type ChangeWarning = components["schemas"]["ChangeWarning"];

/** reparse 统计。对齐后端 schema（components.schemas.ChangeReparseStats）。 */
export type ChangeReparseStats = components["schemas"]["ChangeReparseStats"];

/** reparse 响应。对齐后端 schema——warnings optional（后端条件返回），调用方按需 guard。 */
export type ChangeReparseResponse = components["schemas"]["ChangeReparseResponse"];

// ── Workflow Types (task-05) ────────────────────────────────────────────

/**
 * 阶段流转请求参数。
 *
 * shadow schema: components.schemas.TransitionRequest（D-004@v2 有据例外保留手写）。
 * schema 的 worker_preset / main_agent_config 是 `{[key:string]:unknown}[]` loose dict，
 * 手写是精确 `{agent_type;model;objective;role}[]` / `{agent_type?;provider?;model?}`，
 * 调用方（advanceChangeStage opts）依赖精确结构；schema team_mode required 与前端按需
 * `body.team_mode=true` 冲突。迁过去会降级类型安全，故保留手写。
 */
export type TransitionRequest = {
  /** 目标阶段，对应后端 StageEnum 值 */
  target_stage: string;
  /** 流转原因（可选） */
  reason?: string;
  /** 显式 agent provider（可选）；省略则后端用 workspace.default_agent */
  provider?: string | null;
  model?: string | null;
  /** 2026-08-12-dispatch-bind-agent-profile：本次派发用的 AgentProfile id（可选，
   * 单次 dispatch 入参不持久化，D-001@v1）。省略/None=跟随工作区默认（不选档案）。 */
  agent_profile_id?: string | null;
  /** execute/verify 阶段是否用团队执行（task-08，D-004@v2；省略/False=单 worker 零回归） */
  team_mode?: boolean;
  /** team_mode 用户预设 worker 列表，透传到 backend change.stages.team_worker_preset。
   * 2026-08-12-dispatch-bind-agent-profile：每 worker 选档案，结构 {profile_id, objective, role}
   * （向后兼容旧 {agent_type, model, ...} 形态，D-002@v2）。 */
  worker_preset?: {
    profile_id?: string;
    objective?: string;
    role?: string;
    // 向后兼容旧形态（agent_type/model 仍可传，消费方按 profile_id 优先）
    agent_type?: string;
    model?: string;
  }[];
  /** team_mode 主 agent 配置。2026-08-12-dispatch-bind-agent-profile：主 agent 选档案，
   * agent_profile_id 优先（D-003@v2）。 */
  main_agent_config?: {
    agent_profile_id?: string;
    agent_type?: string;
    provider?: string;
    model?: string;
  };
};

/**
 * 反馈提交请求参数。对齐后端 schema（components.schemas.FeedbackRequest）。
 * category: A=Bug, B=设计错误, C=信息不足, D=衍生新change。
 * target_stage（可选）：自定义返工目标，覆盖类别默认值——后端 submit_feedback 已支持，
 * 旧手写漏此字段（drift），迁移补回。
 */
export type FeedbackRequest = components["schemas"]["FeedbackRequest"];

/**
 * 归档门禁单项检查结果。对齐后端 schema（components.schemas.ArchiveCheckItem）。
 * name 固定 6 项之一：no_unresolved_feedback / ac_confirmed /
 * tech_verification_passed / business_review_passed / feedback_categorized / documents_complete。
 */
export type ArchiveCheckItem = components["schemas"]["ArchiveCheckItem"];

/** 归档门禁检查响应。对齐后端 schema（checks optional）。 */
export type ArchiveGateResponse = components["schemas"]["ArchiveGateResponse"];

export function listChanges(
  workspaceId: string,
  params?: { location?: string; status?: string; owner?: string; search?: string; currentStage?: string; sort?: string; pendingReviewOnly?: boolean; page?: number; pageSize?: number },
) {
  const searchParams = new URLSearchParams();
  if (params?.location) searchParams.set("location", params.location);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.owner) searchParams.set("owner", params.owner);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.currentStage) searchParams.set("current_stage", params.currentStage);
  if (params?.sort) searchParams.set("sort", params.sort);
  if (params?.pendingReviewOnly) searchParams.set("pending_review_only", "true");
  if (params?.page) searchParams.set("page", String(params.page));
  if (params?.pageSize) searchParams.set("page_size", String(params.pageSize));
  const qs = searchParams.toString();
  return apiFetch<ChangeList>(
    `/api/workspaces/${workspaceId}/changes${qs ? `?${qs}` : ""}`,
  );
}

export function getChange(workspaceId: string, changeId: string) {
  return apiFetch<ChangeRead>(
    `/api/workspaces/${workspaceId}/changes/${changeId}`,
  );
}

export function reparseChanges(workspaceId: string) {
  return apiFetch<ChangeReparseResponse>(
    `/api/workspaces/${workspaceId}/changes/reparse`,
    { method: "POST" },
  );
}

// 批准
// 退役（task-13，FR-06）：旧 approval 链路（approval_status + approve/reject）不再驱动
// change 推进，changes 详情页已改走 submitStageReview（submit_stage_review 语义）。本方法
// 保留供既有历史调用方 / 数据兼容，只读参考，不再由 changes 详情页调用。
export function approveChange(workspaceId: string, changeKey: string, approvedBy: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/approve`,
    {
      method: "POST",
      json: { approved_by: approvedBy },
    },
  );
}

// task-07（2026-08-13-profile-system-prompt-injection）：存每阶段独立 profile_id。
// PATCH /changes/{cid}/stage-profile → change.stages[current_stage].profile_id。
// profileId=null 清除（跟随工作区默认）。
export function updateStageProfile(
  workspaceId: string,
  changeId: string,
  profileId: string | null,
) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/stage-profile`,
    {
      method: "PATCH",
      json: { profile_id: profileId },
    },
  );
}

// 驳回
// 退役（task-13，FR-06）：旧 approval 链路（approval_status + approve/reject）不再驱动
// change 推进，changes 详情页已改走 submitStageReview（submit_stage_review 语义）。本方法
// 保留供既有历史调用方 / 数据兼容，只读参考，不再由 changes 详情页调用。
export function rejectChange(workspaceId: string, changeKey: string, reason: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/reject`,
    {
      method: "POST",
      json: { reason },
    },
  );
}

/**
 * 阶段流转 — POST /api/workspaces/{wid}/changes/{cid}/transition
 *
 * 将 change 从当前阶段流转到 target_stage。
 * 后端会校验 TRANSITIONS 合法性和角色权限。
 */
export function transitionChange(
  workspaceId: string,
  changeId: string,
  targetStage: string,
  reason?: string,
  provider?: string | null,
  model?: string | null,
  teamMode?: boolean,
  workerPreset?: TransitionRequest["worker_preset"],
  mainAgentConfig?: TransitionRequest["main_agent_config"],
) {
  const body: TransitionRequest = { target_stage: targetStage };
  if (reason !== undefined) {
    body.reason = reason;
  }
  // ql-20260618-009：与 triggerDispatch 风格统一，只在真值时附加
  // （后端 schema default=None，行为与 !== undefined 等价）
  if (provider) {
    body.provider = provider;
  }
  if (model) {
    body.model = model;
  }
  // team-mode（task-08，D-004@v2）：true 时附加 body.team_mode=true
  // （后端 TransitionRequest.team_mode default=False，省略=零回归）
  if (teamMode) {
    body.team_mode = true;
    // task-09（D-002/D-003@v2）：worker_preset / main_agent_config 透传。
    // 后端 transition_with_dispatch 写 change.stages.team_worker_preset /
    // team_main_agent_config，_dispatch_execute_team → OrchestratorService 读取。
    if (workerPreset && workerPreset.length > 0) {
      body.worker_preset = workerPreset;
    }
    if (mainAgentConfig) {
      body.main_agent_config = mainAgentConfig;
    }
  }
  return apiFetch<TransitionResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    {
      method: "POST",
      json: body,
    },
  );
}

/**
 * 归档门禁检查 — GET /api/workspaces/{wid}/changes/{cid}/archive-gate
 *
 * 检查 change 是否满足归档的前置条件（6 项检查）。
 * 返回 can_archive 标志和未通过项列表。
 */
export function checkArchiveGate(workspaceId: string, changeId: string) {
  return apiFetch<ArchiveGateResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive-gate`,
  );
}

// ── Agent Dispatch Types ─────────────────────────────────────────────

/**
 * Transition 专用的 agent dispatch 结果。对齐后端 schema（components.schemas.TransitionDispatchResponse）。
 * schema 把 agent_run_id/stage/reason/mission_id/mode 标可选（后端条件返回更准确，手写 required 过严）。
 */
export type TransitionDispatchResponse = components["schemas"]["TransitionDispatchResponse"];

/**
 * POST /changes/{id}/transition（及 /advance-stage）的返回类型。
 *
 * shadow schema: components.schemas.TransitionResponse（D-004@v2 有据例外保留手写）。
 * schema 的 change 是 `{[key:string]:unknown}` loose dict，手写是 `ChangeRead` 精确结构
 * （23 处 `.change.xxx` 调用依赖）。迁过去会丢失 change 字段类型，故保留手写。
 */
export type TransitionResponse = {
  /** 变更数据（ChangeRead 的 dict 表示） */
  change: ChangeRead;
  /** Agent dispatch 结果（无 dispatch 时为 null） */
  agent_dispatch: TransitionDispatchResponse | null;
};

/**
 * Agent 运行结果。无 openapi schema，前端本地契约（DispatchResponse.last_dispatch 精确结构）。
 */
export type DispatchResult = {
  status: "running" | "completed" | "failed";
  output_summary?: string | null;
  run_id?: string | null;
  started_at?: string | null;
  finished_at?: string | null;
  /** P3 driver gate pilot：gate 客观核验态（pending/running/decided/failed，nullable brownfield） */
  gate_status?: string | null;
  /** P3 driver gate pilot：gate 结果（{exit_code, errors, raw_envelope}，nullable） */
  gate_result?: {
    exit_code: number;
    errors: string[];
    raw_envelope: Record<string, unknown>;
  } | null;
} | null;

/**
 * Agent 状态响应（GET /agent-status / POST /dispatch）。
 *
 * shadow schema: components.schemas.DispatchResponse（D-004@v2 有据例外保留手写）。
 * schema 的 last_dispatch / dispatch_result 是 `{[key:string]:unknown}` loose dict，
 * 手写 last_dispatch 是精确 DispatchResult（agent-status 展示读 `.status`/`.run_id`/
 * `.gate_status` 等调用方依赖）；schema current_stage required vs 手写 `| null`。
 * 迁过去会丢失 dispatch 结果字段类型，故保留手写。
 */
export type DispatchResponse = {
  change_id: string;
  current_stage: string | null;
  has_active_run: boolean;
  config_enabled: boolean;
  last_dispatch: DispatchResult;
  /**
   * 手动 dispatch（POST /dispatch）的软失败结果。200 OK + dispatched:false 时携带
   * reason + error（如 daemon-client root 校验失败 / dispatch_error）。前端必须读此
   * 字段显示失败原因——软失败不抛 ApiError，handleDispatch 的 catch 拿不到。
   */
  dispatch_result?: {
    dispatched: boolean;
    reason?: string | null;
    error?: string | null;
    stage?: string | null;
  };
};

/**
 * 获取 Agent 运行状态 — GET /api/workspaces/{wid}/changes/{cid}/agent-status
 */
export function getAgentStatus(workspaceId: string, changeId: string) {
  return apiFetch<DispatchResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/agent-status`,
  );
}

/**
 * 手动触发 Agent Dispatch — POST /api/workspaces/{wid}/changes/{cid}/dispatch
 *
 * 2026-08-12-dispatch-bind-agent-profile：加 agentProfileId（Query 参数，对齐后端
 * manual_dispatch 的 provider/model/agent_profile_id 三 Query）。
 */
export function triggerDispatch(
  workspaceId: string,
  changeId: string,
  provider?: string | null,
  model?: string | null,
  agentProfileId?: string | null,
) {
  const searchParams = new URLSearchParams();
  if (provider) searchParams.set("provider", provider);
  if (model) searchParams.set("model", model);
  if (agentProfileId) searchParams.set("agent_profile_id", agentProfileId);
  const qs = searchParams.toString();
  return apiFetch<DispatchResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/dispatch${qs ? `?${qs}` : ""}`,
    { method: "POST" },
  );
}

// ── Change 阶层按需触发（2026-08-08-change-center-on-demand task-12，FR-06/D-005）──
//
// 后端已砍 auto_dispatch 自动连轴（Wave 1），阶段完成停「完成待触发」态。
// 前端 handleDispatch 改显式调下列 HTTP 端点按需推进，不再依赖自动连轴。
// 注：api-types.ts 为 OpenAPI 生成，本次 allowed_paths 不含它；advance-stage /
// run-verify-gate 端点类型在此本地内联（TransitionResponse/TransitionRequest 已存在，
// VerifyGateResponse 为新增），不手写进 api-types.ts。

/**
 * 单步推进 change 阶层 — POST /api/workspaces/{wid}/changes/{cid}/advance-stage
 *
 * body/响应与 /transition 完全对齐（advance-stage 为前端语义命名别名，共用
 * ChangeService.transition_with_dispatch，team 分流 single→AgentService /
 * team→_dispatch_execute_team）。
 *
 * @param targetStage 目标阶段（brainstorm→plan→execute→verify→archive 的下一阶段）
 * @param opts 可选 agentProfileId/provider/model/team_mode/worker_preset/main_agent_config 覆盖
 */
export function advanceChangeStage(
  workspaceId: string,
  changeId: string,
  targetStage: string,
  opts?: {
    reason?: string;
    provider?: string | null;
    model?: string | null;
    agentProfileId?: string | null;
    teamMode?: boolean;
    workerPreset?: TransitionRequest["worker_preset"];
    mainAgentConfig?: TransitionRequest["main_agent_config"];
  },
) {
  const body: TransitionRequest = { target_stage: targetStage };
  if (opts?.reason !== undefined) body.reason = opts.reason;
  if (opts?.provider) body.provider = opts.provider;
  if (opts?.model) body.model = opts.model;
  if (opts?.agentProfileId) body.agent_profile_id = opts.agentProfileId;
  if (opts?.teamMode) {
    body.team_mode = true;
    if (opts.workerPreset && opts.workerPreset.length > 0) {
      body.worker_preset = opts.workerPreset;
    }
    if (opts.mainAgentConfig) body.main_agent_config = opts.mainAgentConfig;
  }
  return apiFetch<TransitionResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/advance-stage`,
    { method: "POST", json: body },
  );
}

/**
 * gate 软调用响应（task-11 / design §6.2/§6.3）。
 *
 * shadow schema: components.schemas.VerifyGateResponse（D-004@v2 有据例外保留手写）。
 * schema 的 source 是 loose `string`，手写是 `"gate_result"|"gate_cmd"|"unavailable"`
 * 精确 union（调用方 `===` 比较依赖 exhaustiveness）；schema 的 exit_code/errors 标 optional
 * 而手写 required（手写更严更准）。迁过去会丢失 union 收窄，故保留手写。
 */
export type VerifyGateResponse = {
  /** gate exit code（0=通过 / 1=打回 / 2=异常；unavailable 时为 null） */
  exit_code: number | null;
  /** gate errors 列表（已 str 强转） */
  errors: string[];
  /** 结果来源：gate_result / gate_cmd / unavailable */
  source: "gate_result" | "gate_cmd" | "unavailable";
};

/**
 * gate 软调用 — POST /api/workspaces/{wid}/changes/{cid}/run-verify-gate
 *
 * 不硬阻塞、不改 change 状态（结果交调用方决策）：优先读最近 completed
 * AgentRun.gate_result（source=gate_result），缺则软调 sillyspec gate verify
 * （source=gate_cmd），两者均不可用则 source=unavailable + exit_code=null。
 */
export function runVerifyGate(workspaceId: string, changeId: string) {
  return apiFetch<VerifyGateResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/run-verify-gate`,
    { method: "POST" },
  );
}

// ── HumanGate & Review API ─────────────────────────────────────────────
//
// task-13（FR-06）：proposalReview / planReview / humanTest / archiveConfirm 四个方法
// 是 submit_stage_review 语义的 HTTP 传输层（分别对应后端 /proposal-review、
// /plan-review、/human-test、/archive-confirm 路由），统一经 submitStageReview 分发调用。

export type HumanGate =
  | "none"
  | "need_requirement_input"
  | "need_proposal_review"
  | "need_plan_review"
  | "need_human_test"
  | "need_archive_confirm"
  | "blocked";

export type ReviewResponse = {
  change: ChangeRead;
  agent_dispatch: TransitionDispatchResponse | null;
  /**
   * D-006@v2（2026-08-14-change-center-conversation-driven task-04）：审批后后端
   * 以服务身份向绑定会话注入审批消息的结果。true=已注入；false 时 notify_error
   * 语义化（turn_conflict / session_inactive / inject_failed）。注入 best-effort，
   * 失败不回滚审批（R-03）。
   */
  notified_session: boolean;
  notify_error: string | null;
};

export function proposalReview(
  workspaceId: string,
  changeId: string,
  decision: "approve" | "revise" | "unclear",
  comment?: string,
  notifySession = true,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/proposal-review`,
    {
      method: "POST",
      json: {
        decision,
        comment: comment ?? null,
        notify_session: notifySession,
      },
    },
  );
}

export function planReview(
  workspaceId: string,
  changeId: string,
  decision: "approve" | "replan" | "back_to_propose" | "back_to_brainstorm",
  comment?: string,
  notifySession = true,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/plan-review`,
    {
      method: "POST",
      json: {
        decision,
        comment: comment ?? null,
        notify_session: notifySession,
      },
    },
  );
}

export function humanTest(
  workspaceId: string,
  changeId: string,
  result: "pass" | "bug" | "doc_mismatch",
  comment?: string,
  notifySession = true,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/human-test`,
    {
      method: "POST",
      json: {
        result,
        comment: comment ?? null,
        notify_session: notifySession,
      },
    },
  );
}

export function archiveConfirm(
  workspaceId: string,
  changeId: string,
  comment?: string,
  notifySession = true,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive-confirm`,
    {
      method: "POST",
      json: { comment: comment ?? null, notify_session: notifySession },
    },
  );
}

/**
 * submit_stage_review 统一前端入口（task-13，FR-06 收敛三条并存审核链路）。
 *
 * 对齐 backend ``mcp_gateway.submit_stage_review`` MCP tool（design §6.1）：按 action
 * 分发到既有 4 个 stage review HTTP 端点客户端方法（proposalReview / planReview /
 * humanTest / archiveConfirm，后端各有 HTTP 路由，零新增端点）。changes 详情页审批卡
 * 审核动作一律走本方法，作为唯一审核语义；旧 approval_status + 通用 submitReview
 * 链路已退役（approveChange / rejectChange / submitReview 标注只读，不再驱动推进）。
 *
 * @param action 审批卡 action 词表：proposal_approve / proposal_revise /
 *   proposal_unclear / plan_approve / plan_replan / plan_back_to_propose /
 *   plan_back_to_brainstorm / test_pass / test_bug / test_doc_mismatch / archive_confirm
 * @param comment 审核意见（可选，archive_confirm 亦透传）
 * @param notifySession D-006@v2（task-10）：是否通知绑定会话（透传后端 notify_session，
 *   默认 true）。审批落库后由后端以服务身份注入绑定会话，best-effort。
 */
export function submitStageReview(
  workspaceId: string,
  changeId: string,
  action: string,
  comment?: string,
  notifySession = true,
) {
  switch (action) {
    case "proposal_approve":
      return proposalReview(workspaceId, changeId, "approve", comment, notifySession);
    case "proposal_revise":
      return proposalReview(workspaceId, changeId, "revise", comment, notifySession);
    case "proposal_unclear":
      return proposalReview(workspaceId, changeId, "unclear", comment, notifySession);
    case "plan_approve":
      return planReview(workspaceId, changeId, "approve", comment, notifySession);
    case "plan_replan":
      return planReview(workspaceId, changeId, "replan", comment, notifySession);
    case "plan_back_to_propose":
      return planReview(workspaceId, changeId, "back_to_propose", comment, notifySession);
    case "plan_back_to_brainstorm":
      return planReview(workspaceId, changeId, "back_to_brainstorm", comment, notifySession);
    case "test_pass":
      return humanTest(workspaceId, changeId, "pass", comment, notifySession);
    case "test_bug":
      return humanTest(workspaceId, changeId, "bug", comment, notifySession);
    case "test_doc_mismatch":
      return humanTest(workspaceId, changeId, "doc_mismatch", comment, notifySession);
    case "archive_confirm":
      return archiveConfirm(workspaceId, changeId, comment, notifySession);
    default:
      // 未识别 action → 拒绝（对齐 MCP tool 的 400 语义，调用方捕获后展示）。
      return Promise.reject(
        new Error(`unsupported review action: ${action}`),
      );
  }
}

// ── Generic Review API（task-11 合并自 lib/workflow.ts，单一来源 D-006） ──

/** 通用审核记录（GET/POST /reviews 端点返回结构） */
export interface ReviewEntry {
  id: string;
  change_id: string;
  reviewer_id: string;
  verdict: "approve" | "reject";
  comment: string | null;
  created_at: string;
}

/**
 * 提交通用审核 — POST /api/workspaces/{wid}/changes/{cid}/reviews
 *
 * 退役（task-13，FR-06）：通用 verdict=approve/reject 审核链路不再驱动 change 推进，
 * changes 详情页已改走 submitStageReview（submit_stage_review 语义）。注意后端 workflow
 * router 仅有 GET /reviews（list_reviews），无 POST——本方法所打端点实际不存在（405），
 * 仅保留供既有历史调用方 / 数据兼容，只读参考，不再由 changes 详情页调用。
 */
export function submitReview(
  workspaceId: string,
  changeId: string,
  verdict: "approve" | "reject",
  comment?: string,
) {
  return apiFetch<ReviewEntry>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/reviews`,
    { method: "POST", json: { verdict, comment } },
  );
}

/** 拉取通用审核列表 — GET /api/workspaces/{wid}/changes/{cid}/reviews */
export function listReviews(workspaceId: string, changeId: string) {
  return apiFetch<ReviewEntry[]>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/reviews`,
  );
}
