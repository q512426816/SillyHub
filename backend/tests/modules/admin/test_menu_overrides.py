"""Menu overrides 端点 + 种子迁移测试（task-06 / FR-01 / FR-02 / FR-05）。

覆盖 change ``2026-09-18-web-menu-management`` task-03/04/05 的行为契约：

1. CRUD 链——GET 空 → PUT 建行/二次更新/置 null 清除回默认（全 null 保留行）→
   DELETE 204 且 GET 回空；DELETE 未命中幂等 204。
2. 门控——未认证 401；无 ``menu:admin`` 用户 PUT/DELETE 403
   （``details.permission == "menu:admin"``）而 GET 仅认证 200。
3. 校验——label 空串/31 字符、sort_order 越界、menu_key 超长、未知字段均 422
   （中文文案 + ``code=validation_error``）；未认证时 401 先于 422。
4. 审计——PUT/DELETE 落 ``menu_override.upserted/deleted`` AuditLog 行，
   ``details_json`` 含 ``menu_key``（范式 tests/core/test_audit_hooks_effective.py）；
   DELETE 未命中不落审计（对齐 roles_service「未命中不落审计」）。
5. 孤儿容忍——PUT 注册表不存在的 menu_key 仍 200（R-01，后端不校验注册表）。
6. 种子迁移——照 tests/test_platform_deleted_hidden_migration.py 范式在 SQLite
   内存库真实执行 upgrade：4 新权限 key × 全部 roles（含 disabled）授满、
   不授 ``menu:admin``、无关行保留、重放幂等不重复插；downgrade 删 4 key
   授权行并 drop 表。迁移内权限字符串字面量与 Permission 枚举一致性也在此
   断言（迁移 docstring 指定 task-06 负责对齐）。
"""

from __future__ import annotations

import importlib
import json
import os
import uuid
from pathlib import Path

import pytest
import sqlalchemy as sa
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_access_token, password_hasher
from app.modules.admin.model import MenuOverride
from app.modules.auth.model import User
from app.modules.auth.permissions import Permission
from app.modules.workflow.model import AuditLog

REVISION_ID = "20260918150000"
DOWN_REVISION_ID = "20260917160000"  # alembic heads 实测唯一 head（task-03）

# 前端注册表不存在的 key——锁「后端不校验注册表，孤儿行由前端合并层忽略」（R-01）。
ORPHAN_MENU_KEY = "totally_not_in_frontend_registry"


@pytest.fixture
async def non_menu_admin_headers(db_session: AsyncSession) -> dict[str, str]:
    """无任何角色、非平台管理员的普通登录用户（不持 menu:admin）。

    构造方式对齐 test_roles_router.non_admin_token（status 默认 active，
    get_current_user 校验通过；无 user_roles / user_workspace_roles 行 →
    require_permission_any(MENU_ADMIN) 判 False → 403）。
    """
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="menu-normie@example.com",
        password_hash=password_hasher.hash("Xx1!abcd"),
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=False,
        settings=settings,
    )
    return {"Authorization": f"Bearer {token}"}


async def _menu_audit_rows(db_session: AsyncSession, action: str) -> list[AuditLog]:
    """menu_override.* 审计行（范式 tests/core/test_audit_hooks_effective.py:98）。"""
    stmt = select(AuditLog).where(AuditLog.action == action)
    return list((await db_session.execute(stmt)).scalars().all())


async def _admin_user_id(db_session: AsyncSession) -> uuid.UUID:
    """conftest auth_headers 背后的平台管理员 id（审计 actor 断言用）。"""
    stmt = select(User).where(User.email == "admin@example.com").limit(1)
    user = (await db_session.execute(stmt)).scalars().first()
    assert user is not None
    return user.id


# ---------------------------------------------------------------------------
# 1. CRUD 全链（FR-02 菜单管理页 / FR-05 下发端点）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_crud_full_chain(client: AsyncClient, auth_headers, db_session: AsyncSession):
    """CRUD 链：GET 空 → PUT 建行 → GET 回读 → DELETE 204 → GET 回空。"""
    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"items": []}

    resp = await client.put(
        "/api/menu-overrides/skills",
        json={"label": "技能中心", "sort_order": 5, "hidden": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "menu_key": "skills",
        "label": "技能中心",
        "sort_order": 5,
        "hidden": True,
    }

    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {
        "items": [{"menu_key": "skills", "label": "技能中心", "sort_order": 5, "hidden": True}]
    }

    resp = await client.delete("/api/menu-overrides/skills", headers=auth_headers)
    assert resp.status_code == 204

    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json() == {"items": []}


@pytest.mark.asyncio
async def test_put_updates_existing_override(client: AsyncClient, auth_headers):
    """PUT 二次更新：同 menu_key 整行覆盖写，仍只有一行。"""
    first = await client.put(
        "/api/menu-overrides/mcp",
        json={"label": "旧名"},
        headers=auth_headers,
    )
    assert first.status_code == 200, first.text
    assert first.json()["label"] == "旧名"
    # 未提供的维度整体覆盖写：hidden 未给即回 False（PUT 全量语义）。
    assert first.json()["hidden"] is False

    second = await client.put(
        "/api/menu-overrides/mcp",
        json={"label": "新名", "sort_order": 2, "hidden": True},
        headers=auth_headers,
    )
    assert second.status_code == 200, second.text
    assert second.json() == {
        "menu_key": "mcp",
        "label": "新名",
        "sort_order": 2,
        "hidden": True,
    }

    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    items = resp.json()["items"]
    assert len(items) == 1
    assert items[0]["label"] == "新名"


@pytest.mark.asyncio
async def test_put_null_fields_clear_back_to_default_and_keep_row(
    client: AsyncClient, auth_headers, db_session: AsyncSession
):
    """null = 清除该维度回代码默认；全 null upsert 保留行不删行（task-04 语义）。"""
    resp = await client.put(
        "/api/menu-overrides/agent-profiles",
        json={"label": "档案", "sort_order": 9, "hidden": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200

    resp = await client.put("/api/menu-overrides/agent-profiles", json={}, headers=auth_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {
        "menu_key": "agent-profiles",
        "label": None,
        "sort_order": None,
        "hidden": False,
    }

    # 行保留（整行删除是 DELETE 端点专属语义），GET 仍含该行。
    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert resp.json()["items"] == [
        {"menu_key": "agent-profiles", "label": None, "sort_order": None, "hidden": False}
    ]
    rows = (await db_session.execute(select(MenuOverride))).scalars().all()
    assert len(rows) == 1


@pytest.mark.asyncio
async def test_delete_missing_key_is_idempotent_204(client: AsyncClient, auth_headers):
    """DELETE 不存在的 menu_key → 幂等 204（不 404）。"""
    resp = await client.delete("/api/menu-overrides/never-existed", headers=auth_headers)
    assert resp.status_code == 204


@pytest.mark.asyncio
async def test_get_lists_multiple_rows_sorted_by_menu_key(client: AsyncClient, auth_headers):
    """GET 列表含多行并按 menu_key 升序（稳定排序契约）。"""
    for key in ("sessions", "skills", "mcp"):
        resp = await client.put(f"/api/menu-overrides/{key}", json={}, headers=auth_headers)
        assert resp.status_code == 200

    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert [item["menu_key"] for item in resp.json()["items"]] == ["mcp", "sessions", "skills"]


# ---------------------------------------------------------------------------
# 2. 门控（FR-02 无权限场景 / FR-05 任意已认证用户）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_endpoints_require_authentication(client: AsyncClient):
    """未认证（无凭证）→ 三端点均 401，code=HTTP_401_AUTH_TOKEN_MISSING。"""
    resp = await client.get("/api/menu-overrides")
    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    resp = await client.put("/api/menu-overrides/skills", json={"label": "x"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"

    resp = await client.delete("/api/menu-overrides/skills")
    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"


@pytest.mark.asyncio
async def test_put_delete_denied_without_menu_admin(client: AsyncClient, non_menu_admin_headers):
    """无 menu:admin 的普通用户 PUT/DELETE → 403，details.permission=menu:admin。"""
    resp = await client.put(
        "/api/menu-overrides/skills",
        json={"label": "越权改名"},
        headers=non_menu_admin_headers,
    )
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["code"].endswith("PERMISSION_DENIED")
    assert body["details"]["permission"] == Permission.MENU_ADMIN.value

    resp = await client.delete("/api/menu-overrides/skills", headers=non_menu_admin_headers)
    assert resp.status_code == 403, resp.text
    body = resp.json()
    assert body["code"].endswith("PERMISSION_DENIED")
    assert body["details"]["permission"] == Permission.MENU_ADMIN.value


@pytest.mark.asyncio
async def test_get_allowed_for_any_authenticated_user(client: AsyncClient, non_menu_admin_headers):
    """GET 仅需认证：无 menu:admin 的普通用户 200（FR-05 导航渲染消费）。"""
    resp = await client.get("/api/menu-overrides", headers=non_menu_admin_headers)
    assert resp.status_code == 200, resp.text
    assert resp.json() == {"items": []}


# ---------------------------------------------------------------------------
# 3. 参数校验 422（FR-02 非法参数场景，认证态）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_label_empty_or_too_long_rejected_422(client: AsyncClient, auth_headers):
    """label 空串 / 31 字符 → 422 中文校验错误。"""
    for bad_label in ("", "a" * 31):
        resp = await client.put(
            "/api/menu-overrides/skills",
            json={"label": bad_label},
            headers=auth_headers,
        )
        assert resp.status_code == 422, (bad_label, resp.text)
        body = resp.json()
        assert body["code"] == "validation_error"
        assert body["message"] == "请求参数校验失败，请检查输入格式。"


@pytest.mark.asyncio
async def test_put_sort_order_out_of_range_rejected_422(client: AsyncClient, auth_headers):
    """sort_order -1 / 1000 → 422（合法区间 0–999）。"""
    for bad_sort in (-1, 1000):
        resp = await client.put(
            "/api/menu-overrides/skills",
            json={"sort_order": bad_sort},
            headers=auth_headers,
        )
        assert resp.status_code == 422, (bad_sort, resp.text)
        assert resp.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_put_menu_key_too_long_rejected_422(client: AsyncClient, auth_headers):
    """menu_key 超过 64 字符（对齐列 String(64)）→ 认证态 422 而非落库 500。"""
    resp = await client.put(
        f"/api/menu-overrides/{'k' * 65}",
        json={"label": "超长 key"},
        headers=auth_headers,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_put_unknown_field_rejected_422(client: AsyncClient, auth_headers):
    """未知字段拒收（MenuOverrideUpsert extra=forbid）→ 422。"""
    resp = await client.put(
        "/api/menu-overrides/skills",
        json={"label": "x", "role_id": "hack"},
        headers=auth_headers,
    )
    assert resp.status_code == 422, resp.text
    assert resp.json()["code"] == "validation_error"


@pytest.mark.asyncio
async def test_unauthenticated_401_precedes_422(client: AsyncClient):
    """未认证 + 非法 label → 401（认证依赖先于 body 校验，不泄漏校验细节）。"""
    resp = await client.put("/api/menu-overrides/skills", json={"label": ""})
    assert resp.status_code == 401, resp.text
    assert resp.json()["code"] == "HTTP_401_AUTH_TOKEN_MISSING"


# ---------------------------------------------------------------------------
# 4. 审计落库（FR-02：覆盖变更写审计日志）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_writes_upsert_audit_rows(client: AsyncClient, auth_headers, db_session):
    """两次 PUT → 恰两行 menu_override.upserted，details 含 menu_key 与 created 标记。"""
    await client.put("/api/menu-overrides/skills", json={"label": "一"}, headers=auth_headers)
    await client.put("/api/menu-overrides/skills", json={"label": "二"}, headers=auth_headers)

    logs = await _menu_audit_rows(db_session, "menu_override.upserted")
    assert len(logs) == 2, f"expected 2 upsert audit rows, got {len(logs)}"
    admin_id = await _admin_user_id(db_session)
    for log in logs:
        assert log.resource_type == "menu_override"
        assert log.actor_id == admin_id
        assert log.workspace_id is None  # 全局配置，无 workspace 维度
        details = json.loads(log.details_json or "{}")
        assert details["menu_key"] == "skills"
        assert details["label"] in ("一", "二")
    created_flags = sorted(json.loads(log.details_json or "{}").get("created") for log in logs)
    assert created_flags == [False, True]  # 首次建行 True，二次更新 False


@pytest.mark.asyncio
async def test_delete_writes_audit_row_and_missing_delete_writes_none(
    client: AsyncClient, auth_headers, db_session
):
    """DELETE 命中 → 一行 menu_override.deleted（details 含 menu_key）；未命中不落审计。"""
    await client.put("/api/menu-overrides/mcp", json={"label": "旧"}, headers=auth_headers)
    resp = await client.delete("/api/menu-overrides/mcp", headers=auth_headers)
    assert resp.status_code == 204

    logs = await _menu_audit_rows(db_session, "menu_override.deleted")
    assert len(logs) == 1
    admin_id = await _admin_user_id(db_session)
    assert logs[0].actor_id == admin_id
    assert logs[0].resource_type == "menu_override"
    details = json.loads(logs[0].details_json or "{}")
    assert details["menu_key"] == "mcp"
    assert details["label"] == "旧"

    # 未命中 DELETE：无变更即无审计（幂等 no-op，deleted 行数不增）。
    await client.delete("/api/menu-overrides/never-existed", headers=auth_headers)
    assert len(await _menu_audit_rows(db_session, "menu_override.deleted")) == 1


# ---------------------------------------------------------------------------
# 5. 孤儿 key 容忍（FR-05 R-01：后端不校验注册表）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_put_orphan_menu_key_accepted(client: AsyncClient, auth_headers):
    """PUT 注册表不存在的 menu_key → 200 且 GET 可见（孤儿行留给前端合并层忽略）。"""
    resp = await client.put(
        f"/api/menu-overrides/{ORPHAN_MENU_KEY}",
        json={"label": "孤儿", "hidden": True},
        headers=auth_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["menu_key"] == ORPHAN_MENU_KEY

    resp = await client.get("/api/menu-overrides", headers=auth_headers)
    assert [item["menu_key"] for item in resp.json()["items"]] == [ORPHAN_MENU_KEY]


# ---------------------------------------------------------------------------
# 6. 种子迁移断言（FR-01：4 新权限授全部现存角色）
# 范式：tests/test_platform_deleted_hidden_migration.py（加载迁移模块 + SQLite
# 内存库 Operations.context 真实执行）。单 head 链已由 test_migrations_graph.py
# 全局守护，此处不重复。
# ---------------------------------------------------------------------------


def _load_migration(revision_id: str):
    """按 revision 前缀加载迁移模块（前缀精确匹配，防 merge 文件误命中）。

    本文件在 tests/modules/admin/ 下，backend 根是 parents[3]（范式文件
    test_platform_deleted_hidden_migration.py 位于 tests/ 根故为 parent.parent）。
    """
    backend_root = Path(__file__).resolve().parents[3]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and f.startswith(f"{revision_id}_") and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


def test_migration_metadata():
    mod = _load_migration(REVISION_ID)
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_seed_permission_literals_match_enum():
    """迁移内硬编码字符串与 Permission 枚举成员值一一对应（迁移 docstring 指定）。

    迁移不 import app.*（须可离线生成 SQL），漂移只能靠测试拦——含「不授
    menu:admin」的设计决策（menu:admin 授予属运营决策，走角色管理页）。
    """
    mod = _load_migration(REVISION_ID)
    assert tuple(mod.MENU_READ_PERMISSIONS) == (
        Permission.SKILL_READ.value,
        Permission.MCP_READ.value,
        Permission.AGENT_PROFILE_READ.value,
        Permission.AGENT_SESSION_READ.value,
    )
    assert Permission.MENU_ADMIN.value not in mod.MENU_READ_PERMISSIONS


def _create_pre_migration_tables(conn) -> list[str]:
    """迁移前形态最小 roles / role_permissions + 3 角色（含 1 个 disabled）。

    预置两类既有行考验幂等与零回归：
    - role_active_1 已持有 skill:read（4 key 之一，判存后不得重复插）；
    - role_active_2 持有 task:read（无关权限，upgrade 不得动）。
    返回全部 role_id（字符串形态，插入用）。
    """
    conn.execute(
        sa.text(
            """
            CREATE TABLE roles (
                id CHAR(36) PRIMARY KEY NOT NULL,
                key VARCHAR(100) NOT NULL,
                is_active BOOLEAN NOT NULL DEFAULT TRUE
            )
            """
        )
    )
    conn.execute(
        sa.text(
            """
            CREATE TABLE role_permissions (
                role_id CHAR(36) NOT NULL,
                permission VARCHAR(100) NOT NULL,
                PRIMARY KEY (role_id, permission)
            )
            """
        )
    )
    role_ids = [str(uuid.uuid4()) for _ in range(3)]
    conn.execute(
        sa.text("INSERT INTO roles (id, key, is_active) VALUES (:id, :key, :active)"),
        [
            {"id": role_ids[0], "key": "role_active_1", "active": True},
            {"id": role_ids[1], "key": "role_active_2", "active": True},
            # disabled 角色同样在种子覆盖范围内（保现状语义，迁移不筛 is_active）。
            {"id": role_ids[2], "key": "role_disabled", "active": False},
        ],
    )
    conn.execute(
        sa.text("INSERT INTO role_permissions (role_id, permission) VALUES (:r, :p)"),
        [
            {"r": role_ids[0], "p": "skill:read"},
            {"r": role_ids[1], "p": "task:read"},
        ],
    )
    return role_ids


def _run_migration_fn(engine, mod, fn_name: str) -> None:
    """在 SQLite 连接上执行迁移函数本体（alembic op 代理经 Operations.context 安装）。"""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(mod, fn_name)()


def _seeded_pairs(conn) -> set[tuple[str, str]]:
    """4 个种子 key 的全部 (role_id, permission) 行（UUID 归一到带连字符形态）。

    typed stub 的 Uuid bind processor 在 SQLite 落 hex-32 无连字符，而本文件
    预置行是带连字符 CHAR(36)——经 uuid.UUID() 归一后两种形态才可比。
    """
    mod = _load_migration(REVISION_ID)
    rows = conn.execute(
        sa.text(
            "SELECT role_id, permission FROM role_permissions "
            "WHERE permission IN (:p1, :p2, :p3, :p4)"
        ).bindparams(
            sa.bindparam("p1", mod.MENU_READ_PERMISSIONS[0]),
            sa.bindparam("p2", mod.MENU_READ_PERMISSIONS[1]),
            sa.bindparam("p3", mod.MENU_READ_PERMISSIONS[2]),
            sa.bindparam("p4", mod.MENU_READ_PERMISSIONS[3]),
        )
    ).fetchall()
    return {(str(uuid.UUID(row[0])), str(row[1])) for row in rows}


@pytest.fixture()
def seeded_engine():
    """建前置表 → 跑 upgrade → yield（downgrade / 幂等重放各自单独测）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _create_pre_migration_tables(conn)
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(engine, mod, "upgrade")
    yield engine
    engine.dispose()


def test_upgrade_grants_four_keys_to_all_roles_including_disabled(seeded_engine):
    """AC：4 新 key × 全部 roles 行（含 disabled 角色）种子授满。"""
    with seeded_engine.begin() as conn:
        role_ids = [str(uuid.UUID(row[0])) for row in conn.execute(sa.text("SELECT id FROM roles"))]
        assert len(role_ids) == 3
        expected = {
            (rid, perm)
            for rid in role_ids
            for perm in _load_migration(REVISION_ID).MENU_READ_PERMISSIONS
        }
        assert _seeded_pairs(conn) == expected


def test_upgrade_keeps_unrelated_rows_and_does_not_duplicate(seeded_engine):
    """AC：预存 skill:read 行不重复插；无关 task:read 行保留（零回归）。"""
    with seeded_engine.begin() as conn:
        # 预存的 role_active_1 × skill:read 只有一行（先查后插幂等）。
        count = conn.execute(
            sa.text(
                "SELECT COUNT(*) FROM role_permissions "
                "WHERE role_id = (SELECT id FROM roles WHERE key = 'role_active_1') "
                "AND permission = 'skill:read'"
            )
        ).scalar_one()
        assert count == 1
        # 无关权限行原样保留。
        unrelated = conn.execute(
            sa.text("SELECT COUNT(*) FROM role_permissions WHERE permission = 'task:read'")
        ).scalar_one()
        assert unrelated == 1
        # 不授 menu:admin（授予属运营决策，走角色管理页）。
        menu_admin = conn.execute(
            sa.text("SELECT COUNT(*) FROM role_permissions WHERE permission = 'menu:admin'")
        ).scalar_one()
        assert menu_admin == 0


def test_upgrade_creates_menu_overrides_table(seeded_engine):
    """AC：menu_overrides 表随 upgrade 建立（menu_key 唯一）。"""
    with seeded_engine.begin() as conn:
        names = {row[1] for row in conn.execute(sa.text("PRAGMA table_info(menu_overrides)"))}
        assert {"id", "menu_key", "label_override", "sort_order", "hidden"} <= names


def test_upgrade_seed_replay_inserts_no_duplicates(seeded_engine):
    """AC：种子重放幂等——已有授权行不重复插（先查后插判存分支）。

    alembic 本身用版本表防整段重跑，本用例直击 acceptance 的「幂等不重复
    插」：drop 掉 menu_overrides（让 create_table 可重入）但保留
    role_permissions 种子行，再跑一次 upgrade——判存应跳过全部 4 key ×
    3 角色行，仍恰 12 行无重复。
    """
    with seeded_engine.begin() as conn:
        conn.execute(sa.text("DROP TABLE menu_overrides"))
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(seeded_engine, mod, "upgrade")
    with seeded_engine.begin() as conn:
        assert len(_seeded_pairs(conn)) == 12


def test_downgrade_removes_seed_grants_and_drops_table(seeded_engine):
    """downgrade：4 key 授权行全删（含预存 skill:read）、menu_overrides 表 drop、
    无关 task:read 行保留。"""
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(seeded_engine, mod, "downgrade")
    with seeded_engine.begin() as conn:
        assert _seeded_pairs(conn) == set()
        unrelated = conn.execute(
            sa.text("SELECT COUNT(*) FROM role_permissions WHERE permission = 'task:read'")
        ).scalar_one()
        assert unrelated == 1
        assert (
            conn.execute(
                sa.text("SELECT COUNT(*) FROM sqlite_master WHERE name = 'menu_overrides'")
            ).scalar_one()
            == 0
        )
