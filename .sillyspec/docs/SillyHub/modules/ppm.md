---
schema_version: 1
doc_type: module-card
module_id: ppm
author: qinyi
created_at: 2026-08-18 01:45:00
---

# 项目与问题管理（ppm）

## 定位
平台级「项目与问题管理」业务域（不绑 workspace），从 dept_project_back 全量复刻，**已上线**。跨前后端：
- 后端 6 子域（project / plan / task / problem / kanban / workbench）提供 REST
- 前端桌面 ppm 路由组 + 移动端 m/ppm + lib/ppm 客户端 + ppm-* 组件提供完整 UI

覆盖项目→计划→里程碑→任务→问题→看板全链路，复用平台 auth/audit/file 基础设施但业务自成体系，与 spec 工作流并行。

## 契约摘要
- 后端路由（统一挂 `/api/ppm` 前缀，子域靠 path 区分，约 135 端点）：
  - project（27 端点，tag=ppm-project）：项目维护 / 客户 / 干系人 / 成员（member-summary 聚合）/ 导入导出
  - plan（43，ppm-plan）：计划节点模板（PlanNode+明细）/ 项目计划 / 里程碑（PsPlanNode）/ 模块 / 明细（PsPlanNodeDetail）/ Excel 导入导出
  - task（25，ppm-task）：任务计划（PlanTask）/ 执行（TaskExecute）/ 工时
  - problem（22，ppm-problem）：问题清单 + 问题变更流（4 节点审批）/ 批量导入
  - kanban（13，ppm-kanban）：看板任务 / 评论 / 子任务 / reorder
  - workbench（5，ppm-workbench）：工作台聚合 profile / summary / calendar / todos（支持切换查看目标用户）
- 数据范围（`data_scope.py`，2026-07-22 权限统一）：
  - 单一可信源 = 项目成员角色：`PpmProjectMember.role_name` 逗号拆分后**精确匹配** 部门经理/项目经理/开发经理/业务经理
  - 超管（is_platform_admin 或 super_admin 角色）→ 看全部
  - 经理 → 看名下全部项目；其余 → 仅凭 created_by 可见自己创建的
  - 功能权限（require_permission_any PPM_*）管「能不能进接口」，DataScope 管「能看哪些数据」，二者正交
- 归属防冒名（`common/ownership.resolve_owner`，security-ppm-ownership）：
  - task 的 execute_user_id / check_user_id / current_user_id / user_id 等代填字段统一过 resolve_owner
  - 非超管且 requested 非本人 → 拒绝（PPM 代填冒名防护原语）
- common 基础设施（`ppm/common/`）：
  - `crud.Page[T]` 泛型分页 + PageReq / apply_pagination / apply_sort / count_total
  - `export`：openpyxl 导出，平铺与 `grouped_report_to_workbook` 子母表分组两种布局
  - `fsm.StateMachine[S]` 泛型状态机（can_transition / next_states / assert_transition）
  - `data_scope`（manager_project_ids / is_super_admin）
  - `ownership`（resolve_owner）
  - `upload`：.xlsx 上传校验（单文件 10MiB 上限，PpmUploadError，413/415）
  - `uuid_type`：统一 UUID 类型处理
- 前端：
  - `lib/ppm/` 16 文件：project/plan/task/problem/kanban/workbench/weekly-plan 客户端 + types/format/status-label/workday/aggregations/export/execute-time
  - 桌面 `(dashboard)/ppm/*` 15+ 页面：projects / project-plans / plan-nodes / milestone-details / task-plans / task-execute / work-hours / work-hour-statistics / weekly-plan / problem-list / kanban / project-members / customers / project-stakeholders / workbench
  - 移动端 `m/ppm/*` 5 页面：workbench / task-plans / project-plans / problem-list / milestone-details
  - `components/ppm-*` 11 个业务组件（表格/表单/选择器/状态操作等）
- 状态机（2 套 + 变更链）：
  - 问题审批流：申请 → 开发经理 → 项目经理 → [部门经理] → 验证 → 关闭；bug 类型跳过部门经理；`compute_next_node` / `is_audit_node` 计算推进
  - 里程碑明细：draft → review → approve → done（编辑直提 draft→done 免审核路径）
  - 里程碑变更走 `parent_id` 版本链（旧版 archived、新版 draft），不走状态迁移

## 关键逻辑
```
问题审批: 按项目角色查 project_member 找下一处理人 → 缺失挂起 ProblemPendingAssignment
明细↔任务联动（同事务强一致）:
  明细 done → 自动建 PlanTask 挂执行人名下（_ensure_task_for_detail 等 helper）
  编辑 → 同步任务字段
  删除 → 级联：非[已完成]任务连任务+TaskExecute 一起删，[已完成]仅解关联保留
  删模块 → 级联删该模块下全部明细（逐条套任务级联规则）+ 模块本身
模板初始化:
  新建项目计划按全部 PlanNode 模板批量建里程碑（有模块→空里程碑 / 无模块→复制明细 draft）
  新建里程碑选模板阶段同样复制明细（template_plan_node_id 追溯来源）
看板: 人员×日期矩阵，任务按 start_time~deadline 跨天连续落 cell（限 366 天）
导出: grouped 子母表（里程碑/模块跨列合并标题行 + 明细行），状态英→中映射
```

## 注意事项
- 平台级无 workspace_id；通知走 audit_logs（无独立站内信），问题附件用 file_urls JSON（无独立上传服务）
- `role_name` 是多角色逗号拼接存储，按角色过滤用 ilike 模糊匹配（精确匹配会漏多角色成员）
- 项目计划列表/详情/导出的项目名 outerjoin 项目表实时取真名（单一可信源），冗余列 project_name 仅创建兜底用
- FastAPI 路由按注册顺序匹配：字面量路径（如 export-excel）必须排在 `{item_id}` 参数路由前，否则 422
- 列表默认 20 条、page_size 上限 200（后端 Query ge=1 le=200）；排序走白名单防注入，order_by 为空时回退 created_at desc
- 导出文件名 `{中文名}_YYYYMMDD_HHmmss.xlsx`
- 前端 downloadExcel 需解析 Content-Disposition RFC 5987 filename* 取服务端文件名，且需自己复刻 401 刷新（裸 fetch 不走 apiFetch）
- 导入规则：一行多责任人全匹配拆 N 条、任一未匹配整行标红不拆；空责任人放行（draft 后补）；导入序号按当前层级最大纯数字 no 递增
- PPM 已上线：涉其表结构/接口的破坏性变更需按已上线标准评估，不适用「未上线可清数据」豁免

## 人工备注

<!-- MANUAL_NOTES_START -->

<!-- MANUAL_NOTES_END -->
