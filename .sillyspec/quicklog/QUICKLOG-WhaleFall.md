---
author: WhaleFall
created_at: 2026-06-24T19:19:38
---

<!-- 本文件从空开始。ql-ID 续号规则：扫描同目录所有 QUICKLOG*.md 文件，
     取当天(YYYYMMDD)最大序号 +1。归档历史见 QUICKLOG-WhaleFall-<DATE>.md。 -->

## ql-20260624-011-b8f2 | 2026-06-24 19:34:11 | 项目计划新增/编辑选中项目后带出公司名+项目经理唯一时自动带入
状态：已完成
文件：frontend/src/components/ppm-project-plan-form.tsx
需求：项目计划[新增、编辑]时，选中项目后①带出公司名称；②如果该项目只有 1 个项目经理，自动带入项目经理。
现状:onProjectChange 试图回填 company_name,但依赖 listSimpleProjects 的 raw,而 simple-list 只返回 {id,project_name} 无 company_name → 公司名带出本就不工作;项目经理无论几个都清空。
方案:onProjectChange 改 async,选中项目后 Promise.all 并行查 getProject(id)(拿 company_name)+ listProjectMembers({pm_project_id,role_name:项目经理})(拿项目经理);company_name 回填,members.length===1 时带入 project_manager_id+name。
结果:① import 补 getProject + listProjectMembers;② onProjectChange 改 async,先同步重置 project_name/company_name/项目经理 清掉旧值,id 非空时 Promise.all 并行查项目详情(含 company_name)+ 项目经理,公司名回填、唯一项目经理自动带入 project_manager_id+name,查询失败静默不阻断选项目。raw 类型去掉无用 company_name。managers[0] 加 if(m) 判空适配 noUncheckedIndexedAccess。typecheck + 单文件 eslint exit 0 + 480 tests 全过无回归。后端无改动(ilike 过滤复用 ql-010)。Docker frontend 待重建部署。

## ql-20260625-001-7a3c | 2026-06-25 14:05:00 | 参考 ppm/project-plans 样式调整 admin/users 页面（布局+查询条件+列表）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：参考 http://127.0.0.1:3000/ppm/project-plans 的样式，调整 http://127.0.0.1:3000/admin/users 的【查询条件、列表、布局】。
现状:admin/users 用裸 div max-w-7xl + 裸 input/select/按钮 flex-wrap + 裸 antd Table，与 project-plans 的 PageContainer/PageHeader/SectionCard/grid-cols-4 Field/DataTable 模式不一致。
方案:①布局裸div→PageContainer(size full)+PageHeader(用户管理);②查询→SectionCard 包裹;③列表裸Table→DataTable(bordered+emptyText)。逻辑 load/handlers/columns/Drawer 不变。
结果:commit 8e86679b。第一版用 SectionCard+SearchBar+SearchBarActions(横向)+无列表高度,用户反馈"搜索条件布局/新建按钮位置/列表高度"三处不对 → 见 ql-20260625-002 修正。typecheck/lint/48 passed 全过,rebuild frontend healthy。

## ql-20260625-002-7a3c | 2026-06-25 14:20:00 | 修正 admin/users 对齐偏差（顶部按钮行 + Field 表单 + 列表高度）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：用户反馈 ql-001 三处偏差:①搜索条件布局和 project-plans 完全不一样;②新建用户按钮位置不对;③列表高度没设定。
现状:ql-001 用横向 SearchBar(控件左+按钮 SearchBarActions 右)、列表 scroll 无 y。
方案（精确复刻 project-plans 结构）:①查询区改 SectionCard 内顶部操作按钮行(搜索/重置/分隔/+新建用户,justify-end 右对齐)+ grid-cols-4 垂直 Field 表单;②控件原生 input/select → antd Input/Select,关键词保留 debounce + 搜索按钮/回车(onPressEnter);③新建按钮移到顶部按钮行右端;④列表 scroll.y=calc(100vh - 430px);⑤加文件内 Field 组件(垂直 label)+ handleSearchClick/handleResetClick;⑥去掉冗余顶部"共N"(分页 showTotal 已有)。
结果:commit ca9e99c6。typecheck no errors、lint 无 page.tsx 相关、rebuild frontend healthy。注:ql-001/ql-002 错误地走了 sillyspec run quick --change default 记到 default/tasks.md,实际应记 QUICKLOG-WhaleFall.md(本次补记,5e8516d5 后续补记 commit)。

## ql-20260625-003-9e2f | 2026-06-25 14:50:49 | admin/users 搜索改纯受控（输入不查询，点搜索/回车才查）
状态：已完成
文件：frontend/src/app/(dashboard)/admin/users/page.tsx
需求：①搜索按钮点击即查询，去多余逻辑；②关键词输入框输入不自动查询，手动点搜索/回车才触发。
现状:handleSearchInput 有 debounce 400ms 自动 setSearch；handleSearchClick/handleResetClick 带 debounceRef.current clearTimeout。
方案:handleSearchInput 只 setSearchInput(去 debounce)；handleSearchClick=setSearch(searchInput)+setPage(1)；handleResetClick 同步清空；去 debounceRef+useRef import(若不再用)。状态 Select onChange 即筛保留。
结果:①import 去 useRef；②删 debounceRef 声明；③handleSearchInput 只 setSearchInput；④handleSearchClick/ResetClick 去 clearTimeout。查询改为输入纯受控 + 搜索按钮/回车(onPressEnter)触发，状态 Select 即筛保留。typecheck no errors、lint 无 page.tsx 相关。


