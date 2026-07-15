---
author: WhaleFall
created_at: 2026-07-15T10:27:20
---

# 决策台账（Decisions）— 2026-07-15-project-members-rebuild

> 本次变更的实现/验收影响决策记录。长期术语待 archive/scan 时再提升到 `docs/SillyHub/glossary.md`。

## D-001@v1 — 负责人推算口径（零 migration）

- **type**: design
- **status**: accepted
- **source**: brainstorm step 6（用户确认）
- **question**: 一级项目表的「负责人」怎么来？要不要给项目表加负责人字段？
- **answer**: 不新增字段、零 migration。负责人由该项目成员推算——取 `role_name` 含「项目经理」（ilike）的成员，多个取 `created_at` 最早那个的 `user_name`；无则空。
- **normalized_requirement**: 负责人列为派生展示，不落库；多项目经理取最早加入者。
- **impacts**: 后端 `member_summary` 子查询（§7.2）；验收 7；R-01。
- **evidence**: `model.py:42`（项目表无负责人字段）、`service.py:452`（role_name ilike 多角色匹配）、`model.py:173`（成员 created_at）。
- **priority**: P1

## D-002@v1 — 后端聚合 summary 接口（避免前端 groupBy）

- **type**: architecture
- **status**: accepted
- **source**: brainstorm step 6（用户确认）
- **question**: 两级表的一级项目数据怎么来？前端 groupBy 还是后端聚合？
- **answer**: 后端新增 `GET /api/ppm/project-maintenance/member-summary` 聚合接口，一次查询返回分页项目 + member_count + owner_name 推算 + 多维筛选。前端不 groupBy、不 N+1。
- **normalized_requirement**: 一级列表数据由后端聚合接口提供，支持分页与 6 维筛选。
- **impacts**: schema/service/router（§7.1/§7.2）；前端 client（§7.4）。
- **evidence**: `service.py:210-264`（现有 page 模式可复用 helper）、`crud.py`（count_total/apply_sort/apply_pagination）。
- **priority**: P0

## D-003@v1 — 成员展开行懒加载（复用现有成员接口）

- **type**: design
- **status**: accepted
- **source**: brainstorm step 6（用户确认）
- **question**: 展开项目行后成员数据怎么加载？聚合接口内嵌全量成员，还是展开时懒加载？
- **answer**: 懒加载——展开时复用现有 `GET /project-member?pm_project_id=` 按项目拉取，不内嵌到聚合接口。
- **normalized_requirement**: 成员子表展开时按需加载，首屏只载项目聚合行。
- **impacts**: GroupTable `expandable.expandedRowRender` 内嵌 `PpmProjectMembersTable projectId`（§7.5）；R-03。
- **evidence**: `router.py:449`（成员接口已支持 pm_project_id 筛选）、`ppm-project-members-table.tsx`（锁定模式现成）。
- **priority**: P1

## D-004@v1 — 成员子表显示登录账号列（LEFT JOIN users 补 username）

- **type**: design
- **status**: accepted
- **source**: brainstorm step 9（用户确认待定项）
- **question**: 展开后的成员子表要不要显示登录账号列？
- **answer**: 要。后端 `ProjectMemberResp` 补可选 `username`（`ProjectMemberService.page()` LEFT JOIN `users` 取 `username`），子表多一列「账号」。
- **normalized_requirement**: 成员子表含登录账号列；username 可空（None 兜底「—」）。
- **impacts**: schema/service（§7.3）；前端 types（§7.4）；R-04。
- **evidence**: `auth/model.py:48`（User.username 可空）、`schema.py:177`（ProjectMemberResp）。
- **priority**: P1

## D-005@v1 — 一级表默认排序，不做成员数排序

- **type**: design
- **status**: accepted
- **source**: brainstorm step 9（用户确认待定项）
- **question**: 一级项目表要不要支持「按成员数排序」？
- **answer**: 不做。一级表默认按 `updated_at` 倒序；派生列 owner_name/member_count 不进排序白名单（按派生列排序实现复杂、收益低）。
- **normalized_requirement**: 一级表排序白名单 = {updated_at, created_at, project_name, project_code}。
- **impacts**: `_MEMBER_SUMMARY_SORT_FIELDS`（§7.2）；非目标 §3。
- **evidence**: `crud.py:162-173`（apply_sort 白名单外静默忽略）。
- **priority**: P2

## D-006@v1 — 展开行复用 PpmProjectMembersTable（最小改动）

- **type**: architecture
- **status**: accepted
- **source**: brainstorm step 9（设计推导）
- **question**: 展开行的成员子表是新写，还是复用现有 PpmProjectMembersTable？
- **answer**: 复用。展开行 `expandedRowRender` 内嵌 `<PpmProjectMembersTable projectId showToolbar />`，直接继承其成员表格 + MemberFormDrawer + 删除确认 + 列定义，最小改动、零重复。为支持全局「添加项目成员」跨项目新增，将 `MemberFormDrawer` 从 `ppm-project-members-table.tsx` export 出来共享。
- **normalized_requirement**: 两级表的成员子表与 projects 抽屉成员表同源；全局新增复用同一表单。
- **impacts**: `ppm-project-members-table.tsx` export + props（§7.5）；新增 `ppm-project-members-group-table.tsx`；R-03/R-05。
- **evidence**: `ppm-project-members-table.tsx:91`（props projectId 锁定模式）、`:376`（MemberFormDrawer）、`projects/page.tsx:173`（抽屉复用）。
- **priority**: P1

## D-007@v1 — onChanged 回调刷新 member_count

- **type**: design
- **status**: accepted
- **source**: brainstorm step 9（设计推导）
- **question**: 展开行内增删成员后，一级表该行的 member_count 如何同步？
- **answer**: `PpmProjectMembersTable` 新增可选 `onChanged?: () => void`，在成员 create/update/delete 成功后调用；GroupTable 传 `onChanged={load}`（重新拉 summary 刷新 member_count）。
- **normalized_requirement**: 成员增删后成员数实时更新。
- **impacts**: `ppm-project-members-table.tsx` props（§7.5）；验收 6。
- **evidence**: `ppm-project-members-table.tsx:149-193`（handleSubmit/handleConfirmDelete 成功点）。
- **priority**: P2
