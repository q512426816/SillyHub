/**
 * PPM project 子域 API client。
 *
 * 端点前缀 `/api/ppm`,对齐后端 project/router.py:
 * - /project-maintenance        项目维护 (CRUD + simple-list + export-excel)
 * - /customer-maintenance       客户维护 (CRUD + export-excel)
 * - /project-member             项目成员 (CRUD)
 * - /project-stakeholder        项目干系人 (CRUD)
 *
 * 走统一 `apiFetch`(自动带 token + 401 刷新);导出走 `downloadExcel`。
 */
import { apiFetch } from "@/lib/api";
import { downloadExcel } from "./export";
import type {
  CustomerMaintenance,
  CustomerMaintenanceCreate,
  CustomerMaintenancePageReq,
  CustomerMaintenanceUpdate,
  PageResp,
  ProjectMaintenance,
  ProjectMaintenanceCreate,
  ProjectMaintenancePageReq,
  ProjectMaintenanceUpdate,
  ProjectMember,
  ProjectMemberCreate,
  ProjectMemberPageReq,
  ProjectMemberSummaryItem,
  ProjectMemberSummaryPageReq,
  ProjectMemberUpdate,
  ProjectSimpleItem,
  ProjectStakeholder,
  ProjectStakeholderCreate,
  ProjectStakeholderPageReq,
  ProjectStakeholderUpdate,
} from "./types";

// ===========================================================================
// 项目维护 /project-maintenance
// ===========================================================================

/**
 * 项目维护列表(真分页):后端返回 PageResp(items+total)。
 * PpmResourceTable serverSidePagination 模式直接调它。
 */
export async function pageProjects(
  params?: ProjectMaintenancePageReq,
): Promise<PageResp<ProjectMaintenance>> {
  return apiFetch<PageResp<ProjectMaintenance>>(
    "/api/ppm/project-maintenance",
    {
      query: params as Record<string, string | number | undefined> | undefined,
    },
  );
}

/**
 * 项目维护列表(向后兼容):返回 T[],内部取 pageProjects 第一页 items。
 * 注意:不传 page_size 时后端默认 20 条,大表请改用 pageProjects。
 */
export async function listProjects(
  params?: ProjectMaintenancePageReq,
): Promise<ProjectMaintenance[]> {
  const resp = await pageProjects(params);
  return resp.items;
}

export async function getProject(projectId: string): Promise<ProjectMaintenance> {
  return apiFetch<ProjectMaintenance>(`/api/ppm/project-maintenance/${projectId}`);
}

export async function createProject(
  body: ProjectMaintenanceCreate,
): Promise<ProjectMaintenance> {
  return apiFetch<ProjectMaintenance>("/api/ppm/project-maintenance", {
    method: "POST",
    json: body,
  });
}

export async function updateProject(
  projectId: string,
  body: ProjectMaintenanceUpdate,
): Promise<ProjectMaintenance> {
  return apiFetch<ProjectMaintenance>(`/api/ppm/project-maintenance/${projectId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteProject(projectId: string): Promise<void> {
  await apiFetch(`/api/ppm/project-maintenance/${projectId}`, { method: "DELETE" });
}

export async function listSimpleProjects(): Promise<ProjectSimpleItem[]> {
  return apiFetch<ProjectSimpleItem[]>(
    "/api/ppm/project-maintenance/simple-list",
  );
}

export async function exportProjects(
  params?: ProjectMaintenancePageReq,
): Promise<void> {
  await downloadExcel(
    "/api/ppm/project-maintenance/export-excel",
    params as Record<string, unknown> | undefined,
    "project_maintenance.xlsx",
  );
}

/**
 * 项目成员聚合分页 (design §7.4 / GET /api/ppm/project-maintenance/member-summary)。
 * 一行 = 一个项目 + member_count;member_keyword/role_name 为子表筛选透传。
 */
export async function pageProjectMemberSummary(
  params?: ProjectMemberSummaryPageReq,
): Promise<PageResp<ProjectMemberSummaryItem>> {
  return apiFetch<PageResp<ProjectMemberSummaryItem>>(
    "/api/ppm/project-maintenance/member-summary",
    { query: params as Record<string, string | number | undefined> | undefined },
  );
}

// ===========================================================================
// 客户维护 /customer-maintenance
// ===========================================================================

export async function pageCustomers(
  params?: CustomerMaintenancePageReq,
): Promise<PageResp<CustomerMaintenance>> {
  return apiFetch<PageResp<CustomerMaintenance>>(
    "/api/ppm/customer-maintenance",
    {
      query: params as Record<string, string | number | undefined> | undefined,
    },
  );
}

export async function listCustomers(
  params?: CustomerMaintenancePageReq,
): Promise<CustomerMaintenance[]> {
  const resp = await pageCustomers(params);
  return resp.items;
}

export async function getCustomer(customerId: string): Promise<CustomerMaintenance> {
  return apiFetch<CustomerMaintenance>(`/api/ppm/customer-maintenance/${customerId}`);
}

export async function createCustomer(
  body: CustomerMaintenanceCreate,
): Promise<CustomerMaintenance> {
  return apiFetch<CustomerMaintenance>("/api/ppm/customer-maintenance", {
    method: "POST",
    json: body,
  });
}

export async function updateCustomer(
  customerId: string,
  body: CustomerMaintenanceUpdate,
): Promise<CustomerMaintenance> {
  return apiFetch<CustomerMaintenance>(`/api/ppm/customer-maintenance/${customerId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteCustomer(customerId: string): Promise<void> {
  await apiFetch(`/api/ppm/customer-maintenance/${customerId}`, { method: "DELETE" });
}

export async function exportCustomers(
  params?: CustomerMaintenancePageReq,
): Promise<void> {
  await downloadExcel(
    "/api/ppm/customer-maintenance/export-excel",
    params as Record<string, unknown> | undefined,
    "customer_maintenance.xlsx",
  );
}

// ===========================================================================
// 项目成员 /project-member
// ===========================================================================

export async function pageProjectMembers(
  params?: ProjectMemberPageReq,
): Promise<PageResp<ProjectMember>> {
  return apiFetch<PageResp<ProjectMember>>("/api/ppm/project-member", {
    query: params as Record<string, string | number | undefined> | undefined,
  });
}

export async function listProjectMembers(
  params?: ProjectMemberPageReq,
): Promise<ProjectMember[]> {
  // 后端 /project-member 默认 page_size=20,这里按 200(后端 le=200 上限)翻页拿全量,
  // 避免 PpmUserSelect res=projectMember 等下拉在大表时只显示前 20 条(第 21+ 缺失)。
  const PAGE_SIZE = 200;
  let page = 1;
  let all: ProjectMember[] = [];
  for (;;) {
    const resp = await pageProjectMembers({ ...params, page, page_size: PAGE_SIZE });
    all = all.concat(resp.items);
    if (resp.items.length < PAGE_SIZE) break; // 最后一页(不足一页)
    page += 1;
    if (page > 100) break; // 安全上限(200*100=20000),防异常死循环
  }
  return all;
}

export async function getProjectMember(memberId: string): Promise<ProjectMember> {
  return apiFetch<ProjectMember>(`/api/ppm/project-member/${memberId}`);
}

export async function createProjectMember(
  body: ProjectMemberCreate,
): Promise<ProjectMember> {
  return apiFetch<ProjectMember>("/api/ppm/project-member", {
    method: "POST",
    json: body,
  });
}

export async function updateProjectMember(
  memberId: string,
  body: ProjectMemberUpdate,
): Promise<ProjectMember> {
  return apiFetch<ProjectMember>(`/api/ppm/project-member/${memberId}`, {
    method: "PUT",
    json: body,
  });
}

export async function deleteProjectMember(memberId: string): Promise<void> {
  await apiFetch(`/api/ppm/project-member/${memberId}`, { method: "DELETE" });
}

// ===========================================================================
// 项目干系人 /project-stakeholder
// ===========================================================================

export async function pageProjectStakeholders(
  params?: ProjectStakeholderPageReq,
): Promise<PageResp<ProjectStakeholder>> {
  return apiFetch<PageResp<ProjectStakeholder>>(
    "/api/ppm/project-stakeholder",
    {
      query: params as Record<string, string | number | undefined> | undefined,
    },
  );
}

export async function listProjectStakeholders(
  params?: ProjectStakeholderPageReq,
): Promise<ProjectStakeholder[]> {
  const resp = await pageProjectStakeholders(params);
  return resp.items;
}

export async function getProjectStakeholder(
  stakeholderId: string,
): Promise<ProjectStakeholder> {
  return apiFetch<ProjectStakeholder>(
    `/api/ppm/project-stakeholder/${stakeholderId}`,
  );
}

export async function createProjectStakeholder(
  body: ProjectStakeholderCreate,
): Promise<ProjectStakeholder> {
  return apiFetch<ProjectStakeholder>("/api/ppm/project-stakeholder", {
    method: "POST",
    json: body,
  });
}

export async function updateProjectStakeholder(
  stakeholderId: string,
  body: ProjectStakeholderUpdate,
): Promise<ProjectStakeholder> {
  return apiFetch<ProjectStakeholder>(
    `/api/ppm/project-stakeholder/${stakeholderId}`,
    { method: "PUT", json: body },
  );
}

export async function deleteProjectStakeholder(stakeholderId: string): Promise<void> {
  await apiFetch(`/api/ppm/project-stakeholder/${stakeholderId}`, {
    method: "DELETE",
  });
}
