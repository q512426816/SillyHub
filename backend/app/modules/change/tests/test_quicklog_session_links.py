"""快速修复-会话绑定模型测试（task-01 / design §8 / D-001@v1）。

Change 2026-08-25-session-spec-binding task-01：``quicklog_session_links`` 表
模型落表约束。测试走根 conftest ``db_engine`` 的 SQLite ``create_all``
（``app.modules.change.model`` 已在其 import 列表，新表自动建），**不跑
alembic**——迁移内的存量播种（``gen_random_uuid`` / ``ON CONFLICT`` 为 PG
专属语法）不进本测试路径，由 PG 环境 upgrade 验收（task constraints）。

覆盖：建行与字段落表 / 同 (workspace_id, ql_id, session_id) 二次插入被唯一
约束拦截（IntegrityError，幂等 upsert 兜底）/ 同会话多 ql_id 多对多共存 /
表元数据 FK（双 CASCADE）+ 唯一约束 + 双索引存在性。

author: qinyi
created_at: 2026-08-25
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.schema import UniqueConstraint

from app.models.base import BaseModel
from app.modules.agent.model import AgentSession
from app.modules.auth.model import User
from app.modules.change.model import QuicklogSessionLink
from app.modules.workspace.model import Workspace


async def _make_user(db_session) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"qll-{uuid.uuid4().hex[:8]}@example.com",
        password_hash="x",
        display_name="Ql",
        status="active",
        is_platform_admin=False,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _make_ws(db_session) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name="ql link ws",
        slug=f"qll-{uuid.uuid4().hex[:8]}",
        root_path=f"/tmp/ql-link-test-{uuid.uuid4().hex[:12]}",
        status="active",
        component_key="comp",
    )
    db_session.add(ws)
    await db_session.commit()
    await db_session.refresh(ws)
    return ws


async def _make_session(db_session, *, workspace_id: uuid.UUID, user_id: uuid.UUID) -> AgentSession:
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        workspace_id=workspace_id,
        provider="claude",
        status="active",
        created_at=datetime.now(UTC),
    )
    db_session.add(s)
    await db_session.commit()
    await db_session.refresh(s)
    return s


def _make_link(workspace_id: uuid.UUID, session_id: uuid.UUID, ql_id: str) -> QuicklogSessionLink:
    return QuicklogSessionLink(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        ql_id=ql_id,
        session_id=session_id,
    )


async def test_create_link_row_persists_all_fields(db_session):
    """建行：自然键三元组全字段落表（created_at 由默认值补齐，非 NULL）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    db_session.add(_make_link(ws.id, s.id, ql_id="ql-20260825-001-a"))
    await db_session.commit()

    row = (
        (
            await db_session.execute(
                select(QuicklogSessionLink).where(QuicklogSessionLink.ql_id == "ql-20260825-001-a")
            )
        )
        .scalars()
        .one()
    )
    assert row.workspace_id == ws.id
    assert row.session_id == s.id
    assert row.created_at is not None


async def test_duplicate_pair_rejected_by_unique_constraint(db_session):
    """同 (workspace_id, ql_id, session_id) 二次插入 → IntegrityError（D-001 幂等兜底）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    db_session.add(_make_link(ws.id, s.id, ql_id="ql-20260825-002"))
    await db_session.commit()

    db_session.add(_make_link(ws.id, s.id, ql_id="ql-20260825-002"))
    with pytest.raises(IntegrityError):
        await db_session.commit()


async def test_same_session_multiple_ql_ids_coexist(db_session):
    """多对多：同一会话绑定多个快速修复条目（不同 ql_id 共存，互不排斥）。"""
    user = await _make_user(db_session)
    ws = await _make_ws(db_session)
    s = await _make_session(db_session, workspace_id=ws.id, user_id=user.id)
    db_session.add(_make_link(ws.id, s.id, ql_id="ql-20260825-003-a"))
    db_session.add(_make_link(ws.id, s.id, ql_id="ql-20260825-003-b"))
    await db_session.commit()

    rows = (
        (
            await db_session.execute(
                select(QuicklogSessionLink).where(QuicklogSessionLink.session_id == s.id)
            )
        )
        .scalars()
        .all()
    )
    assert {r.ql_id for r in rows} == {"ql-20260825-003-a", "ql-20260825-003-b"}


def test_table_metadata_fk_unique_and_indexes():
    """表元数据：注册进 metadata（create_all 可建）+ 双 CASCADE FK + 唯一约束 + 双索引。"""
    table = QuicklogSessionLink.__table__
    # 模型已注册进 BaseModel.metadata → 根 conftest create_all 会建本表
    assert BaseModel.metadata.tables["quicklog_session_links"] is table

    # FK 列存在性：workspaces.id / agent_sessions.id 双 CASCADE（design §8）
    fks = {fk.target_fullname: fk.ondelete for fk in table.foreign_keys}
    assert fks == {"workspaces.id": "CASCADE", "agent_sessions.id": "CASCADE"}

    # 唯一约束 uq_quicklog_session_link_pair(workspace_id, ql_id, session_id)
    uq = next(
        c
        for c in table.constraints
        if isinstance(c, UniqueConstraint) and c.name == "uq_quicklog_session_link_pair"
    )
    assert tuple(col.name for col in uq.columns) == ("workspace_id", "ql_id", "session_id")

    # 双索引：条目→会话列表查询键 + 会话侧反查键
    indexes = {ix.name: tuple(ix.columns.keys()) for ix in table.indexes}
    assert indexes["ix_quicklog_session_link_ql"] == ("workspace_id", "ql_id")
    assert indexes["ix_quicklog_session_link_session"] == ("session_id",)
