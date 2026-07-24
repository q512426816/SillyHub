---
author: qinyi
created_at: 2026-07-24T08:55:00
---

# 提案书（Proposal）

## 动机

个人工作台（`/ppm/workbench`）当前两个缺口影响使用：①「我的待办」一次性渲染全部派生待办（问题在办 + 变更待审 + 任务 top20），无分页，待办多时左栏冗长难翻阅；②工作台只读当前登录人，部门/项目/开发/业务经理无法查看下属或项目组成员的工作台，缺乏管理视角。本次补齐这两项，让工作台既能分页浏览待办，又能让管理者切换查看他人工作台（WEB + APP 双端）。

## 关键问题

1. **待办无分页**：后端 `_derive_todos` 一次性派生、前端全量渲染，无翻页；问题待办无上限，多时体验差且无 total 概念。
2. **工作台无管理视角**：profile/summary/calendar/任务表全部硬编码当前登录人（`user.id`），经理无法查看部门或项目组成员的工作台，必须逐个登录或另造页面。
3. **APP 端无待办区**：移动端工作台目前完全没有「我的待办」卡片（数据已 fetch 但未用），与桌面端不对齐。

## 变更范围

- **后端**：新增分页端点 `GET /workbench/todos`、可切换用户列表 `GET /workbench/switchable-users`；profile/summary/calendar/personal-task-plan 四端点加可选 `target_user_id`；service 加 `_resolve_target_user`（权限收口）+ `_visible_user_ids`（按经理角色分口径）+ `_can_view_others`；`WorkbenchSummary` 去 todos、`WorkbenchProfile` 加 `can_view_others`、新增 `WorkbenchSwitchableUser`。
- **前端 WEB**：`TodoListPanel` 自带分页（默认 10 条/页）；`ProfileSummaryCard` 加「切换用户」下拉（仅 `can_view_others`）；page 维护 `targetUserId` 透传全工作台 + 查看他人提示条；`WorkbenchTaskTable` 跟随 target。
- **前端 APP**：新增「我的待办」卡片（带分页）；`ProfileCard` 加「切换成员」入口；切换后全工作台跟随 target。

## 不在范围内（显式清单）

- 不改工作台三栏 / 移动卡片流布局结构。
- 不新建数据库表、不加 migration（纯 DTO + 查询逻辑）。
- 不做「批量聚合多个下属工作台」视图（YAGNI）。
- 不改看板 / 项目计划等其它子域的数据范围。
- 不补「我的任务」表分页器（仅透传 target_user_id）。

## 成功标准（可验证）

- 不传 `target_user_id` 时，所有端点行为与旧版完全一致（兼容）。
- `GET /workbench/todos?page=1&page_size=10` 返回 `PageResp`，total 准确，可翻页。
- 经理（部门/项目/开发/业务任一）或 super_admin 在个人信息区可见「切换用户」，切换后 profile/指标/日历/待办/任务表全部变为目标用户数据。
- 部门经理可切换到自己所在部门及下属部门成员；项目/开发/业务经理可切换到其经理项目的项目组成员。
- 非经理非超管 `can_view_others=false`，无切换入口；越权传他人 target_user_id → 403。
- WEB 与 APP 双端均具备上述能力。
- 后端 workbench 测试 + 前端单测全绿。
