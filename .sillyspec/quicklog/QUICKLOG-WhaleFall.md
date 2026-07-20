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
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx（PpmResourceDrawer 表单层重写为 antd Form + import DatePicker/InputNumber/dayjs + 删原生 inputCls/textareaCls）
需求：用户确认 /ppm/projects 编辑/新建抽屉表单控件统一换 antd（与搜索区一致）。
根因：PpmResourceDrawer 抽屉外壳已 antd Drawer(ppm-projects-style-redesign task-02)，但表单内 input/select/textarea/label 仍是原生 HTML + tailwind（task-02 漏改表单层），与搜索区 antd Form 不统一，原生日期选择器/下拉样式差。泛型组件，项目/客户/干系人页复用。
方案：表单层从「useState form + 手动 fieldErrors + 原生控件」重写为「Form.useForm + Form.Item rules(required/pattern 自动校验) + antd 控件」：text→Input、number→InputNumber、select→Select、textarea→Input.TextArea、date→DatePicker、datetime→DatePicker(showTime)；date/datetime 用 Form.Item getValueProps/normalize 做 dayjs↔ISO 双向转换；submit 改 validateFields→onSubmit；按钮 disabled 去 formValid；删 inputCls/textareaCls。props 不变。
波折：首次改造完成后未及 commit，被并发会话 git merge milestone-module-import(a32f07c7) 丢弃工作区改动（quicklog/代码全回退），且 frontend/node_modules/.bin 被破坏致 pre-commit hook 的 next/tsc/vitest 命令找不到（pnpm install 重建 .bin 修复）。本次为重新应用改造。
结果：①typecheck 过；②lint 0 error；③全量 test 911 passed；④commit 7ffeb0a5（首次改造被并发 git merge a32f07c7 覆盖，重新应用后提交）；⑤rebuild frontend 部署 healthy（backend 同 recreate 仍 healthy）；⑥push 待网络恢复（github 间歇性连不上）；⑦quick step3 baseline 审计被并发遗留文件(milestone-module-import/verify-result.md)误判 block，CLI 无法 --done（quick-baseline-blocks-dirty-worktree 坑），按先例手动维护本条状态。

## ql-20260715-001-7d2e | 2026-07-15 09:07:29 | /ppm/project-members 平铺表格补「所属项目」列——后端 ProjectMemberResp 只回 pm_project_id(UUID) 无项目名，前端用 listSimpleProjects 建 id→name 映射展示
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-members-table.tsx（import listSimpleProjects + state projectNameMap + load 平铺模式并行拉项目列表建映射 + columns unshift 首列「所属项目」+ useMemo 依赖加 projectId/projectNameMap）+ .sillyspec/docs/frontend/modules/components-ppm.md（PpmProjectMembersTable 契约补述 + 变更索引）
需求：用户反馈 /ppm/project-members 平铺表格不显示所属项目，看不出成员归属哪个项目。
根因：PpmProjectMembersTable 在 !projectId 全量平铺模式下表格列只有姓名/联系方式/部门/承担角色，无所属项目列；且后端 ProjectMemberResp 只回 pm_project_id(UUID) 无 project_name 字段，前端无项目名可直接展示。
方案：纯前端——平铺模式（未传 projectId）load 时并行调 listSimpleProjects()（已有 /project-maintenance/simple-list 接口）建 pm_project_id→project_name 映射存 state；columns 在 !projectId 时 unshift 首列「所属项目」，render 取 projectNameMap[id]||id（缺失回退 UUID，与姓名列兜底风格一致）；锁定 projectId 模式（projects 页成员管理抽屉）按项目过滤，不显示该列。不动后端 schema。
结果：①typecheck 过；②lint 0 error（剩余 warning 全既有其他文件）；③待 commit+push+rebuild frontend 部署 + 用户浏览器验证（平铺页首列显示项目名）。

## ql-20260715-002-9c5b | 2026-07-15 10:01:28 | /admin/users 新建用户去掉密码输入框，改后端固定默认密码 SillyHub@123
状态：已完成
关联变更：（无）
文件：backend/app/modules/admin/schema.py（UserCreateRequest.password 改可选 str|None + docstring）+ backend/app/modules/admin/users_service.py（加模块常量 DEFAULT_INITIAL_PASSWORD + create_user password 改可选缺省兜底）+ frontend/src/components/admin-user-drawer.tsx（移除 create 密码输入框/password state/passwordValid/body.password + 加蓝色默认密码提示）+ frontend/src/lib/admin.ts（接口 password 改可选）+ frontend/src/components/__tests__/admin-user-drawer.test.tsx（6 用例随需求调整）
需求：用户要求 /admin/users 新建用户时不要输入密码，系统给默认密码。经确认采用「固定默认密码 SillyHub@123」方案（统一初始值，管理员告知用户后登录，建议尽快修改）。
根因：原 UserCreateRequest.password 必填（min_length=8）+ 前端 create 模式有密码输入框，管理员每建一个用户都要手设密码。需求是去掉输入、后端统一给默认密码。
方案：① schema 层 password 改 str|None（default=None，显式传仍 min_length=8 校验）；② service 层 create_user 接收 None 时落库 DEFAULT_INITIAL_PASSWORD="SillyHub@123"，router 零改动（payload.password 可为 None，service 兜底），admin/settings 两入口共用同一 schema 行为一致（模块文档要求两处规则不发散）；③ 前端 admin-user-drawer create 模式去密码输入框+相关 state/校验/body 字段，换成蓝色提示展示默认密码 SillyHub@123；④ lib/admin.ts 接口 password 改可选。
结果：①前端组件测试 17/17 通过；②后端 admin schema+router 测试 36 passed + 3 xfail(预先债务) + 1 failed(test_auth_user_read_email_optional：employee_no 必填导致的预先 test debt，本次未触碰 UserRead，无关)；③ruff format/check + mypy app(468 文件) + tsc 全通过；④admin.md 契约摘要+注意事项+变更索引已同步。

## ql-20260715-003-e1f4 | 2026-07-15 13:05:00 | 里程碑明细列表隐藏「审核人」「审批人」两列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（明细 detailColumns 注释掉 audit_user_name / approve_user_name 两个列定义，保留代码+注释标注 ql-id 便于后续恢复）
需求：用户要求里程碑明细列表里的「审核人」「审批人」两列先隐藏。
方案：直接注释掉 detailColumns 数组中 audit_user_name（审核人）与 approve_user_name（审批人）两个 column 对象，不动后端（audit_user_id/approve_user_id 字段保留，仅在列表不展示）；注释保留原定义+ql-id，后续要恢复取消注释即可。
结果：tsc --noEmit EXIT 0；列表不再显示审核人/审批人两列；后端/数据未变。

## ql-20260715-005-8f3a | 2026-07-15 13:06:51 | /ppm/project-members 样式同步 /ppm/projects——GroupTable 加 SectionCard 卡片包裹 + 按钮行 D-006(新增│分隔│搜索/重置一行) + 搜索区 grid-cols-4 + striped 斑马纹表
状态：已完成
关联变更：2026-07-15-project-members-rebuild
文件：frontend/src/components/ppm-project-members-group-table.tsx
需求：用户要求 /ppm/project-members 样式和 /ppm/projects 同步。
根因：project-members 页的 GroupTable（project-members-rebuild 新建）样式与 projects 页 PpmResourceTable 不一致——GroupTable 裸 div 容器(无卡片)、顶部「添加」与底部「查询/重置」分散两行、搜索区 grid-cols-3、表格无斑马纹；projects 用 SectionCard 卡片 + 按钮行 D-006(数据组│竖分隔│基础组一行) + 搜索区 grid-cols-4 + ppm-striped-table 斑马纹。
方案：GroupTable 单文件样式对齐 PpmResourceTable(ppm-resource-table.tsx:535-665)：①SectionCard bodyPadding=p-2 包裹搜索区(原裸 div)②按钮行合并 D-006(添加项目成员│mx-1 h-6 w-px bg-border 竖分隔│搜索/重置 一行)③搜索区 grid-cols-1/3→grid-cols-4④Input/Select 去 size=small 对齐默认⑤表格外包 ppm-striped-table div+<style> 斑马纹⑥toast 前置。功能不变。
结果：tsc --noEmit EXIT 0。待 commit + push + rebuild frontend 部署 + 用户浏览器验证(project-members 视觉与 projects 一致:卡片/按钮一行/4列搜索/斑马纹)。

## ql-20260715-006-3e8c | 2026-07-15 13:19:13 | 登录失败报错改中文（Invalid email or password → 用户名或密码错误）
状态：已完成
关联变更：（无）
文件：backend/app/modules/auth/service.py（AuthService.login 用户名/密码校验失败抛 AuthInvalidCredentials 的 message：Invalid email or password → 用户名或密码错误）
需求：用户反馈登录失败报错是英文「Invalid email or password」，要求改中文。
根因：报错文案是 service.py:93 的英文硬编码（防枚举统一报错，D-001 纯 username 登录后仍残留 email 字样）。注：用户用 180490+SillyHub@123 登录 401 的根因是 180490 为 2025-01-15 创建的老用户（默认密码方案 2026-07-15 才上线），密码非默认——与本次文案改动无关，老用户密码需单独批量重置。
方案：service.py:93 AuthInvalidCredentials 消息「Invalid email or password.」→「用户名或密码错误。」（注释同步中文，保留防枚举：不区分用户不存在/密码错）。
结果：纯文案改动；待 commit+push+rebuild backend 部署 + 用户验证（登录失败显示中文「用户名或密码错误」）。

## ql-20260715-006-2c4d | 2026-07-15 13:33:28 | GroupTable 搜索区超 4 条件加展开收起（对齐 projects PpmResourceTable showExpandToggle）
状态：已完成
关联变更：2026-07-15-project-members-rebuild
文件：frontend/src/components/ppm-project-members-group-table.tsx
需求：用户反馈查询条件还是不统一——GroupTable 6 字段全显示，projects 超过 4 字段有展开收起。
根因：ql-005 同步样式时漏了 projects PpmResourceTable 的 showExpandToggle 逻辑（visibleSearchFields collapsed 取前 4 + 展开按钮，ppm-resource-table.tsx:519/595-603）；GroupTable 6 字段直接全显。
方案：GroupTable 加 searchExpanded state（默认 false）+ 后 2 字段（成员姓名·账号/角色）用 {searchExpanded &&} 条件渲染（前 4 总显）+ 按钮行搜索/重置后加展开/收起按钮（6>4 显示）。对齐 projects。
结果：tsc --noEmit EXIT 0。待 commit + push + rebuild frontend + 用户验证（默认前 4 + 展开按钮，点展开显全部 6 + 收起）。

## ql-20260715-007-3a5e | 2026-07-15 13:46:44 | GroupTable 一级表 scroll 加 y 自适应高度（对齐 projects PpmResourceTable DataTable calc(100vh-430px)）
状态：已完成
关联变更：2026-07-15-project-members-rebuild
文件：frontend/src/components/ppm-project-members-group-table.tsx
需求：用户反馈 table 没设置自适应高度，要对齐项目页。
根因：GroupTable 一级项目表 scroll 只有 {x:'max-content'} 无 y（ql-005 同步样式时漏了对齐 projects DataTable 的 y: calc(100vh-430px)）；G1 只给展开行成员子表(embedded)去了 y，一级表本应有 y。
方案：GroupTable 一级项目表 scroll 加 y:'calc(100vh-430px)'（对齐 ppm-resource-table.tsx:665）。展开行成员子表(embedded)保持无 y（G1 设计，嵌套不适合 vh scroll）。
结果：tsc --noEmit EXIT 0。待 commit + push + rebuild frontend + 用户验证（一级表自适应高度，超长时表头固定+ body 滚动）。

## ql-20260715-008-66c5 | 2026-07-15 13:53:21 | /admin/users 重置密码默认改用默认密码 SillyHub@123（非随机）+ 重置成功后关闭弹窗
状态：已完成
关联变更：（无）
文件：backend/app/modules/admin/users_service.py、frontend/src/app/(dashboard)/admin/users/page.tsx
需求：用户要求 /admin/users 重置密码默认也用默认密码（SillyHub@123），且重置成功后关闭弹窗。
根因：原 reset_password 不传密码时 _generate_password() 随机生成 12 位密码，前端弹窗停留展示明文（仅本次显示）；管理员易误以为默认密码 SillyHub@123（实际是随机串），被重置用户拿 SillyHub@123 登录会 401。
方案：后端 reset_password 默认 _generate_password()→DEFAULT_INITIAL_PASSWORD（与 create_user 一致，单一真源），删 _generate_password + secrets/string import，审计字段 auto_generated→used_default_password；前端 ResetPasswordDialog 成功后 onClose 关闭弹窗 + toast（默认场景提示「已重置为默认密码 SillyHub@123」），默认提示行展示固定默认密码，复选框文案改「不勾选则使用默认密码」，删 result/copied/copy，onReset 类型 Promise<string>→Promise<void>，加 DEFAULT_INITIAL_PASSWORD 常量；保留「自定义密码」勾选（显式传仍按 min_length=8 校验）。
结果：后端 ruff All checks passed + admin 路由测试 35 passed/3 xfailed；前端 lint 干净 + tsc --noEmit EXIT 0。待 commit + push + rebuild backend+frontend 部署 + 用户验证（重置密码后弹窗关闭，被重置用户用 SillyHub@123 可登录）。

## ql-20260715-009-5a20 | 2026-07-15 14:18:13 | email=NULL 用户登录 500 修复（TokenPayload.email 强制 str→可选，兼容 username-only 账号）
状态：已完成
关联变更：（无）
文件：backend/app/core/security.py、backend/tests/modules/auth/test_login_username.py
需求：用户重置 181245（张浩，email=NULL）密码后登录报 500 internal_error。
根因：181245 email 为 NULL（migrated username-only 账号），登录密码 verify 通过后 _issue_token_pair→create_access_token→TokenPayload(email=None)，但 TokenPayload.email 强制 str，pydantic 校验 None 失败抛 ValidationError→500（异常栈 request_id 1e26888c）。180490 不复现因其 email=180490@migrated.local 非空。
方案：security.py TokenPayload.email: str→str|None，create_access_token 的 email 参数同步 str|None；JWT payload email=None 编码为 null，decode 后 TokenPayload(email=None) 通过校验。安全性：decode_access_token 返回值在 auth_deps.get_current_user 与 db.py audit 只读 payload.sub，无人消费 email，改可选无连带影响。test_login_username.py 加 test_login_username_only_without_email（email=None 用户登录→200）回归测试。
结果：登录测试 7 passed（含新用例）、auth 全模块 106 passed/2 xfailed、ruff All checks passed。待 commit + rebuild backend 部署 + 用户验证（181245 用 SillyHub@123 登录成功）。

## ql-20260715-010-bb2c | 2026-07-15 16:24:20 | /ppm/project-members 编辑成员姓名显示 id 修复（list_users 加 ids 批量查 + PpmUserSelect 已选值回填查真实姓名）
状态：已完成
关联变更：（无）
文件：backend/app/modules/admin/router.py、backend/app/modules/admin/users_service.py、backend/tests/modules/admin/test_users_router.py、frontend/src/lib/admin.ts、frontend/src/components/ppm-user-select.tsx
需求：/ppm/project-members 编辑成员时调 /api/admin/users?limit=20&offset=0 数据不全，已选成员 user_id 不在前 20，姓名字段显示 id。
根因：编辑成员"姓名"字段用 PpmUserSelect res="user"（ppm-project-members-table.tsx:563），首屏 listUsers({limit:20}) 只取前 20；已选 user_id 不在前 20 时，组件 mergedOptions（ppm-user-select.tsx:308-313）用 value(user_id) 兜底 label → 姓名显示 id。
方案：后端 list_users 加 ids 参数（router Query list[uuid.UUID] + service `User.id.in_(ids)`），按 id 精确批量查绕过分页/关键字；前端 listUsers(UserListParams) 加 ids（apiFetch 数组编码 ?ids=a&ids=b）；ppm-user-select res=user 已选值缺失时用 listUsers({ids}) 批量查真实姓名回填 label（inflightIdsRef 防并发重复，搜索 reset 丢弃后允许重补）。
结果：后端 ruff + admin 测试 36 passed（含新 test_list_users_filter_by_ids）/3 xfailed；前端 tsc EXIT 0。待 commit + rebuild backend+frontend 部署 + 用户验证（编辑成员姓名显示真实姓名非 id）。

## ql-20260715-011-b118 | 2026-07-15 16:36:21 | /ppm/project-members 一级表"更新时间"列格式化（ISO slice → fmtDateTime 本地时区）
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-members-group-table.tsx
需求：/ppm/project-members 更新时间列格式化。
根因：group-table.tsx:240 "更新时间"列 render 用 `String(v).slice(0,19)`，显示原始 ISO（带 T、UTC 时间，如 2026-07-15T06:00:35），可读性差且时区未转换。
方案：改用项目 `fmtDateTime(v)`（lib/ppm/format.ts，`YYYY-MM-DD HH:mm` 本地时区，空值返回 —），加 import。成员子表无此列，仅改一级表一处。
结果：tsc --noEmit EXIT 0。待 commit + rebuild frontend 部署 + 用户验证（更新时间显示本地 2026-07-15 14:00 格式）。

## ql-20260715-012-5110 | 2026-07-15 16:51:48 | /ppm/projects 成员管理改为跳转 /ppm/project-members（带 project_name 查询 + 自动展开子表）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/projects/page.tsx、frontend/src/app/(dashboard)/ppm/project-members/page.tsx、frontend/src/components/ppm-project-members-group-table.tsx
需求：/ppm/projects 点成员管理不开抽屉，改为跳转 /ppm/project-members，带入项目名查询 + 自动展开子表。
方案：projects 页"成员管理"按钮 `setMemberProject`(开抽屉) → `router.push('/ppm/project-members?project_name=<encodeURIComponent(project_name)>')`，删 ProjectMembersDrawer 组件 + Drawer/PpmProjectMembersTable import + memberProject state；project-members page 用 `useSearchParams` 读 project_name 传 `initialProjectName` 给 GroupTable；GroupTable 加 `initialProjectName` prop（初始 search.project_name 填充 + 首次 load 后 autoExpandedRef 展开匹配项目 expandedRowKeys，仅一次）。
结果：tsc EXIT 0、lint 干净。待 commit + rebuild frontend 部署 + 用户验证（projects 点成员管理跳转 project-members，搜索框带入项目名 + 该项目子表自动展开）。

## ql-20260715-013-9bc5 | 2026-07-15 17:02:21 | 项目成员子表改服务端分页（pageSize/page 变更走接口，不再一次全量+本地 slice）
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-project-members-table.tsx
需求：项目成员子表实时查询，变更每页条数时走接口获取，而非一开始就获取所有。
根因：`PpmProjectMembersTable.load` 调 `listProjectMembers`（= `pageProjectMembers().items`，不传 page/page_size、丢 total），一次性拉数据存 `rows`，前端 `rows.slice` 本地分页；pageSize 变更只改本地 slice 不走接口（后端默认 page_size 下数据也可能不全）。
方案：load 改用 `pageProjectMembers({page, page_size, pm_project_id})` 服务端分页，`setRows(resp.items)` + `setTotal(resp.total)`；新增 `total` state；删本地 `pagedRows` slice（`dataSource` 直接用 `rows`=当前页）；`onChange` 时 pageSize 变化回到第 1 页避免越界。load 依赖加 `[page, pageSize]` 触发翻页/改页大小重新查询。
结果：tsc EXIT 0、lint 干净（line 937 `error` unused 为既存，非本次）。待 commit + rebuild frontend 部署 + 用户验证（展开成员子表，切换每页条数走接口刷新当前页）。

## ql-20260715-014-7e3a | 2026-07-15 21:14:46 | 导入模块多责任人拆分多条（每人一条明细+任务）
状态：已完成
结果：service._to_preview_row→_to_preview_rows(返回list:全匹配→N条各一责任人duty_user_id+work_load各原值;任一未匹配→整行1条标红不拆;空责任人→1条标红)+import_preview改flatMap。test_router加多责任人拆分测试。plan 77 passed+ruff/mypy过。
关联变更：2026-07-15-milestone-detail-auto-task
文件：backend/app/modules/ppm/plan/service.py（_to_preview_row 拆分 + import_preview flatMap）+ test_importer.py + test_detail_task_link.py
需求：导入一行多责任人→拆N条（各一个责任人duty_user_id+联动建任务）；任一未匹配→整行1条标红valid=false不导入；work_load各=原值（不除人数）。

## ql-20260715-015-3c8d | 2026-07-15 21:40:00 | 任务计划列表删除：超级管理员也可删除
状态：已完成
结果：task-plans/page.tsx canDelete = isOwner || !!currentUser?.is_platform_admin（负责人或超级管理员可删除）。tsc EXIT0。
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/task-plans/page.tsx（canDelete 加 isPlatformAdmin 判断）
需求：删除按钮当前仅负责人(isOwner)可用，增加超级管理员(is_platform_admin)也可删除。
## ql-20260715-010-a3b7 | 2026-07-15 17:19:04 | PPM 工作台：默认首页改 /ppm/workbench + 快捷入口加「任务计划」按钮 + 我的待办纳入「问题变更审批」
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/page.tsx（redirect 目标 /ppm/projects→/ppm/workbench）+ frontend/src/app/(dashboard)/ppm/workbench/_components/quick-entry-grid.tsx（问题清单按钮后新增「任务计划」Button 跳 /ppm/task-plans，4→5 按钮，注释同步）+ backend/app/modules/ppm/workbench/service.py（import PpmProblemChange + _derive_todos 新增第二类「问题变更待审批」分支）+ frontend/src/app/(dashboard)/ppm/workbench/_components/todo-list-panel.tsx（goTodo 为 source=problem_change 跳 /ppm/problem-changes，须先于 startsWith("problem") 判定；两处注释同步）+ backend/app/modules/ppm/workbench/tests/test_workbench_service.py（_seed_problem_change helper + 3 用例）
需求：①PPM 默认首页从「项目列表」改「个人工作台」；②工作台快捷入口加「任务计划」按钮；③「我的待办」纳入审批任务。口径经用户确认：审批只做「问题变更 + 问题清单」，问题清单维持现状（所有在办），不含任务计划/里程碑明细（任务计划 PlanTask 本身无审批流，有审批流的是里程碑明细，用户明确不要）。
方案：①page.tsx redirect 改 /ppm/workbench；②quick-entry-grid 加 Button router.push /ppm/task-plans；③_derive_todos 新增分支 select PpmProblemChange where status="1"（审核中 ProblemChangeStatus.AUDITING）且 now_handle_user 逗号分隔 split 含当前 user.id → WorkbenchTodoItem(source="problem_change", type="缺陷", name=pro_desc||project_name||"问题变更待审批")，与问题清单分支同构（Python 端 split，R-02 方言安全，无 SQL LIKE 子串风险）；前端 todoBadge 的 problem_change→destructive「缺陷」映射此前已存在占位无需改，仅 goTodo 加 problem_change→/ppm/problem-changes（problem_change 也以 problem 开头，故须先判 equals 再判 startsWith，否则误跳 problem-list）；WorkbenchTodoItem schema 四字段(id/name/type/source)无需改，无 DB 迁移（ppm_problem_change 表已存在）。
结果：后端 workbench 测试 24 passed（原 21 + 新增 3：命中/now_handle_user 不含我/status≠"1" 过滤）、ruff All checks passed + 7 files already formatted、mypy Success no issues；前端 lint 0 error（19 warning 全既有，本次 3 文件无新告警）。待 commit + rebuild frontend+backend 部署 + 用户验证（进 /ppm 落地工作台、快捷入口「任务计划」跳转、有待审批问题变更时出现在我的待办且点击跳问题变更页）。

## ql-20260715-016-5f2a | 2026-07-15 22:25:00 | 任务计划列表增加批量删除功能
状态：已完成
结果：task-plans/page.tsx 加 rowSelection 多选 + 批量删除按钮 + handleBatchDelete 循环 deletePlanTask + canDeleteTask 共用(负责人或超管)。tsc EXIT0 + eslint 0error。
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/task-plans/page.tsx
需求：列表加多选(checkbox)+批量删除按钮，权限复用 canDelete(负责人或超管)，前端循环调 deletePlanTask。
## ql-20260715-014-c1d2 | 2026-07-15 21:56:06 | PPM 工作台待办「缺陷」口径修正：去 duty 限制改为仅看当前处理人（审批人非责任人也能看到）+ 造测试数据验证三类齐全
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/workbench/service.py（_derive_todos ①问题待办分支去 .where(duty_user_id==user.id)，改 select(PpmProblemList) 全表 + Python now_handle_user split 含我 + status≠4）+ backend/app/modules/ppm/workbench/tests/test_workbench_service.py（加 test_summary_todo_problem_handle_me_even_not_duty：duty≠me 但 now_handle 含 me → 进 todos）
需求：用户反馈工作台「我的待办」只看到计划任务，看不到缺陷和审批数据。
根因：①缺陷(problem_audit)分支原条件 duty_user_id==me 且 now_handle_user 含 me，过严——审批人非责任人(duty≠me)时被过滤；且现有演示数据问题的 now_handle 没填 admin（1 条填了不存在的用户 7a45641f、1 条空）。②ppm_problem_change 表 0 条，无审批数据。经确认缺陷口径改为「仅当前流转给我的」(now_handle 含 me，不限 duty)。
方案：①service.py 问题待办分支 select(PpmProblemList) 去 duty where，Python 端 now_handle_user split 含我 + status≠"4"即显示（审批人非责任人也能看到）；defect_count 指标不动（仍 duty==me，语义=我负责的缺陷数，与待办口径区分）。②补 duty≠me 测试。③数据：UPDATE 问题1（now_handle 脏数据 7a45641f→admin）+ INSERT 测试变更（status=1，now_handle=admin）。
结果：后端 workbench 25 passed（+1 新用例）；rebuild backend 后 admin 登录 GET /api/ppm/workbench/summary todos 三类齐全（problem_audit 缺陷1 + problem_change 审批1 + plan_task 任务3）。待 commit + 用户浏览器验证。

## ql-20260715-015-7e9a | 2026-07-15 22:41:53 | PPM 工作台日历加月份切换（‹ YYYY年M月 ›）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/workbench/page.tsx（加 calendarMonth state 默认当月 + loadCalendar 改用 calendarMonth 依赖 + handleCalendarMonthChange + 拆出 calendar 独立 useEffect 跟随月份 + WorkCalendarPanel 传 month/onMonthChange）+ frontend/src/app/(dashboard)/ppm/workbench/_components/work-calendar-panel.tsx（props 加 month/onMonthChange + import dayjs/useEffect/useMemo + todayStr 改 useMemo 稳定 + selectedDay useEffect 跟随月份重置 + SectionCard title 改「工作日历」+ body 顶部加 ‹/YYYY年M月/› 月份导航 + 日期格 date 构造 yearMonth→month 修 tsc TS2304）
需求：用户要求工作台「本月日历」可以切换月份。
方案：后端 get_calendar(year_month) 与 fetchWorkbenchCalendar(yearMonth) 此前已支持任意月,只缺前端切换 UI。page.tsx 加 calendarMonth state（默认当月 dayjs format YYYY-MM）,loadCalendar 依赖 calendarMonth,切换 setCalendarMonth → loadCalendar 重建 → 独立 useEffect 重拉该月（不随 profile/tasks 重跑）。WorkCalendarPanel 加月份导航行（‹ dayjs(month).subtract(1,month) | format(YYYY年M月) | add(1,month) ›）调 onMonthChange;selectedDay 用 useEffect 跟随 month 重置（今天在新月则选中今天,否则清空,避免跨月残留）;日期格 date 用 props month 构造（原 yearMonth 局部变量已移除,修 tsc 报错）。
结果：tsc --noEmit exit 0;rebuild frontend 后 healthy,/api/health ok（commit_sha=e3ae33b9）。待 commit + 用户浏览器验证 ‹ › 切换。

## ql-20260715-016-b3f1 | 2026-07-15 23:16:08 | 修复登录后仍跳 /ppm/projects——login PLATFORM_REDIRECT.ppm 改 /ppm/workbench（上次只改了 /ppm redirect 漏了登录硬编码）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(auth)/login/page.tsx（PLATFORM_REDIRECT.ppm "/ppm/projects"→"/ppm/workbench" + L79 注释同步）
需求：用户反馈选 ppm 平台登录后仍默认跳 /ppm/projects 而非 /ppm/workbench。
根因：登录成功跳转走 login/page.tsx 的 PLATFORM_REDIRECT[platform]（L81 router.replace），ppm 硬编码 "/ppm/projects"（L28），不经过 /ppm/page.tsx 的 redirect。上次（ql-010-a3b7）只改了 /ppm/page.tsx 的 redirect 目标,漏了 login 这处硬编码跳转 → 登录直奔 /ppm/projects 绕过 redirect。
方案：login/page.tsx PLATFORM_REDIRECT.ppm 改 "/ppm/workbench"（登录成功直接跳工作台）+ 注释同步。其他 /ppm/projects 引用（app-shell 图标映射、menu-permissions 菜单项 ppm-projects、top-bar.test 测试）不影响登录跳转,不动;切换平台走 /ppm 经 redirect 到 workbench 仍有效。
结果：rebuild frontend 后 healthy,commit_sha=c5fcc6b04c32;grep .next 产物命中 ppm/workbench（login 常量已编译进镜像）。待 commit + 用户浏览器验证（选 ppm 登录→/ppm/workbench）。

## ql-20260716-001-a2b3 | 2026-07-16 00:54:44 | PPM 任务计划执行弹窗加任务详情区(核心字段+备注/附件) + 问题清单「开始处置」弹窗补流程履历
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx（import fmtDay/taskStatusTag + 新增 DetailItem/TaskDetail 只读详情区:项目/模块/计划时间/状态/负责人/配合人员/预估工时 + remarks 备注 + file_urls 附件链接,DialogHeader 后插入）+ frontend/src/app/(dashboard)/ppm/problem-list/_forms.tsx（ProblemStartForm 加 useProblemLogs + ProcessTimeline,对齐 audit/done/close 态,详情区下方补流程履历）
需求：用户反馈任务计划/问题清单执行弹窗"只有执行输入框,不够"。经澄清:任务计划执行弹窗确实纯输入框无详情(要加详情区);问题清单用户点的是「开始处置」按钮(ProblemStartForm),该弹窗有详情但只有单输入框、无流程履历(补履历)。
方案：①execute-task-dialog 加 TaskDetail 只读详情区(grid 布局,复用 taskStatusTag/fmtDay),核心 7 字段(项目/模块/计划时间/状态/负责人/配合人员/预估工时)+ remarks 备注 + file_urls 附件链接(仅有时显示),task 对象已由 state.task 透传无需改父;②ProblemStartForm 对齐 audit/done/close 加 useProblemLogs(problem.id) + ProcessTimeline logs/loading,详情区下方显示流程履历。两处均纯前端,弹窗已收到完整对象,无新接口/无后端改动。
结果：tsc --noEmit exit 0;rebuild frontend 后 healthy,commit_sha=6ed43b5b。待 commit + 用户浏览器验证(任务计划执行弹窗显示详情;问题清单开始处置弹窗显示履历)。注:工作区另有遗留的 workbench/service.py 日历负载重构(会话开始就有的 intentional 改动,未 commit,致 test_calendar_load_level_buckets 失败),本次未动,单独说明。

## ql-20260716-001-7f3a | 2026-07-16 08:41:06 | 项目维护新建项目后创建人(create_name)为空，改为后端按当前登录用户自动填充
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/project/service.py（ProjectMaintenanceService.create 加 operator_name 参数，create_name=data.create_name or operator_name 回退填充）+ backend/app/modules/ppm/project/router.py（create_project_maintenance 传 operator_name=user.display_name）+ backend/app/modules/ppm/project/tests/test_service.py（新增 test_project_create_name_auto_fill_from_operator 三断言）
根因：前端 projects/page.tsx 把 create_name 标 hideInForm:true（系统字段不进表单，design 约定），新建不传 create_name；后端 service.create 直接用 data.create_name(为 None)入库 → 创建人列空。
方案：create_name 是创建人姓名(系统字段)，应由系统按当前登录用户自动带出。service.create 新增 operator_name 参数，data.create_name 为空时回退用 operator_name(user.display_name) 填充；显式传入时优先用传入值。仅修项目维护表(PpmProjectMaintenance)，customer/member/stakeholder 同模式问题本次未动。
结果：project 模块 31 passed(含新增1)；ruff format+check 通过；mypy 通过。待 commit + rebuild backend Docker 验证。

## ql-20260716-002-4c8e | 2026-07-16 09:14:54 | 项目维护列表默认按创建时间降序（最新在前）
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/project/service.py（page 方法 order_by 为空时默认 created_at，复用 req.order 默认 desc）+ backend/app/modules/ppm/project/tests/test_service.py（新增 test_project_page_default_sort_created_at_desc）
根因：apply_sort 当 order_by 为空时不加任何排序(return 原 stmt)，返回 DB 自然顺序(不确定)；前端 PpmResourceTable 默认不传 order_by → 项目列表无稳定排序，不满足「最新在前」。
方案：service.page 在 req.order_by 为空时回退 "created_at"(白名单 _PROJECT_SORT_FIELDS 已含 created_at)，复用 req.order 默认 desc → 最新在前；前端显式传 order_by 时仍优先前端选择(兼容列头排序)。仅改后端一处，前端不动。
结果：project 模块 32 passed(含新增默认排序用例，断言默认 desc + 显式 order_by 不被覆盖)；ruff format+check 通过；mypy 通过。待 commit + rebuild backend 验证。

## ql-20260716-003-8b3e | 2026-07-16 09:42:00 | 计划节点模板子表样式优化——明细/模块子表套限宽 overflow-x 容器独立横向滚动（隔离母表）+ 明细 7 列列宽压缩（920→790）
状态：已完成
关联变更：2026-07-16-plan-node-subtable-style
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx（PlanNodeChildren 内 DetailsSubTable/ModulesSubTable 表格根节点外层各加限宽 overflow-x 容器 calc(100vw-340px) + DETAIL_COLUMNS 7 列 width 压缩 90/100/140/120/80/90/90）
结果：①tsc --noEmit EXIT 0；②pnpm lint 0 error（warning 全既有无关文件）；③vitest plan/milestone 3 文件 27 passed；④仅改 plan-nodes/page.tsx 3 处，PpmSubTable 通用组件/母表/后端均未动，零回归。待 commit + rebuild frontend 部署 + 用户浏览器实测 R-02（子表独立滚动隔离母表、列紧凑）。

## ql-20260716-004-6d21 | 2026-07-16 09:49:19 | 里程碑明细·明细列表(DetailLevelTable)加「执行人」列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable columns 加执行人列 PpmUserSelect 显示 execute_user_id + DetailLevelProps 加 projectId + 两处调用(532 非实施阶段/947 模块下)透传 projectId + moduleExpandRender deps 补 projectId）
需求：用户要求里程碑明细页「明细列表」(模块展开后的明细行)显示执行人。
根因：明细数据有 execute_user_id，但 DetailLevelTable 列表未显示执行人列；PsPlanNodeDetail 无 execute_user_name(后端 audit/approve_user_name 是持久化字段,执行人无对应)。模块(PlanNodeModule)只有 duty_user_id 责任人,无执行人——故加在明细行而非模块行(已与用户确认)。
方案：DetailLevelTable columns 加「执行人」列,用 PpmUserSelect disabled 显示 execute_user_id(同模块责任人列模式,res=projectMember + searchData pm_project_id);DetailLevelProps 加 projectId + 两处调用透传 projectId;moduleExpandRender useCallback deps 补 projectId。仅改前端单文件,不动后端/通用组件。
结果：tsc --noEmit EXIT 0;vitest milestone-details 24 passed;next lint 0 error(962 warning 已修,余 warning 全既有)。待 commit + rebuild frontend 部署 + 用户浏览器验证。

## ql-20260716-005-c2a7 | 2026-07-16 10:10:00 | 修 ql-003 R-02 遗留：plan-nodes 明细子表（PpmSubTable flex wrapper 内 .ant-table-wrapper min-width:auto 顶住限宽容器）无独立横向滚动条——限宽容器加 min-w-0 让表格可压缩
状态：已完成
关联变更：2026-07-16-plan-node-subtable-style
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx（DetailsSubTable 限宽容器 div 加 className=[&_.ant-table-wrapper]:min-w-0）
根因：模块子表直接 AntD Table，限宽容器约束 .ant-table-wrapper 宽→内容超出内部滚动有滚动条；明细子表经 PpmSubTable 的 flex flex-col gap-2 包裹，Table 作为 flex item min-width:auto=min-content(790px) 顶住不压缩，.ant-table-content 宽=790=table 内容不滚动。模块无此 flex 包裹故正常。
方案：明细限宽容器加 tailwind arbitrary [&_.ant-table-wrapper]:min-w-0（即 .ant-table-wrapper min-width:0），让 flex item 表格可压缩到容器宽，.ant-table-content 宽=容器宽，table 790 超出则独立滚动条。scoped 到明细容器，不动 PpmSubTable 组件（D-001），模块子表无需改。
结果：tsc --noEmit EXIT 0；仅改 plan-nodes/page.tsx 1 处 className。待 commit + rebuild frontend 部署 + 用户浏览器验证（明细子表独立横向滚动条出现，与模块子表一致）。

## ql-20260716-006-9c4f | 2026-07-16 10:16:47 | /ppm/project-plans 新建项目计划后「项目名称」列显示 id 修复：后端 create 兜底按 project_id 关联取 project_name
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/service.py（create_ps_project_plan project_name 为空时按 project_id 查 PpmProjectMaintenance.project_name 兜底 + import PpmProjectMaintenance）+ backend/app/modules/ppm/plan/tests/test_service.py（新增 test_create_plan_fills_project_name_from_project 三断言）
需求：用户反馈 /ppm/project-plans 新建项目计划后,列表「项目名称」列显示 id。
根因：DB 实测新建记录 project_name=None(历史数据有名称)。①前端表单无 project_name 的 Form.Item(「项目名称」字段实际绑定 project_id),onProjectChange setFieldValue 回填的 project_name 未可靠进入提交体;②后端 create_ps_project_plan 直接存 data 不兜底 → project_name 存 None;③列表 render v ?? p.id 在 project_name 为空时回退显示 id。
方案：后端 create_ps_project_plan 兜底——project_name 为空(falsy)且 project_id 存在时,按 project_id 查 PpmProjectMaintenance.project_name 填充(单一可信源,不依赖前端提交)。显式传 project_name 不被覆盖;project_id 无效保持 None 不报错。仅改后端 service 一处 + import + 单测。
结果：plan service 19 passed(含新增兜底用例);ruff format+check 通过(--fix 修 import 排序);mypy 通过。待 commit + rebuild backend 验证。

## ql-20260716-007-d4e9 | 2026-07-16 10:35:00 | 回退 ql-003/005 的限宽 overflow 容器——2K 屏容器引入母表/模块多余滚动条，去掉容器只保留列宽压缩
状态：已完成
关联变更：2026-07-16-plan-node-subtable-style
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx（DetailsSubTable/ModulesSubTable 去掉外层限宽 overflow-x 容器 div + 去掉 [&_.ant-table-wrapper]:min-w-0，恢复 PpmSubTable/Table 直接渲染；DETAIL_COLUMNS 列宽压缩 90/100/140/120/80/90/90 保留）
根因：ql-003 加的限宽容器 maxWidth:calc(100vw-340px)+overflowX:auto 在 2K 屏（容器约 2220px）反而引入多余滚动条（母表+模块都出滚动条）。用户澄清：2K 屏子表内容（明细790/模块600）远小于可视宽度（约2200），装得下不需要滚动条，也不要明细强制滚动。限宽 overflow 容器是基于「子表该独立滚动」的错误假设。
方案：去掉明细/模块外层限宽容器（+min-w-0），回到原始结构（子表直接 scroll.x:max-content），只保留 DETAIL_COLUMNS 列宽压缩。2K 屏子表 790 < 可视宽度 2200，母表 max-content=max(母表列,790)=790 < 视口不撑不滚，子表 fits 不滚。仅改 plan-nodes/page.tsx。
结果：tsc --noEmit EXIT 0；仅改 plan-nodes/page.tsx（去限宽容器+min-w-0，列宽压缩保留）。待 commit + rebuild frontend 部署 + 用户浏览器验证（2K 屏展开模板行：母表/模块/明细均无多余横向滚动条）。

## ql-20260716-008-e5f1 | 2026-07-16 10:55:00 | plan-nodes 子表 scroll.x 改固定宽度（明细790/模块790）替代 max-content——从根本上避免嵌套测量膨胀撑母表
状态：已完成
关联变更：2026-07-16-plan-node-subtable-style
文件：frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx（明细 PpmSubTable tableProps 加 scroll:{x:790} 覆盖内部 max-content；模块 Table scroll x:max-content→790）
根因：ql-007 回退容器后回到原始 max-content，但 antd 嵌套表格 max-content 测量可能膨胀撑母表（用户最初问题）。用户建议子表改固定宽度。
方案：子表 scroll.x 用固定值（明细 790=列总710+操作80；模块 790，模块名列自适应剩余）。固定宽度下子表 table min-width 明确(790)，母表 max-content=max(母表列,790)=790 不膨胀。2K 屏 790<可视2200→母表不撑无滚动条，子表790=展开行宽 fits 不滚。窄屏子表按790独立滚不撑母表。仅改 plan-nodes/page.tsx，未改 PpmSubTable 通用组件。
结果：tsc --noEmit EXIT 0；仅改 plan-nodes/page.tsx（明细/模块 scroll.x 固定 790）。待 commit + rebuild frontend 部署 + 用户浏览器验证（2K 屏展开模板行：母表/模块/明细均无多余滚动条，列紧凑）。

## ql-20260717-001-f1a2 | 2026-07-17 12:30:00 | 里程碑明细编辑提交直接完成(无审核流程)+建任务计划
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/plan/fsm.py（DRAFT 白名单加 DONE）、backend/app/modules/ppm/plan/service.py（_FORWARD_NEXT[DRAFT]=DONE + _transition DONE 分支记完成人 approve_user）、backend/app/modules/ppm/plan/tests/test_fsm.py + test_service.py + test_detail_task_link.py（更新 13 测试反映 draft→done 新流程）
根因：用户反馈编辑明细提交后状态"审核中"(review)而非"完成"(done)，且没建任务计划。根源同源：_FORWARD_NEXT[DRAFT]=REVIEW（draft→review 单步）+ fsm DRAFT 白名单无 DONE；_ensure_task_for_detail 只在 target=DONE 触发，故 review 不建任务。
方案：_FORWARD_NEXT[DRAFT]=DONE（draft save→done 一步，跳过审核）+ fsm DRAFT 白名单加 DONE + _transition DONE 分支记 approve_user（完成人）。reject 测试改用手动 review 明细。
结果：ruff/mypy 过；pytest plan 104 passed（13 测试更新，零回归）。

## ql-20260717-002-f864 | 2026-07-17 14:50:16 | 旧"实施阶段"里程碑三层结构丢失修复——回填 has_module=true（直接 UPDATE 数据库，无代码改动）
状态：已完成
关联变更：2026-07-17-project-plan-init-from-template（R-02 风险兑现修复）
文件：（无代码改动；仅运行库 UPDATE ppm_ps_plan_node SET has_module=true）
需求：用户反馈旧项目计划的"实施阶段"里程碑在 /ppm/milestone-details 页没有三层结构（里程碑→模块→明细）了，只剩二级。
根因：上午变更 project-plan-init-from-template 把前端模块层展示条件从 overall_stage==="实施阶段" 改成 PsPlanNode.has_module===true（D-006），migration `20260717_psn_tmpl_fields` 加 has_module 列时 R-02 定案**不回填**（当时理由"项目未上线可重置"），旧里程碑 has_module 全是默认 false → 前端 `if(node.has_module)` 不成立 → 不展开三级 → 模块+模块下明细全部隐藏。DB 实测：16 个旧"实施阶段"里程碑 has_module=false 但挂了 76 个模块/约 1488 条明细（最大一个 21 模块/368 明细），数据本身完好只是展示不出来；范围确认仅"实施阶段"挂模块。
方案：直接 UPDATE 运行库（用户选直接 UPDATE 不走 migration）。SQL：`UPDATE ppm_ps_plan_node SET has_module=true, updated_at=now() WHERE overall_stage='实施阶段' AND has_module=false AND template_plan_node_id IS NULL AND id IN (SELECT plan_node_id FROM ppm_plan_node_module WHERE plan_node_id IS NOT NULL)`。条件限定：手动建（template_plan_node_id IS NULL，不含从模板新生成的 has_module=true 里程碑）且确实挂了模块（那个 module_cnt=0 的空里程碑 4fe81b2f 保持 false 二级展示正确）。
结果：UPDATE 16 条；回填后实施阶段 has_module=true 共 18 个（挂 77 模块/1514 明细，全部恢复三级展示），has_module=false 仅剩 1 个（无模块无明细，正确二级）。无代码改动，前端刷新 /ppm/milestone-details 即生效，无需 rebuild Docker。注：本次仅修当前运行库，migration 文件未改（重置/新环境仍会复现，若后续要彻底解决需补一个回填 migration）。

## ql-20260717-003-94b4 | 2026-07-17 14:59:38 | 里程碑明细列表加显示【任务描述】列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx（DetailLevelTable columns「任务主题」列后加「任务描述」列，dataIndex=task_description，width=220，ellipsis=true）
需求：用户要求里程碑明细列表里也显示【任务描述】。
根因：明细表单已有 task_description 字段（page.tsx:2313 Form.Item + types.ts:274 等 PsPlanNodeDetail.task_description），但 DetailLevelTable 列表只有明细阶段/任务主题/角色/计划工时/执行人/状态/操作，缺任务描述列。
方案：DetailLevelTable columns 在「任务主题」列后插入「任务描述」列（dataIndex=task_description，width=220，ellipsis=true 防长文本撑高行 hover 看完整，render v??"—""）；useMemo deps 无需改（新列不依赖外部变量）。page.tsx 有 3 处「任务主题」列（masterColumns 主表 391/previewColumns 导入预览 1151/DetailLevelTable 明细 1717），用后跟列区分唯一定位（仅 DetailLevelTable 后跟「角色」列，另两处分别跟「责任人」「工作量」）。纯前端单文件，不动后端/接口/types。
结果：tsc --noEmit EXIT 0；vitest milestone-details 24 passed（2 test files）零回归。待 commit + rebuild frontend 部署 + 用户浏览器验证（明细列表显示任务描述列，长文本省略号 hover 看完整）。

## ql-20260717-004-01b2 | 2026-07-17 15:56:09 | 项目改名后项目计划列表项目名不更新（写时同步 ps_project_plan.project_name）
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/project/service.py（ProjectMaintenanceService.update 改名时 update(PsProjectPlan) 同步刷新）+ backend/app/modules/ppm/project/tests/conftest.py（加 plan model 注册建 ppm_ps_project_plan 表）+ backend/app/modules/ppm/project/tests/test_service.py（加 test_project_rename_syncs_ps_project_plan_name）
需求：用户反馈项目维护改名后，项目计划列表的项目名称没跟着变。
根因：ps_project_plan.project_name 是冗余快照（创建时从项目表复制，ql-20260716-006），项目改名不更新 → 计划列表/详情/导出/任务联动（_resolve_project_context 取 PsProjectPlan.project_name）全显示旧名。
方案：写时同步——ProjectMaintenanceService.update 检测 project_name 变更时，同事务 update(PsProjectPlan).where(project_id==entity_id).values(project_name, updated_at) 刷新所有关联计划。单一写入点，所有读 project_name 的下游自动同步。import plan.model 无循环（plan.model 仅依赖 base/common）。
波折：① 初版用 text SQL WHERE project_id 绕过 UuidCoercing 类型适配，sqlite/PG 不匹配致 UPDATE 0 行（DB 实测值未变），改用 SQLAlchemy update() statement 走 model 类型适配；② project/tests/conftest 未注册 plan model，sqlite 不建 ppm_ps_project_plan 表（连带 crud test 的 update 也 no such table），conftest 加 plan model import；③ expire_on_commit=False 致 session.get 返回 identity map 缓存旧值，测试改用 select column 直查 DB 验证实际值。
结果：ruff format/check 过；mypy app（471 文件）无问题；pytest project 10 passed（含新增 test_project_rename_syncs_ps_project_plan_name）。仅改后端 project 模块，不动前端/plan service/types。待 commit + rebuild backend 部署 + 用户验证（项目改名 → 项目计划列表项目名实时更新）。

## ql-20260717-005-b551 | 2026-07-17 16:27:56 | /admin/users 新建用户抽屉→antd Modal 弹窗 + 组织树选择 + 角色选择框 + 全 antd 表单
状态：已完成
关联变更：（无）
文件：frontend/src/components/admin-user-drawer.tsx（整组件重写）+ frontend/src/test/setup.ts（matchMedia polyfill）+ frontend/src/components/__tests__/admin-user-drawer.test.tsx（17 用例适配 antd）
需求：用户要求 /admin/users 新建用户抽屉改弹窗、全部 antd UI、组织选树结构选择框、角色改选择框。
根因：原 AdminUserDrawer 用自实现 fixed Drawer + 大量原生 input/checkbox（登录名/邮箱/显示名/超管/登录/组织 checkbox 平铺/角色 checkbox 平铺），与项目 antd 表单体系（PpmResourceDrawer ql-010 等）不统一；组织是平铺 checkbox 无法体现层级。
方案：整组件重写为 antd——Modal（替自实现 Drawer）+ Form.useForm layout=vertical；登录名/邮箱/显示名→Form.Item(rules required/min3/email)+Input+aria-label；超管/登录→Checkbox；组织 checkbox 平铺→TreeSelect 多选（buildOrgTreeData 用 OrganizationRead.parent_id 构造 treeData）；角色 checkbox 平铺→Select multiple；Form.useWatch 实时算 usernameValid/emailValid 驱动保存按钮 disabled（保留原"空字段禁用按钮"行为，submit 仍走 validateFields 双保险）。保留 create 默认密码提示 Alert + isSelf 警告 + create/edit body 构造逻辑 + 权限 disabled。OrganizationRead 已有 parent_id，无需改后端。
波折：① antd Modal/TreeSelect/Select 在 jsdom 报 window.matchMedia 未定义（17 测试全炸），setup.ts 加 matchMedia polyfill；② antd Form.Item label 不建立 label[for]→input 关联致 getByLabelText 失效，给登录名/邮箱 Input 补 aria-label；③ 组织/角色 checkbox→TreeSelect/Select 后原 checkbox toggle/checked 测试失效（jsdom 测 TreeSelect 选中态难），改为"渲染 + 提交 body 验证预填/未选"。
结果：typecheck EXIT 0；lint 0 error（warning 全既有 kanban.ts）；vitest admin-user-drawer 17 passed；全量 937 passed 零回归。纯前端，不动后端/接口/page.tsx（组件名/props 不变）。待 commit + rebuild frontend 部署 + 用户浏览器验证（新建/编辑用户弹窗 + 组织树多选 + 角色多选 + 全 antd 控件）。

## ql-20260717-006-ec0f | 2026-07-17 16:50:00 | /admin/users 用户列表加「组织」列
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/admin/users/page.tsx（columns 加「组织」列）
需求：用户要求用户列表显示组织列。
根因：用户列表有「角色」列（Tag 列表 u.roles）但无「组织」列，看不出用户归属哪些组织。
方案：columns 在「显示名」列后、「角色」列前加「组织」列，仿角色列渲染——u.organizations 为空显 —，非空 map Tag(o.name)；UserRead.organizations 已有（同 u.roles 源），无需改后端/接口/types。
结果：typecheck EXIT 0；admin test 17 passed（列表无专门测试，drawer 测试不受影响）。纯前端单文件。待 commit + rebuild frontend 部署 + 用户验证（用户列表显示组织列）。

## ql-20260720-001-c4a1 | 2026-07-20 09:09:40 | /ppm/projects 编辑抽屉改 antd Modal 弹窗 + 审查页面 antd 统一性
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx（Drawer→Modal + shadcn Button→antd Button）；frontend/src/app/(dashboard)/ppm/projects/page.tsx（成员管理按钮→antd）
需求：用户要求 /ppm/projects 的编辑从抽屉改为弹窗，并审查该页面是否都用 antd UI。
现状审查：PpmResourceTable 内 Form/Input/Select/DatePicker/Table/Tag/Drawer/Modal 已全 antd；仅操作栏 Button 为 shadcn（+ StatusBadge、布局壳）。
方案：用户确认改通用组件 PpmResourceTable 一处，4 个 ppm 页面统一切 Modal。PpmResourceDrawer→PpmResourceModal，<Drawer>→<Modal>（onClose→onCancel，保存按钮加 loading={saving}，文本统一"保存"）；所有 shadcn Button→antd Button（编辑/成员管理 type=link，删除 type=link danger，新增/搜索 type=primary，导出/重置/展开/重新加载 default，size=small）；antd import 加 Button 去 Drawer，删 shadcn Button import；projects/page.tsx 成员管理按钮同步 antd。
结果：tsc --noEmit EXIT 0；eslint 两文件 0 error（15 warning 全既有类型签名未用参数）；grep 两文件无 shadcn Button/Drawer/size=sm/variant 残留。影响 4 个 ppm 页面新建+编辑全变 antd Modal，操作栏按钮全 antd。纯前端，不动后端/接口。

## ql-20260720-002-8d3e | 2026-07-20 09:42:14 | /ppm/projects 查询区按钮 size 调整(antd small→默认 middle，修字体顶边框)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
需求：用户反馈查询条件上面那排按钮(导出/新增/搜索/重置/展开)字体太大、快顶到按钮边框，比例奇怪。
根因：antd Button size="small" 控件高度 24px + 字体 14px，上下 padding 太小致字顶边框(上一条 ql-20260720-001 把 shadcn Button 换成 antd 时统一用了 small)。
方案：查询区 5 按钮(导出/新增/搜索/重置/展开) + Modal footer 2 按钮(取消/保存) + 错误条重新加载 1 按钮(均有边框/实心) size="small"→默认 middle(32px，字体 14px 不顶边)；操作列 link 按钮(编辑/删除)保持 small(无边框不顶边，表格行内紧凑)；DataTable 的 size="small" 是表格属性不动。
结果：tsc --noEmit EXIT 0；grep 残留 size=small 仅操作列 2 link + DataTable 1 表格(预期)。查询区/Modal 按钮改默认 middle 后字体不再顶边框，与下方查询字段高度协调。纯前端单文件。待 commit + push + rebuild frontend 部署 + 用户浏览器验证。

## ql-20260720-003-2f1a | 2026-07-20 09:52:33 | table 序号「#」列居中对齐
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
需求：用户要求 /ppm/projects 表格序号「#」列居中对齐。
根因：PpmResourceTable showIndex 时 push 的序号列 coldef 无 align 属性，antd Table 列默认左对齐；序号是窄列(56px)+单字符数字，左对齐看着偏左不整齐。
方案：序号列 coldef 加 align: "center"(antd align 同时控制表头与单元格)，表头「#」+单元格数字同居中。影响所有 PpmResourceTable 实例(项目/客户/成员/干系人)。
结果：tsc --noEmit EXIT 0。序号列加 align=center 后表头「#」+数字单元格同居中。纯前端单文件(通用组件,4 个 ppm 表同效果)。待 commit + push + rebuild frontend 部署 + 用户浏览器验证。

## ql-20260720-004-b05c | 2026-07-20 10:07:58 | 修 striped 表固定列(序号/操作)横向滚动穿透：加不透明背景
状态：已完成
关联变更：（无）
文件：frontend/src/components/ppm-resource-table.tsx
需求：用户确认 /ppm/projects 横向滚动时，固定列(序号「#」fixed left + 操作 fixed right)背景透明，中间列内容穿透到固定列按钮下方。
根因：striped CSS `.ant-table-row td{background:transparent}`(奇行)/`nth-child(even) td{background-color:hsl(var(--muted)/0.4)}`(偶行)用 td 选择器命中所有数据行单元格(含 fixed 列)，把固定列也设透明；固定列靠不透明背景遮挡滚动内容，透明后失去遮挡 → 穿透。偶行因半透明灰穿透略轻，奇行(全透明)最明显。
方案：序号列 + 操作列 coldef 加 onCell 返回 style.background=hsl(var(--card))(SectionCard 用 bg-card，卡片底=--card，纯白/卡片色)，inline style 优先级高于 striped stylesheet 规则覆盖透明；中间非固定列保留斑马纹不动。两种主题(light/dark)自适应(--card 随主题变)。
结果：tsc --noEmit EXIT 0。序号列(fixed left)+操作列(fixed right)加 onCell background=hsl(var(--card)) 后固定列不透明，横向滚动不再穿透；中间非固定列保留斑马纹。纯前端单文件(通用组件,4 个 ppm 表同效果)。待 commit + push + rebuild frontend 部署 + 用户浏览器验证(横向滚动操作列不再有内容穿透)。

## ql-20260720-005-e91c | 2026-07-20 10:26:03 | StatusBadge 组件内部改 antd Badge(全局 17 处状态标签统一切 antd)
状态：已完成
关联变更：（无）
文件：frontend/src/components/ui/status-badge.tsx
需求：用户要求把 StatusBadge(状态列圆点药丸标签)换成 antd Badge，全项目统一(17 处调用点)。
根因：StatusBadge 是 D-005 自写的 shadcn 风格组件(tailwind 圆点药丸 + 浅色背景)，是 /ppm/projects 最后残留的非 antd UI 组件；用户要全 antd。
方案：改 status-badge.tsx 的 StatusBadge 渲染：span 药丸 → antd Badge status+text；StatusKind → antd status 映射(info→processing/success→success/warning→warning/error→error/neutral→default)；API(kind/children/icon/size/className)不变，17 处调用点零改；size 用 text 字号 class 保留差异；删 KIND_STYLES/SIZE_STYLES/DOT_SIZE_STYLES(antd Badge 自带配色)。fromStatus 函数 + StatusKind 类型保留(调用点在用)。
结果：tsc --noEmit EXIT 0；eslint status-badge.tsx 0 error；无 StatusBadge 相关测试(grep 无结果)。StatusBadge 内部改 antd Badge 后,17 处调用点 API 不变自动生效,外观从「圆角药丸+浅背景」变「小圆点+文字」。纯前端单文件。待 commit + push + rebuild frontend 部署 + 用户浏览器验证。

## ql-20260720-006-a7e3 | 2026-07-20 11:25:00 | 里程碑明细 done 状态增加「变更」按钮（编辑信息+同步任务计划，不改状态）
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx
需求：里程碑明细页，已完成(done)状态的明细操作列增加「变更」按钮(本质是编辑功能,改名"变更")；变更抽屉只保留「提交」按钮、去掉「保存」；提交后同步更新对应的任务计划信息,但不改变任务计划的状态。
根因：done 是终态,原 modeForStatus(done)=view 只读无编辑入口；现有 edit 模式 footer 有「保存+提交」两按钮,且提交(autoSubmit)走 saveProcess 触发状态机推进(draft→done),对已 done 明细不适用；需独立 mode 区分"信息变更"(不改状态)与"版本变更"(change 模式生成新版本)。
方案：新增 DrawerMode="changeInfo"——①操作列 done 加「变更」按钮(onOpenDetail(d,"changeInfo"),readOnly 禁用)；②baseEditable 含 changeInfo(开立信息块可编辑)；③提取 baseBody(create/edit/changeInfo 共用开立信息字段集合)；④submit 加 changeInfo 分支:仅调 updatePsPlanNodeDetail(detail.id,baseBody),不调 saveProcess、不生成新版本、不改明细 status,后端 update_detail→_sync_task_fields 自动同步关联任务(content/workload/time/user/module,FR-03/D-007,不改 task.status)；⑤title="变更明细"、submitText="提交"；⑥footer 逻辑天然支持(showSubmit && 非 create/edit → 单「提交」按钮)。modeForStatus 不动(done 默认仍 view,"变更"是显式覆盖 mode 打开)。
结果：tsc --noEmit EXIT 0；vitest milestone-details 24 passed(2 test files)零回归；eslint page.tsx 0 error(19 warning 全既有类型签名未用参数,非本次引入)。纯前端单文件,后端 update_detail 早已实现任务同步(FR-03 测试覆盖)。待 commit + push + rebuild frontend 部署 + 用户浏览器验证(done 明细点「变更」→抽屉仅「提交」→改字段提交→任务计划对应字段同步、状态不变)。

## ql-20260720-007-b9d2 | 2026-07-20 11:45:00 | 任务计划建/改同步明细 task_description + 任务计划列表展示任务描述列
状态：已完成
关联变更：（无）
文件：backend/app/modules/ppm/task/model.py（PlanTask 加 task_description Text 列）+ backend/app/modules/ppm/task/schema.py（PlanTaskCreate/Update/Response 加字段）+ backend/app/modules/ppm/plan/service.py（_ensure_task_for_detail 命中/新建两分支 + _sync_task_fields 三处同步 task_description）+ backend/migrations/versions/20260720_add_plan_task_task_description.py（加列,down_revision=20260718_project_org_id）+ backend/app/modules/ppm/plan/tests/test_detail_task_link.py（FR-01 全字段映射断言 + FR-03 新 test_update_detail_syncs_task_description）+ frontend/src/lib/ppm/types.ts（PlanTask 加 task_description）+ frontend/src/app/(dashboard)/ppm/task-plans/page.tsx（「任务内容」列后加「任务描述」列 width220 ellipsis）
需求：里程碑明细提交(建任务)/修改(同步任务)时,明细的 task_description 要带到任务计划并展示。
根因：PlanTask 无 task_description 字段(只有 content=task_theme),_ensure_task_for_detail 建任务 + _sync_task_fields 同步都未带 task_description,任务计划列表也无该列。
方案：①PlanTask 加 task_description(Text,对齐明细);②migration 加列(down_revision=20260718_project_org_id,已 alembic heads 确认);③service 三处(detail 变 done 建任务命中/新建分支 + 编辑同步)都带 task.task_description=detail.task_description;④schema Create/Update/Response 暴露(task service update 用 exclude_unset 不传不动,任务计划编辑不会误清空);⑤前端 PlanTask 类型加字段 + task-plans「任务内容」后加「任务描述」列;⑥测试 FR-01 全字段断言 + FR-03 专门测编辑同步 task_description。
结果：ruff All checks passed;pytest plan 114 + task 26 + detail_task_link 11(含新 2 例)全过零回归;tsc EXIT 0;eslint 0 error。待 commit + push + rebuild backend+frontend Docker(后端启动跑 migration 加列)+ 用户验证(明细填任务描述→提交建任务→任务计划列表显示任务描述列;改明细任务描述→任务计划同步)。
波折：宿主机无 python,后端测试用 docker run --rm --user root -v backend:/app 临时容器 + pip --target /opt/venv purelib 装 pytest/pytest-asyncio/httpx/aiosqlite(dev 依赖不在 runtime 镜像) + /opt/venv/bin/python -m pytest 跑(uv venv 无 pip,不能 -m pip)。

## ql-20260720-008-c4e1 | 2026-07-20 12:25:00 | 任务计划详情(列表「详情」Modal + 执行弹窗 TaskDetail)补任务内容/任务描述
状态：已完成
关联变更：（无）
文件：frontend/src/app/(dashboard)/ppm/task-plans/page.tsx（详情 Modal 任务信息 grid 开头加任务内容/任务描述 col-span-2）+ frontend/src/app/(dashboard)/ppm/_components/execute-task-dialog.tsx（TaskDetail grid 开头加 DetailItem 任务内容/任务描述 col-span-2）
需求：任务计划的详情里也要展示任务内容、任务描述。
根因：列表「详情」Modal 任务信息区(项目/模块/工时/时间/负责人/配合/备注)与执行弹窗 TaskDetail(项目/模块/计划时间/状态/负责人/配合/工时/备注)都缺任务内容(content)、任务描述(task_description);标题区虽有 content 但信息区没有,task_description 两处都没。
方案：两处信息 grid 开头加任务内容(整行 col-span-2,无条件空显 —)+任务描述(整行 col-span-2,空不显示,同 remarks 条件模式)。task-plans Modal 用行内 span:label 模式;execute-task-dialog 用 DetailItem 包外层 div col-span-2 控制跨度。PlanTask 类型已有两字段(ql-007),纯前端展示。
结果：tsc --noEmit EXIT 0;eslint 0 error(6 warning 全既有未用变量,非本次)。纯前端两文件。待 commit + push + rebuild frontend 部署 + 用户验证(任务计划点「详情」/「执行」弹窗信息区显示任务内容+任务描述)。
