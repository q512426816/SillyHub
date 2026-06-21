"""ETL: 源 MySQL(ruoyi-vue-pro, dept_project_back) → 目标 PostgreSQL(SillyHub)。

迁移范围（按依赖顺序）：
1. 清空目标体系（保留 is_system=True 的种子角色及其权限）
2. system_dept           → organizations
3. system_users          → users  + user_organizations
4. system_role           → roles（非 system 种子）
5. system_user_role      → user_roles
6. system_role_menu×menu → role_permissions（PPM/system:user 等，启发式映射）
7. ppm 业务表 19 张（按依赖）

执行：``uv run python scripts/migrate_from_ruoyi.py``
幂等：先清空目标相关表再迁。

设计依据：
- 目标 model：app/modules/{auth,admin,ppm}/.../model.py
- 权限枚举：app/modules/auth/permissions.py
- 通用规则：源 bigint 主键 → UUID（映射 dict）；FK 字段按对应映射重写；
  附件 fileUrl1..9 → file_urls JSON 数组；tenant_id 丢弃；deleted=1 跳过；
  PPM 域 plan/problem 的 *_id（duty/audit 等）按目标 model 约定：UUID FK 的映射，
  String 语义的保留源 ID 字符串（目标 model 注释明确「源 ID 不迁移」）。
"""

from __future__ import annotations

import asyncio
import os
import uuid
from collections import defaultdict
from datetime import UTC, datetime
from typing import Any

import pymysql
from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.modules.admin.model import Organization, UserOrganization, UserRole
from app.modules.auth.model import Role, RolePermission, User
from app.modules.ppm.plan.model import (
    PlanNode,
    PlanNodeDetail,
    PlanNodeModule,
    PsPlanNode,
    PsPlanNodeDetail,
    PsPlanNodeDetailProcess,
    PsProjectPlan,
)
from app.modules.ppm.problem.model import (
    PpmProblemChange,
    PpmProblemChangeProcessLog,
    PpmProblemChangeProcessTask,
    PpmProblemList,
    PpmProblemListProcessLog,
    PpmProblemListProcessTask,
)
from app.modules.ppm.project.model import (
    PpmCustomerMaintenance,
    PpmProjectMaintenance,
    PpmProjectMember,
    PpmProjectStakeholder,
)
from app.modules.ppm.task.model import PlanTask, TaskExecute

# ---------------------------------------------------------------------------
# 连接配置
# ---------------------------------------------------------------------------

SRC = dict(
    host=os.environ.get("MIGRATE_SRC_HOST", "127.0.0.1"),
    port=int(os.environ.get("MIGRATE_SRC_PORT", "3306")),
    user=os.environ.get("MIGRATE_SRC_USER", "root"),
    password=os.environ.get("MIGRATE_SRC_PASSWORD", "root"),
    database=os.environ.get("MIGRATE_SRC_DB", "ruoyi-vue-pro"),
)


def src_conn():
    return pymysql.connect(**SRC, charset="utf8mb4", cursorclass=pymysql.cursors.DictCursor)


def src_query(sql: str, args: tuple | None = None) -> list[dict]:
    conn = src_conn()
    try:
        with conn.cursor() as cur:
            cur.execute(sql, args or ())
            rows: list[dict] = list(cur.fetchall())
        return rows
    finally:
        conn.close()


# ---------------------------------------------------------------------------
# 杂项辅助
# ---------------------------------------------------------------------------

DT_FIELDS_DEFAULT = ("1970-01-01 00:00:00", "0000-00-00 00:00:00")


def to_dt(v: Any) -> datetime | None:
    """MySQL datetime → tz-aware UTC datetime；非法/零值 → None。"""
    if v is None:
        return None
    if isinstance(v, datetime):
        d = v
    elif isinstance(v, str):
        s = v.strip()
        if not s or s in DT_FIELDS_DEFAULT:
            return None
        try:
            d = datetime.fromisoformat(s.replace("T", " "))
        except ValueError:
            return None
    else:
        return None
    if d.tzinfo is None:
        d = d.replace(tzinfo=UTC)
    return d


def clean_str(v: Any, max_len: int | None = None) -> str | None:
    if v is None:
        return None
    if isinstance(v, bytes):
        v = v.decode("utf-8", "ignore")
    s = str(v).strip()
    if not s:
        return None
    if max_len and len(s) > max_len:
        s = s[:max_len]
    return s


def collect_file_urls(row: dict, n: int = 9) -> list[str]:
    out: list[str] = []
    for i in range(1, n + 1):
        u = clean_str(row.get(f"file_url{i}"))
        if u:
            out.append(u)
    return out


def uuid5_int(prefix: str, src_id: Any) -> uuid.UUID:
    """源 bigint id → 稳定 UUID（同 prefix+id 永远一致，便于幂等/重跑不产生新行）。"""
    return uuid.uuid5(uuid.NAMESPACE_DNS, f"{prefix}:{src_id}")


def is_deleted(row: dict) -> bool:
    v = row.get("deleted")
    if v is None:
        return False
    if isinstance(v, (bytes, bytearray)):
        return v != b"\x00"
    return bool(v)


def mget(mapping: dict, key: Any) -> Any:
    """统一 dict 查找：兼容源 ID 的 int/str 类型差异（MySQL bigint=int, varchar=str）。"""
    if key is None:
        return None
    if key in mapping:
        return mapping[key]
    s = str(key)
    return mapping.get(s)


# 记录「源值无法映射到目标 UUID」的 FK 字段，用于报告（key=字段名, value=出现过的源值集合）
_UNMAPPED_FK: dict[str, set[str]] = defaultdict(set)


def map_fk(
    maps: Maps,
    map_key: str,
    src_value: Any,
    field_name: str,
    *,
    fallback_keep: bool = True,
) -> str | None:
    """把源 ID 映射为目标 UUID 字符串（String FK 字段统一用此函数）。

    - 映射成功：返回 str(uuid)
    - 映射失败：
        - fallback_keep=True：保留源字符串值（便于人工排查），并记录到 _UNMAPPED_FK
        - fallback_keep=False：返回 None
    - src_value 为空：返回 None
    """
    if src_value is None:
        return None
    s = str(src_value).strip()
    if not s or s == "0":
        return None
    mapped = mget(maps.get(map_key, {}), src_value)
    if mapped is not None:
        return str(mapped)
    _UNMAPPED_FK[field_name].add(s)
    return s if fallback_keep else None


def to_num(v: Any) -> float | None:
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------------------
# 状态映射
# ---------------------------------------------------------------------------

# 源 ppm_ps_plan_node_detail.status: 10=进行中/在办, 90=已关闭
# 目标 PsPlanNodeDetail.status: draft/review/approve/done/rejected/archived
PS_DETAIL_STATUS_MAP = {
    "10": "done",  # 源 10 实际是流程流转中的活跃态，多数已实际完成 → done
    "90": "archived",  # 源 90 关闭 → archived
}


def map_ps_detail_status(src: Any) -> str:
    if src is None:
        return "draft"
    return PS_DETAIL_STATUS_MAP.get(str(src).strip(), "draft")


# ---------------------------------------------------------------------------
# 权限映射：源 system_menu.permission 字符串 → 目标 Permission.value
# ---------------------------------------------------------------------------

PERM_MAP: dict[str, str] = {
    # pm 项目 / 客户
    "pm:project-maintenance:query": "ppm:project:read",
    "pm:project-maintenance:create": "ppm:project:write",
    "pm:project-maintenance:update": "ppm:project:write",
    "pm:project-maintenance:delete": "ppm:project:delete",
    "pm:project-maintenance:export": "ppm:project:export",
    "pm:customer-maintenance:query": "ppm:customer:read",
    "pm:customer-maintenance:create": "ppm:customer:write",
    "pm:customer-maintenance:update": "ppm:customer:write",
    "pm:customer-maintenance:delete": "ppm:customer:delete",
    "pm:customer-maintenance:export": "ppm:customer:export",
    # ps 计划（plan-node / project-plan / plan-node-detail）
    "ps:project-plan:query": "ppm:plan:read",
    "ps:project-plan:create": "ppm:plan:write",
    "ps:project-plan:update": "ppm:plan:write",
    "ps:project-plan:delete": "ppm:plan:delete",
    "ps:project-plan:export": "ppm:plan:export",
    "ps:project-plan:change": "ppm:plan:write",
    "ps:plan-node:query": "ppm:plan:read",
    "ps:plan-node:create": "ppm:plan:write",
    "ps:plan-node:update": "ppm:plan:write",
    "ps:plan-node:delete": "ppm:plan:delete",
    "ps:plan-node:export": "ppm:plan:export",
    "ps:plan-node-detail:query": "ppm:plan:read",
    "ps:plan-node-detail:create": "ppm:plan:write",
    "ps:plan-node-detail:update": "ppm:plan:write",
    "ps:plan-node-detail:delete": "ppm:plan:delete",
    "ps:plan-node-detail:export": "ppm:plan:export",
    # plan 模板节点
    "plan:plan-node:query": "ppm:plan:read",
    "plan:plan-node:create": "ppm:plan:write",
    "plan:plan-node:update": "ppm:plan:write",
    "plan:plan-node:delete": "ppm:plan:delete",
    "plan:plan-node:export": "ppm:plan:export",
    # problem 问题
    "problem:list:query": "ppm:problem:read",
    "problem:list:create": "ppm:problem:write",
    "problem:list:update": "ppm:problem:write",
    "problem:list:delete": "ppm:problem:delete",
    "problem:change:query": "ppm:problem:read",
    "problem:change:create": "ppm:problem:write",
    "problem:change:update": "ppm:problem:write",
    "problem:change:delete": "ppm:problem:delete",
    "problem:change-process-log:query": "ppm:problem:read",
    "problem:change-process-log:export": "ppm:problem:export",
    # task 任务 / 工时 / 看板
    "task:plan:query": "ppm:task:read",
    "task:plan:create": "ppm:task:write",
    "task:plan:update": "ppm:task:write",
    "task:plan:delete": "ppm:task:delete",
    "ppm:personal-task-plan:query": "ppm:task:read",
    "ppm:task:kanban": "ppm:kanban:view",
    "ppm:task:kanban:view": "ppm:kanban:view",
    "ppm:task:kanban:assign": "ppm:kanban:assign",
    # system:user / role / dept → admin 权限
    "system:user:query": "user:read",
    "system:user:list": "user:read",
    "system:user:create": "user:write",
    "system:user:update": "user:write",
    "system:user:update-password": "user:write",
    "system:user:delete": "user:write",
    "system:user:export": "user:read",
    "system:user:import": "user:write",
    "system:role:query": "role:read",
    "system:role:create": "role:write",
    "system:role:update": "role:write",
    "system:role:delete": "role:write",
    "system:role:export": "role:read",
    "system:dept:query": "organization:read",
    "system:dept:create": "organization:write",
    "system:dept:update": "organization:write",
    "system:dept:delete": "organization:write",
}


def map_permission(src_perm: str) -> str | None:
    """源权限字符串 → 目标 Permission.value，映射不上返回 None。"""
    if not src_perm:
        return None
    return PERM_MAP.get(src_perm.strip())


# ---------------------------------------------------------------------------
# 迁移：清空目标
# ---------------------------------------------------------------------------

# ppm 业务表（按依赖倒序，配合 TRUNCATE CASCADE 实际顺序无关，保留可读性）
TRUNCATE_ORDER = [
    "ppm_task_execute",
    "ppm_plan_task",
    "ppm_problem_change_process_log",
    "ppm_problem_change_process_task",
    "ppm_problem_list_process_log",
    "ppm_problem_list_process_task",
    "ppm_problem_change",
    "ppm_problem_list",
    "ppm_ps_plan_node_detail_process",
    "ppm_ps_plan_node_detail",
    "ppm_ps_plan_node",
    "ppm_ps_project_plan",
    "ppm_plan_node_module",
    "ppm_plan_node_detail",
    "ppm_plan_node",
    "ppm_project_stakeholder",
    "ppm_project_member",
    "ppm_customer_maintenance",
    "ppm_project_maintenance",
]


async def purge_target(db: AsyncSession) -> None:
    """清空目标业务/体系表，保留 is_system=True 种子角色 + 其权限。

    删除顺序遵循 FK 依赖（child 先于 parent）：
    user_roles / user_organizations 先删（role_id/org_id 均 RESTRICT）→
    再删非 system roles + 其 role_permissions →
    再删 users / organizations（users 删时 CASCADE 级联 user_roles/user_organizations，
    但显式先删避免 RESTRICT 阻塞 organization 删除）。
    """
    sys_role_ids_subq = select(Role.id).where(Role.is_system.is_(True))
    # 1) 解绑 user_roles / user_organizations（避免后续删 role/org 触发 RESTRICT）
    await db.execute(UserRole.__table__.delete())
    await db.execute(UserOrganization.__table__.delete())
    # 2) 删非 system 角色 + 其权限
    await db.execute(
        RolePermission.__table__.delete().where(RolePermission.role_id.not_in(sys_role_ids_subq))
    )
    await db.execute(Role.__table__.delete().where(Role.is_system.is_(False)))
    # 3) users（CASCADE 会级联残留的 user_roles/user_organizations）
    #    保留 bootstrap admin(被 SillySpec changes.owner_id 等引用,避免 FK 违反)
    bootstrap_email = os.environ.get("PLATFORM_BOOTSTRAP_ADMIN_EMAIL", "admin@sillyhub.local")
    await db.execute(User.__table__.delete().where(User.email != bootstrap_email))
    # 4) organizations（parent_id 自引用 RESTRICT，叶子删除顺序不可控，直接 TRUNCATE CASCADE）
    await db.execute(text("TRUNCATE TABLE organizations RESTART IDENTITY CASCADE"))
    # 5) ppm 业务表全部清空（按依赖 CASCADE，一次 TRUNCATE 搞定）
    ppm_tables = ", ".join(TRUNCATE_ORDER)
    await db.execute(text(f"TRUNCATE TABLE {ppm_tables} RESTART IDENTITY CASCADE"))
    await db.commit()


# ---------------------------------------------------------------------------
# 迁移各阶段
# ---------------------------------------------------------------------------

Maps = dict[str, dict[Any, uuid.UUID]]
Stats = dict[str, dict[str, int]]


def new_stat(name: str, stats: Stats, src_count: int) -> None:
    stats[name] = {"src": src_count, "inserted": 0, "skipped": 0}


async def migrate_dept(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM system_dept ORDER BY parent_id, id")
    new_stat("dept→organizations", stats, len(rows))
    maps["dept"] = {}
    objects: list[Organization] = []
    for r in rows:
        if is_deleted(r):
            stats["dept→organizations"]["skipped"] += 1
            continue
        oid = uuid5_int("dept", r["id"])
        maps["dept"][str(r["id"])] = oid
        parent_id = mget(maps["dept"], r["parent_id"]) if r["parent_id"] else None
        name = clean_str(r["name"], 100) or f"dept-{r['id']}"
        status = "active" if int(r.get("status") or 0) == 0 else "disabled"
        objects.append(
            Organization(
                id=oid,
                name=name,
                code=f"dept_{r['id']}",
                parent_id=parent_id,
                status=status,
                sort_order=int(r.get("sort") or 0),
                created_at=to_dt(r.get("create_time")) or datetime.now(UTC),
                updated_at=to_dt(r.get("update_time")) or datetime.now(UTC),
            )
        )
    db.add_all(objects)
    await db.flush()
    stats["dept→organizations"]["inserted"] = len(objects)


async def migrate_users(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM system_users ORDER BY id")
    new_stat("users→users", stats, len(rows))
    maps["user"] = {}
    user_objs: list[User] = []
    uo_objs: list[UserOrganization] = []
    skipped_no_dept = 0
    used_emails: set[str] = set()
    for r in rows:
        if is_deleted(r):
            stats["users→users"]["skipped"] += 1
            continue
        uid = uuid5_int("user", r["id"])
        maps["user"][str(r["id"])] = uid
        username = clean_str(r["username"]) or f"user{r['id']}"
        email = clean_str(r["email"]) or f"{username}@migrated.local"
        # email 必须唯一；源可能重复/为空，加后缀去重
        base_email = email
        suffix = 2
        while email in used_emails:
            local, _, domain = base_email.rpartition("@")
            email = f"{local}_{suffix}@{domain or 'migrated.local'}"
            suffix += 1
        used_emails.add(email)
        # bcrypt hash 直存（目标用 passlib bcrypt 校验）
        pw = clean_str(r["password"]) or ""
        user_objs.append(
            User(
                id=uid,
                email=email,
                password_hash=pw,
                display_name=clean_str(r["nickname"], 100),
                status="active" if int(r.get("status") or 0) == 0 else "disabled",
                is_platform_admin=False,
                login_enabled=(int(r.get("status") or 0) == 0),
                last_login_at=to_dt(r.get("login_date")),
                created_at=to_dt(r.get("create_time")) or datetime.now(UTC),
                updated_at=to_dt(r.get("update_time")) or datetime.now(UTC),
            )
        )
        dept_id = r.get("dept_id")
        if dept_id:
            org_id = mget(maps["dept"], dept_id)
            if org_id:
                uo_objs.append(UserOrganization(user_id=uid, organization_id=org_id))
            else:
                skipped_no_dept += 1
    db.add_all(user_objs)
    await db.flush()
    db.add_all(uo_objs)
    await db.flush()
    stats["users→users"]["inserted"] = len(user_objs)
    stats["user_organizations"] = {
        "src": len([r for r in rows if r.get("dept_id") and not is_deleted(r)]),
        "inserted": len(uo_objs),
        "skipped": skipped_no_dept,
    }


async def migrate_roles(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM system_role ORDER BY id")
    new_stat("role→roles", stats, len(rows))
    maps["role"] = {}
    role_objs: list[Role] = []
    existing_keys = {k for (k,) in (await db.execute(select(Role.key))).all()}
    for r in rows:
        if is_deleted(r):
            stats["role→roles"]["skipped"] += 1
            continue
        rid = uuid5_int("role", r["id"])
        maps["role"][str(r["id"])] = rid
        code = clean_str(r["code"]) or f"role_{r['id']}"
        name = clean_str(r["name"], 100) or code
        # key 唯一，与已有种子 key 冲突则加后缀
        key = code
        suffix = 2
        while key in existing_keys:
            key = f"{code}_m{suffix}"
            suffix += 1
        existing_keys.add(key)
        role_objs.append(
            Role(
                id=rid,
                key=key,
                name=name,
                description=clean_str(r["remark"]),
                is_system=False,
                is_active=(int(r.get("status") or 0) == 0),
            )
        )
    db.add_all(role_objs)
    await db.flush()
    stats["role→roles"]["inserted"] = len(role_objs)


async def migrate_user_role(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM system_user_role")
    new_stat("user_role→user_roles", stats, len(rows))
    objs: list[UserRole] = []
    for r in rows:
        uid = mget(maps["user"], r["user_id"])
        rid = mget(maps["role"], r["role_id"])
        if not uid or not rid:
            stats["user_role→user_roles"]["skipped"] += 1
            continue
        objs.append(UserRole(user_id=uid, role_id=rid))
    # 批量 upsert（user_id+role_id 复合主键，去重）
    if objs:
        vals = [{"user_id": o.user_id, "role_id": o.role_id} for o in objs]
        await db.execute(
            pg_insert(UserRole)
            .values(vals)
            .on_conflict_do_nothing(index_elements=["user_id", "role_id"])
        )
    stats["user_role→user_roles"]["inserted"] = len(objs)


async def migrate_role_permissions(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    # role_id → 该角色命中的所有源权限字符串（去重）
    rows = src_query(
        """
        SELECT rm.role_id, m.permission
        FROM system_role_menu rm
        JOIN system_menu m ON rm.menu_id = m.id
        WHERE m.permission IS NOT NULL AND m.permission != ''
        """
    )
    new_stat("role_menu→role_permissions", stats, len(rows))
    role_perms: dict[Any, set[str]] = defaultdict(set)
    for r in rows:
        role_perms[r["role_id"]].add(r["permission"])

    mapped = 0
    unmapped_samples: list[str] = []
    unmapped_set: set[str] = set()
    objs: list[RolePermission] = []
    for src_role_id, perms in role_perms.items():
        rid = mget(maps["role"], src_role_id)
        if not rid:
            stats["role_menu→role_permissions"]["skipped"] += 1
            continue
        for p in perms:
            tgt = map_permission(p)
            if tgt is None:
                if p not in unmapped_set:
                    unmapped_set.add(p)
                    unmapped_samples.append(p)
                continue
            mapped += 1
            objs.append(RolePermission(role_id=rid, permission=tgt))
    if objs:
        vals = [{"role_id": o.role_id, "permission": o.permission} for o in objs]
        await db.execute(
            pg_insert(RolePermission)
            .values(vals)
            .on_conflict_do_nothing(index_elements=["role_id", "permission"])
        )
    stats["role_menu→role_permissions"]["inserted"] = len(objs)
    stats["role_menu→role_permissions"]["_mapped_distinct_perms"] = mapped
    stats["role_menu→role_permissions"]["_unmapped_samples"] = unmapped_samples[:30]


# ---------------------------------------------------------------------------
# PPM 业务表迁移
# ---------------------------------------------------------------------------


async def migrate_projects(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_project_maintenance ORDER BY id")
    new_stat("ppm_project_maintenance", stats, len(rows))
    maps["project"] = {}
    objs: list[PpmProjectMaintenance] = []
    used_codes: set[str] = set()
    for r in rows:
        if is_deleted(r):
            stats["ppm_project_maintenance"]["skipped"] += 1
            continue
        pid = uuid5_int("project", r["id"])
        maps["project"][str(r["id"])] = pid
        base_code = clean_str(r["project_code"], 100) or f"proj_{r['id']}"
        code = base_code
        suffix = 2
        while code in used_codes:
            code = f"{base_code}_{suffix}"
            suffix += 1
        used_codes.add(code)
        objs.append(
            PpmProjectMaintenance(
                id=pid,
                create_name=clean_str(r["create_name"], 100),
                company_name=clean_str(r["company_name"], 255),
                project_name=clean_str(r["project_name"], 255),
                project_code=code,
                project_status=clean_str(r["project_status"], 50),
                project_type=clean_str(r["project_type"], 50),
                project_effective_start_time=to_dt(r["project_effective_start_time"]),
                project_effective_end_time=to_dt(r["project_effective_end_time"]),
                project_maintenance_end_time=to_dt(r["project_maintenance_end_time"]),
                created_at=to_dt(r["create_time"]) or datetime.now(UTC),
                updated_at=to_dt(r["update_time"]) or datetime.now(UTC),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_project_maintenance"]["inserted"] = len(objs)


async def migrate_customers(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_customer_maintenance ORDER BY id")
    new_stat("ppm_customer_maintenance", stats, len(rows))
    objs: list[PpmCustomerMaintenance] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_customer_maintenance"]["skipped"] += 1
            continue
        cid = uuid5_int("customer", r["id"])
        objs.append(
            PpmCustomerMaintenance(
                id=cid,
                create_name=clean_str(r["create_name"], 100),
                company_name=clean_str(r["company_name"], 255),
                contact=clean_str(r["contact"], 100),
                phone_no=clean_str(r["phone_no"], 50),
                dept_name=clean_str(r["dept_name"], 150),
                level=clean_str(r["level"], 50),
                created_at=to_dt(r["create_time"]) or datetime.now(UTC),
                updated_at=to_dt(r["update_time"]) or datetime.now(UTC),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_customer_maintenance"]["inserted"] = len(objs)


async def migrate_members(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_project_member ORDER BY id")
    new_stat("ppm_project_member", stats, len(rows))
    maps["member"] = {}
    objs: list[PpmProjectMember] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_project_member"]["skipped"] += 1
            continue
        proj = mget(maps["project"], r["pm_project_id"]) if r["pm_project_id"] else None
        if not proj:
            stats["ppm_project_member"]["skipped"] += 1
            continue
        user_src = r["user_id"]
        user = mget(maps["user"], user_src) if user_src else None
        if not user:
            # 孤立 user_id（源 4 个不在 system_users）→ 跳过
            stats["ppm_project_member"]["skipped"] += 1
            continue
        mid = uuid5_int("member", r["id"])
        maps["member"][str(r["id"])] = mid
        objs.append(
            PpmProjectMember(
                id=mid,
                create_name=clean_str(r["create_name"], 100),
                pm_project_id=proj,
                user_id=user,
                user_name=clean_str(r["user_name"], 100),
                # depart_id 目标 String（指向 organization/dept）→ 映射为目标 org UUID 字符串
                depart_id=map_fk(maps, "dept", r["depart_id"], "project_member.depart_id")
                or clean_str(r["depart_id"], 64),
                phone=clean_str(r["phone"], 50),
                # role_id 是项目角色标识字符串（非 FK），保留源值
                role_id=clean_str(r["role_id"], 64),
                role_name=clean_str(r["role_name"], 100),
                depart_name=clean_str(r["depart_name"], 150),
                created_at=to_dt(r["create_time"]) or datetime.now(UTC),
                updated_at=to_dt(r["update_time"]) or datetime.now(UTC),
            )
        )
    # 源同 (project,user) 可能有多行（重复挂角色），目标有 unique 约束 → 冲突跳过
    if objs:
        vals = [
            {
                "id": o.id,
                "create_name": o.create_name,
                "pm_project_id": o.pm_project_id,
                "user_id": o.user_id,
                "user_name": o.user_name,
                "depart_id": o.depart_id,
                "phone": o.phone,
                "role_id": o.role_id,
                "role_name": o.role_name,
                "depart_name": o.depart_name,
                "created_at": o.created_at,
                "updated_at": o.updated_at,
            }
            for o in objs
        ]
        result = await db.execute(
            pg_insert(PpmProjectMember)
            .values(vals)
            .on_conflict_do_nothing(index_elements=["pm_project_id", "user_id"])
        )
        stats["ppm_project_member"]["inserted"] = result.rowcount or 0
        stats["ppm_project_member"]["skipped"] += len(objs) - (result.rowcount or 0)
    else:
        stats["ppm_project_member"]["inserted"] = 0


async def migrate_stakeholders(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_project_stakeholder ORDER BY id")
    new_stat("ppm_project_stakeholder", stats, len(rows))
    objs: list[PpmProjectStakeholder] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_project_stakeholder"]["skipped"] += 1
            continue
        proj = mget(maps["project"], r["pm_project_id"]) if r["pm_project_id"] else None
        if not proj:
            stats["ppm_project_stakeholder"]["skipped"] += 1
            continue
        objs.append(
            PpmProjectStakeholder(
                id=uuid5_int("stakeholder", r["id"]),
                stakeholder=clean_str(r["stakeholder"], 100),
                stakeholder_role=clean_str(r["stakeholder_role"], 100),
                phone=clean_str(r["phone"], 50),
                pm_project_id=proj,
                create_name=clean_str(r["create_name"], 100),
                created_at=to_dt(r["create_time"]) or datetime.now(UTC),
                updated_at=to_dt(r["update_time"]) or datetime.now(UTC),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_project_stakeholder"]["inserted"] = len(objs)


async def migrate_plan_node(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_plan_node ORDER BY id")
    new_stat("ppm_plan_node", stats, len(rows))
    maps["plan_node"] = {}
    objs: list[PlanNode] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_plan_node"]["skipped"] += 1
            continue
        nid = uuid5_int("plan_node", r["id"])
        maps["plan_node"][str(r["id"])] = nid
        objs.append(
            PlanNode(
                id=nid,
                overall_stage=clean_str(r["overall_stage"], 64) or f"stage_{r['id']}",
                project_type=clean_str(r["project_type"], 64),
                no=r["no"],
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_plan_node"]["inserted"] = len(objs)


async def migrate_plan_node_detail(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_plan_node_detail ORDER BY id")
    new_stat("ppm_plan_node_detail", stats, len(rows))
    objs: list[PlanNodeDetail] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_plan_node_detail"]["skipped"] += 1
            continue
        # plan_node_id 目标 String → 映射为目标 plan_node UUID 字符串
        objs.append(
            PlanNodeDetail(
                id=uuid5_int("plan_node_detail", r["id"]),
                plan_node_id=map_fk(
                    maps, "plan_node", r["plan_node_id"], "plan_node_detail.plan_node_id"
                )
                or "",
                detailed_stage=clean_str(r["detailed_stage"], 64),
                no=str(r["no"]) if r["no"] is not None else None,
                task_theme=clean_str(r["task_theme"], 255),
                task_description=clean_str(r["task_description"]),
                requirements=clean_str(r["requirements"]),
                role_name=clean_str(r["role_name"], 128),
                achievement=clean_str(r["achievement"]),
                overall_stage=clean_str(r["overall_stage"], 64),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_plan_node_detail"]["inserted"] = len(objs)


async def migrate_plan_node_module(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_ps_plan_node_module ORDER BY id")
    new_stat("ppm_plan_node_module", stats, len(rows))
    maps["module"] = {}
    objs: list[PlanNodeModule] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_plan_node_module"]["skipped"] += 1
            continue
        mid = uuid5_int("module", r["id"])
        maps["module"][str(r["id"])] = mid
        objs.append(
            PlanNodeModule(
                id=mid,
                # plan_node_id 目标 String（源表 ppm_ps_plan_node_module，指向 ps_plan_node；
                # 前端 /plan-node/{id}/modules 也用模板 plan_node 查，两个 map 都尝试）
                plan_node_id=(
                    map_fk(maps, "ps_plan_node", r["plan_node_id"], "plan_node_module.plan_node_id")
                    or map_fk(maps, "plan_node", r["plan_node_id"], "plan_node_module.plan_node_id")
                    or ""
                ),
                module_name=clean_str(r["module_name"], 255),
                plan_workload=clean_str(r["plan_workload"], 64),
                plan_begin_time=to_dt(r["plan_begin_time"]),
                plan_complete_time=to_dt(r["plan_complete_time"]),
                # duty_user_id 目标 String → 映射为目标 user UUID 字符串
                duty_user_id=map_fk(
                    maps, "user", r["duty_user_id"], "plan_node_module.duty_user_id"
                ),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_plan_node_module"]["inserted"] = len(objs)


async def migrate_ps_project_plan(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_ps_project_plan ORDER BY id")
    new_stat("ppm_ps_project_plan", stats, len(rows))
    maps["ps_project_plan"] = {}
    objs: list[PsProjectPlan] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_ps_project_plan"]["skipped"] += 1
            continue
        ppid = uuid5_int("ps_project_plan", r["id"])
        maps["ps_project_plan"][str(r["id"])] = ppid
        objs.append(
            PsProjectPlan(
                id=ppid,
                # project_id 目标 UUID FK → 映射为目标 project UUID（源 ppm_project_maintenance.id）；
                # fallback_keep=False：未映射返回 None（列已是 uuid，不保留源 Long ID 防 ALTER/插入失败）
                project_id=map_fk(
                    maps,
                    "project",
                    r["project_id"],
                    "ps_project_plan.project_id",
                    fallback_keep=False,
                ),
                project_name=clean_str(r["project_name"], 255),
                # project_manager_id 目标 String，保留源字符串
                project_manager_id=clean_str(r["project_manager_id"], 64),
                project_manager_name=clean_str(r["project_manager_name"], 128),
                project_start_time=to_dt(r["project_start_time"]),
                project_plan_end_time=to_dt(r["project_plan_end_time"]),
                contract_sign_time=to_dt(r["contract_sign_time"]),
                contract_name=clean_str(r["contract_name"], 255),
                contract_amount=clean_str(r["contract_amount"], 64),
                profit_margin=clean_str(r["profit_margin"], 64),
                profit_amount=clean_str(r["profit_amount"], 64),
                module=clean_str(r["module"]),
                budget_amount=clean_str(r["budget_amount"], 64),
                budget_person_days=clean_str(r["budget_person_days"], 64),
                actual_consumption_person_days=clean_str(r["actual_consumption_person_days"], 64),
                remaining_available_person_days=clean_str(r["remaining_available_person_days"], 64),
                status=clean_str(r["status"], 32) or "draft",
                adjustment_person_days=clean_str(r["adjustment_person_days"], 64),
                total_cost=clean_str(r["total_cost"], 64),
                labor_cost=clean_str(r["labor_cost"], 64),
                remaining_cost=clean_str(r["remaining_cost"], 64),
                cost_adjustment=clean_str(r["cost_adjustment"], 64),
                company_name=clean_str(r["company_name"], 255),
                create_name=clean_str(r["create_name"], 128),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_ps_project_plan"]["inserted"] = len(objs)


async def migrate_ps_plan_node(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_ps_plan_node ORDER BY id")
    new_stat("ppm_ps_plan_node", stats, len(rows))
    maps["ps_plan_node"] = {}
    objs: list[PsPlanNode] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_ps_plan_node"]["skipped"] += 1
            continue
        nid = uuid5_int("ps_plan_node", r["id"])
        maps["ps_plan_node"][str(r["id"])] = nid
        objs.append(
            PsPlanNode(
                id=nid,
                overall_stage=clean_str(r["overall_stage"], 64),
                no=str(r["no"]) if r["no"] is not None else None,
                # ps_project_plan_id 目标 String → 映射为目标 UUID 字符串（ps_project_plan）
                ps_project_plan_id=map_fk(
                    maps,
                    "ps_project_plan",
                    r["ps_project_plan_id"],
                    "ps_plan_node.ps_project_plan_id",
                )
                or "",
                status=clean_str(r["status"], 32) or "draft",
                task_theme=clean_str(r["task_theme"], 255),
                plan_workload=clean_str(r["plan_workload"], 64),
                plan_begin_time=to_dt(r["plan_begin_time"]),
                plan_complete_time=to_dt(r["plan_complete_time"]),
                # duty_user_id 目标 String → 映射为目标 user UUID 字符串
                duty_user_id=map_fk(maps, "user", r["duty_user_id"], "ps_plan_node.duty_user_id"),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_ps_plan_node"]["inserted"] = len(objs)


async def migrate_ps_plan_node_detail(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_ps_plan_node_detail ORDER BY id")
    new_stat("ppm_ps_plan_node_detail", stats, len(rows))
    maps["ps_detail"] = {}
    objs: list[PsPlanNodeDetail] = []
    # 先建立 id 映射（parent_id 自引用需要），再处理 pre_id
    for r in rows:
        maps["ps_detail"][str(r["id"])] = uuid5_int("ps_detail", r["id"])
    for r in rows:
        if is_deleted(r):
            stats["ppm_ps_plan_node_detail"]["skipped"] += 1
            continue
        did = maps["ps_detail"][str(r["id"])]
        parent_id = mget(maps["ps_detail"], r["pre_id"]) if r["pre_id"] else None
        objs.append(
            PsPlanNodeDetail(
                id=did,
                # plan_node_id 目标 String（源语义指向 ppm_ps_plan_node）→ 映射为目标 UUID 字符串
                plan_node_id=map_fk(
                    maps, "ps_plan_node", r["plan_node_id"], "ps_plan_node_detail.plan_node_id"
                )
                or "",
                detailed_stage=clean_str(r["detailed_stage"], 64),
                task_theme=clean_str(r["task_theme"], 255),
                task_description=clean_str(r["task_description"]),
                requirements=clean_str(r["requirements"]),
                role_name=clean_str(r["role_name"], 128),
                achievement=clean_str(r["achievement"]),
                overall_stage=clean_str(r["overall_stage"], 64),
                plan_workload=clean_str(r["plan_workload"], 64),
                plan_begin_time=to_dt(r["plan_begin_time"]),
                plan_complete_time=to_dt(r["plan_complete_time"]),
                actual_begin_time=to_dt(r["actual_begin_time"]),
                actual_complete_time=to_dt(r["actual_complete_time"]),
                no=str(r["no"]) if r["no"] is not None else None,
                # execute_user_id 目标 String → 映射为目标 user UUID 字符串
                execute_user_id=map_fk(
                    maps, "user", r["execute_user_id"], "ps_plan_node_detail.execute_user_id"
                ),
                # module_id 目标 String（指向 ppm_ps_plan_node_module）→ 映射为目标 UUID 字符串
                module_id=map_fk(maps, "module", r["module_id"], "ps_plan_node_detail.module_id"),
                attach_group_id=clean_str(r["attach_group_id"], 128),
                status=map_ps_detail_status(r["status"]),
                parent_id=parent_id,
                # audit/approve user 均为目标 String → 映射为目标 user UUID 字符串
                audit_user_id=map_fk(
                    maps, "user", r["audit_user_id"], "ps_plan_node_detail.audit_user_id"
                ),
                audit_user_name=clean_str(r["audit_user_name"], 128),
                approve_user_id=map_fk(
                    maps, "user", r["approve_user_id"], "ps_plan_node_detail.approve_user_id"
                ),
                approve_user_name=clean_str(r["approve_user_name"], 128),
                change_reason=clean_str(r["change_reason"]),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_ps_plan_node_detail"]["inserted"] = len(objs)


async def migrate_ps_detail_process(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_ps_plan_node_detail_process ORDER BY id")
    new_stat("ppm_ps_plan_node_detail_process", stats, len(rows))
    objs: list[PsPlanNodeDetailProcess] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_ps_plan_node_detail_process"]["skipped"] += 1
            continue
        objs.append(
            PsPlanNodeDetailProcess(
                id=uuid5_int("ps_detail_proc", r["id"]),
                # business_id 目标 String，指向 ps_detail.id → 映射为目标 UUID 字符串
                business_id=map_fk(
                    maps, "ps_detail", r["business_id"], "ps_detail_process.business_id"
                )
                or "",
                business_type=clean_str(r["business_type"], 64) or "ps_plan_node_detail",
                node_key=clean_str(r["node_key"], 64),
                handle_user_id=map_fk(
                    maps, "user", r["handle_user_id"], "ps_detail_process.handle_user_id"
                ),
                handle_user_name=clean_str(r["handle_user_name"], 128),
                handle_date=to_dt(r["handle_date"]),
                handle_info=clean_str(r["handle_info"]),
                next_user_id=map_fk(
                    maps, "user", r["next_user_id"], "ps_detail_process.next_user_id"
                ),
                next_user_name=clean_str(r["next_user_name"], 128),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_ps_plan_node_detail_process"]["inserted"] = len(objs)


async def migrate_problem_list(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_problem_list ORDER BY id")
    new_stat("ppm_problem_list", stats, len(rows))
    maps["problem_list"] = {}
    objs: list[PpmProblemList] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_problem_list"]["skipped"] += 1
            continue
        pid = uuid5_int("problem_list", r["id"])
        maps["problem_list"][str(r["id"])] = pid
        objs.append(
            PpmProblemList(
                id=pid,
                # project_id 目标 String → 映射为目标 project UUID 字符串
                project_id=map_fk(maps, "project", r["project_id"], "problem_list.project_id")
                or "",
                project_name=clean_str(r["project_name"], 255),
                # module_id 目标 String（指向 plan_node_module）→ 映射为目标 UUID 字符串
                module_id=map_fk(maps, "module", r["module_id"], "problem_list.module_id"),
                model_name=clean_str(r["model_name"], 255),
                pro_desc=clean_str(r["pro_desc"]),
                file_urls=collect_file_urls(r),
                func_name=clean_str(r["func_name"], 255),
                pro_type=clean_str(r["pro_type"], 64),
                is_urgent=clean_str(r["is_urgent"], 8),
                find_by=clean_str(r["find_by"], 128),
                find_time=to_dt(r["find_time"]),
                pro_answer=clean_str(r["pro_answer"]),
                work_type=clean_str(r["work_type"], 64),
                # duty_user_id/audit_user_id 目标 String → 映射为目标 user UUID 字符串
                duty_user_id=map_fk(maps, "user", r["duty_user_id"], "problem_list.duty_user_id"),
                duty_user_name=clean_str(r["duty_user_name"], 128),
                plan_start_time=to_dt(r["plan_start_time"]),
                plan_end_time=to_dt(r["plan_end_time"]),
                real_end_time=to_dt(r["real_end_time"]),
                audit_user_id=map_fk(
                    maps, "user", r["audit_user_id"], "problem_list.audit_user_id"
                ),
                audit_user_name=clean_str(r["audit_user_name"], 128),
                audit_time=to_dt(r["audit_time"]),
                remarks=clean_str(r["remarks"]),
                status=clean_str(r["status"], 8) or "1",
                is_delay_plan=clean_str(r["is_delay_plan"], 8),
                work_load=clean_str(r["work_load"], 64),
                time_spent=to_num(r["time_spent"]),
                now_node=r["now_node"],
                now_handle_user=clean_str(r["now_handle_user"], 255),
                now_handle_user_name=clean_str(r["now_handle_user_name"], 255),
                handle_info=clean_str(r["handle_info"]),
                check_info=clean_str(r["check_info"]),
                check_result=clean_str(r["check_result"], 8),
                check_time=to_dt(r["check_time"]),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_problem_list"]["inserted"] = len(objs)


async def migrate_problem_change(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_problem_change ORDER BY id")
    new_stat("ppm_problem_change", stats, len(rows))
    maps["problem_change"] = {}
    objs: list[PpmProblemChange] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_problem_change"]["skipped"] += 1
            continue
        cid = uuid5_int("problem_change", r["id"])
        maps["problem_change"][str(r["id"])] = cid
        objs.append(
            PpmProblemChange(
                id=cid,
                # resource_id 目标 String（指向 problem_list）→ 映射为目标 problem_list UUID 字符串
                resource_id=map_fk(
                    maps, "problem_list", r["resource_id"], "problem_change.resource_id"
                )
                or "",
                # project_id 目标 String → 映射为目标 project UUID 字符串
                project_id=map_fk(maps, "project", r["project_id"], "problem_change.project_id")
                or clean_str(r["project_id"], 64),
                project_name=clean_str(r["project_name"], 255),
                model_name=clean_str(r["model_name"], 255),
                pro_desc=clean_str(r["pro_desc"]),
                func_name=clean_str(r["func_name"], 255),
                pro_type=clean_str(r["pro_type"], 64),
                is_urgent=clean_str(r["is_urgent"], 8),
                find_by=clean_str(r["find_by"], 128),
                find_time=to_dt(r["find_time"]),
                pro_answer=clean_str(r["pro_answer"]),
                work_type=clean_str(r["work_type"], 64),
                duty_user_id=map_fk(maps, "user", r["duty_user_id"], "problem_change.duty_user_id")
                or clean_str(r["duty_user_id"], 64),
                duty_user_name=clean_str(r["duty_user_name"], 128),
                plan_start_time=to_dt(r["plan_start_time"]),
                plan_end_time=to_dt(r["plan_end_time"]),
                audit_user_id=map_fk(
                    maps, "user", r["audit_user_id"], "problem_change.audit_user_id"
                )
                or clean_str(r["audit_user_id"], 64),
                audit_user_name=clean_str(r["audit_user_name"], 128),
                audit_time=to_dt(r["audit_time"]),
                remarks=clean_str(r["remarks"]),
                change_reason=clean_str(r["change_reason"]),
                status=clean_str(r["status"], 8) or "1",
                work_load=clean_str(r["work_load"], 64),
                is_delay_plan=clean_str(r["is_delay_plan"], 8),
                now_node=r["now_node"],
                now_handle_user=clean_str(r["now_handle_user"], 255),
                now_handle_user_name=clean_str(r["now_handle_user_name"], 255),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_problem_change"]["inserted"] = len(objs)


async def _migrate_proc_task_log(
    db: AsyncSession,
    maps: Maps,
    stats: Stats,
    src_table: str,
    stat_key: str,
    uuid_prefix: str,
    task_cls: type,
    log_cls: type,
    business_map_key: str,
) -> None:
    """problem_list / problem_change 的流程任务 + 履历迁移。

    business_id 目标 String，指向对应业务（problem_list 或 problem_change）→ 映射为目标 UUID；
    handle_user_id / next_user_id 目标 String → 映射为目标 user UUID。
    """
    biz_field = f"{stat_key}.business_id"
    # 流程任务
    trows = src_query(f"SELECT * FROM {src_table}_process_task ORDER BY id")
    new_stat(f"{stat_key}_process_task", stats, len(trows))
    tobjs: list = []
    for r in trows:
        if is_deleted(r):
            stats[f"{stat_key}_process_task"]["skipped"] += 1
            continue
        tobjs.append(
            task_cls(
                id=uuid5_int(f"{uuid_prefix}_ptask", r["id"]),
                business_id=map_fk(maps, business_map_key, r["business_id"], biz_field) or "",
                node_key=clean_str(r["node_key"], 32),
                node_name=clean_str(r["node_name"], 64),
                now_handle_user=clean_str(r["now_handle_user"], 255),
                now_handle_user_name=clean_str(r["now_handle_user_name"], 255),
            )
        )
    db.add_all(tobjs)
    await db.flush()
    stats[f"{stat_key}_process_task"]["inserted"] = len(tobjs)

    # 流程履历
    lrows = src_query(f"SELECT * FROM {src_table}_process_log ORDER BY id")
    new_stat(f"{stat_key}_process_log", stats, len(lrows))
    lobjs: list = []
    for r in lrows:
        if is_deleted(r):
            stats[f"{stat_key}_process_log"]["skipped"] += 1
            continue
        lobjs.append(
            log_cls(
                id=uuid5_int(f"{uuid_prefix}_plog", r["id"]),
                business_id=map_fk(maps, business_map_key, r["business_id"], biz_field) or "",
                node_key=clean_str(r["node_key"], 32),
                handle_user_id=map_fk(
                    maps, "user", r["handle_user_id"], f"{stat_key}_log.handle_user_id"
                ),
                handle_user_name=clean_str(r["handle_user_name"], 128),
                handle_date=to_dt(r["handle_date"]),
                handle_info=clean_str(r["handle_info"]),
                next_user_id=map_fk(
                    maps, "user", r["next_user_id"], f"{stat_key}_log.next_user_id"
                ),
                next_user_name=clean_str(r["next_user_name"], 255),
                comment=clean_str(r["comment"]),
            )
        )
    db.add_all(lobjs)
    await db.flush()
    stats[f"{stat_key}_process_log"]["inserted"] = len(lobjs)


async def migrate_plan_task(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_plan_task ORDER BY id")
    new_stat("ppm_plan_task", stats, len(rows))
    maps["plan_task"] = {}
    objs: list[PlanTask] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_plan_task"]["skipped"] += 1
            continue
        tid = uuid5_int("plan_task", r["id"])
        maps["plan_task"][str(r["id"])] = tid
        # user_id 必填 UUID，必须映射上
        user = mget(maps["user"], r["user_id"]) if r["user_id"] else None
        if not user:
            stats["ppm_plan_task"]["skipped"] += 1
            continue
        # project_id/module_id/ps_plan_node_detail_id 可空 UUID
        proj = mget(maps["project"], r["project_id"]) if r["project_id"] else None
        module = mget(maps["module"], r["module_id"]) if r["module_id"] else None
        ps_detail = (
            mget(maps["ps_detail"], r["ps_plan_node_detail_id"])
            if r["ps_plan_node_detail_id"]
            else None
        )
        objs.append(
            PlanTask(
                id=tid,
                user_id=user,
                user_name=clean_str(r["user_name"], 100),
                status=clean_str(r["status"], 30) or "未开始",
                month=clean_str(r["month"], 20),
                week=clean_str(r["week"], 20),
                year=clean_str(r["year"], 10),
                week_day=clean_str(r["week_day"], 50),
                start_time=to_dt(r["start_time"]),
                end_time=to_dt(r["end_time"]),
                project_id=proj,
                project_name=clean_str(r["project_name"], 200),
                module_id=module,
                module_name=None,  # 源无独立 module_name 列（model_name 是型号名）
                content=clean_str(r["content"], 2000),
                work_load=clean_str(r["work_load"], 50),
                add_work=clean_str(r["add_work"], 50),
                work_partner=clean_str(r["work_partner"], 200),
                remarks=clean_str(r["remarks"], 1000),
                no=r["no"],
                ps_plan_node_detail_id=ps_detail,
                actual_start_time=to_dt(r["actual_start_time"]),
                actual_end_time=to_dt(r["actual_end_time"]),
                start_remark=clean_str(r["start_remark"], 500),
                end_remark=clean_str(r["end_remark"], 500),
                time_spent=to_num(r["time_spent"]),
                plan_attach_group_id=clean_str(r["plan_attach_group_id"], 100),
                file_urls=collect_file_urls(r),
                kanban_order=int(r.get("kanban_order") or 0),
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_plan_task"]["inserted"] = len(objs)


async def migrate_task_execute(db: AsyncSession, maps: Maps, stats: Stats) -> None:
    rows = src_query("SELECT * FROM ppm_task_execute ORDER BY id")
    new_stat("ppm_task_execute", stats, len(rows))
    objs: list[TaskExecute] = []
    for r in rows:
        if is_deleted(r):
            stats["ppm_task_execute"]["skipped"] += 1
            continue
        plan_task = mget(maps["plan_task"], r["plan_task_id"]) if r["plan_task_id"] else None
        # problem_task_id 指向 problem_list（源语义），映射；映射不上置空
        problem_task = (
            mget(maps["problem_list"], r["problem_task_id"]) if r["problem_task_id"] else None
        )
        execute_user = mget(maps["user"], r["execute_user_id"]) if r["execute_user_id"] else None
        check_user = mget(maps["user"], r["check_user_id"]) if r["check_user_id"] else None
        current_user = mget(maps["user"], r["current_user_id"]) if r["current_user_id"] else None
        objs.append(
            TaskExecute(
                id=uuid5_int("task_execute", r["id"]),
                plan_task_id=plan_task,
                problem_task_id=problem_task,
                time_spent=to_num(r["time_spent"]),
                actual_start_time=to_dt(r["actual_start_time"]),
                actual_end_time=to_dt(r["actual_end_time"]),
                start_remark=clean_str(r["start_remark"], 500),
                end_remark=clean_str(r["end_remark"], 500),
                execute_info=clean_str(r["execute_info"], 2000),
                attach_group_id=clean_str(r["attach_group_id"], 100),
                execute_user_id=execute_user,
                check_info=clean_str(r["check_info"], 2000),
                check_attach_group_id=clean_str(r["check_attach_group_id"], 100),
                check_user_id=check_user,
                check_flag=clean_str(r["check_flag"], 2),
                current_user_id=current_user,
                status=clean_str(r["status"], 4) or "10",
            )
        )
    db.add_all(objs)
    await db.flush()
    stats["ppm_task_execute"]["inserted"] = len(objs)


# ---------------------------------------------------------------------------
# 验证
# ---------------------------------------------------------------------------


async def verify(db: AsyncSession, stats: Stats) -> dict:
    """逐表 SELECT COUNT(*) 对比，返回差异摘要。"""
    table_targets = {
        "organizations": Organization,
        "users": User,
        "roles": Role,
        "user_roles": UserRole,
        "role_permissions": RolePermission,
        "ppm_project_maintenance": PpmProjectMaintenance,
        "ppm_customer_maintenance": PpmCustomerMaintenance,
        "ppm_project_member": PpmProjectMember,
        "ppm_project_stakeholder": PpmProjectStakeholder,
        "ppm_plan_node": PlanNode,
        "ppm_plan_node_detail": PlanNodeDetail,
        "ppm_plan_node_module": PlanNodeModule,
        "ppm_ps_project_plan": PsProjectPlan,
        "ppm_ps_plan_node": PsPlanNode,
        "ppm_ps_plan_node_detail": PsPlanNodeDetail,
        "ppm_ps_plan_node_detail_process": PsPlanNodeDetailProcess,
        "ppm_problem_list": PpmProblemList,
        "ppm_problem_change": PpmProblemChange,
        "ppm_problem_list_process_task": PpmProblemListProcessTask,
        "ppm_problem_list_process_log": PpmProblemListProcessLog,
        "ppm_problem_change_process_task": PpmProblemChangeProcessTask,
        "ppm_problem_change_process_log": PpmProblemChangeProcessLog,
        "ppm_plan_task": PlanTask,
        "ppm_task_execute": TaskExecute,
    }
    out = {}
    for name, model in table_targets.items():
        cnt = await db.execute(select(model).execution_options(compile_cache=False))
        # 用 count(*) 更准
        cnt = (await db.execute(text(f"SELECT COUNT(*) FROM {name}"))).scalar_one()
        out[name] = cnt
    return out


# ---------------------------------------------------------------------------
# 主流程
# ---------------------------------------------------------------------------


async def main() -> None:
    settings = get_settings()
    engine = create_async_engine(settings.database_url, pool_pre_ping=True, future=True)
    factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    maps: Maps = {}
    stats: Stats = {}

    async with factory() as db:
        print("==> [1] 清空目标业务表 + 非 system 角色/users/orgs ...")
        await purge_target(db)

        print("==> [2] system_dept → organizations")
        await migrate_dept(db, maps, stats)
        await db.commit()

        print("==> [3] system_users → users + user_organizations")
        await migrate_users(db, maps, stats)
        await db.commit()

        print("==> [4] system_role → roles")
        await migrate_roles(db, maps, stats)
        await db.commit()

        print("==> [5] system_user_role → user_roles")
        await migrate_user_role(db, maps, stats)
        await db.commit()

        print("==> [6] system_role_menu → role_permissions")
        await migrate_role_permissions(db, maps, stats)
        await db.commit()

        print("==> [7] ppm 项目/客户/成员/干系人")
        await migrate_projects(db, maps, stats)
        await migrate_customers(db, maps, stats)
        await migrate_members(db, maps, stats)
        await migrate_stakeholders(db, maps, stats)
        await db.commit()

        print("==> [8] ppm plan 模板簇 + ps 计划簇")
        await migrate_plan_node(db, maps, stats)
        await migrate_plan_node_detail(db, maps, stats)
        await migrate_ps_project_plan(db, maps, stats)
        await migrate_ps_plan_node(db, maps, stats)
        # module.plan_node_id 实际指向 ps_plan_node(里程碑),须在 migrate_ps_plan_node 之后
        # 执行,否则 maps["ps_plan_node"] 未构建 → map_fk 全失败 → 孤儿(QL ql-20260621-004)
        await migrate_plan_node_module(db, maps, stats)
        await migrate_ps_plan_node_detail(db, maps, stats)
        await migrate_ps_detail_process(db, maps, stats)
        await db.commit()

        print("==> [9] ppm problem 子域")
        await migrate_problem_list(db, maps, stats)
        await migrate_problem_change(db, maps, stats)
        await _migrate_proc_task_log(
            db,
            maps,
            stats,
            "ppm_problem_list",
            "problem_list",
            "plist_pt",
            PpmProblemListProcessTask,
            PpmProblemListProcessLog,
            business_map_key="problem_list",
        )
        await _migrate_proc_task_log(
            db,
            maps,
            stats,
            "ppm_problem_change",
            "problem_change",
            "pchange_pt",
            PpmProblemChangeProcessTask,
            PpmProblemChangeProcessLog,
            business_map_key="problem_change",
        )
        await db.commit()

        print("==> [10] ppm task (plan_task + task_execute)")
        await migrate_plan_task(db, maps, stats)
        await migrate_task_execute(db, maps, stats)
        await db.commit()

        print("==> [11] 验证：目标表行数")
        verify_counts = await verify(db, stats)

    await engine.dispose()

    # 输出报告
    print("\n" + "=" * 72)
    print("迁移报告（源 src / 插入 inserted / 跳过 skipped）")
    print("=" * 72)
    print(f"{'表/阶段':<42}{'src':>8}{'inserted':>10}{'skipped':>9}{'target':>9}")
    print("-" * 72)
    name_to_stat = {
        "organizations": "dept→organizations",
        "users": "users→users",
        "roles": "role→roles",
        "user_roles": "user_role→user_roles",
        "role_permissions": "role_menu→role_permissions",
        "ppm_project_maintenance": "ppm_project_maintenance",
        "ppm_customer_maintenance": "ppm_customer_maintenance",
        "ppm_project_member": "ppm_project_member",
        "ppm_project_stakeholder": "ppm_project_stakeholder",
        "ppm_plan_node": "ppm_plan_node",
        "ppm_plan_node_detail": "ppm_plan_node_detail",
        "ppm_plan_node_module": "ppm_plan_node_module",
        "ppm_ps_project_plan": "ppm_ps_project_plan",
        "ppm_ps_plan_node": "ppm_ps_plan_node",
        "ppm_ps_plan_node_detail": "ppm_ps_plan_node_detail",
        "ppm_ps_plan_node_detail_process": "ppm_ps_plan_node_detail_process",
        "ppm_problem_list": "ppm_problem_list",
        "ppm_problem_change": "ppm_problem_change",
        "ppm_problem_list_process_task": "problem_list_process_task",
        "ppm_problem_list_process_log": "problem_list_process_log",
        "ppm_problem_change_process_task": "problem_change_process_task",
        "ppm_problem_change_process_log": "problem_change_process_log",
        "ppm_plan_task": "ppm_plan_task",
        "ppm_task_execute": "ppm_task_execute",
    }
    for tbl, stat_key in name_to_stat.items():
        s = stats.get(stat_key, {"src": 0, "inserted": 0, "skipped": 0})
        tgt = verify_counts.get(tbl, "?")
        print(
            f"{stat_key:<42}{s.get('src', 0):>8}{s.get('inserted', 0):>10}{s.get('skipped', 0):>9}{tgt!s:>9}"
        )
    # user_organizations 单独打印
    s = stats.get("user_organizations", {"src": 0, "inserted": 0, "skipped": 0})
    print(
        f"{'user_organizations':<42}{s.get('src', 0):>8}{s.get('inserted', 0):>10}{s.get('skipped', 0):>9}{'':>9}"
    )

    print("\n--- 权限映射覆盖率 ---")
    rp = stats.get("role_menu→role_permissions", {})
    print(f"命中的 role_menu 行: {rp.get('src', 0)}")
    print(f"成功映射并写入 role_permissions: {rp.get('inserted', 0)}")
    print(f"映射不上的权限样本（前 30）: {rp.get('_unmapped_samples', [])}")

    print("\n--- String FK 映射覆盖（映射不上、已保留源值）---")
    if _UNMAPPED_FK:
        for field, samples in sorted(_UNMAPPED_FK.items()):
            sample_str = ",".join(sorted(samples)[:8])
            print(f"  {field}: {len(samples)} 个源值，样本 [{sample_str}]")
    else:
        print("  （全部 FK 字段映射成功）")

    print("\n完成。")


if __name__ == "__main__":
    # 确保 .env 被加载（get_settings 依赖）
    if not os.environ.get("DATABASE_URL"):
        # 兜底，正常走 settings
        pass
    asyncio.run(main())
