/**
 * PPM plan 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 plan/router.py:
 * - /plan-node                  计划节点模板 CRUD
 * - /plan-node/{id}/details     模板明细列表
 * - /plan-node-detail-tpl       模板明细 CRUD
 * - /plan-node/{id}/modules     模块列表
 * - /plan-node-module           模块 CRUD
 * - /project-plan               ps 项目计划 CRUD
 * - /project-plan/{id}/plan-nodes ps 里程碑列表
 * - /plan-node-ps               ps 里程碑 CRUD
 * - /plan-node-ps/{id}/details  ps 里程碑明细列表
 * - /plan-node-detail           ps 里程碑明细 CRUD
 * - /plan-node-detail/{id}/versions           版本链
 * - /plan-node-detail/{id}/process/{save|reject|change}  流程动作
 * - /plan-node-detail/{id}/processes          流程履历
 * - /plan-node/export-excel     导出 (X-002)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type {
  PlanChangeProcessReq,
  PlanNode,
  PlanNodeDetail,
  PlanNodeDetailCreate,
  PlanNodeDetailUpdate,
  PlanNodeCreate,
  PlanNodeModule,
  PlanNodeModuleCreate,
  PlanNodeModuleUpdate,
  PlanNodeUpdate,
  PlanProcessActionReq,
  PageReq,
  PageResp,
  ProjectPlanThreeLevel,
  PsPlanNode,
  PsPlanNodeDetail,
  PsPlanNodeDetailCreate,
  PsPlanNodeDetailProcess,
  PsPlanNodeDetailUpdate,
  PsPlanNodeCreate,
  PsPlanNodeUpdate,
  PsProjectPlan,
  PsProjectPlanCreate,
  PsProjectPlanUpdate,
} from "./types";

function pageQuery(
  params?: PageReq,
): { query: Record<string, string | number | undefined> } | undefined {
  if (!params) return undefined;
  const q: Record<string, string | number | undefined> = {};
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    q[k] = v;
  }
  return { query: q };
}

// ===========================================================================
// 计划节点模板 /plan-node
// ===========================================================================

export async function listPlanNodes(params?: PageReq): Promise<PlanNode[]> {
  return apiFetch<PlanNode[]>("/api/ppm/plan-node", pageQuery(params));
}

export async function getPlanNode(nodeId: string): Promise<PlanNode> {
  return apiFetch<PlanNode>(`/api/ppm/plan-node/${nodeId}`);
}

export async function createPlanNode(body: PlanNodeCreate): Promise<PlanNode> {
  return apiFetch<PlanNode>("/api/ppm/plan-node", { method: "POST", json: body });
}

export async function updatePlanNode(
  nodeId: string,
  body: PlanNodeUpdate,
): Promise<PlanNode> {
  return apiFetch<PlanNode>(`/api/ppm/plan-node/${nodeId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deletePlanNode(nodeId: string): Promise<void> {
  await apiFetch(`/api/ppm/plan-node/${nodeId}`, { method: "DELETE" });
}

export async function exportPlanNodes(): Promise<void> {
  await downloadExcel("/api/ppm/plan-node/export-excel", undefined, "plan_nodes.xlsx");
}

/** P2-3:导出项目计划 (projectplan)。 */
export async function exportProjectPlans(): Promise<void> {
  await downloadExcel(
    "/api/ppm/project-plan/export-excel",
    undefined,
    "project_plans.xlsx",
  );
}

/** P2-3:导出里程碑明细 (psplannodedetail,仅非 archived)。 */
export async function exportMilestoneDetails(): Promise<void> {
  await downloadExcel(
    "/api/ppm/plan-node-detail/export-excel",
    undefined,
    "plan_node_details.xlsx",
  );
}

// ===========================================================================
// 模板明细 /plan-node-detail-tpl + /plan-node/{id}/details
// ===========================================================================

export async function listPlanNodeDetails(
  planNodeId: string,
): Promise<PlanNodeDetail[]> {
  return apiFetch<PlanNodeDetail[]>(`/api/ppm/plan-node/${planNodeId}/details`);
}

export async function createPlanNodeDetailTpl(
  body: PlanNodeDetailCreate,
): Promise<PlanNodeDetail> {
  return apiFetch<PlanNodeDetail>("/api/ppm/plan-node-detail-tpl", {
    method: "POST",
    json: body,
  });
}

export async function updatePlanNodeDetailTpl(
  detailId: string,
  body: PlanNodeDetailUpdate,
): Promise<PlanNodeDetail> {
  return apiFetch<PlanNodeDetail>(`/api/ppm/plan-node-detail-tpl/${detailId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deletePlanNodeDetailTpl(detailId: string): Promise<void> {
  await apiFetch(`/api/ppm/plan-node-detail-tpl/${detailId}`, {
    method: "DELETE",
  });
}

// ===========================================================================
// 模块 /plan-node-module + /plan-node/{id}/modules
// ===========================================================================

export async function listPlanNodeModules(
  planNodeId: string,
): Promise<PlanNodeModule[]> {
  return apiFetch<PlanNodeModule[]>(`/api/ppm/plan-node/${planNodeId}/modules`);
}

export async function createPlanNodeModule(
  body: PlanNodeModuleCreate,
): Promise<PlanNodeModule> {
  return apiFetch<PlanNodeModule>("/api/ppm/plan-node-module", {
    method: "POST",
    json: body,
  });
}

export async function updatePlanNodeModule(
  moduleId: string,
  body: PlanNodeModuleUpdate,
): Promise<PlanNodeModule> {
  return apiFetch<PlanNodeModule>(`/api/ppm/plan-node-module/${moduleId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deletePlanNodeModule(moduleId: string): Promise<void> {
  await apiFetch(`/api/ppm/plan-node-module/${moduleId}`, { method: "DELETE" });
}

// ===========================================================================
// ps 项目计划 /project-plan
// ===========================================================================

export async function listProjectPlans(
  params?: PageReq,
): Promise<PageResp<PsProjectPlan>> {
  return apiFetch<PageResp<PsProjectPlan>>(
    "/api/ppm/project-plan",
    pageQuery(params),
  );
}

export async function getProjectPlan(planId: string): Promise<PsProjectPlan> {
  return apiFetch<PsProjectPlan>(`/api/ppm/project-plan/${planId}`);
}

export async function createProjectPlan(
  body: PsProjectPlanCreate,
): Promise<PsProjectPlan> {
  return apiFetch<PsProjectPlan>("/api/ppm/project-plan", {
    method: "POST",
    json: body,
  });
}

export async function updateProjectPlan(
  planId: string,
  body: PsProjectPlanUpdate,
): Promise<PsProjectPlan> {
  return apiFetch<PsProjectPlan>(`/api/ppm/project-plan/${planId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteProjectPlan(planId: string): Promise<void> {
  await apiFetch(`/api/ppm/project-plan/${planId}`, { method: "DELETE" });
}

/**
 * 三联表查询 (task-03) — plan → node → detail → task 四层嵌套 + 成本派生。
 *
 * 单计划完整树,不分页;remaining_* 由后端 service 层派生计算 (D-014@v1)。
 */
export async function getProjectPlanThreeLevel(
  planId: string,
): Promise<ProjectPlanThreeLevel> {
  return apiFetch<ProjectPlanThreeLevel>(
    `/api/ppm/project-plan/${planId}/three-level`,
  );
}

// ===========================================================================
// ps 里程碑 /plan-node-ps + /project-plan/{id}/plan-nodes
// ===========================================================================

export async function listPsPlanNodes(planId: string): Promise<PsPlanNode[]> {
  return apiFetch<PsPlanNode[]>(`/api/ppm/project-plan/${planId}/plan-nodes`);
}

export async function getPsPlanNode(nodeId: string): Promise<PsPlanNode> {
  return apiFetch<PsPlanNode>(`/api/ppm/plan-node-ps/${nodeId}`);
}

export async function createPsPlanNode(
  body: PsPlanNodeCreate,
): Promise<PsPlanNode> {
  return apiFetch<PsPlanNode>("/api/ppm/plan-node-ps", {
    method: "POST",
    json: body,
  });
}

export async function updatePsPlanNode(
  nodeId: string,
  body: PsPlanNodeUpdate,
): Promise<PsPlanNode> {
  return apiFetch<PsPlanNode>(`/api/ppm/plan-node-ps/${nodeId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deletePsPlanNode(nodeId: string): Promise<void> {
  await apiFetch(`/api/ppm/plan-node-ps/${nodeId}`, { method: "DELETE" });
}

// ===========================================================================
// ps 里程碑明细 /plan-node-detail + /plan-node-ps/{id}/details
// + 版本链 + 流程端点
// ===========================================================================

export async function listPsPlanNodeDetails(
  planNodeId: string,
): Promise<PsPlanNodeDetail[]> {
  return apiFetch<PsPlanNodeDetail[]>(
    `/api/ppm/plan-node-ps/${planNodeId}/details`,
  );
}

export async function getPsPlanNodeDetail(
  detailId: string,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>(`/api/ppm/plan-node-detail/${detailId}`);
}

export async function createPsPlanNodeDetail(
  body: PsPlanNodeDetailCreate,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>("/api/ppm/plan-node-detail", {
    method: "POST",
    json: body,
  });
}

export async function updatePsPlanNodeDetail(
  detailId: string,
  body: PsPlanNodeDetailUpdate,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>(`/api/ppm/plan-node-detail/${detailId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deletePsPlanNodeDetail(detailId: string): Promise<void> {
  await apiFetch(`/api/ppm/plan-node-detail/${detailId}`, { method: "DELETE" });
}

/** 版本链 — 拉取该明细的所有历史版本 (含变更归档)。 */
export async function listPsPlanNodeDetailVersions(
  detailId: string,
): Promise<PsPlanNodeDetail[]> {
  return apiFetch<PsPlanNodeDetail[]>(
    `/api/ppm/plan-node-detail/${detailId}/versions`,
  );
}

// ---------- 流程:save / reject / change ----------

/** save — 提交审批 / 推进到下一节点。 */
export async function savePlanNodeDetailProcess(
  detailId: string,
  body?: PlanProcessActionReq,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>(
    `/api/ppm/plan-node-detail/${detailId}/process/save`,
    { method: "POST", json: body ?? {} },
  );
}

/** reject — 驳回。 */
export async function rejectPlanNodeDetailProcess(
  detailId: string,
  body?: PlanProcessActionReq,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>(
    `/api/ppm/plan-node-detail/${detailId}/process/reject`,
    { method: "POST", json: body ?? {} },
  );
}

/** change — 复制当前版本为草稿新版本,旧版本归档。 */
export async function changePlanNodeDetailProcess(
  detailId: string,
  body?: PlanChangeProcessReq,
): Promise<PsPlanNodeDetail> {
  return apiFetch<PsPlanNodeDetail>(
    `/api/ppm/plan-node-detail/${detailId}/process/change`,
    { method: "POST", json: body ?? {} },
  );
}

/** 流程履历 — 拉取该明细的所有流程流转记录。 */
export async function listPlanNodeDetailProcesses(
  detailId: string,
): Promise<PsPlanNodeDetailProcess[]> {
  return apiFetch<PsPlanNodeDetailProcess[]>(
    `/api/ppm/plan-node-detail/${detailId}/processes`,
  );
}
