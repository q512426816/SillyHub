---
author: qinyi
created_at: 2026-07-24T08:55:00
---

# 任务清单（Tasks）

> 仅列任务名与一句话职责，Wave 分组与依赖、详细步骤在 plan 阶段（`sillyspec run plan`）展开。

## 后端（backend / ppm）

- task-01: workbench schema 调整 —— `WorkbenchProfile+=can_view_others`、`WorkbenchSummary-=todos`、新增 `WorkbenchSwitchableUser` DTO。
- task-02: workbench service 权限与可见用户算法 —— `_resolve_target_user`（403/404 收口）、`_visible_user_ids`（部门经理→`{oid}|_descendant_ids` 子树；项目/开发/业务经理→项目成员；并集）、`_can_view_others`、`_load_user`。
- task-03: workbench service getter 改 target —— `get_profile/get_summary/get_calendar` 按 `target_user` 取数；profile 带 `can_view_others`（反映登录人）。
- task-04: workbench 待办分页 —— `_derive_todos(target,page,page_size)` 去除 top20、全量取+合并稳定排序+切片+total（含保护上限）。
- task-05: workbench router —— 4 端点加可选 `target_user_id`；新增 `GET /workbench/todos`、`GET /workbench/switchable-users`（`list_switchable_users` 批量 JOIN 装配）。
- task-06: personal-task-plan 加 target —— `/personal-task-plan/page` 加可选 `target_user_id`，仅走 `_resolve_target_user`（禁用 data_scope），`req.user_id=target.id`。
- task-07: 后端测试 —— 可见用户算法四口径 / 分页 / target 透传 / 越权 403 / super_admin 任意；更新现有 workbench 测试（summary 去 todos）。

## 前端 WEB（frontend / (dashboard)/ppm/workbench）

- task-08: lib 层 —— `workbench.ts` 各 fetch 加 `targetUserId`、新增 `fetchWorkbenchTodos`/`fetchWorkbenchSwitchableUsers`；`types.ts` 同步 DTO（去 todos、加 can_view_others、加 WorkbenchSwitchableUser）；`task.ts` `listPersonalPlanTasks` 加 `targetUserId`。
- task-09: page 状态 —— `targetUserId` 状态 + 透传所有 fetch + 查看他人提示条「正在查看 XX · 返回我自己」。
- task-10: ProfileSummaryCard 切换用户 —— `can_view_others` 时渲染下拉（switchable-users + 我自己）。
- task-11: TodoListPanel 分页 —— 改自带 fetch `/workbench/todos` + 分页器（默认 10 条/页、上一页/下一页、共 total 条）。
- task-12: WorkbenchTaskTable 透传 —— 接收 `targetUserId` 透传到 `listPersonalPlanTasks`。
- task-13: WEB 测试 —— todo 分页、切换用户交互单测。

## 前端 APP（frontend / app/m/ppm/workbench）

- task-14: APP page 状态 —— `targetUserId` + 透传 profile/指标/日历/待办。
- task-15: 新增「我的待办」卡片 —— 带分页（移动端上一页/下一页 + 页码）。
- task-16: ProfileCard 切换入口 —— 「切换查看其他成员」底部 sheet，切换后全工作台跟随。

## 验收与收尾

- task-17: 端到端核对 —— 切换用户后 profile/指标/日历/待办/任务表全部跟随；分页翻页正确；越权 403。
