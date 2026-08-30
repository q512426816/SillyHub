"""audit_hooks 全局挂载生效用例（task-05 / 2026-08-14-audit-system-completion）。

区别于 ``app/modules/workflow/tests/test_audit_hooks.py`` 的钩子单元行为，这里按
design §4.5/FR-06 验证生产挂载路径（main.py lifespan 调 ``register_audit_hooks``
后）五场景端到端行为：

1. 有 audit_context 的 insert → 恰 1 条 AuditLog（action=<resource>.insert）；
2. 有 audit_context 的 update（真实改字段）→ 1 条，details 含 changed_fields/from/to；
3. **无** audit_context 的写 → 不产生审计行（daemon/后台写豁免，D-01）；
4. audit_logs 自身写入不递归（计数只增 1，不多增）；
5. 复合主键表（role_permissions）写入不产生审计（``_get_resource_id`` None 跳过）。

每个测试的 ``db_engine`` 是 function 级独立 in-memory SQLite，行数断言互不污染。
"""

from __future__ import annotations

import json
import uuid

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.audit_hooks import register_audit_hooks
from app.modules.auth.model import Role, RolePermission, User
from app.modules.change.model import Change
from app.modules.workflow.model import AuditLog
from app.modules.workspace.model import Workspace

# ---------------------------------------------------------------------------
# Hooks 全局注册一次（Mapper 事件是进程级全局，engine 参数仅 API 兼容）
# ---------------------------------------------------------------------------

_hooks_registered = False


def _maybe_register_hooks() -> None:
    global _hooks_registered
    if _hooks_registered:
        return
    from sqlalchemy.ext.asyncio import create_async_engine

    register_audit_hooks(create_async_engine("sqlite+aiosqlite:///:memory:", future=True))
    _hooks_registered = True


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


async def _seed_user_and_workspace(session: AsyncSession) -> tuple[User, Workspace]:
    """Create prerequisite User + Workspace WITHOUT audit_context（豁免路径）。"""
    user = User(
        id=uuid.UUID("00000000-0000-0000-0000-000000000011"),
        email="hooks-effective@example.com",
        password_hash="$2b$04$dummyhashnotforproduction",
        display_name="Hooks Effective User",
        status="active",
    )
    ws = Workspace(
        id=uuid.UUID("00000000-0000-0000-0000-000000000012"),
        name="Hooks Effective WS",
        slug="hooks-effective",
        root_path="/tmp/hooks-effective",
        status="active",
    )
    session.add(user)
    session.add(ws)
    await session.commit()
    return user, ws


def _set_ctx(session: AsyncSession, actor_id: uuid.UUID, workspace_id: uuid.UUID) -> None:
    session.info["audit_context"] = {"actor_id": actor_id, "workspace_id": workspace_id}


def _clear_ctx(session: AsyncSession) -> None:
    session.info.pop("audit_context", None)


def _make_change(ws: Workspace, **overrides) -> Change:
    defaults = dict(
        id=uuid.uuid4(),
        workspace_id=ws.id,
        change_key=f"hooks-{uuid.uuid4().hex[:8]}",
        title="Hooks Effective Change",
        status="draft",
        location="active",
        path=".sillyspec/changes/hooks-effective",
    )
    defaults.update(overrides)
    return Change(**defaults)


async def _all_audit_logs(session: AsyncSession) -> list[AuditLog]:
    return list((await session.execute(select(AuditLog))).scalars().all())


async def _audit_logs_where(session: AsyncSession, **filters) -> list[AuditLog]:
    stmt = select(AuditLog)
    for key, value in filters.items():
        stmt = stmt.where(getattr(AuditLog, key) == value)
    return list((await session.execute(stmt)).scalars().all())


# ---------------------------------------------------------------------------
# 场景 1：有 audit_context 的 insert → 恰 1 条 AuditLog
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_insert_with_context_produces_single_audit_log(db_session: AsyncSession) -> None:
    _maybe_register_hooks()
    user, ws = await _seed_user_and_workspace(db_session)
    assert await _all_audit_logs(db_session) == []  # 前置数据无 ctx，不产生审计

    _set_ctx(db_session, user.id, ws.id)
    change = _make_change(ws)
    db_session.add(change)
    await db_session.commit()

    logs = await _all_audit_logs(db_session)
    assert len(logs) == 1, f"expected exactly 1 audit row, got {len(logs)}"
    log = logs[0]
    assert log.action == "change.insert"
    assert log.resource_type == "change"
    assert log.resource_id == change.id
    assert log.actor_id == user.id
    assert log.workspace_id == ws.id
    details = json.loads(log.details_json or "{}")
    assert details["fields"]["status"] == "draft"


# ---------------------------------------------------------------------------
# 场景 2：有 audit_context 的 update（真实改字段）→ 1 条 changed_fields/from/to
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_with_context_records_changed_fields(db_session: AsyncSession) -> None:
    _maybe_register_hooks()
    user, ws = await _seed_user_and_workspace(db_session)

    _set_ctx(db_session, user.id, ws.id)
    change = _make_change(ws)
    db_session.add(change)
    await db_session.commit()
    assert len(await _all_audit_logs(db_session)) == 1  # insert 审计

    change.status = "proposed"
    db_session.add(change)
    await db_session.commit()

    update_logs = await _audit_logs_where(db_session, action="change.update")
    assert len(update_logs) == 1
    log = update_logs[0]
    assert log.resource_id == change.id
    assert log.actor_id == user.id
    details = json.loads(log.details_json or "{}")
    assert details["changed_fields"] == ["status"]
    assert details["from"]["status"] == "draft"
    assert details["to"]["status"] == "proposed"


# ---------------------------------------------------------------------------
# 场景 3（核心断言）：无 audit_context 的写 → 不产生审计行（D-01 后台写豁免）
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_write_without_context_produces_no_audit_log(db_session: AsyncSession) -> None:
    _maybe_register_hooks()
    _clear_ctx(db_session)

    user, ws = await _seed_user_and_workspace(db_session)
    change = _make_change(ws)
    db_session.add(change)
    await db_session.commit()

    change.status = "proposed"
    db_session.add(change)
    await db_session.commit()

    logs = await _all_audit_logs(db_session)
    assert logs == [], f"writes without audit_context must not be audited, got {len(logs)} rows"

    # 数据本身正常落库（豁免审计 ≠ 豁免写入）
    await db_session.refresh(change)
    assert change.status == "proposed"
    assert await db_session.get(User, user.id) is not None


# ---------------------------------------------------------------------------
# 场景 4：audit_logs 自身写入不递归
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_audit_log_self_write_does_not_recurse(db_session: AsyncSession) -> None:
    _maybe_register_hooks()
    user, ws = await _seed_user_and_workspace(db_session)

    _set_ctx(db_session, user.id, ws.id)
    change = _make_change(ws)
    db_session.add(change)
    await db_session.commit()

    count_before = len(await _all_audit_logs(db_session))
    assert count_before >= 1

    # 带 ctx 直接经 ORM 写一条 AuditLog → 计数只 +1（手动那条），不得 +2（递归）
    db_session.add(
        AuditLog(
            id=uuid.uuid4(),
            workspace_id=ws.id,
            actor_id=user.id,
            action="manual.probe",
            resource_type="change",
            resource_id=change.id,
            details_json=json.dumps({"probe": True}),
        )
    )
    await db_session.commit()

    logs = await _all_audit_logs(db_session)
    assert len(logs) == count_before + 1, "audit_logs insert must not trigger a nested audit row"
    assert await _audit_logs_where(db_session, action="audit_log.insert") == []


# ---------------------------------------------------------------------------
# 场景 5：复合主键表（role_permissions）写入不产生审计
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_composite_pk_table_write_not_audited(db_session: AsyncSession) -> None:
    _maybe_register_hooks()
    user, ws = await _seed_user_and_workspace(db_session)

    _set_ctx(db_session, user.id, ws.id)
    role = Role(id=uuid.uuid4(), key=f"hooks-{uuid.uuid4().hex[:6]}", name="Hooks Role")
    db_session.add(role)
    await db_session.commit()

    db_session.add(RolePermission(role_id=role.id, permission="workspace:read"))
    await db_session.commit()  # 不得抛错（复合 PK 无单 UUID id）

    assert await _audit_logs_where(db_session, resource_type="role_permission") == []

    # 对照：单 UUID PK 的 role insert 正常审计
    role_logs = await _audit_logs_where(db_session, resource_type="role")
    assert len(role_logs) == 1
    assert role_logs[0].action == "role.insert"
