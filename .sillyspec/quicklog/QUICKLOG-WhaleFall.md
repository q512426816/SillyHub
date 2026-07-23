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
需求：/ppm/milestone-details 按页面样式规范调整（对齐 FRONTEND_PAGE_STYLE.md）。
根因：页面用了 shadcn Button、原生 confirm()、硬编码色（emerald/blue/amber/red/slate）等不规范写法。
方案：shadcn Button 全量换 antd（28处：操作列 ghost→link small、删除加 danger、工具栏 outline→default、新建→primary、Drawer/footer 保存→primary+loading 去掉"提交中…"文案）+3 处原生 confirm→Modal.confirm（静态，与 message 一致）+硬编码色→token（emerald→success、blue→primary、amber/red→destructive、slate→border/muted-foreground；bg-red-50 错误语境保留合规）。3 个 Drawer→Modal 留第二批。
结果：eslint 0 error（19 既有 warning）tsc 0 error。

## ql-20260721-003-c8d1 | 2026-07-21 10:05:00 | /ppm/milestone-details 按页面样式规范调整(第二批:3个 Drawer→Modal)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：第一批遗留的 3 个 Drawer 改 Modal。
根因：模块 extra 按钮、明细 extra 状态 Tag、里程碑 footer 三处仍用 antd Drawer。
方案：3 个 Drawer→Modal（模块 extra 按钮→footer、明细 extra 状态Tag→title 内联 footer 保留、里程碑 footer 保留）；统一 onClose→onCancel、补 maskClosable={false}、删 Drawer import、</Drawer>→</Modal>。
结果：eslint 0 error（19 既有 warning）tsc 0 error，milestone-details 24 测试通过。

## ql-20260721-004-a3f2 | 2026-07-21 10:12:00 | /ppm/milestone-details 主表操作列(+新建明细/编辑里程碑/删除里程碑)加宽
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：主表操作列（新建明细/编辑里程碑/删除里程碑 3 按钮）挤换行，加宽。
根因：操作列 width=280 偏窄，3 按钮挤换行。
方案：主表（里程碑）操作列 width 280→340。
结果：纯列宽数字改动，无逻辑影响。

## ql-20260721-005-5d8e | 2026-07-21 10:25:00 | /ppm/milestone-details 明细子表加计划开始/结束时间列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：明细子表缺计划开始/结束时间展示，补两列。
根因：DetailLevelTable 无 plan_begin_time/plan_complete_time 列。
方案：在「计划工时」列后新增「计划开始」「计划结束」两列（width 120，fmtDate 回显 plan_begin_time/plan_complete_time）。
结果：tsc 0 error，milestone-details 24 测试通过。

## ql-20260721-006-c7a1 | 2026-07-21 11:10:00 | /ppm/plan-nodes 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
需求：/ppm/plan-nodes 按页面样式规范调整（对齐 FRONTEND_PAGE_STYLE.md）。
根因：用了 shadcn Button、原生 confirm、Drawer、硬编码色。
方案：shadcn Button→antd（7 处：操作列 ghost→link small/删除 danger、新建→primary、重新加载→default、明细/Drawer footer 保存→primary+loading）+1 处原生 confirm→Modal.confirm+1 个 Drawer→Modal（NodeFormDrawer footer 保留；onClose→onCancel）+硬编码色→token（emerald→success、amber→destructive、删除红随 danger；bg-red-50 错误语境保留）。Table 保留（带 expandable）。
结果：eslint 0 error tsc 0 error。

## ql-20260721-007-9d2e | 2026-07-21 11:30:00 | 修复 /ppm/milestone-details 新建/编辑里程碑 plan-node-ps POST/PUT 422
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：/ppm/milestone-details 新建/编辑里程碑 plan-node-ps POST/PUT 报 422。
根因：MasterDrawer submit 的 plan_workload 是 InputNumber(number)，原 (vals.plan_workload as string) 直接发 number，后端 plan_workload:str 收 number 422（Pydantic v2 不 coerce number→str）。POST/PUT 都发 plan_workload 故都 422。
方案：改 String() 转换（对齐明细表单写法）。日期字段 getValueProps/normalize+fromDate 返回 YYYY-MM-DD string，后端 datetime 正常解析，非 422 源。
结果：tsc 0 error，milestone-details 24 测试通过。

## ql-20260721-008-a1b2 | 2026-07-21 15:10:00 | /ppm/problem-list 按页面样式规范调整(按钮antd化+Drawer→Modal+删除确认+颜色token)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/page.tsx + _problem-drawer.tsx
需求：/ppm/problem-list 按页面样式规范调整（对齐 FRONTEND_PAGE_STYLE.md）。
根因：用了 shadcn Button、原生 confirm/alert、Drawer、硬编码色。
方案：shadcn Button→antd（操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索→primary）+1 处 confirm→Modal.confirm+3 处 alert→message.error+_problem-drawer Drawer→Modal+硬编码色→token（rgba(0,0,0,0.45)→muted-foreground、#dc2626/#16a34a→destructive/success）。problem-detail-modal 组件待随 task-plans 批次改。
结果：eslint 0 error tsc 0 error。

## ql-20260721-009-b2c3 | 2026-07-21 16:20:00 | 批量按样式规范调整 problem-changes/task-plans/work-hours/work-hour-statistics + task-detail-modal/problem-detail-modal
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/{problem-changes,task-plans,work-hours,work-hour-statistics}/page.tsx + _components/{task-detail-modal,problem-detail-modal}.tsx
需求：批量按样式规范调整 problem-changes/task-plans/work-hours/work-hour-statistics 4 页 + task-detail-modal/problem-detail-modal 2 组件。
根因：同上，shadcn Button、原生 confirm/alert、Drawer/自写遮罩、硬编码色。
方案：4 页面+2 组件 shadcn Button→antd（操作列 ghost→link small/删除 danger、工具栏 outline→default、新建/搜索/完成/提交→primary、destructive→danger）+confirm→Modal.confirm+alert→message.error+Drawer/自写遮罩→antd Modal+硬编码色→token。子代理并行改。至此 12 个 ppm 页面全部对齐 FRONTEND_PAGE_STYLE.md。
结果：eslint/tsc 全 0 error，tsc 全量 0 error。

## ql-20260721-010-c3d4 | 2026-07-21 16:40:00 | 修复 /ppm/problem-list 弹窗两组底部按钮(Modal默认footer与表单自带重复)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/problem-list/_problem-drawer.tsx
需求：/ppm/problem-list 弹窗出现两组底部按钮（Modal 默认 footer 与表单自带重复）。
根因：ql-008 把 Drawer→Modal 时未设 footer，antd Modal 默认渲染「取消/确定」，而 ProblemCreateForm 内部自带「取消/保存」，两组底部按钮重复。
方案：Modal 加 footer={null}（表单自带按钮保留，与 problem-changes/其他 Modal 一致）。grep 确认其他 ppm Modal footer 均已正确（null 或自定义），仅此处漏。
结果：小改动无 test 影响。

## ql-20260721-011-e3f2 | 2026-07-21 17:00:00 | 修复 PpmResourceTable edit 模式清空字段不传(validateFields 跳过空值→后端不更新)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
需求：PpmResourceTable edit 模式清空字段不传（validateFields 跳过空值→后端不更新），影响 projects/customers/project-members/project-stakeholders 4 页。
根因：formInst.validateFields() 只返回有值字段，清空的字段（undefined/空串）被静默跳过→请求体不含→exclude_unset 不含→后端不更新。
方案：edit 模式补全——getFieldsValue 拿所有 key，不在 validateFields returns 里的→设 null。create 模式不动（用户没填的非必填字段让后端用默认值）。
结果：eslint 0 error（15 既有 warning）tsc 0 error。

## ql-20260721-012-c6f7 | 2026-07-21 17:10:00 | 追修 PpmResourceTable 空串字段未补正(validateFields 返回空串但 key 存在→不补 null)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
需求：ql-011 追修——空串字段仍未补正（validateFields 返回空串但 key 存在→不补 null）。
根因：ql-011 用 !(key in values) 判断，但 validateFields 对非必填空字段返回 {key:""}（key 存在值空串）→!(key in values) false→不补 null→发空串（非 null），非 required 字段后端收到空串不返回旧值但仍没真正清空。
方案：改 values[key]===undefined/null/""→补 null。
结果：eslint 0 error tsc 0 error。

## ql-20260721-013-a2b8 | 2026-07-21 17:20:00 | 最终修复 stripForm 过滤 null 致清空不生效(projects/customers/stakeholders)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/{projects,customers,project-stakeholders}/page.tsx
需求：最终修复 stripForm 过滤 null 致清空不生效（projects/customers/stakeholders）。
根因：stripForm（if(v===null)continue）把 PpmResourceTable 补的 null 又过滤了→请求体不含该字段→后端不更新→显示旧值。
方案：去掉 v===null 条件，保留 null（清空信号）。配合 ql-011/012（PpmResourceTable 补 null），清空全链路通。
结果：eslint 0 error tsc 0 error。

## ql-20260721-014-b2e7 | 2026-07-21 17:30:00 | 修复项目计划编辑保存后 project_name 变 id
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx
需求：项目计划编辑保存后 project_name 显示为 id。
根因：「项目名称」Form.Item name="project_name" 缺失→setFieldsValue 回填但 validateFields 不返回（无 Form.Item 的字段不被 form 管理）→payload 发 project_name=null→后端写 null→列表 render(v??p.id)回退显示 id。
方案：加 hidden Form.Item(name="project_name") 让 form 兜住该字段。
结果：eslint 0 error tsc 0 error。

## ql-20260721-015-d4a9 | 2026-07-21 17:40:00 | 追修项目计划 project_name 变 id(submit 兜底+onProjectChange 去 id 回退)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx
需求：ql-014 追修——hidden Form.Item 仍可能因 destroyOnClose 时序丢值。
根因：ql-014 加 hidden Form.Item 在 destroyOnClose 时序下仍可能丢值。
方案：双保险——(1)submit payload project_name 改 values.project_name ?? plan?.project_name ?? null（edit 用 plan 初始值兜底）；(2)onProjectChange 去掉 ?? id 回退（改 raw 没 project_name 时用 null，不再误填 id；create 后端按 project_id 兜底查名）。
结果：eslint 0 error tsc 0 error。

## ql-20260721-016-e7c1 | 2026-07-21 17:55:00 | /ppm/project-plans 列表 project_name 兜底 id 修复(render+旧数据)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/project-plans/page.tsx + DB 数据修复
需求：/ppm/project-plans 列表 project_name 为 null 时回退显示 id（误导）+ 旧坏数据修复。
根因：列表 render(v ?? p.id) 在 project_name 为 null 时回退显示计划 id；之前 bug 写入旧数据 project_name=null/uuid。
方案：(1)render 改 v ?? "—"；(2)DB 修 2 条坏数据（UPDATE project_name 按 project_id 查 ppm_project_maintenance.project_name）。配合 ql-014/015 保存逻辑。
结果：新数据正确+旧数据已修，剩余 0 条坏。

## ql-20260722-001-a7f3 | 2026-07-22 09:23:00 | /ppm/project-plans 列表默认按创建时间倒序(最新创建在前)
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py（list_ps_project_plans 调 list_paged 前兜底 order_by）+ backend/app/modules/ppm/plan/tests/test_service.py（2 单测）
需求：/ppm/project-plans 列表默认排序不确定（顺序乱），要求默认最新创建在前。
根因：前端 project-plans/page.tsx 调 listProjectPlans 不传 order_by；后端 _project_plan_list_req 默认 order_by=None；apply_sort（crud.py）遇空值直接跳过排序 → 列表顺序不可预测。
方案：service.list_ps_project_plans 调 list_paged 前兜底 `if not req.order_by: req.order_by="created_at"`（order 默认 desc=最新创建在前；allowed_sort 已含 created_at）；前端显式传 order_by（project_name/status）仍优先尊重。新增 2 单测（test_list_default_sorts_by_created_at_desc 验默认 P2/P1/P0、test_list_explicit_order_by_not_overridden 验显式 project_name asc 不被覆盖）。
结果：test_service + test_project_plan_data_scope 共 52 passed + ruff 过。

## ql-20260722-002-b9e4 | 2026-07-22 09:46:30 | /ppm/projects 项目维护「公司名称」改文案为「客户名称」
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/page.tsx（字段 label 改文案，列头/表单/搜索框经 PpmResourceTable 自动跟随）+ backend/app/modules/ppm/project/router.py（项目维护导出 ColumnDef header 改文案）
需求：/ppm/projects 项目维护「公司名称」改文案为「客户名称」。
根因：纯文案展示问题，字段名 company_name 不动（保数据兼容），仅改展示文案。
方案：2 处「公司名称」→「客户名称」：①projects/page.tsx 字段 label；②project/router.py 项目维护导出（ProjectMaintenanceService）ColumnDef header。客户维护（/ppm/customers）router.py:393 + test_router.py:148（level=VIP）不在范围未改。
结果：后端 project 模块 26 passed + ruff format/check 全过。

## ql-20260722-003-c4d8 | 2026-07-22 10:50:00 | /ppm/problem-list 验证人(audit_user_id)清空/修改不生效
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/problem/schema.py（ProblemListUpdate 补 audit_user_id 字段）+ backend/app/modules/ppm/problem/tests/test_schema.py（新增 3 测试）
需求：/ppm/problem-list 验证人(audit_user_id)清空/修改不生效。
根因：ProblemListUpdate（schema.py）缺 audit_user_id 字段；前端 problem-list edit 的 upd（_forms.tsx）发 audit_user_id（清空时=null），后端 Update 无此字段 + Pydantic extra=ignore 静默丢弃 → 验证人无法更新/清空（DB updated_at 变但字段不变）。ProblemListBase（create）/ORM 都有 audit_user_id，唯独 Update 缺。逐层排查排除：apiFetch 不过滤 null、前端 upd 不过滤、后端 exclude_unset 实测保留显式 null、_Crud.update 能写 null（plan TestUpdateClearVsKeep 验证）、_backfill_names 只补 name 不动 id 字段。
方案：Update 加 `audit_user_id: uuid.UUID|None=None`。新增 problem/tests/test_schema.py 3 测试（接收 value/null/absent）。
结果：3 passed + ruff 过。module_id/now_handle_user schema 本就有，清空正常。

## ql-20260722-004-e5a2 | 2026-07-22 11:35:00 | /ppm/project-plans 新建/编辑弹窗加最小/最大高度
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx（Modal 加 styles.body 高度限制）
需求：/ppm/project-plans 新建/编辑弹窗（17 字段表单）过长撑屏，加最小/最大高度。
根因：PpmProjectPlanForm 的 Modal（width=920, antd v6）body 无高度限制，17 字段表单超高撑满屏幕。
方案：Modal `styles.body={maxHeight:'70vh',minHeight:'300px',overflowY:'auto'}`（antd v6 用 styles.body，bodyStyle 已废）；超高时 body 内部滚动不撑屏，minHeight 给短内容下限。新建/编辑共用此 Modal 均受益。纯样式 prop，不改逻辑/字段。
结果：纯样式改动，无逻辑/字段影响。

## ql-20260722-005-5203 | 2026-07-22 11:35:54 | (补分配) ql-004 project-plans 弹窗高度改动的提交收尾
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-plan-form.tsx（同 ql-004，弹窗高度限制）+ .sillyspec/quicklog/QUICKLOG-WhaleFall.md + .sillyspec/docs/SillyHub/modules/ppm.md
需求：（补分配会话）ql-004 改动（ppm-project-plan-form.tsx 弹窗高度）的 commit 收尾。
根因：本 ql-ID 由并行会话分配，实际改动即 ql-004（/ppm/project-plans 新建/编辑弹窗加高度），此条记录其提交动作，无独立新增逻辑。
方案：提交 d55ba3b3（3 文件：ppm-project-plan-form.tsx + quicklog + ppm.md），工作区干净（外部 dirty 文件已由并行会话 commit），QUICKLOG ql-004 标已完成、ppm.md 变更索引追加。
结果：改动实质同 ql-004（详见 ql-20260722-004-e5a2）。
## ql-20260722-006-3aca | 2026-07-22 13:44:38 | 里程碑明细删除级联任务+删模块级联子表+明细列表加「执行状态」列
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py（新增 TASK_STATUS_DONE 常量 + _cascade_task_on_detail_removal 级联 helper：非[已完成]删任务+TaskExecute/[已完成]保留解关联；delete_detail 改用级联替原 _unlink_task；delete_module 级联删该模块下全部明细+模块单事务；details_to_resp 新增 _collect_task_status_map 批量查注入 task_execute_status）+ backend/app/modules/ppm/plan/schema.py（PsPlanNodeDetailResp 加派生字段 task_execute_status）+ backend/app/modules/ppm/plan/tests/test_detail_task_link.py（FR-05 改级联 3 例 + FR-05b 删模块级联 4 例 + FR-08 执行状态 2 例 + _seed_module/_count_executes helper，import PlanNodeModule/TaskExecute）+ frontend/src/lib/ppm/types.ts（PsPlanNodeDetail 加 task_execute_status）+ frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable 加「执行状态」列 + TASK_EXECUTE_STATUS_COLOR 色映射）+ 同目录 __tests__/milestone-details.test.tsx（mkDetail 补字段）+ .sillyspec/docs/SillyHub/modules/ppm.md（关键逻辑更新删除语义 + 变更索引追加）
需求：①里程碑明细被删除时，若关联任务计划不是「已完成」则连任务计划一起删；②三级含模块子表删模块时，该模块下子表明细的任务同步按上述方案删；③明细列表加一列「执行状态」=任务计划的任务状态，实时查不入库。
根因：①delete_detail 原只调 _unlink_task（ps_plan_node_detail_id 置 null、任务永远保留），与需求矛盾；②delete_module 原只删 PlanNodeModule 行，跨表 FK 是软关联无约束（migration 202607220900），致明细 module_id 悬空、任务残留脏数据；③明细列表无任务执行进度展示。
方案：①plan/service.py 抽 _cascade_task_on_detail_removal(detail_id)：查关联任务，状态非「已完成」连任务+其 TaskExecute 执行记录删（对齐 PlanTaskService.delete 清理）、「已完成」仅解关联保留；delete_detail 改调它替 _unlink_task；②delete_module 改为查该模块下全部明细逐条套级联规则 + 删明细 + 删模块，单事务原子提交；③schema.py PsPlanNodeDetailResp 加派生字段 task_execute_status，details_to_resp 批量 IN 查 PlanTask.status（首条生效，1:1 实践）注入；④前端 types.ts 加字段，DetailLevelTable 在「执行人」与「状态」间加「执行状态」列（Tag 色映射 未开始/进行中/已完成，无任务显「—」）。关键决策：删模块连带删其下明细（子表归属模块语义，治悬空脏数据），已在汇报标注可调。
结果：①ppm 全量 374 passed；②ruff/mypy 0 error（ruff format 已对齐）；③前端 typecheck/lint 0 error、milestone-details 24 passed；④已 commit 2da26527 push + 重建 backend+frontend 部署，容器 healthy、/api/health 与前端均 200。

## ql-20260722-007-d15b | 2026-07-22 14:33:56 | /ppm/milestone-details 三级编辑明细提交后第三层折叠改原地刷新
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（detailTick 注释更新；主 expandRender 两处子表 key 去 detailTick 改 key={node.id} + 下传 refreshTick={detailTick}；ModuleLevelProps/DetailLevelProps 加 refreshTick?:number + 解构；moduleExpandRender 透传 refreshTick；DetailLevelTable reload useEffect 加 refreshTick 依赖）+ .sillyspec/docs/SillyHub/modules/ppm.md（变更索引追加）
需求：里程碑明细三级（实施阶段：里程碑→模块→明细）下，编辑第三层（明细）子表信息提交后第三层会被折叠，改为直接刷新、不折叠。
根因：明细提交成功后 onSaved/handleSubmit 都 setDetailTick+1，而 expandRender 里 ModuleLevelTable/DetailLevelTable 的 key 含 detailTick → key 变 → 整个 ModuleLevelTable 重新挂载 → 其内部 antd 非受控 expandedRowKeys 复位 → 模块行折叠、第三层明细列表消失。两级（非模块）场景的 DetailLevelTable 无内层展开故不折，仅实施阶段三级出问题。
方案：去掉子表 key 里的 detailTick（改 key={node.id} 稳定不 remount），改下传 refreshTick={detailTick} prop；ModuleLevelTable 接收并透传给其明细子表；DetailLevelTable 把 refreshTick 加进 reload 的 useEffect 依赖，变化即原地 reload。模块展开态因 ModuleLevelTable 不 remount 而保留 → 不折叠，明细数据照常刷新。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④已 commit 1d85f752 push + 重建 frontend 部署，容器 healthy、前端 200。
## ql-20260722-008-82dc | 2026-07-22 15:24:00 | /ppm/milestone-details 明细子表任务描述列固定 250px + 操作列设固定列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable 任务描述列 width 220→250；操作列加 fixed:'right' + onCell 不透明背景）
需求：里程碑明细（DetailLevelTable）的【任务描述】列固定为 250px；【操作】列设为固定列（横向滚动时钉住）。
根因：①任务描述列原 width=220 偏窄，长文本 ellipsis 截断过多；②操作列无 fixed，列多（11 列）横向滚动时操作按钮被滚出视口，需来回拖才能点到。
方案：①任务描述列 width 220→250（保留 ellipsis）；②操作列加 `fixed: "right"`。表格已 `scroll={{ x: "max-content" }}` 横向滚动启用，固定列生效。固定列 + 斑马纹（rowClassName bg-muted/40）：横向滚动时固定单元格透明会透出滑动行内容，加 `onCell` 不透明 `hsl(var(--muted))` 背景（本表容器 bg-muted/20，用 muted 比 card 更贴表面；对齐 ppm 固定列既有模式但按本表表面调整）。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 部署。
## ql-20260722-009-fb5f | 2026-07-22 15:44:05 | /ppm/milestone-details 明细子表表格样式对齐 /ppm/projects + 修复固定列/列宽不生效
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable：全列加固定宽；斑马纹改 ppm-striped-table CSS 模式；操作列 onCell 背景 muted→card；render 去 overflow-visible）
需求：上轮（ql-008）任务描述固定 250px、操作列固定列都没生效；且里程碑明细子表样式与 /ppm/projects（PpmResourceTable）差别很大，要求一致。
根因：①ql-008 只给任务描述/操作列设宽，其余列无固定宽 → 表格不横向溢出 → 不滚动 → `fixed:"right"` 的 sticky 无处钉、width 也无感（这是「没生效」的真因）；②斑马纹用手动 `bg-muted/40` rowClassName（旧法，与固定列冲突），与 projects 的 `ppm-striped-table` CSS 模式不一致。
方案：①全列加固定宽（明细阶段 140 / 任务主题 160 / 任务描述 250 / 角色 100 / 计划工时 90 / 计划开始 120 / 计划结束 120 / 执行人 160 / 执行状态 100 / 状态 100 / 操作 280 = 1620px，强制溢出 → 固定列钉、列宽生效）；②斑马纹改 `ppm-striped-table` CSS 模式（包裹 div + `<style>` 注入 `nth-child(even) td{background:hsl(var(--muted)/0.4)}` + `rowClassName={()=>""}`，对齐 PpmResourceTable）；③操作列 `onCell` 背景 `hsl(var(--muted))`→`hsl(var(--card))`（对齐 PpmResourceTable）；④去掉 `className="overflow-visible"`（恢复 DataTable 默认 overflow-hidden，内部 scroll 不被裁）。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 部署后用户浏览器验证（任务描述 250 + 操作列钉右 + 斑马纹与 projects 一致）。
## ql-20260722-010-9d8c | 2026-07-22 16:50:36 | /ppm/milestone-details 明细子表弃用 antd 固定列改全宽自适应(ql-009 仍不生效的定性追修)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable：去 scroll.x 改全宽；操作列去 fixed/onCell；回退 ql-009 刚性宽度改弹性）
需求：ql-009 全列加宽 + ppm-striped-table 仍不生效（任务描述 250 不生效、操作列不固定），用户反馈「还是没生效」。
根因：已确认部署产物含改动（git 干净 + bundle 命中 ppm-striped-table），排除没部署。真因是 antd `fixed` 列在三级嵌套（主表/模块表都 `scroll.x`）展开表内不可靠——sticky 相对最近的 overflow 祖先（父表 body）计算，导致固定列失效；`scroll.x=max-content` 在嵌套下不按内容宽建布局，连任务描述 250 列宽也不生效。三次调宽/scroll 均无效，证实是结构性问题、非配置问题。
方案：弃用 antd 固定列，明细表改全宽自适应——①去 `scroll.x`，表格自动填满容器；②操作列去 `fixed`/`onCell`（作为末列自然落在右缘）；③任务描述保留 `width: 250`（全宽下列宽严格生效）；④回退 ql-009 加给明细阶段/任务主题/角色/计划工时/状态的刚性宽度改弹性（auto 自适应，配合全宽布局）；⑤斑马纹 ppm-striped-table 保留（对齐 projects）。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（任务描述 250 + 表格填满 + 斑马纹一致；不再追求横向滚动固定列，因嵌套下不可行）。
## ql-20260722-011-8c3f | 2026-07-22 19:14:20 | /ppm/milestone-details 明细子表(嵌套)操作列固定——照搬已生效子母表同法
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable：操作列加 fixed:right+onCell card；明细阶段/任务主题/角色/计划工时/状态 加固定宽；去 overflow-visible）
需求：子母表（主表/模块表）操作列 fixed 已生效（用户确认），现要求嵌套子表（明细 DetailLevelTable）操作列也固定。
根因：之前明细表固定失败，主因是多列无固定宽 → 表格不横向溢出 → 不滚动 → sticky 无处钉（叠加 ppm-striped-table/去 scroll 等乱改放大了问题），并非纯嵌套所致；主表/模块表（同样 scroll.x）能生效反证只要强制溢出，嵌套表 fixed 也可工作。
方案：照搬已生效主表改法——①明细操作列加 `fixed:"right"` + `onCell card`；②给 auto 列加固定宽（明细阶段 140 / 任务主题 160 / 角色 100 / 计划工时 90 / 状态 100，合计 ~1620px 强制溢出 → sticky 有处钉）；③去 `className="overflow-visible"`（对齐主表/PpmResourceTable）。保留 `scroll x max-content` + 手动斑马纹。与主表/模块表改法完全一致。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（明细表横向滚动时操作列钉右）。若仍不钉，则确属嵌套限制，需把明细从嵌套展开改为独立面板。
## ql-20260723-001-7a2d | 2026-07-23 08:42:03 | /ppm/milestone-details 明细子表【任务描述】列长内容撑宽修复
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable 任务描述列 render 改为受限 truncate 容器）
需求：明细表【任务描述】列宽度仍是自适应——内容过长会整段展示、把列撑得很宽，要求截断固定在 250。
根因：明细表用 `scroll.x="max-content"`，antd 按内容计算列宽；任务描述列虽有 `width:250 + ellipsis:true`，但 max-content 会被长文本撑开列宽、ellipsis 随之失效，故列自适应变宽、内容全显。
方案：任务描述 `render` 由直出文本改为受限宽度 truncate 容器——`<div className="truncate" title={v} style={{maxWidth:220}}>`（truncate=overflow:hidden+text-overflow:ellipsis+white-space:nowrap），强制长文本截断在 220px 内、`title` 悬浮看全文，不再受 max-content 撑开。列 `width:250 + ellipsis:true` 保留作兜底。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（任务描述列固定 ~250、长文本截断显 …）。
## ql-20260723-002-6f33 | 2026-07-23 09:00:10 | /ppm/milestone-details 明细子表【任务描述】列改换行不截断
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable 任务描述列：去 ellipsis，render 改固定宽度换行容器）
需求：上轮（ql-001）把任务描述做了截断（truncate），用户改要求换行显示全文、不要截断。
根因：ql-001 的 `ellipsis:true + truncate` 是单行截断，不符合「换行显示全文」的要求。
方案：①去掉列 `ellipsis:true`（它会强制 `white-space:nowrap` 单行截断）；②render 由 truncate 改为固定宽度换行容器 `<div className="whitespace-normal break-words" style={{maxWidth:220}}>`——长文本自动换行成多行、列宽仍固定 ~250（maxWidth 约束不被 max-content 撑开）、全文可见不截断。列 `width:250` 保留。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（任务描述列固定~250、长文本换行多行、全文可见）。
## ql-20260723-003-8b94 | 2026-07-23 09:08:27 | /ppm/milestone-details 三级「导入模块」弹窗上传步加模板下载
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（ImportModuleModal 上传步加「下载导入模板」按钮）+ frontend/public/templates/dev-plan-template.xlsx（新增静态模板，源 C:\Users\12532\Desktop\项目详细开发计划模板.xlsx）
需求：实施阶段（三级）的「导入模块」弹窗，上传文件步骤加一个模板下载入口，模板由用户提供（桌面「项目详细开发计划模板.xlsx」）。
根因：原上传步只有 Upload.Dragger（accept .xlsx），用户无从得知期望的列格式，需提供模板下载。
方案：①把模板拷到 `frontend/public/templates/dev-plan-template.xlsx`（Next.js 静态服务；next.config 无 basePath，根路径 `/templates/...` 直接可访问）；②ImportModuleModal 上传步（step===1）Upload.Dragger 下方加「下载导入模板」antd Button（type=link），onClick 创建临时 `<a>`（href=`/templates/dev-plan-template.xlsx`、`download="项目详细开发计划模板.xlsx"` 中文名）触发下载；③Dragger + 按钮 Fragment 包裹（修复 JSX 多根元素 TS 报错）。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（上传步点「下载导入模板」能下载到中文名 xlsx）。
## ql-20260723-004-c388 | 2026-07-23 09:28:03 | /ppm/milestone-details 新建里程碑弹窗「总体阶段」改下拉选+输入(AutoComplete)
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（导入 AutoComplete + listPlanNodes/PlanNode；PsPlanNodeDrawer 加 stageOptions 加载 + 总体阶段 Input→AutoComplete）
需求：【新建里程碑】弹窗的「总体阶段」现在是纯输入，没有计划节点模板提示；改成 antd 的「下拉选 + 输入」组合框——下拉项是计划节点模板（PlanNode）的总阶段，且若输入的总体阶段不在模板里就不去匹配（仍接受该值）。
根因：原 PsPlanNodeDrawer 总体阶段是 `<Input>`，用户无从知道有哪些既定阶段，易与模板不一致；而 antd 的 AutoComplete 正是「可选可输」的 combobox。
方案：①导入 `AutoComplete`、`listPlanNodes`、`PlanNode` 类型；②PsPlanNodeDrawer 加 `stageOptions` state + `useEffect`（弹窗 open 时 `listPlanNodes({page_size:200})` 取模板 `overall_stage` 去重作下拉 options，加载失败静默降级为空下拉）；③总体阶段 `Input` → `<AutoComplete options={stageOptions} filterOption=模糊过滤 allowClear>`——可下拉选模板阶段，也可手输任意值（submit 本就纯文本提交，不匹配模板即不匹配，符合需求）。
结果：①前端 typecheck 0 error；②lint 0 error；③milestone-details 24 passed；④待 commit+push+重建 frontend 后用户验证（总体阶段可下拉选模板阶段、也能手输新值）。
## ql-20260723-005-fec1 | 2026-07-23 09:41:36 | /ppm/milestone-details 新建里程碑选模板总体阶段时复制模板明细(同新建项目计划逻辑)
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py（create_ps_plan_node 改单事务+按 overall_stage 匹配模板复制明细）+ backend/app/modules/ppm/plan/tests/test_service.py（+2 单测：匹配复制/不匹配不复制）
需求：新建里程碑时，若选中的总体阶段是计划节点模板（PlanNode）的阶段，把该模板对应阶段的明细数据带过来——逻辑和新建项目计划时一样。
根因：create_ps_plan_node 原只是 `_Crud.create` 建一条空里程碑，未像 create_ps_project_plan（`_init_milestones_from_template`）那样匹配模板并复制明细。
方案：改 create_ps_plan_node 为单事务——建里程碑后按 `overall_stage` 查 PlanNode 模板（`select(PlanNode).where(overall_stage==stage).limit(1)`），命中则记 `template_plan_node_id`/`has_module`，且 `has_module=false` 时复用 `_copy_template_details_to_node` 复制模板明细（draft，module_id=null，与 `_init_milestones_from_template` 完全一致）；`has_module=true` 则只记归属（明细等建模块时由 create_module 复制）；不匹配则空里程碑。新增 2 单测覆盖匹配复制 / 不匹配不复制。
结果：①ruff/mypy 0 error；②plan 套件 139 passed / 22 errors（22 errors 全是本地 venv 缺 aiobotocore 致 db_engine fixture 导入 file/storage 模块失败的预存环境问题，非本次逻辑；CI/生产镜像含 aiobotocore 可正常跑）；③待 commit+push+重建 backend 部署后用户验证（新建里程碑选模板阶段→展开有预置明细；手输非模板阶段→空里程碑）。
## ql-20260723-006-2c41 | 2026-07-23 10:11:25 | /ppm/milestone-details 导出改为只导当前项目计划的明细
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py（list_plan_node_details_for_export 加 plan_id 过滤）+ backend/app/modules/ppm/plan/router.py（export_plan_node_details 加 plan_id Query）+ backend/app/modules/ppm/plan/tests/test_service.py（+1 单测）+ frontend/src/lib/ppm/plan.ts（exportMilestoneDetails 传 planId）+ frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（handleExport 传 planId）
需求：【里程碑明细】页的导出数据不对，应只导出当前这个项目的里程碑明细。
根因：原 list_plan_node_details_for_export 无任何过滤，导出全平台所有项目的非 archived 明细；前端 exportMilestoneDetails 也不传当前 planId，故导出的是全量而非当前项目。
方案：①后端 service `list_plan_node_details_for_export(plan_id=None)`：plan_id 非空时 join `PsPlanNode`(ON plan_node.id == detail.plan_node_id) 过滤 `ps_project_plan_id == plan_id`，只导该项目计划的明细；不传仍全量（兼容）。②router `export_plan_node_details` 加 `plan_id: uuid.UUID|None = Query(None)` 透传。③前端 `exportMilestoneDetails(planId?)` 经 `downloadExcel` 传 `{plan_id}` query。④page handleExport 传当前 `planId`。新增 1 单测验证按 plan_id 过滤（2 计划各 1 明细，传 plan_a 只返回 A 的）。
结果：①ruff(format+check)/mypy 0 error；②前端 typecheck/lint 0 error、milestone-details 24 passed；③后端 db 单测本地 venv 缺 aiobotocore 跑不了（CI 跑）；④待 commit+push+重建 backend+frontend 部署后用户验证（导出只含当前项目明细）。
## ql-20260723-007-bd13 | 2026-07-23 10:35:10 | /ppm/milestone-details 导出改子母表(分组合并)布局
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/common/export.py（新增 grouped_report_to_workbook 分组构建器）+ backend/app/modules/ppm/common/tests/test_export.py（+分组构建纯测试）+ backend/app/modules/ppm/plan/service.py（新增 build_milestone_export_sections 构建分组树）+ backend/app/modules/ppm/plan/router.py（export 端点改分组构建 + _MILESTONE_DETAIL_GROUP_COLUMNS 去 overall_stage 列）+ backend/app/modules/ppm/plan/tests/test_service.py（+分组数据测试）
需求：里程碑明细导出 Excel 按「子母表」方式（用户选定「分组合并」布局）：里程碑 → 模块 → 明细 层级，里程碑/模块作为合并标题行、明细行在其下；导出范围仍限当前项目计划。
根因：原导出为扁平明细行（list_plan_node_details_for_export + rows_to_workbook），无里程碑/模块层级，看不出每条明细属于哪个里程碑/模块。
方案：①common/export 新增 `grouped_report_to_workbook(columns, sections)`：第 1 行列头（冻结、空 sections 也保留）→ 每个 section 大标题行（跨列合并、深蓝底）→ 子分组（子标题合并行浅蓝底? + 明细行）；section 间空行。②service 新增 `build_milestone_export_sections(plan_id)`：取该计划里程碑（按 no），批量反查责任人姓名，has_module 里程碑按模块分子标题、未分模块明细单列「(未分模块)」组，非 has_module 直接挂里程碑；标题行含「里程碑 {no}. {阶段} | 责任人:.. | 计划:..~..」。③router export 端点改用分组构建 + 新列定义 `_MILESTONE_DETAIL_GROUP_COLUMNS`（去掉 overall_stage，标题行已含）。新增 grouped 构建纯测试（openpyxl 读回校验合并/列头/明细行）+ service 分组数据测试。
结果：①ruff(format+check)/mypy 0 error；②plan+export 套件 172 passed 0 errors（含新增 2 测试）；③前端无改动（ql-006 已传 planId，downloadExcel 透传）；④待 commit+push+重建 backend 后用户验证（导出为分组合并的子母表 Excel）。
## ql-20260723-008-a96e | 2026-07-23 11:56:46 | /ppm/milestone-details 导出子母表三补:列头入层级+补全列含执行状态+状态英转中
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/common/export.py（grouped_report_to_workbook 改每 section 自带列头）+ backend/app/modules/ppm/common/tests/test_export.py（per-section 列头布局测试）+ backend/app/modules/ppm/plan/router.py（_MILESTONE_DETAIL_GROUP_COLUMNS 补任务描述/执行人/执行状态）+ backend/app/modules/ppm/plan/service.py（DETAIL_STATUS_CN 常量 + build_milestone_export_sections 批量取明细/执行人名/执行状态/状态中文）+ backend/app/modules/ppm/plan/tests/test_router.py（plan-node-detail header 校验改 None）+ backend/app/modules/ppm/plan/tests/test_service.py（+状态中文/新列断言）
需求：①导出 Excel 的明细列头放到对应里程碑层级里（每个里程碑块自带列头）；②列头要包含所有信息标题，包括执行状态；③状态列目前显示英文，处理成中文。
根因：①ql-007 的列头只在顶部第 1 行，与各里程碑块分离，看某个里程碑明细时不知列含义；②导出列只有 8 列，缺任务描述/执行人/执行状态；③明细 status 存的是 draft/done 等英文枚举值，导出原样显示对用户不友好。
方案：①`grouped_report_to_workbook` 去掉顶部列头，改为每个 section 大标题行后紧跟列头行（块自包含）；②`_MILESTONE_DETAIL_GROUP_COLUMNS` 补「任务描述/执行人/执行状态」共 11 列；③service 加 `DETAIL_STATUS_CN`（draft→草稿/review→审核中/approve→审批中/done→已完成/rejected→已驳回/archived→已归档），`build_milestone_export_sections` 改为批量取该计划全部明细、批量反查执行人姓名(auth.users)+执行状态(关联 PlanTask.status)、status 映射中文。更新 grouped 纯测试（per-section 列头）+ router parametrize（plan-node-detail 无 plan_id 空表，header 校验改 None 仅验 200）。
结果：①ruff(format+check)/mypy 0 error；②plan+export 套件 172 passed 0 errors；③待 commit+push+重建 backend 后用户验证（导出每个里程碑块内自带完整列头含执行状态、状态显示中文）。