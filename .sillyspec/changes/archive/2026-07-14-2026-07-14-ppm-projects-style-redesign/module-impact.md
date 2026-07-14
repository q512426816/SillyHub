---
author: WhaleFall
created_at: 2026-07-14 16:40:00
---

# 模块影响分析（Module Impact）— /ppm/projects 页样式规范化 + 全 ppm 推广

> 变更 `2026-07-14-ppm-projects-style-redesign` · archive 阶段
> 依据：design.md §6（核心 3 文件）+ §6.1（task-08 推广 12 文件）；git diff 来源 commit `eacbfbb6`（execute）+ `ff224412`（task-08 推广）。

## 分析方法

以 git diff（真实 > 声明）为准，将变更涉及的 15 个前端文件按 `_module-map.yaml` 的 paths glob 匹配到模块。纯前端样式规范化，无后端、无 schema/状态机/接口变更。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| ppm | 配置变更（UI 样式规范） | `components/ppm-resource-table.tsx`、`components/ppm-project-members-table.tsx`、`app/(dashboard)/ppm/projects/page.tsx`（核心 W1-W3，commit eacbfbb6） | select 渲染分支（StatusBadge/Tag）；两处手写浮层→antd Drawer/Modal（`maskClosable={false}`）；toast/error 语义化；`project_name` 加粗；搜索按钮分组；`ProjectMembersDrawer`→antd Drawer | false |
| ppm | 配置变更（UI 样式规范推广） | `app/(dashboard)/ppm/kanban/_components/kanban-search-bar.tsx`、`plan-nodes/`、`problem-list/`、`problem-changes/`、`project-plans/`、`project-stakeholders/`、`task-execute/`、`task-plans/`、`work-hours/`、`work-hour-statistics/`、`milestone-details/` 的 page.tsx（task-08 推广，commit ff224412） | 操作列统一（居中 + ghost 按钮 + 危险操作红色 className）；`project-plans` 去硬编码色（`bg-blue-500`/`bg-amber-500`）；`kanban-search-bar` 搜索按钮分组（D-006） | false |
| frontend_app | 配置变更（主题色 token） | `app/globals.css`（commit ff224412） | `--primary`/`--ring` 改蓝（`221 83% 53%`）；`--background` 饱和度 20%→40%；`--radius` 0.375rem→0.5rem | false |

## 影响类型说明

本次变更全部为**配置变更（UI 样式规范）**：
- 无逻辑变更：业务流程、状态机、CRUD 逻辑均未动（verify AC-05 功能不回归，用户实测通过）
- 无数据结构 / 接口 / 调用关系变更
- 仅视觉层：状态/类型渲染组件、浮层组件库、操作列布局、全局主题色 token

## 未匹配文件

| 文件 | 原因 |
|---|---|
| （无） | 15 个变更文件全部匹配到 `ppm` / `frontend_app` 模块 |

## 结论

- 影响模块 2 个：**ppm**（14 文件，样式规范核心 + 全页面推广）、**frontend_app**（1 文件 `globals.css` 主题色 token）。
- 全部为 UI 样式配置变更，无后端/数据/接口影响，`needs_review` 均为 false。
- 用户浏览器实测通过（verify-result「未覆盖」6 项视觉/交互 + task-08 推广页面均确认）。
