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

export type ChangeDocMatrixEntry = {
  doc_type: string;
  exists: boolean;
  path: string;
  status: string | null;
  last_modified_at: string | null;
};

export type ChangeDocMatrix = {
  change_id: string;
  documents: ChangeDocMatrixEntry[];
  prototypes: string[];
  references: string[];
};

export type ChangeDocContent = {
  doc_type: string;
  path: string;
  content: string | null;
  exists: boolean;
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

/** daemon-client 代理创建变更的请求参数。 */
export type ProxyCreateChangeInput = {
  title: string;
  description?: string;
  change_type?: string;
  runtime_id: string;
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

export function getChangeDocuments(workspaceId: string, changeId: string) {
  return apiFetch<ChangeDocMatrix>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents`,
  );
}

export function getChangeDocumentContent(
  workspaceId: string,
  changeId: string,
  docType: string,
  path?: string,
) {
  const qs = path ? `?path=${encodeURIComponent(path)}` : "";
  return apiFetch<ChangeDocContent>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/documents/${docType}${qs}`,
  );
}

export function reparseChanges(workspaceId: string) {
  return apiFetch<ChangeReparseResponse>(
    `/api/workspaces/${workspaceId}/changes/reparse`,
    { method: "POST" },
  );
}

// 获取审批状态
export function getChangeApproval(workspaceId: string, changeKey: string) {
  return apiFetch<{ status: string; reason: string | null }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/approval`,
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

// 更新进度
export function updateChangeProgress(
  workspaceId: string,
  changeKey: string,
  data: { currentStage: string; stages: Record<string, any>; lastActive: string },
) {
  return apiFetch<{ ok: boolean }>(
    `/api/workspaces/${workspaceId}/changes/${changeKey}/progress`,
    {
      method: "POST",
      json: data,
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
) {
  const searchParams = new URLSearchParams();
  if (provider) searchParams.set("provider", provider);
  if (model) searchParams.set("model", model);
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
  return apiFetch<TransitionResponse>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/transition`,
    {
      method: "POST",
      json: body,
    },
  );
}

/**
 * 提交反馈 — POST /api/workspaces/{wid}/changes/{cid}/feedback
 *
 * 在 verify 阶段（pending_review=human_test）提交返工反馈。
 * 后端根据 category 自动决定返工目标阶段（execute/brainstorm 等）。
 */
export function submitFeedback(
  workspaceId: string,
  changeId: string,
  category: string,
  text: string,
) {
  return apiFetch<ChangeRead>(
    `/api/workspaces/${workspaceId}/changes/${changeId}/feedback`,
    {
      method: "POST",
      json: { category, text } satisfies FeedbackRequest,
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
} | null;

/** Agent 状态响应 */
export type DispatchResponse = {
  change_id: string;
  current_stage: string | null;
  has_active_run: boolean;
  config_enabled: boolean;
  last_dispatch: DispatchResult;
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
