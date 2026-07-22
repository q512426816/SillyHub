---
author: WhaleFall
created_at: 2026-07-21T08:48:56
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260721-002-b4c2 | 2026-07-21 09:11:58 | /ppm/milestone-details 按页面样式规范调整(第一批:按钮antd化+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：第一批——shadcn Button 全量换 antd(28处;操作列 ghost→link small、删除加 danger、工具栏 outline→default、新建→primary、Drawer/footer 保存→primary+loading 去掉"提交中…"文案)+3处原生 confirm→Modal.confirm(静态,与 message 一致)+硬编码色→token(emerald→success、blue→primary、amber/red→destructive、slate→border/muted-foreground;bg-red-50 错误语境保留合规)。eslint 0 error(19既有warning) tsc 0 error。3个 Drawer→Modal 留第二批。

## ql-20260721-003-c8d1 | 2026-07-21 10:05:00 | /ppm/milestone-details 按页面样式规范调整(第二批:3个 Drawer→Modal)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：第二批——3个 Drawer→Modal(模块 extra 按钮→footer、明细 extra 状态Tag→title 内联 footer 保留、里程碑 footer 保留);统一 onClose→onCancel、补 maskClosable={false}、删 Drawer import、</Drawer>→</Modal>。eslint 0 error(19既有warning) tsc 0 error milestone-details 24测试通过。

## ql-20260721-004-a3f2 | 2026-07-21 10:12:00 | /ppm/milestone-details 主表操作列(+新建明细/编辑里程碑/删除里程碑)加宽
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：主表(里程碑)操作列 width 280→340(+新建明细/编辑里程碑/删除里程碑 3 按钮加宽,避免挤换行)。纯列宽数字改动。

## ql-20260721-005-5d8e | 2026-07-21 10:25:00 | /ppm/milestone-details 明细子表加计划开始/结束时间列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：明细子表(DetailLevelTable)在「计划工时」列后新增「计划开始」「计划结束」两列(width 120,fmtDate 回显 plan_begin_time/plan_complete_time)。tsc 0 error milestone-details 24测试通过。

## ql-20260721-006-c7a1 | 2026-07-21 11:10:00 | /ppm/plan-nodes 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
结果：shadcn Button→antd(7处;操作列 ghost→link small/删除 danger、新建→primary、重新加载→default、明细保存→primary+loading、Drawer footer 保存→primary+loading)+1处原生 confirm→Modal.confirm+1个 Drawer→Modal(NodeFormDrawer footer 保留;onClose→onCancel)+硬编码色→token(emerald→success、amber→destructive、删除红随 danger;bg-red-50 错误语境保留)。eslint 0 error tsc 0 error。Table 保留(带 expandable)。

## ql-20260721-007-9d2e | 2026-07-21 11:30:00 | 修复 /ppm/milestone-details 新建/编辑里程碑 plan-node-ps POST/PUT 422
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
结果：根因=MasterDrawer submit 的 plan_workload 是 InputNumber(number),原 (vals.plan_workload as string) 直接发 number,后端 plan_workload:str 收 number 422(Pydantic v2 不 coerce number→str)。修复改 String() 转换(对齐明细表单 2122 写法)。日期字段 getValueProps/normalize+fromDate 返回 YYYY-MM-DD string,后端 datetime 正常解析,非 422 源。POST/PUT 都发 plan_workload 故都 422。tsc 0 error milestone-details 24测试通过。

## ql-20260721-008-a1b2 | 2026-07-21 15:10:00 | /ppm/problem-list 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx + _problem-drawer.tsx
结果：shadcn Button→antd(操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索→primary)+1处 confirm→Modal.confirm+3处 alert→message.error+_problem-drawer Drawer→Modal+硬编码色→token(rgba(0,0,0,0.45)→muted-foreground、#dc2626/#16a34a→destructive/success)。eslint 0 error tsc 0 error。problem-detail-modal 组件待随 task-plans 批次改。

## ql-20260721-009-b2c3 | 2026-07-21 16:20:00 | 批量按样式规范调整 problem-changes/task-plans/work-hours/work-hour-statistics + task-detail-modal/problem-detail-modal
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/{problem-changes,task-plans,work-hours,work-hour-statistics}/page.tsx + _components/{task-detail-modal,problem-detail-modal}.tsx
结果：4页面+2组件 shadcn Button→antd(操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索/完成/提交→primary、destructive→danger)+confirm→Modal.confirm+alert→message.error+Drawer/自写遮罩→antd Modal+硬编码色→token。子代理并行改+eslint/tsc 全 0 error。tsc 全量 0 error。至此 12 个 ppm 页面全部对齐 FRONTEND_PAGE_STYLE.md。

## ql-20260721-010-c3d4 | 2026-07-21 16:40:00 | 修复 /ppm/problem-list 弹窗两组底部按钮(Modal默认footer与表单自带重复)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx
结果：ql-008 把 Drawer→Modal 时未设 footer,antd Modal 默认渲染「取消/确定」,而 ProblemCreateForm 内部自带「取消/保存」,两组底部按钮重复。修复:Modal 加 footer={null}(表单自带按钮保留,与 problem-changes/其他 Modal 一致)。grep 确认其他 ppm Modal footer 均已正确(null 或自定义),仅此处漏。小改动无 test 影响。

## ql-20260721-011-e3f2 | 2026-07-21 17:00:00 | 修复 PpmResourceTable edit 模式清空字段不传(validateFields 跳过空值→后端不更新)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
结果：formInst.validateFields() 只返回有值字段,清空的字段(undefined/空串)被静默跳过→请求体不含→exclude_unset 不含→后端不更新。edit 模式补全:getFieldsValue 拿所有 key,不在 validateFields returns 里的→设 null。create 模式不动(用户没填的非必填字段让后端用默认值)。影响/projects,/customers,/project-members,/project-stakeholders 4 页。eslint 0 error(15 既有 warning) tsc 0 error。

## ql-20260721-012-c6f7 | 2026-07-21 17:10:00 | 追修 PpmResourceTable 空串字段未补正(validateFields 返回空串但 key 存在→不补 null)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
结果：ql-011 用 !(key in values) 判断,但 validateFields 对非必填空字段返回 {key:""}(key 存在值空串)→!(key in values) false→不补 null→发空串(非 null),非 required 字段后端收到空串不返回旧值但仍没真正清空。改 values[key]===undefined/null/""→补 null。eslint 0 error tsc 0 error。

## ql-20260721-013-a2b8 | 2026-07-21 17:20:00 | 最终修复 stripForm 过滤 null 致清空不生效(projects/customers/stakeholders)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/{projects,customers,project-stakeholders}/page.tsx
结果：stripForm(if(v===null)continue)把 PpmResourceTable 补的 null 又过滤了→请求体不含该字段→后端不更新→显示旧值。去掉 v===null 条件,保留 null(清空信号)。配合 ql-011/012(PpmResourceTable 补 null),projects/customers/stakeholders(干系人)清空全链路通。eslint 0 error tsc 0 error。

## ql-20260721-014-b2e7 | 2026-07-21 17:30:00 | 修复项目计划编辑保存后 project_name 变 id
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx
结果：「项目名称」Form.Item name="project_name" 缺失→setFieldsValue 回填但 validateFields 不返回(无 Form.Item 的字段不被 form 管理)→payload 发 project_name=null→后端写 null→列表 render(v??p.id)回退显示 id。加 hidden Form.Item(name="project_name") 让 form 兜住该字段。eslint 0 error tsc 0 error。

## ql-20260721-015-d4a9 | 2026-07-21 17:40:00 | 追修项目计划 project_name 变 id(submit 兜底+onProjectChange 去 id 回退)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx
结果：ql-014 加 hidden Form.Item 仍可能因 destroyOnClose 时序丢值。双保险:(1)submit payload project_name 改 values.project_name ?? plan?.project_name ?? null(edit 用 plan 初始值兜底);(2)onProjectChange 去掉 ?? id 回退(改 raw 没 project_name 时用 null,不再误填 id;create 后端按 project_id 兜底查名)。eslint 0 error tsc 0 error。

## ql-20260721-016-e7c1 | 2026-07-21 17:55:00 | /ppm/project-plans 列表 project_name 兜底 id 修复(render+旧数据)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx + DB 数据修复
结果:列表 render(v ?? p.id)在 project_name 为 null 时回退显示计划 id(误导)。之前 bug 写入旧数据 project_name=null/uuid。(1)render 改 v ?? "—";(2)DB 修 2 条坏数据(UPDATE project_name 按 project_id 查 ppm_project_maintenance.project_name,剩余 0 条坏)。配合 ql-014/015 保存逻辑,新数据正确+旧数据已修。

## ql-20260722-001-a7f3 | 2026-07-22 09:23:00 | /ppm/project-plans 列表默认按创建时间倒序(最新创建在前)
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py + backend/app/modules/ppm/plan/tests/test_service.py
结果:根因=前端 project-plans/page.tsx:150 调 listProjectPlans 不传 order_by,后端 _project_plan_list_req 默认 order_by=None,apply_sort(crud.py:162)遇空值直接跳过排序致列表顺序不可预测。修复=service.list_ps_project_plans 调 list_paged 前兜底 if not req.order_by: req.order_by="created_at"(order 默认 desc=最新创建在前;allowed_sort 已含 created_at)。前端显式传 order_by(project_name/status)仍优先尊重。新增 2 单测(test_list_default_sorts_by_created_at_desc 验默认 P2/P1/P0、test_list_explicit_order_by_not_overridden 验显式 project_name asc 不被覆盖)。test_service+test_project_plan_data_scope 共 52 passed。

## ql-20260722-002-b9e4 | 2026-07-22 09:46:30 | /ppm/projects 项目维护「公司名称」改文案为「客户名称」
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/page.tsx + backend/app/modules/ppm/project/router.py
结果:2处纯文案「公司名称」→「客户名称」:(1)projects/page.tsx:55 字段 label(列头/表单/搜索框经 PpmResourceTable 自动跟随);(2)project/router.py:218 项目维护导出(ProjectMaintenanceService)ColumnDef header。字段名 company_name 不动(保数据兼容)。客户维护 router.py:393 + test_router.py:148(level=VIP)属 /ppm/customers 不在范围未改。后端 project 模块 26 passed + ruff format/check 全过。
