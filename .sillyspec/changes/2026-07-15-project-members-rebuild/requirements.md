---
author: WhaleFall
created_at: 2026-07-15 10:48:35
---

# 需求规格（Requirements）

> 变更 `2026-07-15-project-members-rebuild` · 前后端功能改造（项目→成员两级表）

## 角色

| 角色 | 说明 |
|---|---|
| 项目管理员 | 用 `/ppm/project-members` 查看「项目有哪些成员」，按项目集中增删改成员、按多维度查找 |
| 只读用户 | 查看项目→成员两级列表（`canWrite=false` 时隐藏增删改） |
| 后端服务 | 提供按项目聚合的 summary 接口 + 成员接口（含账号） |

## 功能需求

### FR-01: 项目→成员两级可展开表

覆盖决策：D-002@v1, D-003@v1, D-006@v1

Given 用户进入 `/ppm/project-members`
When 页面加载
Then 显示**一级项目列表**（项目名称/项目编号/负责人/成员数/项目状态/项目类型/更新时间/操作），而非成员平铺

Given 一级项目列表已加载
When 用户点击某项目行（展开图标）
Then **懒加载**该项目成员（调 `GET /project-member?pm_project_id=`），在展开行渲染成员子表（姓名/账号/联系方式/部门/角色/操作）

Given 项目未展开
Then 不发起成员请求（首屏只载项目聚合行，不 N+1）

### FR-02: 一级表展示负责人（推算）与成员数（聚合）

覆盖决策：D-001@v1, D-002@v1

Given 项目下有成员 `role_name` 含「项目经理」（ilike，可多角色逗号拼接）
When 聚合接口返回该项目行
Then 「负责人」= 该类成员中 `created_at` **最早**者的 `user_name`

Given 项目下有多个项目经理
When 推算负责人
Then 取 `created_at` 最早的一个（唯一确定）

Given 项目下**无**角色含「项目经理」的成员
When 渲染负责人列
Then 显示「—」（`owner_name=None`）

Given 项目下有 N 个成员
When 聚合接口返回
Then 「成员数」= N（`member_count` 派生计数）

### FR-03: 6 维搜索

覆盖决策：D-002@v1

Given 搜索区有 6 个筛选项（项目名/项目状态/项目类型/负责人姓名/成员姓名·账号/角色）
When 用户填写任意组合并点「查询」
Then 一级项目表按条件刷新（调 summary 接口带筛选），结果只命中匹配项目

Given 填「成员姓名/账号」= "zhang"
When 查询
Then 命中「该项目下存在成员 `user_name` 或 `users.username` 模糊匹配 zhang 的项目」（EXISTS 子查询）

Given 填「负责人」= "张"
When 查询
Then 命中「该项目下存在 role 含项目经理 且 `user_name` 模糊匹配 张 的项目」

Given 点「重置」
When 重置搜索
Then 清空所有筛选并重新加载（无条件）

### FR-04: 成员子表显示登录账号列

覆盖决策：D-004@v1

Given 后端 `ProjectMemberService.page()` LEFT JOIN `users`
When 返回成员
Then `ProjectMemberResp` 含可选 `username`（登录账号）

Given 成员子表渲染
When 某成员有 `username`
Then 「账号」列显示其登录账号

Given 某成员 `username` 为空（None）
When 渲染账号列
Then 显示「—」（兜底）

### FR-05: 两种新增成员入口

覆盖决策：D-006@v1

Given 用户点页头「+ 添加项目成员」（全局）
When 打开成员表单抽屉
Then 抽屉显示「所属项目」选择（跨项目），提交后成员入所选项目

Given 用户在某项目展开行的子表点「+ 新增成员」（项目内）
When 打开成员表单抽屉
Then 项目已锁定（不显示「所属项目」选择），提交后成员入当前项目

Given 新增成员表单（选用户联动回填部门/姓名、角色多选逗号拼接）
When 提交
Then 沿用现有 `PpmProjectMembersTable` 的 MemberFormDrawer 逻辑（D-009 角色、用户联动），行为与 projects 抽屉一致

### FR-06: 增删成员后成员数实时更新

覆盖决策：D-007@v1

Given 用户在展开行子表新增/编辑/删除成员成功
When `PpmProjectMembersTable` 的 `onChanged` 回调触发
Then 父级 `PpmProjectMembersGroupTable` 重新拉 summary，该行「成员数」实时刷新

### FR-07: projects 页成员抽屉不回归（兼容）

覆盖决策：D-004@v1, D-006@v1

Given `/ppm/projects` 页点「成员管理」打开抽屉
When 渲染 `<PpmProjectMembersTable projectId />`
Then 行为与现状一致（CRUD/搜索/分页正常），`ProjectMember.username` 可选字段不破坏现有消费

Given `PpmProjectMembersTable` 新增 `onChanged`/`embedded` 可选 prop
When projects 抽屉不传这两个 prop
Then 行为同现状（不回调、非嵌入式渲染）

### FR-08: 默认排序（不做成员数排序）

覆盖决策：D-005@v1

Given 一级项目表未指定排序
When 加载
Then 默认按 `updated_at` 倒序

Given 派生列 owner_name/member_count
When 试图排序
Then 不在排序白名单内，被静默忽略（仅支持 updated_at/created_at/project_name/project_code）

## 非功能需求

- **兼容性**：`ProjectMemberResp.username`、`PpmProjectMembersTable` 的 `onChanged`/`embedded`、`ProjectMember.username` 均为新增可选，不传时行为同现状；projects 抽屉零改动。
- **可回退**：两级表是新增页形态，出问题可回退到平铺表（ql-20260715-001）；成员接口 LEFT JOIN 可回退为不带 username（账号列降级「—」）。
- **可测试**：后端 pytest（聚合/推算/筛选/member_count/username）；前端 `tsc --noEmit` + `pnpm lint`；Docker rebuild 实测。
- **跨平台**：前端 Next.js + 后端 FastAPI，兼容 Windows / Linux / macOS（无平台相关改动）。
- **性能**：聚合用 EXISTS 子查询 + 标量子查询，`ix_ppm_project_member_project` 已覆盖；summary page_size 默认 20。
- **零 migration**：不新增表/列/索引。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-02 | 负责人推算口径（role 含项目经理取最早，零 migration） |
| D-002@v1 | FR-01, FR-02, FR-03 | 后端聚合 summary 接口（避免前端 groupBy） |
| D-003@v1 | FR-01 | 成员展开行懒加载（复用 project-member 接口） |
| D-004@v1 | FR-04, FR-07 | 成员子表账号列（LEFT JOIN users 补 username） |
| D-005@v1 | FR-08 | 默认排序，不做成员数排序 |
| D-006@v1 | FR-01, FR-05, FR-07 | 展开行复用 PpmProjectMembersTable + MemberFormDrawer 共享 |
| D-007@v1 | FR-06 | onChanged 回调刷新 member_count |
