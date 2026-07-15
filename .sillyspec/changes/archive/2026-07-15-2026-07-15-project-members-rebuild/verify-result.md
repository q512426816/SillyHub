---
author: WhaleFall
created_at: 2026-07-15 19:46:14
change: 2026-07-15-project-members-rebuild
stage: verify
risk_profile: contract-required
---

# 验证报告 — 2026-07-15-project-members-rebuild

> /ppm/project-members 页重构（项目→成员两级表，前后端）

## 结论

**PASS WITH NOTES**

- 风险等级：**contract-required**（涉及 API contract + DTO + 前端 client，非 integration/deployment-critical：design/plan 不含 daemon/session/lease/lifecycle/state_transition/heartbeat/bootstrap/entrypoint 关键词）
- 非集成/部署关键型，PASS WITH NOTES **不降级为 FAIL**
- 代码实现完成（task-01~09 全落地）、自动化测试全过（后端 pytest 30 passed / ruff 过 / 前端 tsc 过 / lint 0 error），存在 1 处合理设计偏离与 2 个非阻断 lint warning，详见 NOTES

## 任务完成度

plan.md 的 10 个 task，代码实现完成率 **9/9（task-10 为联调验收任务，非代码产出）**：

| Task | 内容 | 状态 | 证据 |
|---|---|---|---|
| task-01 | schema 聚合 DTO + username | ✅ | `schema.py:217 ProjectMemberSummaryItem` / `:237 ProjectMemberSummaryPageReq` / `:192 username: str\|None=None` |
| task-02 | service 聚合查询 + LEFT JOIN + 排序白名单 | ✅ | `service.py:251 member_summary` / `:147 _MEMBER_SUMMARY_SORT_FIELDS` / `:329,:574 outerjoin(User)` |
| task-03 | router member-summary 端点 | ✅ | `router.py:238 "/project-maintenance/member-summary"` / `:241 page_project_member_summary`，含路径优先级注释（`:258`，声明在 `{entity_id}` 前） |
| task-04 | 后端 pytest | ✅ | `tests/test_member_summary.py` 9 个测试函数，30 passed |
| task-05 | types 聚合类型 + username | ✅ | `types.ts:90 ProjectMemberSummaryItem` / `:106 ProjectMemberSummaryPageReq` / `:160 username?:string\|null` |
| task-06 | client pageProjectMemberSummary | ✅ | `project.ts:114 pageProjectMemberSummary` |
| task-07 | members-table export + onChanged/embedded | ✅ | `ppm-project-members-table.tsx:409 export MemberFormDrawer` / `:64 onChanged` / `:71 embedded` / `:397 if(embedded)` 渲染分支 |
| task-08 | 新增 group-table 两级组件 | ✅ | `ppm-project-members-group-table.tsx` 494 行，含 expandable/expandedRowRender/6 维搜索/全局新增 |
| task-09 | page 改渲染 GroupTable | ✅ | `project-members/page.tsx:15 import` / `:26 <PpmProjectMembersGroupTable>` |
| task-10 | 联调验收（tsc/lint/pytest/Docker） | ✅ | tsc exit0 / lint 0 error / pytest 30 passed / Docker 已通过 quick 部署实测（ql-013） |

完成率：**100%**（10/10）。

## 设计一致性

实现与 design.md §7 接口定义**高度一致**，逐项核对：

**后端聚合查询（§7.2，task-02）** — 严格对照：
- `owner_subq`：`role_name ilike '%项目经理%'` + `order_by created_at.asc()` + `limit 1`（取最早，D-001）✅
- `count_subq`：`func.count()` + `pm_project_id` 匹配（member_count 派生）✅
- 主 `select` 9 列（含 `company_name`，design §7.1 schema 已列）✅
- 6 维筛选：`project_name/project_status/project_type` 直筛项目表；`owner_name/role_name/member_keyword` 用 `exists()` 子查询 ✅
- `member_keyword` 的 EXISTS 内 `outerjoin(User)` + `(user_name.like | User.username.like)`，孤立 `user_id` 兜底（R-07）✅
- `count_total` + `apply_sort`（白名单）+ `apply_pagination`；映射 `owner_name=None` 兜底、`member_count=int(or 0)` ✅
- 排序白名单 `{updated_at, created_at, project_name, project_code}`，派生列 `owner_name/member_count` 不进白名单（D-005，不做成员数排序）✅

**schema DTO（§7.1，task-01）** — `ProjectMemberSummaryItem` 9 字段 + `ProjectMemberSummaryPageReq` 分页四件 + 6 维筛选 + `Field(ge=1, le=200)` 约束 ✅

**成员接口补 username（§7.3，task-02）** — `ProjectMemberService.page()` 改 `select(PpmProjectMember, User.username).outerjoin(User, ...)`，`ProjectMemberResp(username=row.username)`，`User.username` 可空兜底 None（FR-04/R-04）；保留 `role_name` ilike 多角色匹配（D-009）✅

**router（§7.1，task-03）** — `GET /project-maintenance/member-summary` 声明在 `/{entity_id}` GET 之前（路径优先级，ppm 模块约定），复用 `_PROJECT_READ` ✅

**前端组件（§7.5，task-07/08/09）** —
- `PpmProjectMembersTable` 加可选 `onChanged?`/`embedded?`（纯增量，projects 抽屉不传则行为不变）；`export MemberFormDrawer` 共享
- `embedded` 渲染分支（`:397`）：跳过 SectionCard，Table scroll 三态（embedded → 只 `{x:"max-content"}` / 页面模式 → `{x, y:"calc(100vh-430px)"}` / 抽屉 → 只 x）——G1 视口滚动框嵌套修复正确
- `PpmProjectMembersGroupTable`：`expandable.expandedRowKeys` 受控（G6 翻页重置可接受）+ `expandedRowRender` 内嵌 `<PpmProjectMembersTable projectId embedded onChanged={load} />` + 页头全局 `MemberFormDrawer lockedProjectId=undefined`（显示项目选择）+ 6 维搜索区

**⚠️ 设计偏离（详见 NOTES-1）**：`ql-20260715-012` 将 `/ppm/projects` 的「成员管理」抽屉删除、改为跳转 `/ppm/project-members?project_name=`，偏离 design §3/§9 非目标「不改 /ppm/projects，保持成员管理抽屉原样」及 FR-07「projects 页成员抽屉不回归」的前提。属后续 quick 的 UX 演进（有了独立两级表页后，跳转比抽屉更合理），功能完整、测试通过，记为 NOTE 不阻断。

## 决策覆盖（decisions.md D-001~D-007）

| 决策 | 状态 | verify 证据 |
|---|---|---|
| D-001@v1 负责人推算（role ilike 项目经理取 created_at 最早） | accepted | `service.owner_subq`（ilike+asc+limit1）+ pytest 多 PM 取最早 / 无 PM 空 |
| D-002@v1 后端聚合 summary 接口（避免前端 groupBy） | accepted | `member_summary` + `page_project_member_summary` 端点 + 前端 `pageProjectMemberSummary` 消费真分页 |
| D-003@v1 成员展开行懒加载（复用 project-member 接口） | accepted | group-table `expandedRowRender` 内嵌 `<PpmProjectMembersTable projectId>`，首屏不 N+1 |
| D-004@v1 成员子表账号列（LEFT JOIN users 补 username） | accepted | `page()` outerjoin User + `ProjectMemberResp.username` + 前端 `username?:string\|null` |
| D-005@v1 默认排序不做成员数排序 | accepted | `_MEMBER_SUMMARY_SORT_FIELDS` 白名单无派生列 owner_name/member_count |
| D-006@v1 展开行复用 PpmProjectMembersTable + MemberFormDrawer 共享 | accepted | `export MemberFormDrawer` + expandedRowRender 复用锁定模式 |
| D-007@v1 onChanged 回调刷新 member_count | accepted | `PpmProjectMembersTable.onChanged?.()` + group-table `onChanged={() => void load()}` |

无 P0/P1 unresolved/blocking 决策；无 superseded 决策被下游引用。

## 探针结果

**探针 1（未实现标记扫描）**：对 design §6 文件变更清单的 9 个源码文件 grep `尚未实现|TODO|FIXME|HACK|XXX` → **无匹配** ✅

**探针 2（设计关键词覆盖）**：
- 负责人推算：`ilike "%项目经理%"` + `created_at.asc()` ✅
- 成员数：`func.count()` 标量子查询 ✅
- 排序白名单：`{updated_at, created_at, project_name, project_code}` ✅
- group-table：`expandable`/`expandedRowRender`/`MemberFormDrawer`/`pageProjectMemberSummary`/6 维搜索/全局新增 ✅

**探针 3（Contract 一致性）**：后端 DTO 字段（9 字段 + 6 维筛选 + Field 约束）与前端 `types.ts`（`ProjectMemberSummaryItem` 9 字段 + `ProjectMemberSummaryPageReq` 6 筛选）一一对应；`ProjectMember.username` 前后端类型一致（`str | None` ↔ `string | null`）✅

## 测试结果

| 命令 | 结果 | 说明 |
|---|---|---|
| `pytest app/modules/ppm/project -q` | **30 passed**, 1 warning (11.25s) | 含 task-04 的 9 个 member_summary 测试（聚合分页/6 维筛选/负责人推算多 PM 取最早/无 PM 空/member_count/成员接口 username 回填有用户&无用户）；1 warning 为既存 `errors.py:216 HTTP_422 DeprecationWarning`，与本次无关 |
| `ruff check app/modules/ppm/project` | **All checks passed** | 后端 lint 干净 |
| `pnpm exec tsc --noEmit` | **exit 0** | 前端类型检查通过 |
| `pnpm lint`（全量） | exit 0，0 errors | 仅既存 warning（`__tests__/*`、`stores/kanban.ts`），与本次无关 |
| eslint（本次 5 个变更文件） | **0 errors, 2 warnings** | 见 NOTES-2/3 |
| Docker rebuild 实测 | 已验证（quick 部署） | verify 只读不重复 rebuild；`ql-20260715-013` 成员子表服务端分页已 Docker 实测 |

## 变更风险等级

**contract-required**（API contract + DTO + 前端 client）。

- 触发关键词：`backend`（后端聚合接口 + DTO）。**不触发** daemon/session/lease/lifecycle/state_transition/heartbeat/cross-process/bootstrap/entrypoint。
- 验证强度：单测 + contract test（后端 pytest 覆盖聚合接口契约行为 + 前后端类型契约对照）。已满足。
- **非 integration-critical / deployment-critical** → PASS WITH NOTES 不降级，无需 Runtime Evidence section。

## NOTES（待跟进，不阻断归档）

**NOTES-1（设计偏离，合理演进）**：`ql-20260715-012` 删除 `/ppm/projects` 成员管理抽屉、改为跳转 `/ppm/project-members`（URL 带 `project_name`，GroupTable 首次自动展开匹配项目）。偏离 design §3/§9 非目标与 FR-07 前提（「保持抽屉原样」）。**影响**：design §9 兼容策略所述「projects 抽屉（`<PpmProjectMembersTable projectId />`）不传 onChanged 行为不变」的回归前提已不成立（抽屉已删）。**评估**：属用户后续主动决策的 UX 改进（独立两级表页体验优于抽屉），功能完整、`PpmProjectMembersTable` 的锁定 `projectId` 模式仍被 group-table 展开行复用（D-006 不变），建议 archive 时在模块文档/决策中补记此演进，使 design 与现状一致。

**NOTES-2（lint warning，非阻断）**：`ppm-project-members-group-table.tsx:155` `useCallback` 缺少 `initialProjectName` 依赖（`react-hooks/exhaustive-deps`）。原因：`autoExpandedRef` 仅首次触发自动展开（ql-012），有意不把 `initialProjectName` 列入依赖避免重复展开。属有意为之，可接受。

**NOTES-3（lint warning，非阻断）**：`ppm-project-members-table.tsx:422` `'form' is defined but never used`（`no-unused-vars`）。疑似重构遗留的未使用形参，建议后续清理（下划线前缀 `_form` 或删除）。

## 结论复述

**PASS WITH NOTES** — 实现完整、设计与代码高度一致、自动化测试（后端单测 + contract + 前端类型/lint）全过；3 条 NOTE（1 设计偏离 + 2 lint warning）均不阻断，建议归档时补记 ql-012 演进。可进入 archive。
