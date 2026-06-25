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


