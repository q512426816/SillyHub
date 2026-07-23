---
author: qinyi
created_at: 2026-07-20 14:58:00
---

# 提案（Proposal）— PPM 菜单权限 key 独立化

## 问题

14 个 PPM 菜单共享 8 个权限 key，4 个 key 被多个菜单共用（项目/项目成员/干系人共用 `ppm:project:read`；项目计划/计划节点/里程碑共用 `ppm:plan:read`；问题清单/问题变更共用 `ppm:problem:read`；工作台/任务计划共用 `ppm:task:read`）。admin 无法独立控制单个菜单显隐——授权一个 key 会同时点亮多个菜单。

## 方案

14 个菜单各配一个专属权限 key（方案 A，用户已确认）：
- 新增 9 个 key（workbench:view / project-member:read / project-stakeholder:read / project-plan:read / plan-node:read / milestone-detail:read / problem-list:read / problem-change:read / task-plan:read）。
- 保留 5 个现有 key 给对应菜单（project:read / customer:read / work-hour:read / work-hour:stat / kanban:view）。
- 3 个旧共享 key（plan:read / problem:read / task:read）变悬空，保留不删。

## 影响

- backend `Permission` 枚举 +9（53→62），seed 迁移清单 8→14。
- frontend `menu-permissions.ts` 14 菜单 key 重映射。
- 测试 3 处同步 + openapi 重生成。
- platform_admin 自动获 14 个新菜单 key（启动 seed 兜底）。

## 承接关系

承接 `2026-07-20-ppm-permission-simplify`（ccfab86a，删操作权限留 8 菜单 key）。本变更修正其 D-001 盲点（8 key 不够 14 菜单独立控制）。
