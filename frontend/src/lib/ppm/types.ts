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

/**
 * 项目成员聚合视图 (design §7.4 / GET /api/ppm/project-maintenance/member-summary)。
 *
 * 一行 = 一个项目,member_count 为该项目下成员数;字段对齐后端聚合 DTO。
 */
export interface ProjectMemberSummaryItem {
  id: string;
  project_name: string | null;
  project_code: string;
  project_status: string | null;
  project_type: string | null;
  company_name: string | null;
  owner_name: string | null;
  member_count: number;
  updated_at: string;
}

/**
 * 项目成员聚合分页查询参数 (design §7.4)。
 * member_keyword/role_name 对应后端子表筛选透传。
 */
export interface ProjectMemberSummaryPageReq extends PageReq {
  project_name?: string | null;
  project_status?: string | null;
  project_type?: string | null;
  owner_name?: string | null;
  member_keyword?: string | null;
  role_name?: string | null;
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
  /** 登录账号 (对齐后端聚合;子表账号列用,task-07)。 */
  username?: string | null;
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
  /** 是否有模块子表 (新建时定,保存后不可改,D-001@v1)。 */
  has_module: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanNodeCreate {
  overall_stage: string;
  project_type?: string | null;
  no?: number | null;
  /** 是否有模块子表 (必填,新建时定,D-001@v1)。 */
  has_module: boolean;
}

export interface PlanNodeUpdate {
  overall_stage?: string | null;
  project_type?: string | null;
  no?: number | null;
  /** v3: 编辑时可改 (D-001 取消)。 */
  has_module?: boolean | null;
}

export interface PlanNodeDetail {
  id: string;
  // 后端已放宽为 Optional (历史残留 Long ID 降级 NULL,见 schema.py D-fix@plan500)
  plan_node_id: string | null;
  /** 所属模块 (有模块模板时挂模块,D-002@v1 三层);无模块模板为 null 挂 plan_node_id。 */
  module_id: string | null;
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
  /** 所属模块 (有模块模板时挂模块,D-002@v1);无模块模板不传。 */
  module_id?: string | null;
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
  /** 所属模块 (可改归属,后端重校验 D-004);无模块模板须为 null。 */
  module_id?: string | null;
}

export interface PlanNodeModule {
  id: string;
  // 同 PlanNodeDetail.plan_node_id (D-fix@plan500)
  plan_node_id: string | null;
  module_name: string | null;
  // 计划类型: "正常计划" / "临时计划" / null (design §6 + task-02; 旧数据为 NULL)
  plan_type: string | null;
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
  // 计划类型(编辑保存不丢字段,design §12 自审)
  plan_type?: string | null;
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
  /** 来源模板 (新建项目计划时从 PlanNode 生成写入;手动建为 null) */
  template_plan_node_id: string | null;
  /** 是否有模块 (冗余自模板,milestone-details 模块层判断用) */
  has_module: boolean;
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
  // 派生字段(不落库):后端查询时关联反查填充,只读视图展示用。
  execute_user_name: string | null;
  module_name: string | null;
  // 执行状态(派生,不落库):关联任务 PlanTask.status 的实时值
  // (未开始/进行中/已完成)。明细列表「执行状态」列展示用;无关联任务为 null。
  task_execute_status: string | null;
  change_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface PsPlanNodeDetailCreate {
  plan_node_id: string;
  /** 提交=done（创建为正式，不走审核）；默认空=草稿 draft。ql-20260713-010 */
  status?: string | null;
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

// task-08: 模块 Excel 导入 DTO (design §7.2;字段对齐后端 plan/schema.py)
//
// 注意:所有字段名与后端 Pydantic snake_case 完全一致;
// - datetime 字段后端序列化为 ISO 字符串 → 此处用 string;
// - uuid.UUID 字段 → string;
// - ImportCommitReq 不含 pm_project_id (duty_user_id 随行回传, design §7.2 / X-008)。

/** 单行预览结果 — Excel 一行对应一 DTO。 */
export interface ImportPreviewRow {
  sheet_name: string;
  /** "正常计划" / "临时计划" */
  plan_type: string;
  /** 平台/子系统 (已向下填充) */
  module_name: string | null;
  /** 任务分类 */
  detailed_stage: string | null;
  task_theme: string | null;
  task_description: string | null;
  /** 原样字符串 (后端不解析为数值) */
  plan_workload: string | null;
  /** Excel 原始责任人 (多人取首个,原文保留) */
  duty_user_name: string | null;
  /** 反查到的项目成员 UUID;未匹配为 null */
  duty_user_id: string | null;
  /** 是否匹配到项目成员 */
  duty_matched: boolean;
  /** 多人时未采用的姓名提示 */
  duty_unmatched_note: string | null;
  /** ISO 字符串 */
  plan_begin_time: string | null;
  plan_complete_time: string | null;
  /** 是否可导入 (责任人未匹配/必填缺失 → false) */
  valid: boolean;
  /** 不可导入原因 */
  error: string | null;
}

/** 单 Sheet 预览结果。 */
export interface ImportPreviewSheet {
  name: string;
  plan_type: string;
  row_count: number;
  rows: ImportPreviewRow[];
}

/** 预览响应 — 多 Sheet + 整体解析错误 (如找不到表头)。 */
export interface ImportPreviewResp {
  sheets: ImportPreviewSheet[];
  parse_errors: string[];
}

/** 提交请求中的单 Sheet — 前端回传用户确认导入的行 (valid 行)。 */
export interface ImportCommitSheet {
  name: string;
  plan_type: string;
  rows: ImportPreviewRow[];
}

/**
 * 导入提交请求。
 *
 * duty_user_id 已在 preview 反查并随行回传,无需 pm_project_id (X-008)。
 */
export interface ImportCommitReq {
  sheets: ImportCommitSheet[];
}

/** 导入结果 — 计数 + 失败行描述。 */
export interface ImportResultResp {
  created_modules: number;
  /** 追加明细到已存在同名模块的次数 */
  merged_modules: number;
  created_details: number;
  /** valid=false 被排除的行数 */
  skipped_rows: number;
  /** 入库阶段失败的行描述 */
  failed_rows: string[];
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
  /** 创建人 ID (编辑/删除权限判断依据之一; 历史数据 null) */
  created_by: string | null;
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
  /** 已消耗工时(人天, 后端聚合 sum TaskExecute.time_spent) */
  spent_time?: number;
  /** 后端集中判断的编辑放行 (超管‖创建人‖本项目经理‖责任人), 前端只读 */
  can_edit?: boolean;
  /** 后端集中判断的删除放行 (同 can_edit) */
  can_delete?: boolean;
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
  /** 验证人 ID (对照源 ListForm.vue auditUserId;变更流 deprecated 保留)。 */
  audit_user_id?: string | null;
  audit_user_name?: string | null;
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
  /** 责任人 id(我的任务过滤) */
  duty_user_id?: string;
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
  /** 处置人 (流程当前处置人，编辑表单可调整) */
  now_handle_user?: string | null;
  now_handle_user_name?: string | null;
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

export interface ProblemStartReq {
  /** 跨天拆分补填时传指定日期, 默认 now;problem_id 取自路径, execute_user_id 取自登录用户 */
  actual_start_time?: string | null;
}

export interface ProblemExecuteReq {
  /** start 返回的 in-flight 执行记录 id (必填, 收口哪条) */
  task_execute_id: string;
  /** "submit"(回新建, 可再次开始重复执行) / "complete"(已完成, 终态) */
  action: "submit" | "complete";
  execute_info?: string | null;
  time_spent?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  execute_user_id?: string | null;
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
  task_description: string | null;
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
  /** 已消耗工时(人天, 后端聚合 sum TaskExecute.time_spent) */
  spent_time?: number;
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
  module_id?: string | null;
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

/** 执行计划请求(D-003: 删 submit 改 action 枚举, 不反向兼容)。 */
export interface ExecutePlanReq {
  plan_task_id: string;
  /** "submit"(保存本次+任务回未开始, 可再次填报) / "complete"(保存本次+任务已完成) */
  action: "submit" | "complete";
  /** start 端点返回的 in-flight 执行记录 id(execute 时必填) */
  task_execute_id: string;
  execute_info?: string | null;
  time_spent?: number | null;
  actual_start_time?: string | null;
  actual_end_time?: string | null;
  execute_user_id?: string | null;
  start_remark?: string | null;
  end_remark?: string | null;
}

/** 启动任务请求(D-002: 未开始→进行中, 创建 in-flight TaskExecute 记 actual_start_time)。 */
export interface StartReq {
  plan_task_id: string;
  execute_user_id?: string | null;
  /** 跨天拆分补填时传指定日期, 默认 now */
  actual_start_time?: string | null;
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
  problem_task_id?: string | null;
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
  /** 预估工时 (PlanTask.work_load 字符串解析,单位人天) */
  estimate_hours: number | null;
  /** 任务描述 (PlanTask.task_description) */
  task_description: string | null;
  /** 所属模块名 (PlanTask.module_name) */
  module_name: string | null;
  /** 配合人员 (PlanTask.work_partner) */
  work_partner: string | null;
  /** 备注 (PlanTask.remarks) */
  remarks: string | null;
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

// ===========================================================================
// workbench 子域 (design §7.1~§7.3 — 个人工作台只读聚合 DTO)
// ===========================================================================

/**
 * 当前登录人基本信息 (design §7.1 / GET /api/ppm/workbench/profile)。
 *
 * 字段全部后端 Pydantic 直出 snake_case:
 * - display_name/employee_no/department_name/role_name 均可空
 * - avatar_text 由后端取 display_name 首字生成,必填
 */
export interface WorkbenchProfile {
  display_name: string | null;
  employee_no: string | null;
  department_name: string | null;
  role_name: string | null;
  avatar_text: string;
}

/**
 * 个人工作台指标聚合 (design §7.2)。
 *
 * - task_count: 范围内任务总数(=分母);0 时 completion_rate/delay_rate 返回 0.0
 * - completion_rate/delay_rate: 0~1 浮点(后端 float,前端按百分比展示)
 * - work_hours: 范围内工时 SUM(task_execute.time_spent)
 * - defect_count: 当前人名下全部未关闭缺陷数(不受 range 影响)
 */
export interface WorkbenchMetrics {
  task_count: number;
  completion_rate: number;
  delay_rate: number;
  work_hours: number;
  defect_count: number;
}

/**
 * 待办条目 (design §7.2 WorkbenchTodoItem)。
 *
 * - type: 任务/缺陷/工时/计划 等标签文案
 * - source: plan_task / problem_audit / problem_change (来源域标识)
 */
export interface WorkbenchTodoItem {
  id: string;
  name: string;
  type: string;
  source: string;
}

/**
 * 个人工作台汇总 (design §7.2 / GET /api/ppm/workbench/summary?range=month)。
 *
 * metrics + 派生待办列表(top N)。
 */
export interface WorkbenchSummary {
  metrics: WorkbenchMetrics;
  todos: WorkbenchTodoItem[];
}

/**
 * 工作日历单日格 (design §7.3 CalendarDay)。
 *
 * - load_level/alert_level: "work" | "full" | "over" 分档(后端字符串,前端按色映射)
 * - task_count: 当日以 start_time 落点的任务数(不展开跨日区间)
 */
export interface CalendarPlanItem {
  id: string;
  content: string | null;
  project_name: string | null;
  status: string | null;
  start_time: string | null;
  end_time: string | null;
}

export interface CalendarProblemItem {
  id: string;
  pro_desc: string | null;
  project_name: string | null;
  status: string | null;
}

export interface CalendarExecuteItem {
  id: string;
  content: string | null;
  status: string | null;
  time_spent: number | null;
}

export interface CalendarDay {
  date: string;
  /** 左点负载: none/leisure/full/over */
  load_level: string;
  /** 右点进度: none/green/yellow/red */
  alert_level: string;
  task_count: number;
  /** 当日覆盖的计划任务 (D-009) */
  plan_items: CalendarPlanItem[];
  /** 当日覆盖的缺陷 (D-009) */
  problem_items: CalendarProblemItem[];
  /** 当日 actual 覆盖的实际执行 (D-009,所有状态) */
  execute_items: CalendarExecuteItem[];
}

/**
 * 个人工作台日历 (design §7.3 / GET /api/ppm/workbench/calendar?year_month=2026-07)。
 */
export interface WorkbenchCalendar {
  year_month: string;
  days: CalendarDay[];
}
