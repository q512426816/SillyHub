---
author: qinyi
created_at: 2026-07-20 11:30:22
id: task-08
title: 新建 problem-detail-modal.tsx 统一弹窗
wave: 2
blockedBy: [task-11]
allowed_paths: [frontend/src/app/(dashboard)/ppm/_components/problem-detail-modal.tsx]
acceptance: [FR-10, FR-11]
---

## 目标
新建 `problem-detail-modal.tsx`，复刻 `task-detail-modal.tsx` 结构（detail/execute 双模式 + 跨天填报），信息卡用问题清单字段，API 用 `startProblem`/`executeProblem`（D-006 仿写独立，不 import task-detail-modal）。

## 实现步骤
1. 新建文件，props：`problem: ProblemList | null` / `mode: "detail"|"execute"` / `onClose` / `onChanged?`。
2. **信息卡**（对应 task-detail-modal:194-227）字段换成 problem：项目 `project_name` / 模块 `model_name` / 功能名称 `func_name` / 问题类型 `pro_type` / 紧急度 `is_urgent` / 责任人 `duty_user_name` / 发现人 `find_by` / 发现日期 `find_time` / 计划起止 `plan_start_time~plan_end_time` / 已消耗 `spent_time`（isOverEstimate 对比 `work_load`）/ 问题描述 `pro_desc`。
3. **处置记录表**（对应 :229-268）：`listTaskExecutes({ problem_task_id: problem.id, page:1, page_size:100 })` 拉记录；in-flight 识别 `status==="30"`。
4. **跨天填报区**（对应 :67-168）：`useEffect` 拉 executes → 找 in-flight → 按 `actual_start_time ~ today` 跨天拆分 `DetailDay[]`（最多 60 天）；`handleSubmit(action)` 循环：首条收口 in-flight + 后续天 `startProblem` 建新 in-flight + `executeProblem` 逐天收口，末天用 action，中间天强制 submit。
5. 两按钮「提交(回新建)」「完成」；`showForm = mode==="execute" && problem.status==="进行中" && !!inflightId`。
6. 样式遵循 CLAUDE.md 规则 17（archived prototype-frontend-style-system）+ 复用 `shared.tsx` 的 `taskStatusTag` / `fmtDay` / `inputCls` / `Toast` / `useToast`。

## 测试点
- detail 模式只显示信息卡 + 记录表，无填报区。
- execute 模式 + 进行中 + 有 in-flight → 显示跨天填报区；跨 N 天拆 N 行。
- 提交 → 调 startProblem/executeProblem；完成 → 调 executeProblem(action=complete)。

## 验收
- 组件渲染 detail/execute 双模式正确；跨天拆分逻辑与 task-detail-modal 一致；lint/typecheck 绿。
