---
author: WhaleFall
created_at: 2026-07-15 10:48:35
---

# 提案书（Proposal）

> 变更 `2026-07-15-project-members-rebuild` · 前后端功能改造（项目→成员两级表）

## 动机

`/ppm/project-members` 当前是「以成员为主」的平铺列表（ql-20260715-001 已补「所属项目」列），仍是**数据库视角**——一行一个成员，要靠「所属项目」列反推归属。用户实际要的是**业务视角**：「项目有哪些成员」。本变更把该页重构为 **项目 → 成员两级可展开表**，一级是项目（含负责人、成员数），成员作为可展开子表，并补多维搜索，为后续负责人管理/统计/批量导入导出/权限预留扩展。

## 关键问题

1. **视角错位**：平铺表要靠「所属项目」列反查归属，看不出「一个项目下有哪些人」，跨项目横向看成员也不直观。
2. **无聚合信息**：看不到每个项目的「负责人」「成员数」等概览，要逐条成员数；现有 `/project-member` 接口只回成员行，前端无现成聚合，若前端 groupBy 会产生 N+1 或全量拉取。
3. **缺多维搜索**：无法按负责人、成员姓名/账号、角色等维度筛选项目，定位慢。
4. **成员无账号**：`ProjectMemberResp` 只回 `user_name`（姓名），看不到登录账号，不便核对人员身份。

## 变更范围

- **后端**：新增 `GET /api/ppm/project-maintenance/member-summary` 聚合接口（分页项目 + `member_count` + `owner_name` 推算 + 6 维筛选 + 排序）；`ProjectMemberResp` 补可选 `username`（`ProjectMemberService.page()` LEFT JOIN `users`）。复用现有 `count_total`/`apply_sort`/`apply_pagination` helper。
- **前端**：`project-members/page.tsx` 改渲染两级表组件；新增 `PpmProjectMembersGroupTable`（搜索区 + 一级 antd `Table` expandable + 页头全局新增）；`PpmProjectMembersTable` `export MemberFormDrawer` + 加 `onChanged`/`embedded` 两个可选 prop（展开行复用 + 成员数刷新 + 紧凑渲染）；`lib/ppm/project.ts` 加 `pageProjectMemberSummary`；`lib/ppm/types.ts` 加聚合类型 + `ProjectMember.username`。
- **数据**：零 migration（所有字段已存在，仅查询/聚合方式变）。

## 不在范围内（显式清单）

- 不改 `/ppm/projects` 项目页（保持 `PpmResourceTable` + 成员管理抽屉原样）
- 不破坏 `PpmProjectMembersTable` 锁定 `projectId` 模式（抽屉继续复用）；成员 CRUD 业务逻辑（角色多选、选用户联动回填）不变
- 不新增数据库表/列、不改列定义（零 migration）
- 不支持「按成员数排序」（默认按 `updated_at` 倒序）
- 不做批量导入导出 / 权限粒度 / 负责人独立字段（本次仅推算展示，预留扩展）
- 不改其他 ppm 子域（客户/干系人/计划/看板等）
- 不引入新 npm/pip 依赖

## 成功标准（可验证）

- 进入 `/ppm/project-members` 看到项目级列表（项目名/编号/负责人/成员数/状态/类型/更新时间/操作），非成员平铺
- 点项目行展开，懒加载显示该项目成员子表（姓名/**账号**/联系方式/部门/角色/操作）
- 6 维搜索（项目名/状态/类型/负责人/成员姓名·账号/角色）各自生效
- 页头「+ 添加项目成员」（跨项目选所属项目）与展开后「+ 新增成员」（项目锁定）都正常
- 编辑/删除成员后**成员数实时更新**；负责人推算正确（多项目经理取最早加入、无则显「—」）
- `/ppm/projects` 成员管理抽屉功能**不回归**
- 后端 pytest：聚合接口分页/筛选/负责人推算/member_count 正确；成员接口 username 回填
- `tsc --noEmit` + `pnpm lint` 通过；Docker rebuild 实测核心交互对照原型
