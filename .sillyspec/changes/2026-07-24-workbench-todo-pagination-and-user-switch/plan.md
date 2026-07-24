---
author: qinyi
created_at: 2026-07-24T09:00:00
plan_level: full
---

# 实现计划（Plan）— 工作台待办分页 + 切换查看他人工作台

## Wave 1（后端基础，顺序：schema → service）
- [ ] task-01: workbench schema 调整（覆盖：FR-02, FR-04, D-003@v1, D-005@v1）
- [ ] task-02: workbench service 权限与可见用户算法 `_resolve_target_user`/`_visible_user_ids`/`_can_view_others`/`_load_user`（覆盖：FR-03, FR-04, D-002@v1）
- [ ] task-03: service getter 改 target + 待办分页 `get_profile/get_summary/get_calendar` 按 target、`_derive_todos` 分页、`get_todos`、`list_switchable_users`（覆盖：FR-01, FR-02, D-001@v1, D-003@v1, D-005@v1）

## Wave 2（后端 router + personal-task-plan，依赖 Wave 1）
- [ ] task-04: workbench router —— 3 端点（profile/summary/calendar）加 `target_user_id`、新建 `GET /workbench/todos`（带 target）+ `GET /workbench/switchable-users`（覆盖：FR-01, FR-02）
- [ ] task-05: `/personal-task-plan/page` 加 `target_user_id`，仅走 `_resolve_target_user`、禁用 data_scope（覆盖：FR-02, FR-04, D-004@v1）
- [ ] task-06: 后端测试 —— 可见用户四口径 / 待办分页 / target 透传 / 越权 403 / super_admin 任意；更新现有 workbench 测试（Summary 去 todos）（覆盖：FR-01, FR-03, FR-04）

## Wave 3（前端 lib + WEB，依赖 Wave 1 schema/types；可与 Wave 2 并行）
- [ ] task-07: 前端 lib 层 —— `workbench.ts` 各 fetch 加 `targetUserId` + 新增 `fetchWorkbenchTodos`/`fetchWorkbenchSwitchableUsers`；`types.ts` 同步 DTO；`task.ts` `listPersonalPlanTasks` 加 `targetUserId`（覆盖：FR-01, FR-02）
- [ ] task-08: WEB page 状态 —— `targetUserId` 透传所有 fetch + 查看他人提示条（覆盖：FR-02）
- [ ] task-09: `ProfileSummaryCard` 切换用户下拉（仅 `can_view_others`）（覆盖：FR-02, D-005@v1）
- [ ] task-10: `TodoListPanel` 自带 fetch + 分页（默认 10 条/页）（覆盖：FR-01, D-001@v1）
- [ ] task-11: `WorkbenchTaskTable` 透传 `targetUserId`（覆盖：FR-02, D-004@v1）
- [ ] task-12: WEB 前端测试 —— todo 分页、切换用户交互单测（覆盖：FR-01, FR-02）

## Wave 4（前端 APP，依赖 Wave 3 lib）
- [ ] task-13: APP page 状态 `targetUserId` + `ProfileCard` 切换入口（底部 sheet）（覆盖：FR-02）
- [ ] task-14: APP 新增「我的待办」卡片 + 分页（覆盖：FR-01）

## Wave 5（验收，依赖全部）
- [ ] task-15: 端到端核对 —— 切换用户后 profile/指标/日历/待办/任务表全跟随；分页正确；越权 403；不传 target 行为不变（覆盖：FR-01~FR-04）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | workbench schema 调整 | W1 | P0 | — | FR-02,FR-04,D-003,D-005 | Profile+=can_view_others、Summary-=todos、+WorkbenchSwitchableUser |
| task-02 | service 权限+可见用户算法 | W1 | P0 | task-01 | FR-03,FR-04,D-002 | _resolve_target_user(403/404)、_visible_user_ids(部门子树∪项目成员)、_can_view_others |
| task-03 | service getter 改 target+待办分页 | W1 | P0 | task-02 | FR-01,FR-02,D-001,D-003,D-005 | getter 按 target.id；_derive_todos 去top20改分页；get_todos；list_switchable_users 批量JOIN |
| task-04 | workbench router 端点 | W2 | P0 | task-03 | FR-01,FR-02 | 3端点(profile/summary/calendar)+target；新建/todos(带target)+/switchable-users |
| task-05 | personal-task-plan 加 target | W2 | P0 | task-02 | FR-02,FR-04,D-004 | 仅_resolve_target_user，禁data_scope，req.user_id=target.id |
| task-06 | 后端测试 | W2 | P0 | task-04,05 | FR-01,FR-03,FR-04 | 可见用户四口径/分页/越权403/超管；更新现有(summary去todos) |
| task-07 | 前端 lib 层 | W3 | P0 | task-01 | FR-01,FR-02 | workbench.ts/task.ts fetch 加target；types.ts 同步；新增2 fetch |
| task-08 | WEB page 状态 | W3 | P0 | task-07 | FR-02 | targetUserId 透传+提示条 |
| task-09 | ProfileSummaryCard 切换下拉 | W3 | P0 | task-07 | FR-02,D-005 | can_view_others 显隐 |
| task-10 | TodoListPanel 分页 | W3 | P0 | task-07 | FR-01,D-001 | 自带fetch /workbench/todos + 分页器 |
| task-11 | WorkbenchTaskTable 透传 | W3 | P1 | task-07 | FR-02,D-004 | targetUserId→listPersonalPlanTasks |
| task-12 | WEB 前端测试 | W3 | P1 | task-10,09 | FR-01,FR-02 | todo分页/切换交互单测 |
| task-13 | APP page+ProfileCard 切换 | W4 | P0 | task-07 | FR-02 | targetUserId+底部sheet切换 |
| task-14 | APP 待办卡片+分页 | W4 | P0 | task-07,task-13 | FR-01 | 新增待办卡片+移动分页（同 page.tsx，须在 task-13 后） |
| task-15 | 端到端核对 | W5 | P0 | task-06,12,14 | FR-01~04 | 切换全跟随/分页/越权/兼容 |

## 关键路径

task-01 → task-02 → task-03 → task-04 → task-06 → task-15（后端 schema→service→router→测试→验收，最长路径）。

前端支线 task-01 → task-07 → task-10/13/14 → task-15 可与 Wave 2 后端并行（前端按 API 契约编码）。

## 全局验收标准

- [ ] 后端 PPM 测试全绿：`cd backend && uv run pytest app/modules/ppm -q --no-cov`
- [ ] 前端测试全绿：`cd frontend && pnpm test`
- [ ] （brownfield）不传 `target_user_id` 时，workbench 全部端点 + `/personal-task-plan/page` 行为与旧版完全一致
- [ ] WEB「我的待办」分页：默认 10 条/页，可翻页，badge=total，空态正确
- [ ] APP 出现「我的待办」卡片且带分页
- [ ] 经理/超管可切换用户；切换后 profile/指标/日历/待办/任务表全部变为目标用户数据（含提示条 + 返回我自己）
- [ ] 部门经理可见本部门及下属部门成员；项目/开发/业务经理可见其经理项目成员；并集
- [ ] 非经理非超管无切换入口；越权传他人 target_user_id → 403
- [ ] 代码兼容 Windows/Linux/macOS

## 覆盖矩阵

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-03, task-04, task-10 | 待办走独立 /workbench/todos 端点，PageResp total 准确 |
| D-002@v1 | task-02, task-06 | 可见用户按角色分口径（部门→org子树∪根；其他→项目成员），单测四口径 |
| D-003@v1 | task-01, task-03 | WorkbenchSummary 去 todos，summary 只留 metrics |
| D-004@v1 | task-05, task-11 | /personal-task-plan/page 加 target，切换后任务表跟随（仅 _resolve_target_user） |
| D-005@v1 | task-01, task-03, task-09 | can_view_others 入 profile 响应，前端显隐切换入口 |
