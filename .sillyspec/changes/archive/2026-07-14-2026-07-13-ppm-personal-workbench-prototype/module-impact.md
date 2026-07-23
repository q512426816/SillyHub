---
author: qinyi
created_at: 2026-07-14 12:10:00
change: 2026-07-13-ppm-personal-workbench-prototype
---

# 模块影响分析（Module Impact）— PPM 个人工作台

## 变更概要
PPM 个人工作台（`/ppm/workbench`）：后端新建 `ppm/workbench` 聚合子域（profile/summary/calendar 3 GET 接口）+ `users` 加 `employee_no` 工号字段；前端新建三栏页面 + 8 组件 + 菜单入口。主仓库 commit `c248901d`（28 文件）。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| backend | 数据结构变更 | migrations/versions/20260714_add_user_employee_no.py, app/modules/auth/model.py, app/modules/auth/schema.py | users 表加 employee_no VARCHAR(50) NULL 列（migration down=20260713_fix_session_zombie 单 head）+ User ORM + UserRead schema | false |
| backend | 新增 | app/modules/ppm/workbench/{__init__,schema,service,router}.py | workbench 聚合子域：6 Pydantic DTO + WorkbenchService(get_profile/get_summary/get_calendar) + 3 GET router（权限 PPM_TASK_READ） | false |
| backend | 接口变更 | app/modules/ppm/workbench/router.py, app/main.py | 新增 `GET /api/ppm/workbench/{profile,summary,calendar}` + main.py include_router 挂载（参照 ppm 五 router 模式 L473-477） | false |
| backend | 新增（测试） | app/modules/ppm/workbench/tests/{__init__,conftest,test_workbench_service}.py | 20 单测（profile 部门关联/summary 5 指标+待办派生/calendar 分档，SQLite in-memory 非 mock） | false |
| frontend | 新增 | app/(dashboard)/ppm/workbench/page.tsx + _components/{profile-summary-card,personal-metric-strip,todo-list-panel,workbench-task-table,work-calendar-panel,quick-entry-grid,rule-note-panel,message-placeholder}.tsx | `/ppm/workbench` 三栏页面 + 8 组件（数据装配 apiFetch+useEffect，各栏独立 try/catch） | false |
| frontend | 接口/类型变更 | lib/ppm/workbench.ts, lib/ppm/types.ts, lib/api-types.ts | workbench API client（3 fetch snake_case）+ 6 TS 类型（手写 PPM 域）+ api-types 重生成（UserRead.employee_no） | false |
| frontend | 配置变更 | components/app-shell.tsx, lib/menu-permissions.ts | MENU_ICON_MAP 加 /ppm/workbench→LayoutDashboard + menu-permissions ppm-workbench 条目（permissions ppm:task:read） | false |

## 未匹配文件（worktree 副产品，非业务源码）

| 文件 | 说明 | 处理建议 |
|---|---|---|
| meta.json | sillyspec worktree 元数据，cherry-pick 带入主仓库 | 非业务，归档后可忽略（不影响功能） |
| frontend/.sillyspec-platform-cleaned | worktree 平台配置清理产物 | 同上，非业务 |
| backend/openapi.json | OpenAPI dump 产物（gen-api-types 用） | 生成产物，可由 dump_openapi.py 重新生成 |

## 三重交叉验证（以 git diff 为准）

- **声明范围**（design.md §6 文件清单）：14 个源码文件 → 与 git diff 业务文件一致
- **任务范围**（plan.md 13 task + TaskCard allowed_paths）：task-01~12 文件全覆盖，无遗漏
- **真实变更**（git diff HEAD~1 HEAD，28 文件）：覆盖声明 + 任务范围，额外含 3 个 worktree 副产品（meta.json/.sillyspec-platform-cleaned/openapi.json，cherry-pick 带入，非业务）

三重一致，无幽灵文件（声明但未改）或漏改（任务但未改）。

## needs_review 汇总
所有业务文件影响类型明确（数据结构/新增/接口/配置），无不确定项。worktree 副产品非业务，不影响模块逻辑判断。
