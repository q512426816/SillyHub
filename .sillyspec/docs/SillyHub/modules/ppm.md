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
明细-任务联动：里程碑明细（PsPlanNodeDetail）变 done 时自动建一条 PlanTask 挂执行人名下（plan/service.py 6 helper `_ensure_task_for_detail` 等 + 5 触发点 create_detail/_transition/import_commit/update+delete_detail/change_process，强一致同事务）；编辑同步任务字段、变更迁移（版本链）、删除解关联（ps_plan_node_detail_id 置 null，任务保留）；导入一行多责任人拆分（全匹配→每人一条，任一未匹配→整行标红）。
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
- PpmUserSelect res=user 已选值回填：已选 user_id 不在已加载 options（分页只取部分）时，按 id 批量调 listUsers({ids}) 查真实姓名补 label，避免编辑成员"姓名"字段回退显示 id（依赖后端 list_users ids 参数）
- 问题审批按项目角色查 project_member 找下一处理人，缺失则挂起 ProblemPendingAssignment
- 工时统计支持 stat-by-user（柱图）/stat-by-project（饼图）双维度
- 看板 reorder 持久化 kanban_order；DateNav 仅控展示列不参与任务拉取过滤（对齐源无日期过滤）
- bug 类型问题跳过部门经理审批节点
- 后端 service 改完必须 curl 实测端点 + grep 确认 import 在当前文件（曾 _derive_priority 用未 import 的 UTC 致 500）
- 列表页查询条件变化不自动查，走 searchNonce 兜底（React 18 batch 保证 setState+setSearchNonce 同帧合并触发 1 次重查）
- 选择型查询条件 onChange 即查，文本型（Input/RangePicker）走回车/按钮提交
- 导出按钮对齐：搜索 primary + 重置 outline + 分隔 + 导出 outline + 新建 primary
- PpmResourceTable 新建/编辑表单用 antd Modal（PpmResourceModal，destroyOnClose + footer 自定义取消/保存按钮），操作栏按钮全 antd Button（编辑/成员管理 type=link、删除 type=link danger、新增/搜索 type=primary、导出/重置/展开/重新加载 default，size=small）；2026-07-20 由 Drawer 改 Modal（ql-20260720-001）
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
- /ppm/project-members 为两级 expandable 表：一级项目行调 GET /project-maintenance/member-summary 聚合真分页（owner_name 推算 + member_count + 6 维筛选），展开行复用 PpmProjectMembersTable 的 embedded 紧凑模式（去 SectionCard 外壳 + 去 calc(100vh-430px) 的 vh scroll，避免视口滚动框嵌套 G1；onChanged 回调刷新 member_count）
- 负责人列由 member_summary 推算：role_name ilike '%项目经理%' 取 created_at 最早者 user_name，无则 None（显「—」），不落库；派生列 owner_name/member_count 不进排序白名单（仅 updated_at/created_at/project_name/project_code 可排序，D-005）

## 人工备注
<!-- MANUAL_NOTES_START -->
<!-- MANUAL_NOTES_END -->

## 变更索引
- ql-20260624-010-xxxx | 修复项目计划编辑/新建项目经理下拉多角色成员显示无数据（role_name ilike 模糊匹配）
- ql-20260624-011-b8f2 | 项目计划选中项目后带出公司名 + 唯一项目经理自动带入（onProjectChange async 查 getProject+listProjectMembers）
- ql-20260714-007-b2e7 | 修复「新建里程碑」选计划开始/完成时间崩溃（DatePicker 受控写法 value/onChange 与 Form.Item name 冲突→rc-picker isValid 报错），对齐明细表单 getValueProps+normalize
- 2026-07-14-ppm-projects-style-redesign | /ppm/projects 样式规范化（状态 StatusBadge/类型 Tag/antd Drawer+Modal maskClosable=false/toast 语义化/搜索按钮分组）+ task-08 推广 10 个 ppm 页面操作列统一（居中+ghost+危险红）+ 去硬编码色（bg-blue-500/bg-amber-500/emerald-300）
- ql-20260714-009-c3d1 | /ppm/projects 项目类型/状态列显示 code「1 2」修复：PROJECT_TYPE/STATUS_OPTIONS value 改源字典 code 1/2/3（原 research/ongoing 与 DB 实际 code 不匹配，PpmResourceTable select find 回退显示原始 code）
- ql-20260714-010-a4f2 | PpmResourceDrawer 抽屉表单控件原生→antd 统一：Form.useForm + Form.Item rules + Input/Select/DatePicker/InputNumber/Input.TextArea（date/datetime getValueProps/normalize dayjs↔ISO），补 ppm-projects-style-redesign task-02 漏改的表单层
- ql-20260715-010-bb2c | /ppm/project-members 编辑成员"姓名"显示 id 修复：PpmUserSelect res=user 已选 user_id 不在前 20 条时按 id 批量查真实姓名回填 label（后端 list_users 加 ids 参数配合）
- ql-20260715-011-b118 | /ppm/project-members 一级表"更新时间"列格式化：render `String(v).slice(0,19)`（原始 ISO/UTC，带 T）→ `fmtDateTime`（`YYYY-MM-DD HH:mm` 本地时区，空值 —）
- ql-20260715-012-5110 | /ppm/projects「成员管理」改为跳转 /ppm/project-members（URL 带 project_name）：project-members page 读 param 传 initialProjectName，GroupTable 初始填搜索 project_name + 首次加载自动展开匹配项目子表（autoExpandedRef 仅一次）；删 projects 抽屉入口（ProjectMembersDrawer）
- ql-20260715-013-9bc5 | 项目成员子表（PpmProjectMembersTable）改服务端分页：load 由 listProjectMembers（全量+本地 rows.slice）→ pageProjectMembers 传 page/page_size，rows=当前页、total 来自接口；pageSize 变更走接口刷新（onChange 回第 1 页防越界）
- 2026-07-15-project-members-rebuild | /ppm/project-members 重构为项目→成员两级可展开表：后端新增 GET /project-maintenance/member-summary 聚合接口（owner_name 负责人推算 role 含项目经理取 created_at 最早 + member_count + 6 维 EXISTS 筛选 + 排序白名单）+ 成员接口 LEFT JOIN users 补账号列 username；前端两级 expandable 表（展开行复用 PpmProjectMembersTable embedded 紧凑模式 + onChanged 刷新成员数）+ 页头全局/项目内两种新增入口；/ppm/projects 成员管理抽屉改跳转 project-members（ql-012）+ 成员子表服务端分页（ql-013）。归档总览（实现散于 ql-007/010~013）。
- ql-20260715-014-7e3a | 导入模块多责任人拆分：service._to_preview_row→_to_preview_rows（一行多责任人全匹配→拆N条各一责任人 duty_user_id + work_load 各=原值；任一未匹配→整行1条标红 valid=false 不拆；空责任人→1条标红）+ import_preview 改 flatMap；联动建任务自动跟随
- ql-20260715-010-a3b7 | PPM 工作台：默认首页 /ppm/projects→/ppm/workbench + 快捷入口加「任务计划」按钮（/ppm/task-plans）+ 我的待办新增「问题变更审批」分支（workbench/service.py _derive_todos 查 PpmProblemChange status="1"审核中且 now_handle_user 含我 → source=problem_change，前端 todo-list-panel goTodo 跳 /ppm/problem-changes；问题清单维持现状，不含任务计划/里程碑明细）
- ql-20260716-001-7f3a | /ppm/projects 新建项目后创建人(create_name)列为空修复：create_name 是系统字段(design 约定不进表单)，后端 ProjectMaintenanceService.create 新增 operator_name 参数，data.create_name 为空时回退用 user.display_name 自动填充；router create_project_maintenance 传 user.display_name；补 service 单测三断言
- ql-20260716-002-4c8e | /ppm/projects 项目维护列表默认排序改为创建时间降序(最新在前)：apply_sort 当 order_by 为空时不排序致顺序不确定，service.page 在 req.order_by 为空时回退 created_at(白名单已含)，复用 req.order 默认 desc；前端显式 order_by 仍优先(兼容列头排序)，仅改后端一处
- ql-20260716-004-6d21 | 里程碑明细·明细列表(DetailLevelTable)加「执行人」列：明细有 execute_user_id 但列表未显示(无 execute_user_name 字段),columns 加执行人列用 PpmUserSelect disabled 显示(同模块责任人列模式 res=projectMember),DetailLevelProps 加 projectId + 两处调用(532/947)透传 + moduleExpandRender deps 补;仅改前端单文件,不动后端/通用组件
- ql-20260716-006-9c4f | /ppm/project-plans 新建项目计划后「项目名称」列显示 id 修复：DB 实测新建 project_name=None(前端表单无 project_name 字段致提交空 + 后端不兜底),列表 v??p.id 回退显示 id;后端 create_ps_project_plan 兜底 project_name 为空时按 project_id 查 PpmProjectMaintenance.project_name 填充(单一可信源,显式传不覆盖/project_id 无效保持 None);仅改后端 service+单测
- 2026-07-16-plan-node-module-restructure | /ppm/plan-nodes 计划节点模板模块结构改造：PlanNode+has_module（记录字段,新建必填+编辑可改 v3）+PlanNodeDetail+module_id（防御性归属校验:非null跨模板违例400,v2简化）+migration 20260716;前端 plan-nodes 展开统一只显示模板明细一个子表（v2 取消三层/模块子表）+NodeFormDrawer antd Form（Switch 可改）+列表按编号正序（v4）。归档总览（v1三层→v2降记录→v3可编辑→v4排序,实现散于 design§13/tasks v2v3 章节）
- 2026-07-17-project-plan-init-from-template | /ppm/project-plans 新建项目计划按模板批量初始化里程碑：create_ps_project_plan 同事务按所有 PlanNode 模板建 PsPlanNode（has_module=无复制明细 draft / 有模块空里程碑,no int→str）；create_module 复制模板明细到新模块（draft）；PsPlanNode+template_plan_node_id（追溯模板）+has_module（冗余,模块层判断）；milestone-details 模块层条件 overall_stage→has_module；migration 20260717
- ql-20260717-001-f1a2 | 里程碑明细编辑提交直接完成(无审核流程)+建任务计划：_FORWARD_NEXT[DRAFT]=DONE(draft save→done 跳过审核)+fsm DRAFT 白名单加 DONE+_transition DONE 分支记完成人(approve_user)。修复编辑明细提交后状态"审核中"应"完成"+没建任务计划(两 bug 同源:review 状态不触发 _ensure_task_for_detail)
- ql-20260717-003-94b4 | 里程碑明细·明细列表(DetailLevelTable)加「任务描述」列：明细已有 task_description 字段(表单 page.tsx:2313 + types PsPlanNodeDetail),列表缺该列;columns「任务主题」后加任务描述列(dataIndex=task_description,width=220,ellipsis=true 防长文本撑高行);page.tsx 3 处「任务主题」列用后跟列区分唯一定位(仅 DetailLevelTable 后跟「角色」,master/preview 分别跟「责任人」「工作量」);纯前端单文件,不动后端/接口/types
- ql-20260717-004-01b2 | 项目改名后项目计划列表项目名不更新：ps_project_plan.project_name 是冗余快照(创建从项目表复制 ql-20260716-006)改名不同步→计划列表/详情/导出/任务联动(_resolve_project_context 取 PsProjectPlan.project_name)全显旧名;写时同步——ProjectMaintenanceService.update 检测 project_name 变更时同事务 update(PsProjectPlan).where(project_id==entity_id).values(project_name,updated_at) 刷新所有关联计划,单一写入点所有读点自动跟上(import plan.model 无循环);波折:① text SQL WHERE 绕过 UuidCoercing 致 UPDATE 0 行→改 update() statement 走 model 类型适配;② project/tests/conftest 加 plan model 注册建 sqlite ppm_ps_project_plan 表;③ expire_on_commit=False 测试用 select column 直查 DB 验实际值
- ql-20260720-001-c4a1 | PpmResourceTable 编辑/新建抽屉改 antd Modal（<Drawer>→<Modal>，PpmResourceDrawer→PpmResourceModal，onClose→onCancel，保存按钮加 loading={saving}）+ 操作栏 shadcn Button 全量改 antd Button（编辑 type=link、删除 type=link danger、新增/搜索 type=primary、导出/重置/展开/重新加载 default，size=small）；影响项目/客户/成员/干系人 4 页新建+编辑；projects/page.tsx 成员管理按钮同步 antd
- ql-20260720-002-8d3e | /ppm/projects 查询区按钮 size=small→默认 middle(修字体顶边框)：查询区 5 按钮(导出/新增/搜索/重置/展开)+Modal footer 2(取消/保存)+错误条重新加载 1(均有边框/实心)改默认 32px；操作列 link(编辑/删除)保持 small；DataTable size 不动
- ql-20260720-003-2f1a | table 序号「#」列居中对齐：PpmResourceTable 序号列 coldef 加 align=center(表头「#」+数字单元格同居中)，影响所有 ppm 表
- ql-20260720-004-b05c | 修 striped 表固定列横向滚动穿透：序号列(fixed left)+操作列(fixed right)coldef 加 onCell background=hsl(var(--card))(不透明，与 SectionCard 卡片底一致)覆盖 striped 透明背景；中间非固定列保留斑马纹
- ql-20260720-006-a7e3 | 里程碑明细已完成(done)操作列加「变更」按钮：新增 changeInfo 抽屉模式(开立信息可编辑,footer 仅「提交」无「保存」),提交调 updatePsPlanNodeDetail→后端 _sync_task_fields 同步任务计划字段(content/workload/time/user/module),不改明细 status/不生成新版本/不改任务 status(FR-03/D-007);DetailLevelTable done 加按钮(readOnly 禁用)+baseEditable/submitText/title 配套;纯前端单文件
- ql-20260720-007-b9d2 | 任务计划同步明细 task_description：PlanTask 加 task_description(Text)列+migration+plan/service 三处(_ensure 命中/新建+_sync)同步 task_description+schema 暴露(task update exclude_unset 不误清)+前端 PlanTask 类型加字段+task-plans 加「任务描述」列；明细提交建任务/编辑同步都带任务描述
- ql-20260720-008-c4e1 | 任务计划详情补任务内容/任务描述：列表「详情」Modal 任务信息 grid + 执行弹窗 TaskDetail grid 开头各加任务内容(整行 col-span-2)+任务描述(整行,空不显示);PlanTask 类型已有两字段(ql-007),纯前端展示
- ql-20260720-009-d5f2 | /ppm/project-plans 操作列去「详情」按钮(与项目名称点击打开详情重复);detail Modal 保留(项目名点击仍入口)
