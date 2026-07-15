---
author: WhaleFall
created_at: 2026-07-15T10:27:20
scale: large
---

# 设计文档（Design）— /ppm/project-members 页重构（项目→成员两级表）

> 变更 `2026-07-15-project-members-rebuild`
> 原型 `prototype-project-members-rebuild.html`
> 关联 quick `ql-20260715-001-7d2e`（已为平铺表补「所属项目」列，本次在其基础上重构为两级）

## 1. 背景

`/ppm/project-members`（`frontend/src/app/(dashboard)/ppm/project-members/page.tsx`）当前是「以成员为主」的**平铺列表**——每一行是一个成员，靠 `PpmProjectMembersTable` 组件渲染，ql-20260715-001 刚为它补了「所属项目」首列。但它仍是**数据库视角**（成员属于哪个项目），用户实际要的是**业务视角**：「项目有哪些成员」。

用户要求把该页调整为 **Project → Members 两级结构**：一级列表是项目（项目名、负责人、成员数、状态等），成员作为项目的可展开子表。顶部保留全局「添加项目成员」入口（跨项目，需选所属项目）；展开后子表内也能新增成员（项目已锁定）。新增按项目/负责人/成员姓名·账号/角色/状态的多维搜索。后端优先提供按 Project 聚合的接口，避免前端 groupBy；为后续负责人管理/统计/批量导入导出/权限预留扩展。

现状关键代码事实：
- `PpmProjectMembersTable`（`components/ppm-project-members-table.tsx`）被 **2 处复用**：①本平铺页（不传 `projectId`）；②`/ppm/projects` 页「成员管理」抽屉（`projects/page.tsx:173` 传 `projectId`）。它是**前端分页**（`listProjectMembers` 拉全量后 `rows.slice`）。
- 后端成员接口 `GET /api/ppm/project-member`（`router.py:449`）已支持按 `pm_project_id` 过滤 + 真分页，但 `ProjectMemberResp`（`schema.py:177`）只回 `pm_project_id`(UUID)、`user_name`，**无登录账号 username**、无 `project_name`。
- 项目表 `PpmProjectMaintenance`（`model.py:42`）**无「负责人」字段**（只有 `create_name` 创建人），有 `project_status`/`project_type`/`project_code`。
- 成员表 `PpmProjectMember`（`model.py:173`）`role_name` 是**多角色逗号拼接**（如 `"开发经理,项目经理"`，`service.py:452` ilike 匹配），有 `pm_project_id`(FK)、`user_id`(FK→users)、`user_name`、`created_at`。
- 用户表 `User`（`auth/model.py:27`）有 `username`/`email`（均可空）。

## 2. 设计目标

- 把 `/ppm/project-members` 改为「项目→成员」两级可展开表，突出「项目有哪些成员」的业务视角。
- 一级项目表展示：项目名称、项目编号、**负责人**（推算）、**成员数**（聚合）、项目状态、项目类型、更新时间、操作。
- **后端新增按 Project 聚合的 summary 接口**（分页 + member_count + owner_name 推算 + 多维筛选），前端不 groupBy、不 N+1。
- 成员展开行**懒加载**（展开时复用现有 `GET /project-member?pm_project_id=` 拉取）。
- 成员子表显示**登录账号列**（后端成员接口 LEFT JOIN users 补可选 `username`）。
- 两种新增成员入口：页头全局「添加项目成员」（跨项目，选所属项目）+ 展开后子表「新增成员」（项目锁定）。
- 6 维搜索：项目名、项目状态、项目类型、负责人姓名、成员姓名/账号、角色。
- **零 migration**（所有字段已存在，仅查询/聚合方式变）。

## 3. 非目标

- ❌ 不改 `/ppm/projects` 项目页（保持 `PpmResourceTable` + 成员管理抽屉原样）。
- ❌ 不破坏 `PpmProjectMembersTable` 的锁定 `projectId` 模式（projects 抽屉继续复用）；成员 CRUD 业务逻辑（角色多选、选用户联动回填部门/姓名）不变。
- ❌ 不新增数据库表/列，不改列定义（零 migration）。
- ❌ 不支持「按成员数排序」（一级表默认按 `updated_at` 倒序）；派生列 owner_name/member_count 不进排序白名单。
- ❌ 不做批量导入导出 / 权限粒度 / 负责人独立字段（本次仅推算展示，预留后续扩展）。
- ❌ 不改其他 ppm 子域（客户/干系人/计划/看板等）。
- ❌ 不引入新 npm/pip 依赖。

## 4. 拆分判断

单一变更，不拆分、不批量。理由：前后端强耦合（聚合接口 + 两级表 UI 配套，接口字段直接决定前端列），属同一连贯功能；无多角色/跨页流转/低耦合独立模块，不满足拆分条件；非「模板 × 数据」不满足批量模式。多文件适配由 plan 阶段 Wave 分组（后端 → 前端 client/types → 前端组件 → 联调）。

## 5. 总体方案（分 Wave，plan 细化）

| Wave | 内容 | 类型 |
|---|---|---|
| W1 | **后端聚合接口 + 成员账号**：①`schema.py` 新增 `ProjectMemberSummaryItem`/`ProjectMemberSummaryPageReq`，`ProjectMemberResp` 加可选 `username`；②`service.py` `ProjectMaintenanceService.member_summary()`（子查询派生 member_count/owner_name + 多维 EXISTS 筛选 + 分页排序），`ProjectMemberService.page()` LEFT JOIN users 带 username；③`router.py` 新增 `GET /project-maintenance/member-summary` | 核心 |
| W2 | **前端 client/types**：`types.ts` 新增 `ProjectMemberSummaryItem`/`ProjectMemberSummaryPageReq`，`ProjectMember` 加可选 `username`；`project.ts` 新增 `pageProjectMemberSummary()` | 核心 |
| W3 | **前端组件重构**：①`ppm-project-members-table.tsx` `export MemberFormDrawer`（供全局新增复用）+ 加可选 `onChanged` 回调；②新增 `ppm-project-members-group-table.tsx`（搜索区 + 一级 antd `Table` expandable + 页头全局新增，展开行内嵌 `<PpmProjectMembersTable projectId showToolbar onChanged>`）；③`project-members/page.tsx` 改渲染 `PpmProjectMembersGroupTable` | 核心 |
| W4 | **联调验收**：`tsc --noEmit` + `pnpm lint` + 后端 pytest（聚合接口/负责人推算）+ Docker rebuild 实测（两级展开/两种新增/6 维搜索/成员数实时更新/projects 抽屉不回归） | 收尾 |

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | `backend/app/modules/ppm/project/schema.py` | 新增 `ProjectMemberSummaryItem`、`ProjectMemberSummaryPageReq`；`ProjectMemberResp` 加 `username: str \| None = None` |
| 修改 | `backend/app/modules/ppm/project/service.py` | `ProjectMaintenanceService.member_summary(req)`（派生聚合 + 多维筛选）；`ProjectMemberService.page()` LEFT JOIN `User` 取 `username`；新增 `_MEMBER_SUMMARY_SORT_FIELDS` 白名单 |
| 修改 | `backend/app/modules/ppm/project/router.py` | 新增 `GET /project-maintenance/member-summary`（声明在 `{entity_id}` GET 之前，见 router.py:134 注释的路径优先级约定） |
| 新增 | `backend/app/modules/ppm/project/tests/test_member_summary.py` | 聚合接口分页/6 维筛选/负责人推算/member_count/成员接口 username 的 pytest（task-04） |
| 修改 | `frontend/src/lib/ppm/types.ts` | 新增 `ProjectMemberSummaryItem`、`ProjectMemberSummaryPageReq`；`ProjectMember` 加 `username?: string \| null` |
| 修改 | `frontend/src/lib/ppm/project.ts` | 新增 `pageProjectMemberSummary(params)` |
| 修改 | `frontend/src/app/(dashboard)/ppm/project-members/page.tsx` | 改为渲染 `<PpmProjectMembersGroupTable />`（保留 PageContainer/PageHeader） |
| 新增 | `frontend/src/components/ppm-project-members-group-table.tsx` | 两级展开表组件（搜索区 + 一级项目表 expandable + 全局新增抽屉） |
| 修改 | `frontend/src/components/ppm-project-members-table.tsx` | `export MemberFormDrawer`（共享）；props 加 `onChanged?: () => void`（CRUD 成功后调用）+ `embedded?: boolean`（嵌入式紧凑模式：去 SectionCard 外壳、scroll 只 x 不限 y、保留新增按钮，供两级表展开行用，见 G1） |
| 新增 | `.sillyspec/changes/2026-07-15-project-members-rebuild/prototype-project-members-rebuild.html` | 线框原型（已生成） |

> 无新增数据库表/列、无新增依赖。

## 7. 接口定义（关键签名变更）

### 7.1 后端 — 新增聚合接口

```python
# schema.py —— 新增
class ProjectMemberSummaryItem(PydanticModel):
    """项目成员聚合行（派生，非表实体）。"""
    id: uuid.UUID                       # = PpmProjectMaintenance.id
    project_name: str | None
    project_code: str
    project_status: str | None
    project_type: str | None
    company_name: str | None
    owner_name: str | None              # 推算：该项目 role_name ilike '%项目经理%' 的成员，取 created_at 最早；无则 None
    member_count: int                   # 派生：该项目 ppm_project_member 行数
    updated_at: datetime

class ProjectMemberSummaryPageReq(PydanticModel):
    page: int = Field(default=1, ge=1)
    page_size: int = Field(default=20, ge=1, le=200)
    order_by: str | None = Field(default=None)
    order: str = Field(default="desc")
    project_name: str | None = None      # 项目名模糊
    project_status: str | None = None    # 项目状态精确
    project_type: str | None = None      # 项目类型精确
    owner_name: str | None = None        # 负责人姓名模糊（EXISTS：项目下有 role 含项目经理 且 user_name 匹配）
    member_keyword: str | None = None    # 成员姓名/账号模糊（EXISTS：成员 user_name 或 users.username 匹配）
    role_name: str | None = None         # 角色模糊（EXISTS：成员 role_name ilike）
```

```python
# router.py —— 新增（声明在 /{entity_id} GET 之前，路径优先级见 router.py:134 注释）
@router.get(
    "/project-maintenance/member-summary",
    response_model=Page[ProjectMemberSummaryItem],
)
async def page_project_member_summary(
    session: SessionDep,
    user: Annotated[User, _PROJECT_READ],
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=200),
    order_by: str | None = Query(None),
    order: str = Query("desc"),
    project_name: str | None = Query(None),
    project_status: str | None = Query(None),
    project_type: str | None = Query(None),
    owner_name: str | None = Query(None),
    member_keyword: str | None = Query(None),
    role_name: str | None = Query(None),
) -> Page[ProjectMemberSummaryItem]:
    req = ProjectMemberSummaryPageReq(...)
    s = svc.ProjectMaintenanceService(session)
    result = await s.member_summary(req)
    return Page.build(items=result.items, total=result.total, req=_to_page_req(req))
```

### 7.2 后端 — service 聚合查询核心（负责人推算 + member_count + 多维 EXISTS）

```python
# service.py —— ProjectMaintenanceService.member_summary()
# 子查询：负责人姓名（该项目 role 含项目经理 的成员，取 created_at 最早）
_owner_subq = (
    select(PpmProjectMember.user_name)
    .where(
        PpmProjectMember.pm_project_id == PpmProjectMaintenance.id,
        PpmProjectMember.role_name.ilike("%项目经理%"),
    )
    .order_by(PpmProjectMember.created_at.asc())
    .limit(1)
    .scalar_subquery()
)
# 子查询：成员数
_count_subq = (
    select(func.count())
    .select_from(PpmProjectMember)
    .where(PpmProjectMember.pm_project_id == PpmProjectMaintenance.id)
    .scalar_subquery()
)
# 主查询：项目字段 + 两个派生列
stmt = select(
    PpmProjectMaintenance.id,
    PpmProjectMaintenance.project_name,
    PpmProjectMaintenance.project_code,
    PpmProjectMaintenance.project_status,
    PpmProjectMaintenance.project_type,
    PpmProjectMaintenance.company_name,
    _owner_subq.label("owner_name"),
    _count_subq.label("member_count"),
    PpmProjectMaintenance.updated_at,
)
# 多维筛选（EXISTS）：owner_name / member_keyword / role_name
#   owner_name：项目下 ∃ 成员 role ilike 项目经理 且 user_name like owner_name
#   member_keyword：项目下 ∃ 成员 user_name like kw OR users.username like kw（需 join users）
#   role_name：项目下 ∃ 成员 role_name ilike
total = await count_total(self._session, stmt)          # subquery-count，兼容派生列
stmt = apply_sort(stmt, PpmProjectMaintenance, req.order_by,
                  _MEMBER_SUMMARY_SORT_FIELDS, req.order)  # 白名单：updated_at/created_at/project_name/project_code
stmt = apply_pagination(stmt, _to_page_req(req))
# 映射每行 → ProjectMemberSummaryItem(owner_name=None 兜底, member_count=int)
```

> `_MEMBER_SUMMARY_SORT_FIELDS = {"updated_at","created_at","project_name","project_code"}`。派生列 `owner_name`/`member_count` 不进白名单（D-005，不做成员数排序）。`apply_sort` 对列不在白名单时静默忽略（`crud.py:164`）。

### 7.3 后端 — 成员接口补 username

```python
# service.py —— ProjectMemberService.page() 改 LEFT JOIN users
from app.modules.auth.model import User
stmt = (
    select(PpmProjectMember, User.username)
    .outerjoin(User, User.id == PpmProjectMember.user_id)
)
# ...既有 pm_project_id/user_id/role_name 筛选 + count_total + sort + pagination...
# 结果映射：ProjectMemberResp(..., username=row.username)
```

```python
# schema.py —— ProjectMemberResp 加可选字段（向后兼容）
class ProjectMemberResp(PydanticModel):
    ...
    username: str | None = None          # 新增：登录账号（LEFT JOIN users），可空
```

### 7.4 前端 — client + types

```ts
// types.ts —— 新增
export interface ProjectMemberSummaryItem {
  id: string;
  project_name: string | null;
  project_code: string;
  project_status: string | null;
  project_type: string | null;
  company_name: string | null;
  owner_name: string | null;
  member_count: number;
  updated_at: string;
}
export interface ProjectMemberSummaryPageReq extends PageReq {
  project_name?: string | null;
  project_status?: string | null;
  project_type?: string | null;
  owner_name?: string | null;
  member_keyword?: string | null;
  role_name?: string | null;
}
// ProjectMember 加：username?: string | null;
```

```ts
// project.ts —— 新增
export async function pageProjectMemberSummary(
  params?: ProjectMemberSummaryPageReq,
): Promise<PageResp<ProjectMemberSummaryItem>> {
  return apiFetch<PageResp<ProjectMemberSummaryItem>>(
    "/api/ppm/project-maintenance/member-summary",
    { query: params as Record<string, string | number | undefined> | undefined },
  );
}
```

### 7.5 前端 — 组件

```ts
// ppm-project-members-table.tsx —— 改动（最小）
// 1) export 原 MemberFormDrawer（供 GroupTable 全局新增复用，逻辑不变）
export function MemberFormDrawer(props: { mode; row?; lockedProjectId?; canWrite; onClose; onSubmit }) {...}
// 2) props 加 onChanged + embedded：
export interface PpmProjectMembersTableProps {
  projectId?: string;
  canWrite?: boolean;
  refreshKey?: unknown;
  showToolbar?: boolean;
  onChanged?: () => void;   // 新增：成员 create/update/delete 成功后回调（供父组件刷新 member_count）
  embedded?: boolean;       // 新增(G1)：嵌入式紧凑模式——去 SectionCard 外壳、scroll 只 {x:"max-content"}（无 y），
                            //   保留新增成员按钮（canWrite 时）。两级表展开行用此模式；现有平铺页/抽屉不传，行为不变。
}
// handleSubmit / handleConfirmDelete 成功后：onChanged?.();
// body 渲染分支：embedded=true 时跳过 SectionCard 包裹，Table scroll 用 {x:"max-content"}（去掉 calc(100vh-430px) 的 y）。
```

```ts
// ppm-project-members-group-table.tsx —— 新增组件骨架
export function PpmProjectMembersGroupTable() {
  // state：summary 分页结果、搜索表单、展开行 keys、全局新增抽屉开关
  // load：pageProjectMemberSummary(params) 带搜索条件 + 真分页
  // 一级 antd Table：columns(项目名/编号/负责人/成员数/状态/类型/更新时间/操作)
  //   expandable.expandedRowRender = (record) => (
  //     <PpmProjectMembersTable projectId={record.id} embedded onChanged={load} />
  //   )   // 复用锁定模式成员表（含新增/编辑/删除），embedded 紧凑渲染去 vh scroll(G1)；onChanged=重新拉 summary 刷新 member_count
  // 页头：全局「+ 添加项目成员」→ <MemberFormDrawer mode="create" lockedProjectId={undefined} .../>
  //   （表单显示「所属项目」选择，跨项目；提交走 createProjectMember + load）
  // 搜索区：6 字段（项目名/状态/类型/负责人/成员姓名·账号/角色）+ 查询/重置
  // 枚举复用 projects/page.tsx 的 PROJECT_TYPE_OPTIONS/PROJECT_STATUS_OPTIONS（对齐 DB code 1/2/3）
}
```

## 8. 数据模型

**零 migration**。涉及表均已存在，字段齐全，仅查询方式变：

| 表 | 用到的现有字段 | 本次角色 |
|---|---|---|
| `ppm_project_maintenance` | id, project_name, project_code, project_status, project_type, company_name, updated_at, created_at | 一级行主体 |
| `ppm_project_member` | pm_project_id(FK, 已有索引 `ix_ppm_project_member_project`), user_id(FK), user_name, role_name, created_at | member_count 子查询 + owner_name 推算子查询 + EXISTS 筛选 |
| `users` | id, username | 成员接口 LEFT JOIN 取 username（账号列）；member_keyword 筛选 users.username |

> 无新增表/列/索引。`ix_ppm_project_member_project` 已覆盖按项目聚合的访问路径。

## 9. 兼容策略（brownfield）

- 项目未上线，无版本兼容负担（CLAUDE.md 规则 11）；允许重置测试数据。
- `ProjectMemberResp.username` 为**新增可选字段**（`None` 默认），现有前端 `ProjectMember` 类型加可选 `username?`，不传/无值时子表账号列显示「—」，**对 projects 页成员抽屉等现有消费方完全向后兼容**。
- `PpmProjectMembersTable` 改动为**纯增量**：`export MemberFormDrawer`（不改其逻辑）、新增可选 `onChanged`（不传则不回调，行为同现状）。projects 抽屉（`<PpmProjectMembersTable projectId />`）不传 `onChanged`，行为不变。
- `/ppm/projects` 项目页、客户/干系人页**零改动**。
- 回退路径：聚合接口与两级表是**新增页形态**，出问题可回退到 git 历史的平铺表（ql-20260715-001 状态）；成员接口的 LEFT JOIN 若致性能/兼容问题，可回退为不带 username（账号列降级为「—」）。

## 10. 风险登记

| 编号 | 风险 | 等级 | 应对 |
|---|---|---|---|
| R-01 | 负责人推算依赖 `role_name` 字符串含「项目经理」（ilike），角色命名不规范/拼写差异会漏判 | P2 | 用户已确认该口径（D-001）；execute 实测多项目经理取最早、无项目经理显「—」；后续可推独立字段 |
| R-02 | 聚合接口 owner_name/member_keyword/role_name 用 EXISTS 子查询 + member_count 标量子查询，项目/成员量大时性能 | P3 | `ix_ppm_project_member_project` 已覆盖；summary 默认 page_size=20；必要时 execute 验证 EXPLAIN |
| R-03 | 展开行内嵌 `PpmProjectMembersTable` 是前端分页（拉该项目全量成员后 slice），单项目成员极多时偏慢 | P3 | 成员数通常不大；PpmProjectMembersTable 已有分页器；超大项目后续可改懒加载真分页 |
| R-04 | `PpmProjectMembersTable.page()` 改 LEFT JOIN users 影响现有调用方（projects 抽屉） | P2 | username 为可选字段，映射 None 兜底；execute 跑 members 相关测试 + 抽屉回归 |
| R-05 | 展开行内嵌成员表的 SectionCard 外壳 + `scroll y: calc(100vh-430px)` 在展开区内产生视口高度滚动框，视觉嵌套异常（G1） | P2 | PpmProjectMembersTable 加 `embedded` 紧凑模式（去 SectionCard、scroll 只 x 不限 y、保留新增按钮）；展开行用 `embedded`；Docker 实测核对 |
| R-06 | Drawer 嵌套：projects 抽屉→展开成员→编辑成员→MemberFormDrawer（最多两层 Drawer） | P2 | antd Drawer z-index 自动叠加、ESC 关最上层；本页（非抽屉）展开→编辑只一层 Drawer，无嵌套问题 |
| R-07 | `member_keyword` 筛选 users.username 需 EXISTS 子查询内 join users，user_id 孤立（无对应用户）时 | P3 | 用 LEFT/INNER join + username 可空兜底；ilike NULL 不命中（SQL 标准） |

## 11. 决策追踪

见 `decisions.md`。当前版本决策均被本设计覆盖：

- D-001@v1（负责人推算：role_name ilike 项目经理，取 created_at 最早；零 migration）→ §1/§7.2/§10 R-01
- D-002@v1（后端聚合 summary 接口，避免前端 groupBy）→ §2/§5 W1/§7.1/§7.2
- D-003@v1（成员展开行懒加载，复用 GET /project-member?pm_project_id=）→ §2/§5 W3/§7.5
- D-004@v1（成员子表显示账号列，ProjectMemberResp LEFT JOIN users 补 username）→ §2/§7.3/§10 R-04
- D-005@v1（一级表默认 updated_at 排序，不做成员数排序）→ §3/§7.2
- D-006@v1（展开行复用 PpmProjectMembersTable 渲染成员子表，最小改动）→ §5 W3/§7.5/§10 R-03/R-05
- D-007@v1（PpmProjectMembersTable 加 onChanged 回调，增删后刷新 member_count）→ §7.5

无未解决决策，无剩余风险（R-01~R-07 均有对策）。

## 12. 自审

| 检查项 | 结果 |
|---|---|
| 需求覆盖（两级表/聚合接口/懒加载/账号列/两种新增/6 维搜索/零 migration） | ✅ §2 全覆盖 |
| 非目标清晰（不改 projects 页/不破坏锁定模式/不做成员数排序/不做批量权限） | ✅ §3 |
| 约束一致（ppm CRUD 复用 `count_total`/`apply_sort`/`apply_pagination`；router 路径优先级；前端 `apiFetch`/`PageResp`） | ✅ 沿用现有 helper 与约定 |
| 真实性（表名/字段名/类名/方法名/文件路径） | ✅ 均来自真实代码（model.py/schema.py/service.py/router.py/auth/model.py/page.tsx/ppm-project-members-table.tsx/project.ts/types.ts） |
| YAGNI | ✅ 不新增表/列/依赖；派生列不进排序；批量/权限/独立负责人字段明确列为非目标 |
| 接口定义完整（schema/service/router/前端 client/types/组件骨架） | ✅ §7 |
| 数据模型 | ✅ §8（零 migration，列现有字段） |
| 兼容/回退（brownfield） | ✅ §9（username/onChanged 纯增量可选；可回退平铺表） |
| 风险识别 | ✅ §10 R-01~R-07 |
| 决策追踪 | ✅ §11（D-001~D-007 全引用） |
| 验收标准具体可测 | ✅ 见下 |
| 生命周期契约表 | ⬜ 不适用（无 session/lease/daemon/lifecycle/state transition 关键词） |

### 12.1 Design Grill 交叉审查修正（Step 12）

| 编号 | 问题 | 结论 |
|---|---|---|
| G1 | 展开行内嵌 `PpmProjectMembersTable showToolbar=true` 时，组件 `scroll={{y:"calc(100vh-430px)"}}`（`ppm-project-members-table.tsx:328`）会在展开区产生基于视口的固定高度滚动框，嵌套视觉异常 | ✅ 已修正：新增 `embedded` 紧凑模式（§7.5），展开行用 `embedded`（去 SectionCard + 去 y scroll + 保留新增按钮）；R-05 升级 P2 |
| G2 | `apply_sort(model=PpmProjectMaintenance)` 用于「多列 + 派生 label」的 select 是否可用 | ✅ 确认可用：白名单内字段 `getattr(model, field)` 得列对象，`stmt.order_by()` 合法；派生列不在白名单被静默忽略（`crud.py:164`）；count_total 用 subquery 包裹，order_by 不影响计数（`crud.py:189`） |
| G3 | owner_name/member_count 标量子查询在主 select 列表，count_total 二次执行是否正确 | ✅ 功能正确（subquery 包裹后 count(*)）；性能见 R-02（page_size=20 可接受） |
| G4 | `MemberFormDrawer` export 共享给 GroupTable 全局新增，GroupTable 需自实现 onSubmit（createProjectMember + load），与 PpmProjectMembersTable.handleSubmit 少量重复 | ✅ 可接受（DRY 权衡）；execute 时 GroupTable 实现 onSubmit，lockedProjectId=undefined 显示项目选择（`ppm-project-members-table.tsx:483` showProjectPicker 逻辑兼容） |
| G5 | `ProjectMember.username` 前端类型与后端 `str \| None` 一致性 | ✅ 前端用 `username?: string \| null`（types.ts 约定 `T \| null`），向后兼容 |
| G6 | 一级 antd Table expandable + 真分页，分页切换时展开行状态 | ⚠️ execute 确认项：用受控 `expandedRowKeys`（翻页保留）或接受翻页重置；默认翻页重置可接受 |
| G7 | `MemberFormDrawer` 是否自包含可 export（依赖 MemberForm/EMPTY_FORM） | ✅ 自包含：接收 onSubmit prop，内部不直接调 API；MemberForm/EMPTY_FORM 保持模块内不暴露 |

**验收标准**（verify 对照）：
1. 进入 `/ppm/project-members` 看到项目级列表（项目名/编号/负责人/成员数/状态/类型/更新时间/操作），非成员平铺。
2. 点项目行展开，懒加载并显示该项目成员子表（姓名/**账号**/联系方式/部门/角色/操作）。
3. 6 维搜索（项目名/状态/类型/负责人/成员姓名·账号/角色）各自生效，结果只命中匹配项目。
4. 页头「+ 添加项目成员」打开抽屉、需选所属项目，提交后成员入对应项目。
5. 展开后子表「+ 新增成员」项目已锁定（不显示项目选择），提交后入当前项目。
6. 编辑/删除成员正常，且**成员数实时更新**（onChanged 刷新 summary）。
7. 负责人推算正确：有多项目经理取 `created_at` 最早；无项目经理显「—」。
8. `/ppm/projects` 页成员管理抽屉功能**不回归**（CRUD 正常、username 兼容）。
9. 后端 pytest：聚合接口分页/筛选/负责人推算/member_count 正确；成员接口 username 回填。
10. `tsc --noEmit` + `pnpm lint` 通过；Docker rebuild 后实测核心交互对照原型。
