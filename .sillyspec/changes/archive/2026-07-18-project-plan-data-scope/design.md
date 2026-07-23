---
author: qinyi
created_at: 2026-07-18 17:26:33
change: 2026-07-18-project-plan-data-scope
---

# 项目计划 / 项目维护 数据权限范围 设计文档

> 「项目计划」窗口产出，与并行窗口 ppm-data-scope（任务计划/问题清单）为不同模块。

## 1. 背景与目标

PPM「项目计划」(`GET /api/ppm/project-plan`) 与「项目维护」(`GET /api/ppm/project`) 列表当前对任何持功能权限的用户返回全部数据（各 20 条），无按人/部门的数据范围过滤。本变更新增数据范围控制：按当前登录用户身份（超级管理员 / 部门经理 / 项目经理）限定可见的项目计划与项目，其他用户看不到任何数据。

## 2. 需求（已确认）

| 身份 | 判定 | 可见范围 |
|---|---|---|
| 超级管理员 | 持 `super_admin` 角色 OR `is_platform_admin=true` | 全部 |
| 部门经理 | 持 `DEPTBOSS` 角色 | `UserOrganization` 关联部门 + 各自下级部门（子树）的全部项目 |
| 项目经理 | 持 `XMJL` 角色 | `PsProjectPlan.project_manager_id == 本人` |
| 其他 | 无以上角色 | 空 |

- 多身份取并集。
- 覆盖：项目计划（列表/导出/详情）+ 项目维护列表。
- 项目挂部门：`PpmProjectMaintenance` 新增 `organization_id`，现有 20 项目刷到项目二部（`9f968a5f-a9ef-55ae-9488-bdc20205d210`，code `dept_103`）。

## 3. 现状（真实代码依据）

| 项 | 位置 | 说明 |
|---|---|---|
| 项目计划列表 | `plan/router.py:393` → `PlanService.list_ps_project_plans`（`plan/service.py:391`） | 零范围过滤 |
| 项目计划导出 | `plan/service.py:977` `list_ps_project_plans_for_export` | 全量 |
| 项目计划详情三联表 | `plan/service.py:683` `get_project_plan_three_level` | 无授权校验 |
| 项目维护列表 | `project/router.py` → `ProjectMaintenanceService.page`（`project/service.py:240`） | 零范围过滤 |
| 超级管理员判定 | `User.is_platform_admin`（`auth/model.py:54`）；rbac 短路 `rbac.py:101` | |
| RBAC 角色 | `Role`（`auth/model.py:131`）+ `UserRole`（`admin/model.py:111`） | role key 唯一 |
| 部门（组织） | `Organization`（`admin/model.py:37`，`parent_id` 层级） | |
| 用户↔部门 | `UserOrganization`（`admin/model.py:83`，多对多） | |
| 子树展开 | `_descendant_ids`（`admin/organizations_service.py:51`） | SQLite/PG 兼容 |
| 按组织含子树过滤参考 | `admin/users_service.py:98` | |
| 项目经理字段 | `PsProjectPlan.project_manager_id`（`plan/model.py:195`） | |
| 项目计划→项目 | `PsProjectPlan.project_id` → `PpmProjectMaintenance.id` | |
| 项目主表当前字段 | `PpmProjectMaintenance`（`project/model.py:42`） | **无部门字段** |

DB 实测（2026-07-18）：20 项目 / 20 项目计划；`super_admin` role 5 人、`DEPTBOSS` 1 人（修京廷）、`XMJL` 5 人；`is_platform_admin=true` 仅 admin2（与 super_admin role 不重合）。

## 4. 数据模型变更

`PpmProjectMaintenance`（`project/model.py:42`）新增字段（新增）：

- `organization_id: UUID | None`，FK → `organizations.id`，nullable，索引。

alembic migration（新增）：
- 加列 `organization_id`（UUID，nullable，索引）。
- 数据初始化：`UPDATE ppm_project_maintenance SET organization_id = '9f968a5f-a9ef-55ae-9488-bdc20205d210'`。
- `down_revision` 接当前 alembic head（**开工前 `cd backend && uv run alembic heads` 确认单 head**）。
- `downgrade`：删列。

## 5. 技术设计（方案 A：依赖项解析 + service 注入）

### 5.1 DataScope 与身份解析依赖项（新增 `app/modules/ppm/data_scope.py`）

```python
@dataclass(frozen=True)
class DataScope:
    is_full: bool
    dept_org_ids: frozenset[uuid.UUID]
    pm_user_id: uuid.UUID | None

SUPER_ADMIN_KEY = "super_admin"
DEPT_BOSS_KEY = "DEPTBOSS"
PROJECT_MANAGER_KEY = "XMJL"

async def get_user_role_keys(session, user) -> set[str]: ...      # JOIN user_roles + roles
async def _user_org_subtree(session, user) -> frozenset[uuid.UUID]: ...  # UserOrganization + _descendant_ids

async def get_ppm_data_scope(user, session) -> DataScope:  # FastAPI 依赖项
    roles = await get_user_role_keys(session, user)
    if SUPER_ADMIN_KEY in roles or user.is_platform_admin:   # D-002@v1
        return DataScope(is_full=True, dept_org_ids=frozenset(), pm_user_id=None)
    dept_org_ids = await _user_org_subtree(session, user) if DEPT_BOSS_KEY in roles else frozenset()
    pm_user_id = user.id if PROJECT_MANAGER_KEY in roles else None
    return DataScope(is_full=False, dept_org_ids=dept_org_ids, pm_user_id=pm_user_id)
```

### 5.2 service where 注入

**项目计划（列表 + 导出）**：
```python
if not scope.is_full:
    clauses = []
    if scope.dept_org_ids:
        clauses.append(PpmProjectMaintenance.organization_id.in_(scope.dept_org_ids))
    if scope.pm_user_id is not None:
        clauses.append(PsProjectPlan.project_manager_id == scope.pm_user_id)
    if clauses:
        stmt = stmt.join(PpmProjectMaintenance,
                         PpmProjectMaintenance.id == PsProjectPlan.project_id).where(or_(*clauses))
    else:
        stmt = stmt.where(false())   # 无身份 → 空集
```

**项目计划详情三联表**：先按范围校验 `plan_id` 是否可见，不可见 → `raise HTTPException(403)`。

**项目维护列表**：
```python
if not scope.is_full:
    clauses = []
    if scope.dept_org_ids:
        clauses.append(PpmProjectMaintenance.organization_id.in_(scope.dept_org_ids))
    if scope.pm_user_id is not None:    # D-008@v1 反查
        pm_projects = select(PsProjectPlan.project_id).where(PsProjectPlan.project_manager_id == scope.pm_user_id)
        clauses.append(PpmProjectMaintenance.id.in_(pm_projects))
    where = or_(*clauses) if clauses else false()
```

### 5.3 router 接依赖项

- `plan/router.py` 列表/导出/详情 + `project/router.py` page 加 `scope: Annotated[DataScope, Depends(get_ppm_data_scope)]`。
- `require_permission_any(PPM_PLAN_READ/PPM_PROJECT_READ)` 保留（D-009@v1 正交）。

## 6. 验收标准

- **AC-1**：`super_admin` 用户 GET `/api/ppm/project-plan` 返回全部 20 条。
- **AC-2**：`DEPTBOSS` 用户（修京廷）返回其部门+子部门的项目计划。
- **AC-3**：`XMJL` 用户（覃艺）只返回 `project_manager_id == 覃艺` 的。
- **AC-4**：无角色用户返回空。
- **AC-5**：修京廷（DEPTBOSS+XMJL）返回部门范围 ∪ 自己负责的（并集）。
- **AC-6**：详情三联表越权 → 403。
- **AC-7**：项目维护列表按 AC-1~5 同规则过滤。
- **AC-8**：migration 后 20 项目 `organization_id` 全 = 项目二部。
- **AC-9**：`admin2`（`is_platform_admin`）返回全部（兜底）。

## 7. 非目标

- 不改前端；不新建角色；不做项目成员表 role_name 维度；不覆盖 problem/kanban/task（task 在并行窗口）。

## 8. 风险与对策

| 风险 | 对策 |
|---|---|
| alembic 多 head | 开工前 `alembic heads` 确认单 head |
| `pm_user_id == None` 误命中 | 按 `is not None` 拼分支 |
| `in_(空集)` 方言差异 | 空集不拼 `in_`；全空 → `where(false())` |
| 项目维护 pm 反查性能 | 20 条无虞；YAGNI |
| 刷数据写死 UUID | 未上线可重置；注释标明 |

## 9. 回退

- migration `downgrade` 删列；revert router scope 依赖 + service scope 参数；可 `down -v` 重置。

## 生命周期契约

本次不涉及 session/lease/agent_run/daemon/lifecycle/claim/heartbeat，无生命周期契约表需求。
