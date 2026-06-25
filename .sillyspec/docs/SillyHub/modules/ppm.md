---
schema_version: 1
doc_type: module-card
module_id: ppm
source_commit: ba87eec
author: qinyi
created_at: 2026-06-24T01:16:36
---
# ppm

## 定位
平台级「项目与问题管理」业务域（不绑 workspace），从 dept_project_back/ppdmq-module-ppm 全量复刻。跨 backend（FastAPI）+ frontend（Next.js/antd）三组件：后端 5 子域提供 REST，前端 ppm 路由组 + lib/ppm 客户端 + ppm-* 组件提供完整 UI。覆盖项目→计划→任务→问题→看板全链路。

产品视角：ppm 是 SillyHub 内嵌的独立项目管理子系统，与 spec 工作流并行。它把传统研发管理（项目立项→计划里程碑→任务工时→问题跟踪→看板协作）搬进平台，前端作为独立入口（/ppm）与主平台菜单完全隔离。看板的「人员×日期矩阵」布局是其特色，工时统计与图表联动。它复用平台的 auth/audit/settings 基础设施，但业务自成体系。

## 契约摘要
- 后端路由：`prefix=/api/ppm`，5 子域 router：`ppm-project`（项目/客户/成员/干系人）/ `ppm-plan`（模板+ps 计划/里程碑/三联表）/ `ppm-task`（任务计划/执行/工时）/ `ppm-problem`（问题清单+变更流4节点）/ `ppm-kanban`（看板+评论+子任务），约 102 路由
- 前端：`(dashboard)/ppm/*` 页面（projects/project-plans/plan-nodes/milestone-details/task-plans/task-execute/work-hours/work-hour-statistics/problem-list/problem-changes/kanban/project-members/customers/project-stakeholders）+ `lib/ppm/*` 客户端（project/plan/task/problem/kanban/aggregations/export/format/status-label/workday/types）+ `components/ppm-*.tsx`（dict-select/file-urls/members-table/plan-detail/plan-form/resource-table/status-actions/sub-table/text/user-select）
- common：`crud.Page[T]` 分页泛型 + `PageReq`/`apply_pagination`/`apply_sort`/`count_total` / `export` openpyxl 导出 / `fsm.StateMachine` 状态机基类（`can_transition`/`next_states`/`assert_transition`）/ `uuid_type`
- 权限：`require_permission_any(PPM_*)`，24 个 PPM_PROJECT_*/CUSTOMER_*/PLAN_*/PROBLEM_*/TASK_*/WORKHOUR_*/KANBAN_* 权限点
- 数据：约 21 表；2 套状态机（问题 4 节点审批流 ProblemStatus + 里程碑 PlanNodeDetailStatus draft→review→approve→done + 变更 ProblemChangeStatus 版本链）
- 跨组件协作：后端复用 auth(User/Org/Role)/audit_logs/settings；前端 kanban-store 缓存筛选；导出经 lib/ppm/export.ts

## 关键逻辑
问题审批流（`problem.fsm`）：
```
申请 → 开发经理 → 项目经理 → [部门经理] → 验证 → 关闭
bug 类型跳过部门经理；按项目角色查 project_member 找下一处理人
缺失则挂起 ProblemPendingAssignment
```
里程碑变更走 `parent_id` 版本链（旧版 archived、新版 draft），不走状态迁移。
看板 matrix（`kanban-grouping`）：人员×日期矩阵，任务按 start_time~deadline 跨天连续落 cell（限 366 天）。
导出：openpyxl 生成 xlsx，文件名时间戳格式 `{中文名}_YYYYMMDD_HHmmss.xlsx`。
看板 service `_derive_priority`/`_derive_progress` 从状态派生优先级与进度；`_parse_hours`/`_parse_date_range` 解析工时与日期。
问题审批 `compute_next_node`/`is_audit_node` 计算下一审批节点与是否审批节点。
任务 service `list_by_user_and_date_range` 支持按人+日期范围查（看板数据源）。

### common 基础设施
- `crud.Page[T]`：泛型分页响应（items + total + total_pages），`PageReq`（page/page_size/order_by/order）+ `apply_pagination`/`apply_sort`/`count_total` 查询助手
- `export`：openpyxl 生成 xlsx，列定义 + 文件名时间戳，StreamingResponse 返回
- `fsm.StateMachine[S]`：泛型状态机（can_transition/next_states/assert_transition/transition），TransitionMap 支持 set/list/dict 多形态
- `uuid_type`：统一 UUID 类型处理

### 前端分层
- `lib/ppm/`：API 客户端（project/plan/task/problem/kanban）+ 工具（format/format-token/status-label/workday）+ 类型 types + 聚合 aggregations + 导出 export + 看板分组 kanban-grouping
- `components/ppm-*`：业务组件（表格/表单/选择器/状态操作）
- `(dashboard)/ppm/*`：页面，统一 PageContainer+PageHeader+SectionCard+antd Table 风格，服务端分页

## 注意事项
- 平台级，**无 workspace_id**；多租户 tenant_id 已丢弃
- 通知走 audit_logs（**无独立站内信**），附件用 `file_urls` JSON（**无上传服务**）
- silly 动态表单已弃（状态机替代）
- 后端改完必 curl 实测端点（曾因未 import UTC 致 API 500，看板空）
- FastAPI 路由按注册顺序匹配：字面量路径（export-excel）必须排在 `{item_id}` 参数路由之前，否则 422
- 导出 Excel 前端需解析 Content-Disposition RFC 5987 filename* 取服务端文件名
- 列表页统一默认查 20 条，page_size 上限 200（后端 Query ge=1 le=200），前端调用需夹到 200
- 问题审批按项目角色查 project_member 找下一处理人，缺失则挂起 ProblemPendingAssignment
- 工时统计支持 stat-by-user（柱图）/stat-by-project（饼图）双维度
- 看板 reorder 持久化 kanban_order；DateNav 仅控展示列不参与任务拉取过滤（对齐源无日期过滤）
- bug 类型问题跳过部门经理审批节点
- 后端 service 改完必须 curl 实测端点 + grep 确认 import 在当前文件（曾 _derive_priority 用未 import 的 UTC 致 500）
- 列表页查询条件变化不自动查，走 searchNonce 兜底（React 18 batch 保证 setState+setSearchNonce 同帧合并触发 1 次重查）
- 选择型查询条件 onChange 即查，文本型（Input/RangePicker）走回车/按钮提交
- 导出按钮对齐：搜索 primary + 重置 outline + 分隔 + 导出 outline + 新建 primary
- 操作列 fixed=right + whitespace-nowrap，width 用具体数字（max-content 在 fixed+scroll.x 下不可靠）
- 表格 scroll y 用 calc(100vh-430px) 按视窗自适应，Table.Summary fixed=bottom 吸底
- FastAPI 路由按注册顺序匹配，export-excel 字面量必须排在 {item_id} 前
- downloadExcel 需解析 Content-Disposition RFC 5987 filename* 取服务端文件名
- 前端 downloadExcel 需自己复刻 401 自动刷新（apiFetch 不覆盖裸 fetch）
- 列表页查询条件 grid-cols-4，可展开/收起（默认 4 个 Field）
- DateNav 仅控看板展示列，不参与任务拉取过滤（对齐源无日期过滤）
- 看板 reorder 持久化 kanban_order 字段
- 任务卡片 TaskCardVO 含 start_time 供跨天展示
- 工时 _parse_hours 解析 "1.5h"/"90m" 等多种格式
- 导出列定义在 export.py 各 _COLUMNS 常量
- plan fsm 的 PlanNodeDetailStatus 含 archived 终态
- problem fsm 的 ProblemStatus 含挂起/关闭等扩展态
- project_member.role_name 是多角色逗号拼接存储（D-009@v1，源 multiple-value-type="join"，如"开发经理,项目经理,前端开发人员"）；ProjectMemberService.page 按 role_name 过滤用 ilike 模糊匹配，避免精确匹配漏掉多角色拼接成员（曾致 /ppm/project-plans 编辑/新建项目经理下拉「无数据」）
- ppm/project-maintenance/simple-list 只返回 {id, project_name}，不含 company_name；项目计划表单选项目后带公司名需另调 getProject(id)（ppm-project-plan-form.onProjectChange：Promise.all 查 getProject + listProjectMembers，公司名回填 + 唯一项目经理自动带入）

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260624-010-xxxx | 修复项目计划编辑/新建项目经理下拉多角色成员显示无数据（role_name ilike 模糊匹配）
- ql-20260624-011-b8f2 | 项目计划选中项目后带出公司名 + 唯一项目经理自动带入（onProjectChange async 查 getProject+listProjectMembers）
