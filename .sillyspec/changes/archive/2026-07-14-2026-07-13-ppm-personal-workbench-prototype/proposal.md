---
author: qinyi
created_at: 2026-07-14 09:13:35
change: 2026-07-13-ppm-personal-workbench-prototype
---

# 提案书（Proposal）

## 动机
PPM 模块当前只有 `projects / project-plans / milestone-details / problem-list / task-plans / task-execute / work-hours / kanban` 等业务录入页，登录后没有一个「看到自己今天干什么」的入口——`/ppm` 直接 redirect 到项目列表。用户要在多个页面间手动切换才能了解自己的任务、本月指标、缺陷、待办。需要一个聚合当前登录人数据的个人工作台，作为 PPM 的统一入口。

## 关键问题
1. **没有个人视角的聚合入口**：任务在 task-plans、问题在 problem-list、工时在 work-hours，用户无法一眼看到「我本月多少任务、完成多少、几个缺陷、什么待办」。
2. **缺少关键身份字段**：工作台要显示工号/部门，但 `users` 表无 `employee_no`、无部门字段；部门数据在 `organizations` + `user_organizations` 表存在但从未关联到任何展示面。
3. **无聚合统计能力**：本月任务量/完成率/延期率/缺陷数没有任何现成聚合接口——数据基础都在表里（`ppm_plan_task` / `ppm_problem_list`），但没有按当前登录人 + 时间范围聚合的查询逻辑。

## 变更范围
- **后端**：`users` 表加 `employee_no` 列（nullable）+ 新建 `ppm/workbench` 聚合子域（`profile` / `summary` / `calendar` 三个只读 GET 接口）
- **前端**：新增 `/ppm/workbench` 页面 + 7 个组件 + 菜单项
- **待办**：从现有流程在办表（`now_handle_user` = `str(user.id)`，已验证）+ 非终态 `ppm_plan_task` 派生，不建表

## 不在范围内（显式清单）
- 不做消息通知模块（系统无任何通知表，本次占位空状态，后续单独开变更）
- 不做绩效考评模块（系统无 performance 表，快捷入口占位）
- 不建 todo 待办表（派生自 process_task + 非终态 plan_task）
- 不给 PlanTask 加 `project_code` / `plan_type` 列（前端兜底，见 D-005）
- 不改 `/ppm` redirect 目标（保留 → /ppm/projects）
- 不引入 react-query（PPM 域统一 apiFetch+useEffect）
- 不引入日历第三方库（双圆点日历自研）

## 成功标准（可验证）
- `/ppm/workbench` 页面可访问，三栏布局正常渲染
- 个人信息卡显示姓名/工号/部门/角色（无数据时显示「—」）
- 本月指标 5 项（任务量/完成率/延期率/工时/缺陷数）数值与 `ppm_plan_task` / `ppm_problem_list` / `task_execute` 数据一致
- 待办列表来自当前人的未完成任务 + 待处理问题审批（`now_handle_user` 含当前 user.id）
- 工作日历每日双圆点正确反映任务负载与延期预警
- 消息通知 / 绩效考评显示空状态不报错
- `users` 加 `employee_no` 不影响现有登录/其他流程（老用户工号为空，nullable）
- backend 单测 + frontend 单测全绿，无回归
