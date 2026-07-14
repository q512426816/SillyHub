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
