import { apiFetch } from "./api";

export type ChangeSummary = {
  id: string;
  change_key: string;
  title: string | null;
  status: string;
  location: string;
  change_type: string | null;
  affected_components: string[];
  owner_id: string | null;
  current_stage: string | null;
  created_at: string;
  updated_at: string;
};

export type ChangeRead = ChangeSummary & {
  path: string;
  archived_at: string | null;
  current_stage: string | null;
  stages: Record<string, any> | null;
  approval_status: string | null;
  approved_by: string | null;
  approved_at: string | null;
  rejection_reason: string | null;
  /** 当前应展示的审核面板类型（task-03/07 StageProjectionService 投影，对齐 design §5 P3 / FR-03）。
   *  取值：proposal_review | plan_review | human_test | archive_confirm | null */
  pending_review: string | null;
};

export type ChangeList = {
  items: ChangeSummary[];
  total: number;
};

export type ChangeWarning = {
  code: string;
  detail: string;
  change_key: string | null;
  doc_type: string | null;
};

export type ChangeReparseStats = {
  parsed: number;
  created: number;
  updated: number;
  deleted: number;
};

export type ChangeReparseResponse = {
  workspace_id: string;
  stats: ChangeReparseStats;
  warnings: ChangeWarning[];
};

// ── Workflow Types (task-05) ────────────────────────────────────────────

/** 阶段流转请求参数 */
export type TransitionRequest = {
  /** 目标阶段，对应后端 StageEnum 值 */
  target_stage: string;
  /** 流转原因（可选） */
  reason?: string;
  /** 显式 agent provider（可选）；省略则后端用 workspace.default_agent */
  provider?: string | null;
  model?: string | null;
  /** execute/verify 阶段是否用团队执行（task-08，D-004@v2；省略/False=单 worker 零回归） */
  team_mode?: boolean;
  /** task-09（D-002@v2）：team_mode 用户预设 worker 列表，透传到 backend
   *  change.stages.team_worker_preset 供主 agent OrchestratorService 读取。 */
  worker_preset?: { agent_type: string; model: string; objective: string; role: string }[];
  /** task-09（D-003@v2）：team_mode 主 agent 配置 {agent_type, provider, model}。 */
  main_agent_config?: { agent_type?: string; provider?: string; model?: string };
};

/** 反馈提交请求参数 */
export type FeedbackRequest = {
  /** 反馈类别: A=Bug, B=设计错误, C=信息不足, D=衍生新change */
  category: string;
  /** 反馈内容 */
  text: string;
};

/** 归档门禁单项检查结果 */
/** 归档门禁单项检查结果（对齐后端 ArchiveCheckItem） */
export type ArchiveCheckItem = {
  /** 检查项名称，固定 6 项之一：no_unresolved_feedback / ac_confirmed /
   *  tech_verification_passed / business_review_passed /
   *  feedback_categorized / documents_complete */
  name: string;
  /** 该项是否通过 */
  passed: boolean;
  /** 说明信息（通过时通常为空串，未通过时给出原因） */
  detail: string;
};

/** 归档门禁检查响应（对齐后端 ArchiveGateResponse） */
export type ArchiveGateResponse = {
  /** 是否全部通过，可执行归档 */
  can_archive: boolean;
  /** 全部 6 项检查结果（含通过与未通过） */
  checks: ArchiveCheckItem[];
};

/** 创建变更的请求参数 */
export type CreateChangeInput = {
  title: string;
  description?: string;
  scope?: "full" | "quick";
  change_type?: string;
  affected_components?: string[];
  lease_id?: string;
};

/** daemon-client 代理创建变更的请求参数。

D-002@v1（2026-07-05-daemon-client-change-binding-fix）：删 ``runtime_id`` 字段——
runtime 由后端 ``resolve_runtime_for_writeback`` 用 binding + workspace.default_agent
现算，daemon_id 亦从 per-member binding 解析，前端无需传。 */
export type ProxyCreateChangeInput = {
  title: string;
  description?: string;
  change_type?: string;
};

/** 创建变更的响应 */
export type CreateChangeResponse = {
  id: string;
  workspace_id: string;
  change_key: string;
  title: string | null;
  status: string;
  path: string;
  current_stage: string | null;
  created_at: string;
};

export function listChanges(
  workspaceId: string,
  params?: { location?: string; status?: string; owner?: string; search?: string; currentStage?: string; page?: number; pageSize?: number },
) {
  const searchParams = new URLSearchParams();
  if (params?.location) searchParams.set("location", params.location);
  if (params?.status) searchParams.set("status", params.status);
  if (params?.owner) searchParams.set("owner", params.owner);
  if (params?.search) searchParams.set("search", params.search);
  if (params?.currentStage) searchParams.set("current_stage", params.currentStage);
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
export function approveChange(workspaceId: string, changeKey: string, approvedBy: string) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/approve`,
    {
      method: "POST",
      json: { approved_by: approvedBy },
    },
  );
}

// 驳回
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
 * 创建变更 — POST /workspaces/{id}/changes/create
 *
 * 支持传入 description 和 scope，两者均有后端默认值。
 */
export function createChange(
  workspaceId: string,
  input: CreateChangeInput,
) {
  return apiFetch<CreateChangeResponse>(
    `/api/workspaces/${workspaceId}/changes/create`,
    {
      method: "POST",
      json: input,
    },
  );
}

/**
 * daemon-client 代理创建变更 — POST /workspaces/{id}/changes/proxy-create
 *
 * 由绑定的在线 daemon 通过 change-write 任务代写 spec 树。
 */
export function proxyCreateChange(
  workspaceId: string,
  input: ProxyCreateChangeInput,
) {
  return apiFetch<CreateChangeResponse>(
    `/api/workspaces/${workspaceId}/changes/proxy-create`,
    {
      method: "POST",
      json: input,
    },
  );
}

/**
 * 启动变更执行 — POST /workspaces/{id}/changes/{changeKey}/execute
 *
 * 后端会创建 AgentRun 并后台执行 SillySpec 流程。
 */
export function executeChange(
  workspaceId: string,
  changeKey: string,
  provider?: string | null,
  model?: string | null,
  teamMode?: boolean,
) {
  const searchParams = new URLSearchParams();
  if (provider) searchParams.set("provider", provider);
  if (model) searchParams.set("model", model);
  // team-mode（task-08，D-002）：true 时附加 query，后端 execute 链路按 team 拆 Worker
  if (teamMode) searchParams.set("team_mode", "true");
  const qs = searchParams.toString();
  return apiFetch<{ ok: boolean; run_id: string }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/execute${qs ? `?${qs}` : ""}`,
    { method: "POST" },
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
  // ql-20260618-009：与 executeChange/triggerDispatch 风格统一，只在真值时附加
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

/** Transition 专用的 agent dispatch 结果（对应后端 TransitionDispatchResponse） */
export type TransitionDispatchResponse = {
  /** 是否成功 dispatch 了 AgentRun */
  dispatched: boolean;
  /** AgentRun ID（dispatched=true 时有值） */
  agent_run_id: string | null;
  /** 目标 SillySpec 阶段 */
  stage: string | null;
  /** 未 dispatch 的原因（dispatched=false 时有值） */
  reason: string | null;
  /** task-09（D-004@v2）：team_mode dispatch 的 Mission ID（仅 mode=team 时有值） */
  mission_id: string | null;
  /** task-09：dispatch 模式（team / null=single） */
  mode: string | null;
};

/** POST /changes/{id}/transition 的返回类型（对应后端 TransitionResponse） */
export type TransitionResponse = {
  /** 变更数据（ChangeRead 的 dict 表示） */
  change: ChangeRead;
  /** Agent dispatch 结果（无 dispatch 时为 null） */
  agent_dispatch: TransitionDispatchResponse | null;
};

/** Agent 运行结果 */
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

/** Agent 状态响应 */
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
 */
export function triggerDispatch(
  workspaceId: string,
  changeId: string,
  provider?: string | null,
  model?: string | null,
) {
  const searchParams = new URLSearchParams();
  if (provider) searchParams.set("provider", provider);
  if (model) searchParams.set("model", model);
  const qs = searchParams.toString();
  return apiFetch<DispatchResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/dispatch${qs ? `?${qs}` : ""}`,
    { method: "POST" },
  );
}

// ── HumanGate & Review API ─────────────────────────────────────────────

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
};

export function proposalReview(
  workspaceId: string,
  changeId: string,
  decision: "approve" | "revise" | "unclear",
  comment?: string,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/proposal-review`,
    {
      method: "POST",
      json: { decision, comment: comment ?? null },
    },
  );
}

export function planReview(
  workspaceId: string,
  changeId: string,
  decision: "approve" | "replan" | "back_to_propose" | "back_to_brainstorm",
  comment?: string,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/plan-review`,
    {
      method: "POST",
      json: { decision, comment: comment ?? null },
    },
  );
}

export function humanTest(
  workspaceId: string,
  changeId: string,
  result: "pass" | "bug" | "doc_mismatch",
  comment?: string,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/human-test`,
    {
      method: "POST",
      json: { result, comment: comment ?? null },
    },
  );
}

export function archiveConfirm(
  workspaceId: string,
  changeId: string,
  comment?: string,
) {
  return apiFetch<ReviewResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/archive-confirm`,
    {
      method: "POST",
      json: { comment: comment ?? null },
    },
  );
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
 * verdict=approve/reject 的通用审核入口（区别于上面 proposalReview/planReview 等
 * 阶段化审核端点）。
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
