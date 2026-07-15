---
author: WhaleFall
created_at: 2026-07-15 10:50:00
---

# 任务清单（Tasks）— 2026-07-15-project-members-rebuild

> brainstorm 阶段初步任务清单（按 design §5 Wave 分组）。
> **plan 阶段将细化为带依赖关系 / 验收点 / 测试的正式 Wave-Task 拆分**，本文件会被 plan 覆盖。

## W1 · 后端：聚合接口 + 成员账号

- **task-01** `schema.py`：新增 `ProjectMemberSummaryItem`、`ProjectMemberSummaryPageReq`（6 维筛选字段）；`ProjectMemberResp` 加可选 `username: str | None = None`。
- **task-02** `service.py`：`ProjectMaintenanceService.member_summary(req)`（owner_name 标量子查询取 role ilike 项目经理最早者 + member_count 标量子查询 + owner_name/member_keyword/role_name EXISTS 筛选 + project_name/status/type 筛选 + count_total + apply_sort 白名单 + apply_pagination + 行映射）；`ProjectMemberService.page()` LEFT JOIN `User` 取 `username`；新增 `_MEMBER_SUMMARY_SORT_FIELDS`。
- **task-03** `router.py`：新增 `GET /project-maintenance/member-summary`（声明在 `/{entity_id}` GET 之前，复用 `_PROJECT_READ`）。
- **task-04** 后端测试：聚合接口分页/6 维筛选/负责人推算（多 PM 取最早、无 PM 空）/member_count 正确；成员接口 username 回填 + projects 抽屉调用方兼容。

## W2 · 前端 client/types

- **task-05** `types.ts`：新增 `ProjectMemberSummaryItem`、`ProjectMemberSummaryPageReq`；`ProjectMember` 加可选 `username?: string | null`。
- **task-06** `project.ts`：新增 `pageProjectMemberSummary(params)`（命中 `/api/ppm/project-maintenance/member-summary`）。

## W3 · 前端组件重构

- **task-07** `ppm-project-members-table.tsx`：`export MemberFormDrawer`（共享，逻辑不变）；props 加 `onChanged?: () => void`（CRUD 成功后调用）+ `embedded?: boolean`（紧凑模式：去 SectionCard + scroll 只 x 不限 y + 保留新增按钮，G1）；现有平铺页/抽屉不传则行为不变。
- **task-08** 新增 `ppm-project-members-group-table.tsx`：搜索区（6 字段，复用 projects 页 PROJECT_TYPE/STATUS_OPTIONS 枚举）+ 一级 antd `Table` expandable（列：项目名/编号/负责人/成员数/状态/类型/更新时间/操作）+ 页头全局「+ 添加项目成员」（MemberFormDrawer，lockedProjectId=undefined）；`expandedRowRender` 内嵌 `<PpmProjectMembersTable projectId embedded onChanged={load} />`；真分页调 `pageProjectMemberSummary`。
- **task-09** `project-members/page.tsx`：改渲染 `<PpmProjectMembersGroupTable />`（保留 PageContainer/PageHeader）。

## W4 · 联调验收

- **task-10** `tsc --noEmit` + `pnpm lint`；后端 pytest；Docker rebuild 实测：两级展开/两种新增/6 维搜索/成员数实时更新/负责人推算/projects 抽屉不回归；对照原型核对（含 embedded 展开行视觉）。

## 依赖（初步）

- task-02 依赖 task-01（schema）；task-03 依赖 task-02；task-04 依赖 task-03。
- task-06 依赖 task-05；task-08 依赖 task-06 + task-07；task-09 依赖 task-08。
- task-10 依赖全部。plan 阶段细化 Wave 边界与并行度。
