---
author: WhaleFall
created_at: 2026-07-14T09:20:24
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260714-002-1036 | 2026-07-14 09:44:58 | 导出文件名统一「中文+日期时间」——plan_node_details 与 /ppm/projects 共用 timestamped_filename
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/common/export.py（新增 timestamped_filename helper）+ backend/app/modules/ppm/plan/router.py（3 个导出文件名统一）+ backend/app/modules/ppm/project/router.py（2 个导出文件名改用 helper）+ backend/app/modules/ppm/common/tests/test_export.py（加 2 例单测）
需求：用户要求导出文件名改「中文+日期时间」，且 plan_node_details 与 /ppm/projects 两个导出用同一个逻辑。
根因：plan_node_details 导出文件名是英文固定 plan_node_details.xlsx（无日期）；/ppm/projects 已是「中文+日期」但 f-string 内联在 router。两子域各自重复 helper + 文件名逻辑，common/export.py 缺统一的文件名生成函数。
方案：common/export.py 新增 timestamped_filename(label)→f"{label}_{%Y%m%d_%H%M%S}.xlsx"；plan/router.py 三个导出（项目计划/计划节点模板/里程碑明细）+ project/router.py 两个导出（项目维护/客户维护）统一调用之，删除 project 冗余 datetime import。
结果：①5 个 ppm 导出文件名统一为「中文标签_日期时间.xlsx」；②test_export.py 加 TestTimestampedFilename 2 例（格式 + 多 label）；③common/plan/project 共 72 测试过 + ruff 过；④待 commit+push+rebuild backend 部署后 curl 验证 Content-Disposition 中文文件名。

## ql-20260714-003-f53e | 2026-07-14 10:19:34 | 新建里程碑明细必填校验补全（仅要求/附件/所属模块可空）+ 所属模块仅实施阶段显示
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（明细开立信息字段加 required + 所属模块按 overall_stage 条件渲染 + DetailDrawerState/DetailDrawer/openDetail 透传 overallStage）
需求：用户要求新建里程碑明细只有【要求、附件】不必填，其他全必填；【所属模块】字段仅实施阶段（里程碑→模块→明细三级）展示，其他阶段不显示。
根因：明细开立信息表单除 task_theme 外其余字段无 required（ql-008 只加了 task_theme/审核/审批人，ql-009 关审批后审核审批字段已去）；所属模块(module_id)之前无条件总显示，但非实施阶段无模块可选、显示无意义。DetailDrawer 缺 overall_stage 信息无法判断阶段。
方案：①DetailDrawerState/DetailDrawer prop/openDetail 参数加 overallStage?:string|null，4 处 setDrawer + 2 处 openDetail 调用传当前 node.overall_stage；②明细阶段/任务描述/角色/成果/计划工作量/计划开始/完成时间/执行人 8 字段加 rules required:true（task_theme 已有）；要求/附件/所属模块保持非必填；③所属模块 Form.Item 用 overallStage===IMPLEMENT_STAGE 条件渲染，非实施阶段隐藏且执行人改整行(grid-cols-1)；④后端 schema 不动（前端校验即可，避免影响 problem 变更流等其他入口，同 ql-008 做法）。
结果：①typecheck 过；②eslint 0 error（19 warning 全既有）；③milestone-details 18 测试过；④待 commit+push+rebuild frontend 部署 + 用户浏览器验证（空表单提交被拦、非实施阶段无所属模块）。

## ql-20260714-004-e884 | 2026-07-14 10:51:26 | 明细所有状态可删（去 draft 限制）+ 所属模块（实施阶段）改必填
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（删除按钮去 d.status==="draft" 限制 + 所属模块 Form.Item 加 required）
需求：①用户要求所有状态的明细都能删除（原来只有 draft 能删）；②所属模块也改成必填（原 ql-003 设为可空）。
根因：①删除按钮原条件 {d.status==="draft" && (...)}，只有草稿态显示，done/审核/审批/驳回/归档态都看不到删除按钮；②所属模块 ql-003 设为非必填（allowClear + 无 rules）。注：后端 delete_detail 本就无状态校验（任何状态物理删除），本次只放开前端限制。
方案：①明细列表删除按钮去掉 {d.status==="draft" && } 包裹，所有状态都渲染（保留 disabled={readOnly} 非项目经理禁用）；②所属模块 Form.Item 加 rules=[{required:true}]（该字段仅实施阶段渲染，故=实施阶段必填，其他阶段不显示不校验），tooltip/placeholder 去掉"可空"措辞。
结果：①typecheck 过；②eslint 0 error（19 warning 全既有）；③milestone-details 18 测试过；④待 commit+push+rebuild frontend 部署 + 用户验证（任意状态明细都能删、实施阶段所属模块必填）。

## ql-20260714-005-34d7 | 2026-07-14 11:13:05 | 修 ql-004 遗漏：删除按钮显示了但点击没反应（handleDelete 内残留 status!==draft 守卫）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（handleDelete 删除 d.status!=="draft" return 守卫）
需求：用户反馈 ql-004 后删除按钮对所有状态都显示了，但点击没反应。
根因：ql-004 只改了删除按钮的渲染条件（去 {d.status==="draft" && } 包裹），漏改 handleDelete 内部守卫——handleDelete 第一行 `if (d.status !== "draft") return;` 仍在，非草稿状态点击直接 return（连 confirm 都不弹）→ 表现为"按钮有但点击无反应"。
方案：删除 handleDelete 内 `if (d.status !== "draft") return;` 一行，所有状态都走 confirm→deletePsPlanNodeDetail→reload 正常流程。
结果：①typecheck 过；②18 测试过；③待 commit+push+rebuild frontend 部署 + 用户验证（任意状态明细删除按钮可点出确认框并删除）。

## ql-20260714-006-a98a | 2026-07-14 11:31:29 | 工作日联动跳过节假日/调修 + 计算口径改为「开始日算第1天」+ 计划工作量输入框宽度 100%
状态：已完成
关联变更：（无）
文件：frontend/src/lib/ppm/workday.ts（内置 2026 节假日数据+getDayStatus+isRestDay + addWorkingDaysMs 重写为第N工作日语义）+ frontend/src/app/(dashboard)/ppm/kanban/_components/kanban-gantt-helpers.ts（getDayStatus/DayStatus 改 re-export from workday，单一数据源）+ frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（两处 plan_workload InputNumber 加 style width 100%）+ frontend/src/lib/__tests__/ppm-workday.test.ts（12 用例改新语义 + 3 节假日用例）
需求：①计划工作量输入框宽度没 100%；②自动算完成时间要跳过系统已维护的 2026 节假日；③口径：工作量 2 天、开始 7/1 → 完成 7/2（开始日算第 1 天）。
根因：①antd InputNumber className=w-full 不生效，需 style width;②addWorkingDaysMs 只跳周末，不跳法定假日也不处理调休补班（数据在 kanban-gantt-helpers，未共享给 workday）;③源算法语义是「start+N 工作日」且带 days-0.01 跨日副作用（+2 实际跨 3 天），与用户「开始日算第1天」(+2=+1天) 差 2 天。另：原算法有「每周固定5工作日」完整周优化，加节假日后不准。
方案：①page.tsx 两处 plan_workload InputNumber 加 style={{width:'100%'}}；②workday.ts 内置 HOLIDAYS_2026/ADJUSTED_WORKDAYS_2026 + getDayStatus + isRestDay（休息=法定假日或周末，调休补班算工作），kanban-gantt-helpers re-export 保持 API；③addWorkingDaysMs 重写为「第 N 个工作日」语义（起点顺延休息日作第1天，再推进 N-1 个工作日），去掉 0.99 副作用 + 完整周优化 + 小数跨日，纯逐日跳 isRestDay。
结果：①typecheck 过；②workday 15 测试（12 改新语义 + 3 节假日：中秋顺延/跨国庆/调休补班）全过；③kanban 18 测试过（getDayStatus re-export 行为不变）；④milestone 18 测试过；⑤eslint 0 error。注：problem 表单也用该 helper，完成日语义随之一致变化（无前端测试覆盖）。待 commit+push+rebuild frontend + 用户验证。

## ql-20260714-007-b2e7 | 2026-07-14 15:51:09 | 修「新建里程碑」选计划开始/完成时间崩溃——DatePicker 受控写法与 Form.Item 冲突，对齐明细表单 getValueProps+normalize
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（PsPlanNodeDrawer 两个日期 Form.Item 改 getValueProps+normalize，删 DatePicker 手写 value/onChange）
需求：新建里程碑选「计划开始时间/计划完成时间」报 client-side exception：TypeError: S(...).isValid is not a function。要求调整得和「新建里程碑明细」里一样。
根因：主表单 DatePicker 同时用 <Form.Item name=...> 受控 + 手写 value={toDay(form.getFieldValue(...))}/onChange={form.setFieldValue(fromDate(d))}。Form.Item 有 name 时 antd 会用 cloneElement 把 form store 值（字符串）注入 DatePicker.value 覆盖手写 value，rc-picker 内部 value.isValid() 对字符串报 not a function。明细表单用 getValueProps(v=>({value:toDay(v)}))+normalize(d=>fromDate(d)) 做双向转换，store 存字符串、DatePicker 收 Dayjs，无此问题。
方案：把主表单两个日期 Form.Item 改成与明细完全一致的 getValueProps+normalize 写法，删除 DatePicker 上的 value/onChange 手写 props，仅保留 className/format。
结果：①typecheck 过；②lint 0 error（剩余 warning 全为既有、与本次无关的其他文件）；③milestone-details 18 测试过；④待 commit+push+rebuild frontend 部署 + 用户验证（新建里程碑选开始/完成时间不再崩溃）。

## ql-20260714-008-be21 | 2026-07-14 16:44:56 | milestone-details 明细子表 DataTable overflow-hidden 截断表头/尾部 → 加 overflow-visible 覆盖
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable 的 DataTable 加 className=overflow-visible，覆盖 DataTable 默认的 overflow-hidden）
需求：用户反馈 /ppm/milestone-details 子表的 class=overflow-hidden 导致列表头部和尾部被截断一部分。
根因：明细子表 DetailLevelTable 用了 DataTable 组件（data-table.tsx:32），其外层 `<div className={cn("overflow-hidden", className)}>` 的 overflow-hidden 把 antd Table 的表头/尾部（border/shadow/圆角）裁掉。模块子表用 PpmSubTable（无 overflow-hidden）不受影响。
方案：给 DetailLevelTable 的 DataTable 传 className="overflow-visible"；cn 用 twMerge（tailwind-merge），overflow-visible 覆盖默认 overflow-hidden，只影响该子表，不动 DataTable 默认（其他用 DataTable 的地方仍 overflow-hidden）。
结果：①typecheck 过；②milestone-details 18 测试过；③待 commit+push+rebuild frontend + 用户浏览器验证（明细子表表头/尾部不再被截断）。

## ql-20260714-009-c3d1 | 2026-07-14 17:15:00 | 修 /ppm/projects 项目类型/状态列显示原始 code「1 2」——前端枚举 value 用语义串(research/ongoing)与 DB code(1/2)不匹配
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/page.tsx（PROJECT_TYPE_OPTIONS/PROJECT_STATUS_OPTIONS 的 value 改成源字典 code 1/2/3）
需求：用户反馈 /ppm/projects 页【项目类型】【项目状态】列显示「1 2」而非中文。
根因：PpmResourceTable select 列渲染 opts.find(o=>o.value===String(value))，找不到匹配则回退 String(value) 显示原始值。DB ppm_project_maintenance 实际存源字典 code（type 1/2、status 1/2，仅 1 条测试数据 implementation/ongoing），但前端 PROJECT_TYPE_OPTIONS value=research/implementation/maintenance、PROJECT_STATUS_OPTIONS value=ongoing/completed/paused 与 code 不匹配 → 回退显示 code「1 2」。前端枚举注释「参照源 vue 字典 pm_project_type/pm_project_status」，枚举顺序即源字典 code 顺序（type 1=研发/2=实施/3=运维；status 1=进行中/2=已完成/3=已暂停），DB 数据分布(type=2 多/status=1 多)与此吻合。
方案：两个枚举 value 改成源字典 code "1"/"2"/"3"，label/color/statusKind 不变 → find 匹配 code 渲染中文 Tag/StatusBadge。注：那条 implementation/ongoing 测试数据(前端旧 value 存的)将显示原始串，属测试数据可忽略（CLAUDE.md 规则11 允许重置）。
结果：①typecheck 过；②lint 0 error；③grep 确认 research/ongoing 等旧 value 仅 projects/page.tsx 用（已改），其余 completed/maintenance 命中均 agent/daemon 等无关模块；④待 commit+push+rebuild frontend + 用户验证（类型/状态列显示中文 Tag/StatusBadge）。

## ql-20260714-010-a4f2 | 2026-07-14 23:25:00 | PpmResourceDrawer 抽屉表单原生控件统一改 antd(Form/Form.Item/Input/Select/DatePicker/InputNumber/Input.TextArea)
状态：进行中
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx（PpmResourceDrawer 表单层重写为 antd Form + import DatePicker/InputNumber/dayjs + 删原生 inputCls/textareaCls）
需求：用户确认 /ppm/projects 编辑/新建抽屉表单控件统一换 antd（与搜索区一致）。
根因：PpmResourceDrawer 抽屉外壳已 antd Drawer(ppm-projects-style-redesign task-02)，但表单内 input/select/textarea/label 仍是原生 HTML + tailwind（task-02 漏改表单层），与搜索区 antd Form 不统一，原生日期选择器/下拉样式差。泛型组件，项目/客户/干系人页复用。
方案：表单层从「useState form + 手动 fieldErrors + 原生控件」重写为「Form.useForm + Form.Item rules(required/pattern 自动校验) + antd 控件」：text→Input、number→InputNumber、select→Select、textarea→Input.TextArea、date→DatePicker、datetime→DatePicker(showTime)；date/datetime 用 Form.Item getValueProps/normalize 做 dayjs↔ISO 双向转换；submit 改 validateFields→onSubmit；按钮 disabled 去 formValid；删 inputCls/textareaCls。props 不变。
波折：首次改造完成后未及 commit，被并发会话 git merge milestone-module-import(a32f07c7) 丢弃工作区改动（quicklog/代码全回退），且 frontend/node_modules/.bin 被破坏致 pre-commit hook 的 next/tsc/vitest 命令找不到（pnpm install 重建 .bin 修复）。本次为重新应用改造。
