/**
 * PPM 领域公共类型。
 *
 * 字段对齐后端 Pydantic schema (backend/app/modules/ppm/{project,plan,problem,task,kanban}/schema.py),
 * nullable 用 `T | null`,列表/字典默认 `[]`。供各子域 client (project/plan/
 * problem/task/kanban) 复用,避免循环 import。
 *
 * 设计依据:design.md §7 + tasks/task-09.md。
 */

// ===========================================================================
// 通用分页 (后端部分子域用 list 直返,部分用 Page<T>;此处仅 Page 子域用)
// ===========================================================================

export interface PageReq {
  page?: number;
  page_size?: number;
  order_by?: string | null;
  order?: "asc" | "desc";
}

export interface PageResp<T> {
  items: T[];
  total: number;
  page: number;
  page_size: number;
}

// ===========================================================================
// project 子域 (project/schema.py)
// ===========================================================================

export interface ProjectMaintenance {
  id: string;
  create_name: string | null;
  company_name: string | null;
  project_name: string | null;
  project_code: string;
  project_status: string | null;
  project_type: string | null;
  project_effective_start_time: string | null;
  project_effective_end_time: string | null;
  project_maintenance_end_time: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMaintenanceCreate {
  create_name?: string | null;
  company_name?: string | null;
  project_name?: string | null;
  project_code: string;
  project_status?: string | null;
  project_type?: string | null;
  project_effective_start_time?: string | null;
  project_effective_end_time?: string | null;
  project_maintenance_end_time?: string | null;
}

export interface ProjectMaintenanceUpdate {
  create_name?: string | null;
  company_name?: string | null;
  project_name?: string | null;
  project_status?: string | null;
  project_type?: string | null;
  project_effective_start_time?: string | null;
  project_effective_end_time?: string | null;
  project_maintenance_end_time?: string | null;
}

export interface ProjectMaintenancePageReq extends PageReq {
  project_name?: string | null;
  project_code?: string | null;
  project_status?: string | null;
  project_type?: string | null;
}

export interface ProjectSimpleItem {
  id: string;
  project_name: string | null;
}

export interface CustomerMaintenance {
  id: string;
  create_name: string | null;
  company_name: string | null;
  contact: string | null;
  phone_no: string | null;
  dept_name: string | null;
  level: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CustomerMaintenanceCreate {
  create_name?: string | null;
  company_name?: string | null;
  contact?: string | null;
  phone_no?: string | null;
  dept_name?: string | null;
  level?: string | null;
}

export interface CustomerMaintenanceUpdate {
  create_name?: string | null;
  company_name?: string | null;
  contact?: string | null;
  phone_no?: string | null;
  dept_name?: string | null;
  level?: string | null;
}

export interface CustomerMaintenancePageReq extends PageReq {
  company_name?: string | null;
  contact?: string | null;
  level?: string | null;
}

export interface ProjectMember {
  id: string;
  create_name: string | null;
  pm_project_id: string;
  user_id: string;
  user_name: string | null;
  depart_id: string | null;
  phone: string | null;
  role_id: string | null;
  role_name: string | null;
  depart_name: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectMemberCreate {
  create_name?: string | null;
  pm_project_id: string;
  user_id: string;
  user_name?: string | null;
  depart_id?: string | null;
  phone?: string | null;
  role_id?: string | null;
  role_name?: string | null;
  depart_name?: string | null;
}

export interface ProjectMemberUpdate {
  create_name?: string | null;
  user_name?: string | null;
  depart_id?: string | null;
  phone?: string | null;
  role_id?: string | null;
  role_name?: string | null;
  depart_name?: string | null;
}

export interface ProjectMemberPageReq extends PageReq {
  pm_project_id?: string | null;
  user_id?: string | null;
  role_name?: string | null;
}

export interface ProjectStakeholder {
  id: string;
  stakeholder: string | null;
  stakeholder_role: string | null;
  phone: string | null;
  pm_project_id: string;
  create_name: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectStakeholderCreate {
  create_name?: string | null;
  stakeholder?: string | null;
  stakeholder_role?: string | null;
  phone?: string | null;
  pm_project_id: string;
}

export interface ProjectStakeholderUpdate {
  create_name?: string | null;
  stakeholder?: string | null;
  stakeholder_role?: string | null;
  phone?: string | null;
}

export interface ProjectStakeholderPageReq extends PageReq {
  pm_project_id?: string | null;
  stakeholder?: string | null;
  stakeholder_role?: string | null;
}

// ===========================================================================
// plan 子域 (plan/schema.py)
// ===========================================================================

export interface PlanNode {
  id: string;
  overall_stage: string;
  project_type: string | null;
  no: number | null;
  created_at: string;
  updated_at: string;
}

export interface PlanNodeCreate {
  overall_stage: string;
  project_type?: string | null;
  no?: number | null;
}

export interface PlanNodeUpdate {
  overall_stage?: string | null;
  project_type?: string | null;
  no?: number | null;
}

export interface PlanNodeDetail {
  id: string;
  // 后端已放宽为 Optional (历史残留 Long ID 降级 NULL,见 schema.py D-fix@plan500)
  plan_node_id: string | null;
  detailed_stage: string | null;
  no: string | null;
  task_theme: string | null;
  task_description: string | null;
  requirements: string | null;
  role_name: string | null;
  achievement: string | null;
  overall_stage: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanNodeDetailCreate {
  plan_node_id: string;
  detailed_stage?: string | null;
  no?: string | null;
  task_theme?: string | null;
  task_description?: string | null;
  requirements?: string | null;
  role_name?: string | null;
  achievement?: string | null;
  overall_stage?: string | null;
}

export interface PlanNodeDetailUpdate {
  detailed_stage?: string | null;
  no?: string | null;
  task_theme?: string | null;
  task_description?: string | null;
  requirements?: string | null;
  role_name?: string | null;
  achievement?: string | null;
  overall_stage?: string | null;
}

export interface PlanNodeModule {
  id: string;
  // 同 PlanNodeDetail.plan_node_id (D-fix@plan500)
  plan_node_id: string | null;
  module_name: string | null;
  plan_workload: string | null;
  plan_begin_time: string | null;
  plan_complete_time: string | null;
  duty_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PlanNodeModuleCreate {
  plan_node_id: string;
  module_name?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  duty_user_id?: string | null;
}

export interface PlanNodeModuleUpdate {
  module_name?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  duty_user_id?: string | null;
}

export interface PsProjectPlan {
  id: string;
  // 同上 (D-fix@plan500)
  project_id: string | null;
  project_name: string | null;
  project_manager_id: string | null;
  project_manager_name: string | null;
  project_start_time: string | null;
  project_plan_end_time: string | null;
  contract_sign_time: string | null;
  contract_name: string | null;
  contract_amount: string | null;
  profit_margin: string | null;
  profit_amount: string | null;
  module: string | null;
  budget_amount: string | null;
  budget_person_days: string | null;
  actual_consumption_person_days: string | null;
  remaining_available_person_days: string | null;
  status: string;
  adjustment_person_days: string | null;
  total_cost: string | null;
  labor_cost: string | null;
  remaining_cost: string | null;
  cost_adjustment: string | null;
  company_name: string | null;
  create_name: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsProjectPlanCreate {
  project_id: string;
  project_name?: string | null;
  project_manager_id?: string | null;
  project_manager_name?: string | null;
  project_start_time?: string | null;
  project_plan_end_time?: string | null;
  contract_sign_time?: string | null;
  contract_name?: string | null;
  contract_amount?: string | null;
  profit_margin?: string | null;
  profit_amount?: string | null;
  module?: string | null;
  budget_amount?: string | null;
  budget_person_days?: string | null;
  actual_consumption_person_days?: string | null;
  remaining_available_person_days?: string | null;
  status?: string;
  adjustment_person_days?: string | null;
  total_cost?: string | null;
  labor_cost?: string | null;
  remaining_cost?: string | null;
  cost_adjustment?: string | null;
  company_name?: string | null;
  create_name?: string | null;
}

export interface PsProjectPlanUpdate {
  project_name?: string | null;
  project_manager_id?: string | null;
  project_manager_name?: string | null;
  project_start_time?: string | null;
  project_plan_end_time?: string | null;
  contract_sign_time?: string | null;
  contract_name?: string | null;
  contract_amount?: string | null;
  profit_margin?: string | null;
  profit_amount?: string | null;
  module?: string | null;
  budget_amount?: string | null;
  budget_person_days?: string | null;
  actual_consumption_person_days?: string | null;
  remaining_available_person_days?: string | null;
  status?: string | null;
  adjustment_person_days?: string | null;
  total_cost?: string | null;
  labor_cost?: string | null;
  remaining_cost?: string | null;
  cost_adjustment?: string | null;
  company_name?: string | null;
  create_name?: string | null;
}

export interface PsPlanNode {
  id: string;
  overall_stage: string | null;
  no: string | null;
  ps_project_plan_id: string;
  status: string;
  task_theme: string | null;
  plan_workload: string | null;
  plan_begin_time: string | null;
  plan_complete_time: string | null;
  duty_user_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsPlanNodeCreate {
  overall_stage?: string | null;
  no?: string | null;
  ps_project_plan_id: string;
  status?: string;
  task_theme?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  duty_user_id?: string | null;
}

export interface PsPlanNodeUpdate {
  overall_stage?: string | null;
  no?: string | null;
  status?: string | null;
  task_theme?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  duty_user_id?: string | null;
}

export interface PsPlanNodeDetail {
  id: string;
  // 同上 (D-fix@plan500)
  plan_node_id: string | null;
  detailed_stage: string | null;
  task_theme: string | null;
  task_description: string | null;
  requirements: string | null;
  role_name: string | null;
  achievement: string | null;
  overall_stage: string | null;
  plan_workload: string | null;
  plan_begin_time: string | null;
  plan_complete_time: string | null;
  actual_begin_time: string | null;
  actual_complete_time: string | null;
  no: string | null;
  execute_user_id: string | null;
  module_id: string | null;
  attach_group_id: string | null;
  file_urls: string[];
  status: string;
  parent_id: string | null;
  audit_user_id: string | null;
  audit_user_name: string | null;
  approve_user_id: string | null;
  approve_user_name: string | null;
  change_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsPlanNodeDetailCreate {
  plan_node_id: string;
  detailed_stage?: string | null;
  task_theme?: string | null;
  task_description?: string | null;
  requirements?: string | null;
  role_name?: string | null;
  achievement?: string | null;
  overall_stage?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  actual_begin_time?: string | null;
  actual_complete_time?: string | null;
  no?: string | null;
  execute_user_id?: string | null;
  module_id?: string | null;
  attach_group_id?: string | null;
  file_urls?: string[];
}

export interface PsPlanNodeDetailUpdate {
  detailed_stage?: string | null;
  task_theme?: string | null;
  task_description?: string | null;
  requirements?: string | null;
  role_name?: string | null;
  achievement?: string | null;
  overall_stage?: string | null;
  plan_workload?: string | null;
  plan_begin_time?: string | null;
  plan_complete_time?: string | null;
  actual_begin_time?: string | null;
  actual_complete_time?: string | null;
  no?: string | null;
  execute_user_id?: string | null;
  module_id?: string | null;
  attach_group_id?: string | null;
  file_urls?: string[] | null;
}

export interface PsPlanNodeDetailProcess {
  id: string;
  business_id: string;
  business_type: string;
  node_key: string | null;
  handle_user_id: string | null;
  handle_user_name: string | null;
  handle_date: string | null;
  handle_info: string | null;
  next_user_id: string | null;
  next_user_name: string | null;
  created_at: string;
}

export interface PlanProcessActionReq {
  handle_info?: string | null;
  next_user_id?: string | null;
  next_user_name?: string | null;
  /**
   * 变更审批独有字段(对照源 ChangeApproveNodeDetailForm)。
   *
   * status=change_pending 时,审批人填写:
   *  - change_approve_back_flag: "0" 同意 / "1" 驳回
   *  - change_approve_opinion:   审批意见
   *
   * 后端 plan/fsm.py 当前状态机无 change_pending(变更直接生成 draft 新版本
   * + 旧版本 archived),该字段为前端预留;若后端后续引入变更审批中间态,
   * savePlanNodeDetailProcess / rejectPlanNodeDetailProcess 直接透传即可。
   */
  change_approve_back_flag?: string | null;
  change_approve_opinion?: string | null;
}

export interface PlanChangeProcessReq {
  change_reason?: string | null;
  overrides?: Record<string, unknown>;
}

// task-03: 三联表 (plan → node → detail → task) + 成本派生

/** 三联表叶子节点 — 任务精简视图。 */
export interface PlanTaskSimple {
  id: string;
  content: string | null;
  status: string | null;
  work_load: string | null;
  time_spent: number | null;
  user_name: string | null;
  start_time: string | null;
  end_time: string | null;
}

/** ps 里程碑明细 + 其下任务列表。 */
export interface PsPlanNodeDetailWithTasks extends PsPlanNodeDetail {
  tasks: PlanTaskSimple[];
}

/** ps 里程碑节点 + 其下明细 (含任务)。 */
export interface PsPlanNodeWithDetail extends PsPlanNode {
  details: PsPlanNodeDetailWithTasks[];
}

/**
 * 项目计划三联表响应 (顶层)。
 *
 * remaining_* 为后端 service 层派生计算 (D-014@v1),覆盖 PsProjectPlan 同名字段。
 */
export interface ProjectPlanThreeLevel extends PsProjectPlan {
  remaining_available_person_days: string | null;
  remaining_cost: string | null;
  nodes: PsPlanNodeWithDetail[];
}

// ===========================================================================
// problem 子域 (problem/schema.py)
// ===========================================================================

export interface ProblemList {
  id: string;
  project_id: string;
  project_name: string | null;
  module_id: string | null;
  model_name: string | null;
  pro_desc: string | null;
  file_urls: string[];
  func_name: string | null;
  pro_type: string | null;
  is_urgent: string | null;
  find_by: string | null;
  find_time: string | null;
  pro_answer: string | null;
  work_type: string | null;
  duty_user_id: string | null;
  duty_user_name: string | null;
  plan_start_time: string | null;
  plan_end_time: string | null;
  real_end_time: string | null;
  audit_user_id: string | null;
  audit_user_name: string | null;
  audit_time: string | null;
  remarks: string | null;
  is_delay_plan: string | null;
  work_load: string | null;
  status: string;
  effective_status: string | null;
  time_spent: number | null;
  now_node: number | null;
  now_handle_user: string | null;
  now_handle_user_name: string | null;
  handle_info: string | null;
  check_info: string | null;
  check_result: string | null;
  check_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProblemListCreate {
  project_id: string;
  project_name?: string | null;
  module_id?: string | null;
  model_name?: string | null;
  pro_desc?: string | null;
  file_urls?: string[];
  func_name?: string | null;
  pro_type?: string | null;
  is_urgent?: string | null;
  find_by?: string | null;
  find_time?: string | null;
  pro_answer?: string | null;
  work_type?: string | null;
  duty_user_id?: string | null;
  duty_user_name?: string | null;
  plan_start_time?: string | null;
  plan_end_time?: string | null;
  remarks?: string | null;
  is_delay_plan?: string | null;
  work_load?: string | null;
  /** 验证人 ID (对照源 ListForm.vue auditUserId;后端 fsm 推进时据此指派)。 */
  audit_user_id?: string | null;
  audit_user_name?: string | null;
  /** submit=true 则创建后自动进 Node20 审核中 */
  submit?: boolean;
}

/** 问题清单查询参数(对齐后端 GET /problem-list Query)。 */
export interface ProblemListPageReq extends PageReq {
  /** 关键字:项目/模块/描述/功能/责任人/发现人 模糊匹配 */
  keyword?: string;
  /** 状态(可多值)。后端用 status=1&status=2 重复 query 接收。 */
  status?: string[];
  /** 项目 id 精确匹配 */
  project_id?: string;
  /** 问题类型:bug / change */
  pro_type?: string;
  /** '1' 急 / '0' 否 */
  is_urgent?: string;
  /** find_time ISO 起止(闭区间) */
  find_time_start?: string;
  find_time_end?: string;
}

/** 问题变更查询参数(对齐后端 GET /problem-change Query)。 */
export interface ProblemChangePageReq extends PageReq {
  /** 关键字:项目/模块/变更内容/变更原因 模糊匹配 */
  keyword?: string;
  /** 状态(可多值)。后端用 status=1&status=2 重复 query 接收。 */
  status?: string[];
  /** created_at ISO 起止(闭区间) */
  created_at_start?: string;
  created_at_end?: string;
}

export interface ProblemListUpdate {
  project_name?: string | null;
  module_id?: string | null;
  model_name?: string | null;
  pro_desc?: string | null;
  file_urls?: string[] | null;
  func_name?: string | null;
  pro_type?: string | null;
  is_urgent?: string | null;
  find_by?: string | null;
  find_time?: string | null;
  pro_answer?: string | null;
  work_type?: string | null;
  duty_user_id?: string | null;
  duty_user_name?: string | null;
  plan_start_time?: string | null;
  plan_end_time?: string | null;
  remarks?: string | null;
  is_delay_plan?: string | null;
  work_load?: string | null;
  audit_user_id?: string | null;
  audit_user_name?: string | null;
}

export interface ProblemChange {
  id: string;
  resource_id: string;
  project_id: string | null;
  project_name: string | null;
  model_name: string | null;
  pro_desc: string | null;
  func_name: string | null;
  pro_type: string | null;
  is_urgent: string | null;
  find_by: string | null;
  find_time: string | null;
  pro_answer: string | null;
  work_type: string | null;
  duty_user_id: string | null;
  duty_user_name: string | null;
  plan_start_time: string | null;
  plan_end_time: string | null;
  remarks: string | null;
  change_reason: string | null;
  work_load: string | null;
  is_delay_plan: string | null;
  status: string;
  now_node: number | null;
  now_handle_user: string | null;
  now_handle_user_name: string | null;
  audit_user_id: string | null;
  audit_user_name: string | null;
  audit_time: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProblemChangeCreate {
  resource_id: string;
  project_id?: string | null;
  project_name?: string | null;
  model_name?: string | null;
  pro_desc?: string | null;
  func_name?: string | null;
  pro_type?: string | null;
  is_urgent?: string | null;
  find_by?: string | null;
  find_time?: string | null;
  pro_answer?: string | null;
  work_type?: string | null;
  duty_user_id?: string | null;
  duty_user_name?: string | null;
  plan_start_time?: string | null;
  plan_end_time?: string | null;
  remarks?: string | null;
  change_reason?: string | null;
  work_load?: string | null;
  is_delay_plan?: string | null;
}

export interface ProblemChangeUpdate {
  pro_desc?: string | null;
  pro_type?: string | null;
  is_urgent?: string | null;
  duty_user_id?: string | null;
  duty_user_name?: string | null;
  plan_start_time?: string | null;
  plan_end_time?: string | null;
  change_reason?: string | null;
  work_load?: string | null;
  is_delay_plan?: string | null;
}

export interface ProblemProcessTask {
  id: string;
  business_id: string;
  node_key: string | null;
  node_name: string | null;
  now_handle_user: string | null;
  now_handle_user_name: string | null;
  created_at: string;
}

export interface ProblemProcessLog {
  id: string;
  business_id: string;
  node_key: string | null;
  handle_user_id: string | null;
  handle_user_name: string | null;
  handle_date: string | null;
  handle_info: string | null;
  next_user_id: string | null;
  next_user_name: string | null;
  comment: string | null;
  created_at: string;
}

export interface ProblemNextProcessReq {
  comment?: string | null;
}

export interface ProblemRejectProcessReq {
  comment?: string | null;
}

export interface ProblemChangeNextProcessReq {
  comment?: string | null;
}

export interface ProblemChangeRejectProcessReq {
  comment?: string | null;
}

export interface ProblemDoneTaskReq {
  handle_info?: string | null;
  time_spent?: number | null;
  /** true 推进到待验证;false 仅追加处置情况 */
  completed?: boolean;
}

export interface ProblemCloseTaskReq {
  check_info?: string | null;
  /** "1" 通过 → 已关闭;否则打回责任人 → 处置中 */
  check_result?: string;
}

// ===========================================================================
// task 子域 (task/schema.py)
// ===========================================================================

export interface PlanTask {
  id: string;
  user_id: string;
  user_name: string | null;
  status: string;
  month: string | null;
  week: string | null;
  year: string | null;
  week_day: string | null;
  start_time: string | null;
  end_time: string | null;
  project_id: string | null;
  project_name: string | null;
  module_id: string | null;
  module_name: string | null;
  content: string | null;
  work_load: string | null;
  add_work: string | null;
  work_partner: string | null;
  remarks: string | null;
  no: number | null;
  ps_plan_node_detail_id: string | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  start_remark: string | null;
  end_remark: string | null;
  time_spent: number | null;
  plan_attach_group_id: string | null;
  file_urls: string[];
  kanban_order: number;
  created_at: string;
  updated_at: string;
}

export interface PlanTaskCreate {
  user_id: string;
  user_name?: string | null;
  status?: string;
  month?: string | null;
  week?: string | null;
  year?: string | null;
  week_day?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  module_id?: string | null;
  module_name?: string | null;
  content?: string | null;
  work_load?: string | null;
  add_work?: string | null;
  work_partner?: string | null;
  remarks?: string | null;
  no?: number | null;
  ps_plan_node_detail_id?: string | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
  time_spent?: number | null;
  plan_attach_group_id?: string | null;
  file_urls?: string[];
  kanban_order?: number;
}

export interface PlanTaskUpdate {
  user_id?: string | null;
  user_name?: string | null;
  status?: string | null;
  month?: string | null;
  week?: string | null;
  year?: string | null;
  week_day?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  module_id?: string | null;
  module_name?: string | null;
  content?: string | null;
  work_load?: string | null;
  add_work?: string | null;
  work_partner?: string | null;
  remarks?: string | null;
  no?: number | null;
  ps_plan_node_detail_id?: string | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
  time_spent?: number | null;
  plan_attach_group_id?: string | null;
  file_urls?: string[] | null;
  kanban_order?: number | null;
}

export interface PlanTaskPageReq extends PageReq {
  user_id?: string | null;
  project_id?: string | null;
  /** 状态(可多值)。后端 alias=status */
  status?: string[];
  month?: string | null;
  year?: string | null;
  /** 计划起止区间(按 start_time 闭区间过滤) */
  start_time?: string;
  end_time?: string;
  /** 配合人员模糊匹配 */
  work_partner?: string;
}

export interface ExecutePlanReq {
  plan_task_id: string;
  submit?: boolean;
  task_execute_id?: string | null;
  execute_info?: string | null;
  time_spent?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  execute_user_id?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
}

export interface TaskExecute {
  id: string;
  plan_task_id: string | null;
  problem_task_id: string | null;
  time_spent: number | null;
  actual_start_time: string | null;
  actual_end_time: string | null;
  start_remark: string | null;
  end_remark: string | null;
  execute_info: string | null;
  attach_group_id: string | null;
  execute_user_id: string | null;
  check_info: string | null;
  check_attach_group_id: string | null;
  check_user_id: string | null;
  check_flag: string | null;
  current_user_id: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

/** 计划任务摘要(供 TaskExecute 关联展示任务名/项目)。 */
export interface PlanTaskBrief {
  id: string;
  content: string | null;
  project_id: string | null;
  project_name: string | null;
}

/** 任务执行 + 关联计划任务(看板「实际」tab 用)。 */
export interface TaskExecuteWithPlan extends TaskExecute {
  plan_task: PlanTaskBrief | null;
}

export interface TaskExecuteCreate {
  plan_task_id?: string | null;
  problem_task_id?: string | null;
  time_spent?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
  execute_info?: string | null;
  attach_group_id?: string | null;
  execute_user_id?: string | null;
  check_info?: string | null;
  check_attach_group_id?: string | null;
  check_user_id?: string | null;
  check_flag?: string | null;
  current_user_id?: string | null;
  status?: string;
}

export interface TaskExecuteUpdate {
  plan_task_id?: string | null;
  problem_task_id?: string | null;
  time_spent?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
  execute_info?: string | null;
  attach_group_id?: string | null;
  execute_user_id?: string | null;
  check_info?: string | null;
  check_attach_group_id?: string | null;
  check_user_id?: string | null;
  check_flag?: string | null;
  current_user_id?: string | null;
  status?: string | null;
}

export interface TaskExecutePageReq extends PageReq {
  plan_task_id?: string | null;
  /** 后端 alias=status */
  status?: string | null;
  execute_user_id?: string | null;
}

export interface WorkHour {
  id: string;
  project_id: string;
  task_id: string | null;
  user_id: string;
  work_date: string;
  hours: number;
  description: string | null;
  type: number;
  created_at: string;
  updated_at: string;
}

export interface WorkHourCreate {
  project_id: string;
  task_id?: string | null;
  user_id: string;
  work_date: string;
  hours: number;
  description?: string | null;
  type?: number;
}

export interface WorkHourUpdate {
  project_id?: string | null;
  task_id?: string | null;
  user_id?: string | null;
  work_date?: string | null;
  hours?: number | null;
  description?: string | null;
  type?: number | null;
}

export interface WorkHourPageReq extends PageReq {
  /** 后端 alias=user_id */
  user_id?: string | null;
  /** 后端 alias=project_id */
  project_id?: string | null;
  work_date_start?: string | null;
  work_date_end?: string | null;
  /** 后端 alias=type */
  type?: number | null;
}

export interface WorkHourStatItem {
  /** 聚合维度 ID (user_id 或 project_id) */
  key: string;
  total_hours: number;
  count: number;
}

export interface WorkHourStatResponse {
  /** 聚合维度名:"user" / "project" */
  dimension: string;
  start_date: string | null;
  end_date: string | null;
  items: WorkHourStatItem[];
  total_hours: number;
}

// ===========================================================================
// kanban 子域 (kanban/schema.py)
// ===========================================================================

export interface KanbanQueryReq {
  user_ids?: string[] | null;
  status?: string | null;
  project_id?: string | null;
  keyword?: string | null;
  /** true 时按 Organization 分组返回 (X-001) */
  group_by_org?: boolean;
  /** 日期范围起 (YYYY-MM-DD, 按 deadline/截止日期过滤;两重维度之日期维度) */
  start_date?: string | null;
  /** 日期范围止 (YYYY-MM-DD, 含当天) */
  end_date?: string | null;
}

export interface KanbanUserColumn {
  user_id: string;
  username: string | null;
  avatar: string | null;
  /** 所属组织 ID (Organization.id) */
  dept_id: string | null;
  dept_name: string | null;
  task_count: number;
  total_hours: number;
  /** 饱和度 0-100 */
  saturation: number;
  task_ids: string[];
}

export interface KanbanOrgGroup {
  /** 组织 ID (None=未分组) */
  org_id: string | null;
  org_name: string | null;
  members: KanbanUserColumn[];
}

export interface KanbanTaskCard {
  id: string;
  /** 任务标题 (PlanTask.content) */
  title: string | null;
  status: string | null;
  project_id: string | null;
  project_name: string | null;
  user_id: string | null;
  user_name: string | null;
  /** 截止时间 (PlanTask.end_time) */
  deadline: string | null;
  /** 开始时间 (PlanTask.start_time, 看板跨天连续展示用) */
  start_time: string | null;
  /** 优先级 1逾期/2活跃/3已完成 (派生) */
  priority: number | null;
  /** 进度 0/50/100 (派生) */
  progress: number | null;
  /** 创建时间 (PlanTask.created_at) */
  create_time: string | null;
  /** 更新时间 (PlanTask.updated_at) */
  update_time: string | null;
  /** 预估工时 (PlanTask.work_load 字符串解析) */
  estimate_hours: number | null;
  kanban_order: number;
  /** 附件 URL 列表 (PlanTask.file_urls) */
  file_urls: string[];
}

export interface KanbanTaskAssignReq {
  task_id: string;
  assignee_id: string;
  kanban_order?: number | null;
}

export interface KanbanTaskReorderReq {
  /** 所属人员列 (PlanTask.user_id) */
  user_id: string;
  /** 该列下任务的新顺序 (按数组下标写 kanban_order) */
  task_ids: string[];
}

// task-01: task CRUD + comment/subtask (FR-01 / D-011)

export interface KanbanTaskCreateReq {
  content: string;
  user_id?: string | null;
  project_id?: string | null;
  project_name?: string | null;
  work_load?: string | null;
  end_time?: string | null;
  file_urls?: string[];
}

export interface KanbanTaskUpdateReq {
  task_id: string;
  content?: string | null;
  status?: string | null;
  work_load?: string | null;
  end_time?: string | null;
  file_urls?: string[] | null;
}

export interface KanbanComment {
  id: string;
  task_id: string;
  user_id: string;
  user_name: string | null;
  content: string;
  created_at: string;
}

export interface KanbanCommentCreateReq {
  content: string;
}

export interface KanbanSubtask {
  id: string;
  task_id: string;
  title: string;
  done: boolean;
  sort_order: number;
  created_at: string;
}
