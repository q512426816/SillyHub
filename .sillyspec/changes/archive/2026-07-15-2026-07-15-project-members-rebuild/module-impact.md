---
author: WhaleFall
created_at: 2026-07-15 19:53:46
change: 2026-07-15-project-members-rebuild
baseline: ba6409d
---

# 模块影响分析（Module Impact）— /ppm/project-members 页重构（项目→成员两级表）

> 变更 `2026-07-15-project-members-rebuild`
> baseline commit `ba6409d`（sillyspec execute 起点）→ HEAD
> 三重交叉验证：声明范围（proposal.md §变更范围 / design.md §6 文件清单）× 任务范围（plan.md task-01~10 allowed_paths）× 真实变更（git diff ba6409d..HEAD），**以 git diff 为准**。

## 变更概述

把 `/ppm/project-members` 从「成员平铺表」重构为「项目→成员两级可展开表」：后端新增聚合接口（负责人推算 + member_count + 6 维筛选），成员接口 LEFT JOIN 补 username；前端两级 expandable 表 + 全局/项目内两种新增 + onChanged 刷新成员数。实现经多轮 quick（ql-007/010~013）演进落地。

## 模块影响矩阵

| 模块 | 影响类型 | 相关文件 | 更新内容摘要 | needs_review |
|---|---|---|---|---|
| **ppm**（主） | 接口变更 + 逻辑变更 + 数据结构变更 + 新增 | `backend/app/modules/ppm/project/schema.py`<br>`backend/app/modules/ppm/project/service.py`<br>`backend/app/modules/ppm/project/router.py`<br>`backend/app/modules/ppm/project/tests/test_member_summary.py`（新增）<br>`frontend/src/lib/ppm/types.ts`<br>`frontend/src/lib/ppm/project.ts`<br>`frontend/src/app/(dashboard)/ppm/project-members/page.tsx`<br>`frontend/src/app/(dashboard)/ppm/projects/page.tsx`<br>`frontend/src/components/ppm-project-members-group-table.tsx`（新增）<br>`frontend/src/components/ppm-project-members-table.tsx`<br>`frontend/src/components/ppm-user-select.tsx` | **后端**：①新增 `GET /project-maintenance/member-summary` 聚合接口（owner_name 标量子查询取项目经理最早 + member_count 计数 + 6 维 EXISTS 筛选 + 排序白名单）；②`ProjectMemberService.page()` LEFT JOIN users 补 `username`；③`ProjectMemberResp/SummaryItem/SummaryPageReq` DTO。**前端**：①两级 expandable 表（项目懒加载成员子表）；②`PpmProjectMembersTable` export `MemberFormDrawer` + 加 `onChanged`/`embedded` 可选 prop；③`pageProjectMemberSummary` client；④`projects` 页成员管理抽屉改跳转 `project-members`（ql-012，偏离 design §3/§9 非目标）；⑤成员子表服务端分页（ql-013）；⑥`PpmUserSelect` 已选成员按 id 批量回填姓名（ql-010）。**测试**：9 个 pytest（聚合分页/筛选/推算/count/username 回填）。 | false |
| **admin**（配套） | 接口变更 | `backend/app/modules/admin/users_service.py`<br>`backend/app/modules/admin/router.py`<br>`backend/tests/modules/admin/test_users_router.py`<br>`frontend/src/lib/admin.ts` | `list_users` 加 `ids` 批量查参数（配套 PpmUserSelect 已选 user_id 不在前 20 条时按 id 批量查真实姓名回填 label，修复编辑成员「姓名」字段显示 id）。属本变更 ql-010 配套，非 admin 独立变更。 | false |

## 模块索引可信度

- `ppm` 模块 `_module-map.yaml` needs_review=**false**（索引可信），paths 覆盖 `backend/app/modules/ppm/**` + `frontend/src/lib/ppm/**` + `frontend/src/app/(dashboard)/ppm/**` + `frontend/src/components/ppm-*.tsx`，本变更文件全部命中。
- `admin` 模块 needs_review=**false**（索引可信），paths 覆盖 `backend/app/modules/admin/**` + `frontend/src/lib/admin.ts`。

## 未匹配文件（非本变更，baseline 后其他变更的改动，排除）

下列文件虽在 `git diff ba6409d..HEAD` 内，但属**其他变更**，不计入本变更影响：

| 文件 | 归属 | 排除理由 |
|---|---|---|
| `backend/app/modules/ppm/workbench/**`（service/tests）<br>`frontend/src/app/(dashboard)/ppm/workbench/**`（layout/page/_components/*） | ppm/workbench | 工作台功能，独立变更，非本 project-members 重构 |
| `backend/app/modules/ppm/plan/service.py`<br>`frontend/src/app/(dashboard)/ppm/milestone-details/page.tsx` | ppm/plan + milestone | 属 `2026-07-15-milestone-detail-auto-task` 变更（里程碑明细自动建任务） |
| `frontend/src/app/(dashboard)/admin/users/page.tsx` | admin | admin 用户管理页，未确认由本变更 ql-010 触及（可能为 admin 独立变更），保守排除，needs_review |
| `.sillyspec/docs/SillyHub/modules/ppm.md`<br>.sillyspec/docs/SillyHub/modules/admin.md` | 文档 | 模块卡片，由 doc-syncer（archive step3）据本 module-impact 同步，非源码变更 |

## 结论

本变更核心影响 **ppm 模块**（前后端全套），配套影响 **admin 模块**（list_users ids 参数）。两模块索引均可信（needs_review=false）。无数据结构变更（零 migration，仅查询/聚合方式变 + 新增可选字段）。设计偏离 ql-012（projects 抽屉改跳转）需在 doc-syncer 步骤补记入 ppm 模块卡片变更索引（已在 ppm.md 记录 ql-012 条目）。
