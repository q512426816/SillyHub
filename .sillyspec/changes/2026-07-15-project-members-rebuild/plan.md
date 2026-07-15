---
author: WhaleFall
created_at: 2026-07-15 11:00:03
plan_level: full
---

# 实现计划（Plan）

> 变更 `2026-07-15-project-members-rebuild` · 项目→成员两级表（前后端）
> 依据 `design.md` §5 Wave / §6 文件清单 / §7 接口定义；`decisions.md` D-001~D-007；`requirements.md` FR-01~FR-08
> 技术方案确定（复用 ppm 分页 helper + 现有成员组件），无 Spike；依赖以线性 Wave 为主，省略 Mermaid。

## Wave 1（后端：聚合接口 + 成员账号，内部线性）

- [ ] task-01: `schema.py` 新增 `ProjectMemberSummaryItem`/`ProjectMemberSummaryPageReq`（6 维筛选字段），`ProjectMemberResp` 加可选 `username`（覆盖：FR-02, FR-04, D-001@v1, D-002@v1, D-004@v1）
- [ ] task-02: `service.py` `member_summary()`（owner_name 标量子查询取 role ilike 项目经理最早者 + member_count 标量子查询 + owner_name/member_keyword/role_name EXISTS 筛选 + count_total + apply_sort 白名单 + apply_pagination）；`ProjectMemberService.page()` LEFT JOIN `User` 取 `username`；`_MEMBER_SUMMARY_SORT_FIELDS`（覆盖：FR-02, FR-04, FR-08, D-001@v1, D-002@v1, D-004@v1, D-005@v1）
- [ ] task-03: `router.py` 新增 `GET /project-maintenance/member-summary`（声明在 `/{entity_id}` GET 之前，复用 `_PROJECT_READ`）（覆盖：FR-01, FR-02, FR-03, D-002@v1）
- [ ] task-04: 后端 pytest — 聚合分页/6 维筛选/负责人推算（多 PM 取最早、无 PM 空）/member_count/成员接口 username 回填（覆盖：FR-02, FR-03, FR-04）

## Wave 2（前端 client/types，依赖 Wave 1 schema 定型）

- [ ] task-05: `types.ts` 新增 `ProjectMemberSummaryItem`/`ProjectMemberSummaryPageReq`，`ProjectMember` 加可选 `username?: string | null`（覆盖：FR-04, D-004@v1）
- [ ] task-06: `project.ts` 新增 `pageProjectMemberSummary(params)`（覆盖：FR-01, FR-03, D-002@v1）

## Wave 3（前端组件重构，依赖 Wave 2）

- [ ] task-07: `ppm-project-members-table.tsx` `export MemberFormDrawer` + props 加 `onChanged?`/`embedded?`（紧凑模式：去 SectionCard + scroll 只 x 不限 y + 保留新增按钮，G1）；现有平铺页/抽屉不传则行为不变（覆盖：FR-04, FR-05, FR-06, FR-07, FR-08, D-004@v1, D-006@v1, D-007@v1）
- [ ] task-08: 新增 `ppm-project-members-group-table.tsx` — 搜索区（6 字段，复用 projects 页 PROJECT_TYPE/STATUS_OPTIONS 枚举）+ 一级 antd `Table` expandable（列：项目名/编号/负责人/成员数/状态/类型/更新时间/操作）+ 页头全局「+ 添加项目成员」（MemberFormDrawer，lockedProjectId=undefined）+ `expandedRowRender` 内嵌 `<PpmProjectMembersTable projectId embedded onChanged={load} />` + 真分页调 `pageProjectMemberSummary`（覆盖：FR-01, FR-02, FR-03, FR-05, FR-06, FR-08, D-002@v1, D-003@v1, D-006@v1, D-007@v1）
- [ ] task-09: `project-members/page.tsx` 改渲染 `<PpmProjectMembersGroupTable />`（保留 PageContainer/PageHeader）（覆盖：FR-01, D-006@v1）

## Wave 4（联调验收，依赖全部）

- [ ] task-10: `tsc --noEmit` + `pnpm lint` + 后端 pytest + Docker rebuild 实测（两级展开/两种新增/6 维搜索/成员数实时更新/负责人推算/projects 抽屉不回归/对照原型含 embedded 展开行视觉）（覆盖：全部 FR）

## 任务总表

| 编号 | 任务 | Wave | 优先级 | 依赖 | 覆盖 FR/D | 说明 |
|---|---|---|---|---|---|---|
| task-01 | schema 聚合 DTO + username | W1 | P0 | — | FR-02,04 / D-001,002,004 | 新增 2 个 DTO + Resp 加可选字段 |
| task-02 | service 聚合查询 + LEFT JOIN | W1 | P0 | task-01 | FR-02,04,08 / D-001,002,004,005 | 标量子查询 + EXISTS 筛选 |
| task-03 | router member-summary 端点 | W1 | P0 | task-02 | FR-01,02,03 / D-002 | 路径声明在 {entity_id} 前 |
| task-04 | 后端 pytest | W1 | P0 | task-03 | FR-02,03,04 | 聚合/推算/筛选/username |
| task-05 | types 聚合类型 + username | W2 | P0 | task-01 | FR-04 / D-004 | 前端类型对齐 schema |
| task-06 | client pageProjectMemberSummary | W2 | P0 | task-05 | FR-01,03 / D-002 | apiFetch 命中 summary 端点 |
| task-07 | members-table export + onChanged/embedded | W3 | P0 | task-06 | FR-04,05,06,07,08 / D-004,006,007 | 纯增量可选 prop，兼容现状 |
| task-08 | 新增 group-table 两级组件 | W3 | P0 | task-06, task-07 | FR-01,02,03,05,06,08 / D-002,003,006,007 | 核心 UI |
| task-09 | page 改渲染 GroupTable | W3 | P0 | task-08 | FR-01 / D-006 | 极薄页面切换组件 |
| task-10 | 联调验收（tsc/lint/pytest/Docker） | W4 | P0 | task-01~09 | 全 FR | 含 embedded 视觉核对 |

## 关键路径

task-01 → task-02 → task-03 → task-05 → task-06 → task-07 → task-08 → task-09 → task-10

（task-04 后端测试与 Wave 2 前端可并行，不阻塞关键路径；最长 9 步决定交付周期）

## 全局验收标准

- [ ] 后端 `pytest`（ppm project 模块）通过：聚合接口分页/6 维筛选/负责人推算（多 PM 取最早、无 PM 空）/member_count 正确；成员接口 LEFT JOIN username 回填
- [ ] 前端 `tsc --noEmit` + `pnpm lint` 通过
- [ ] Docker rebuild 后实测：进 `/ppm/project-members` 看到项目级列表（非成员平铺）；点项目展开懒加载成员子表（含账号列）；6 维搜索各自生效；页头全局新增 + 项目内新增均正常；增删成员后成员数实时更新；负责人推算正确（多 PM 取最早、无则「—」）
- [ ] （brownfield）`/ppm/projects` 成员管理抽屉功能不回归；`PpmProjectMembersTable` 不传 `onChanged`/`embedded` 时行为同现状；`ProjectMember.username` 可选字段不破坏现有消费
- [ ] embedded 展开行视觉正常（无 calc(100vh-430px) 滚动框嵌套，对照原型 G1）

## 覆盖矩阵（decisions → task → 验收）

| ID | 覆盖任务 | 验收证据 |
|---|---|---|
| D-001@v1 | task-02, task-04 | 负责人推算：role ilike 项目经理取 created_at 最早，无则空（pytest + 实测） |
| D-002@v1 | task-01, task-02, task-03, task-06, task-08 | 后端聚合接口 + 前端 client/组件消费 |
| D-003@v1 | task-08 | 展开行懒加载复用 project-member 接口 |
| D-004@v1 | task-01, task-02, task-05, task-07 | ProjectMemberResp/类型/子表账号列（LEFT JOIN users） |
| D-005@v1 | task-02 | 排序白名单不含派生列（默认 updated_at desc） |
| D-006@v1 | task-07, task-08, task-09 | 展开行复用 PpmProjectMembersTable + MemberFormDrawer 共享 + page 切换 |
| D-007@v1 | task-07, task-08 | onChanged 回调刷新 member_count |
