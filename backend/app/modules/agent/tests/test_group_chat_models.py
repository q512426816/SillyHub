"""群聊数据模型与迁移测试（2026-09-01-session-group-chat task-01，design §3.1-§3.4）。

覆盖任务卡验收：

- 迁移 up/down 真实可执行（SQLite ``Operations.context`` replay，范式照
  ``tests/test_platform_deleted_hidden_migration.py`` 先例）+ up→down→up 幂等；
- ``agent_sessions.session_kind`` server_default 'chat'——存量行免回填即得
  chat 语义、raw INSERT 不传列同得 'chat'（约束：存量行为零变更）；
- ``agent_run_logs.metadata`` JSON NULL 列（DB 列名 ``metadata`` / ORM 属性
  ``metadata_``——SQLAlchemy ``metadata`` 保留名，daemon/model.py 同款先例）；
- UNIQUE(group_id, display_name)：同群同名昵称拒绝（用户与 agent 共用同一
  命名空间，design §3.3）；部分唯一 (group_id, user_id) WHERE user_id IS NOT
  NULL：同用户重复邀请拒绝、agent 成员（user_id NULL）多行不冲突
  （uq_agent_missions_session_active 部分唯一先例）；
- agent 成员六要素列（runtime_id/workspace_id/provider/llm_provider_id/
  agent_profile_id/config_snapshot + display_name）读写往返（``db_session``
  真实 SQL，SQLite in-memory）。
"""

from __future__ import annotations

import importlib
import os
import uuid
from datetime import UTC, datetime

import pytest
import sqlalchemy as sa

from app.modules.agent.model import AgentGroupChat, AgentGroupMember, AgentRunLog, AgentSession

REVISION_ID = "20260902010000"
DOWN_REVISION_ID = "20260831150000"  # execute 实测唯一 head（alembic heads 单头）


def _load_migration(revision_id: str):
    """Load migration module by matching revision ID in filename（先例同款）。"""
    from pathlib import Path

    backend_root = Path(__file__).resolve().parents[4]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. Migration metadata（AC：单 revision / 接唯一 head / upgrade+downgrade 可调用）
# ---------------------------------------------------------------------------


def test_migration_metadata() -> None:
    mod = _load_migration(REVISION_ID)
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_revision_id_fits_alembic_version_column() -> None:
    # alembic_version.version_num is varchar(32) — revision id must fit.
    assert len(REVISION_ID) <= 32


def test_alembic_single_head_chain() -> None:
    """迁移挂载后 alembic 图仍是单 head（防并行撞 head 分叉，design §3.4）。"""
    from pathlib import Path

    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parents[4]
    sd = ScriptDirectory(str(backend_root / "migrations"))
    heads = sd.get_heads()
    assert len(heads) == 1, f"expected single head, got {heads}"
    chain_ids = {rev.revision for rev in sd.walk_revisions()}
    assert REVISION_ID in chain_ids, f"revision {REVISION_ID} not reachable from head"


# ---------------------------------------------------------------------------
# 2. SQLite 真实执行（Operations.context 跑 upgrade/downgrade，断言真实副作用）
# ---------------------------------------------------------------------------


def _create_pre_migration_tables(conn) -> None:
    """迁移前形态的最小两张表（不含新列）+ agent_sessions 一条存量行。"""
    conn.execute(
        sa.text(
            """
            CREATE TABLE agent_sessions (
                id CHAR(36) PRIMARY KEY NOT NULL,
                user_id CHAR(36) NOT NULL,
                provider VARCHAR(30) NOT NULL,
                status VARCHAR(20) NOT NULL
            )
            """
        )
    )
    conn.execute(
        sa.text(
            """
            CREATE TABLE agent_run_logs (
                id CHAR(36) PRIMARY KEY NOT NULL,
                run_id CHAR(36) NOT NULL,
                timestamp DATETIME NOT NULL,
                channel VARCHAR(20) NOT NULL
            )
            """
        )
    )
    conn.execute(
        sa.text(
            "INSERT INTO agent_sessions (id, user_id, provider, status) VALUES (:i, :u, :p, :s)"
        ),
        {
            "i": str(uuid.uuid4()),
            "u": str(uuid.uuid4()),
            "p": "claude",
            "s": "active",
        },
    )
    conn.execute(
        sa.text(
            "INSERT INTO agent_run_logs (id, run_id, timestamp, channel) VALUES (:i, :r, :t, :c)"
        ),
        {
            "i": str(uuid.uuid4()),
            "r": str(uuid.uuid4()),
            "t": datetime.now(UTC).isoformat(),
            "c": "user_input",
        },
    )


def _run_migration_fn(engine, mod, fn_name: str) -> None:
    """在 SQLite 连接上执行迁移函数本体（alembic op 代理经 Operations.context 安装）。"""
    from alembic.migration import MigrationContext
    from alembic.operations import Operations

    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        with Operations.context(ctx):
            getattr(mod, fn_name)()


def _pragma_column(conn, table: str, column: str) -> tuple[str, int, str] | None:
    """PRAGMA table_info 单列 → (type, notnull, dflt_value)。"""
    for _cid, name, col_type, notnull, dflt_value, _pk in conn.execute(
        sa.text(f"PRAGMA table_info({table})")
    ):
        if name == column:
            return str(col_type), int(notnull), str(dflt_value)
    return None


def _table_names(conn) -> set[str]:
    rows = conn.execute(sa.text("SELECT name FROM sqlite_master WHERE type='table'")).fetchall()
    return {str(r[0]) for r in rows}


def _index_names(conn, table: str) -> set[str]:
    rows = conn.execute(sa.text(f"PRAGMA index_list({table})")).fetchall()
    return {str(r[1]) for r in rows}


@pytest.fixture()
def migrated_engine():
    """建前置表 → 跑 upgrade → yield（downgrade 侧单独测）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _create_pre_migration_tables(conn)
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(engine, mod, "upgrade")
    yield engine
    engine.dispose()


def _insert_group_row(
    conn,
    *,
    group_id: uuid.UUID,
    session_id: uuid.UUID | None = None,
) -> None:
    """raw INSERT 一行 agent_group_chats（NOT NULL 列全显式给值——默认在 ORM
    Python 侧，建表不设 server_default，20260829010000 先例）。"""
    conn.execute(
        sa.text(
            "INSERT INTO agent_group_chats "
            "(id, session_id, workspace_id, title, created_by, agent_cross_mention, "
            "cross_mention_depth, context_window, created_at) "
            "VALUES (:i, :s, :w, :t, :c, 1, 2, 20, :at)"
        ),
        {
            "i": str(group_id),
            "s": str(session_id or uuid.uuid4()),
            "w": str(uuid.uuid4()),
            "t": "项目协作群",
            "c": str(uuid.uuid4()),
            "at": datetime.now(UTC).isoformat(),
        },
    )


def _insert_member_row(
    conn,
    *,
    group_id: uuid.UUID,
    display_name: str,
    member_type: str = "agent",
    user_id: uuid.UUID | None = None,
) -> None:
    conn.execute(
        sa.text(
            "INSERT INTO agent_group_members "
            "(id, group_id, member_type, display_name, user_id, shadow_status, joined_at) "
            "VALUES (:i, :g, :mt, :dn, :u, 'none', :at)"
        ),
        {
            "i": str(uuid.uuid4()),
            "g": str(group_id),
            "mt": member_type,
            "dn": display_name,
            "u": str(user_id) if user_id else None,
            "at": datetime.now(UTC).isoformat(),
        },
    )


def test_upgrade_adds_session_kind_with_default(migrated_engine) -> None:
    """AC：session_kind 列存在 + VARCHAR(16) + NOT NULL + server_default 'chat'。"""
    with migrated_engine.begin() as conn:
        assert _pragma_column(conn, "agent_sessions", "session_kind") == (
            "VARCHAR(16)",
            1,
            "'chat'",
        )
        assert "ix_agent_sessions_session_kind" in _index_names(conn, "agent_sessions")


def test_session_kind_backfills_existing_rows(migrated_engine) -> None:
    """AC/约束：存量行不回填 SQL 也拿到 'chat'（行为零变更）。"""
    with migrated_engine.begin() as conn:
        row = conn.execute(sa.text("SELECT session_kind FROM agent_sessions LIMIT 1")).fetchone()
        assert row is not None and row[0] == "chat"


def test_session_kind_fills_new_rows_without_column(migrated_engine) -> None:
    """正常路径：raw INSERT 不指定列 → server_default 落 'chat'（DB 级默认）。"""
    with migrated_engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO agent_sessions (id, user_id, provider, status) VALUES (:i, :u, :p, :s)"
            ),
            {"i": str(uuid.uuid4()), "u": str(uuid.uuid4()), "p": "claude", "s": "active"},
        )
        row = conn.execute(
            sa.text(
                "SELECT session_kind FROM agent_sessions WHERE provider = 'claude' "
                "ORDER BY rowid DESC LIMIT 1"
            )
        ).fetchone()
        assert row is not None and row[0] == "chat"


def test_upgrade_adds_run_log_metadata_column(migrated_engine) -> None:
    """AC：agent_run_logs.metadata JSON NULL 列（投影行身份承载，存量行 NULL）。"""
    with migrated_engine.begin() as conn:
        assert _pragma_column(conn, "agent_run_logs", "metadata") is not None
        # 存量行不回填（NULL）
        row = conn.execute(sa.text("SELECT metadata FROM agent_run_logs LIMIT 1")).fetchone()
        assert row is not None and row[0] is None


def test_upgrade_creates_group_tables(migrated_engine) -> None:
    """AC：agent_group_chats / agent_group_members 建表。"""
    with migrated_engine.begin() as conn:
        tables = _table_names(conn)
        assert "agent_group_chats" in tables
        assert "agent_group_members" in tables
        # 关键列抽查（全列对齐由 ORM 契约测试守门）
        for col in (
            "session_id",
            "workspace_id",
            "title",
            "created_by",
            "agent_cross_mention",
            "cross_mention_depth",
            "context_window",
            "settings_json",
            "created_at",
            "ended_at",
            "deleted_at",
        ):
            assert _pragma_column(conn, "agent_group_chats", col) is not None, col
        for col in (
            "group_id",
            "member_type",
            "display_name",
            "user_id",
            "runtime_id",
            "workspace_id",
            "provider",
            "llm_provider_id",
            "agent_profile_id",
            "config_snapshot",
            "shadow_session_id",
            "shadow_status",
            "invited_by",
            "joined_at",
            "removed_at",
        ):
            assert _pragma_column(conn, "agent_group_members", col) is not None, col


def test_migration_level_unique_display_name_rejected(migrated_engine) -> None:
    """AC：UNIQUE(group_id, display_name)——同群同名昵称插入被拒（迁移建表侧）。"""
    with migrated_engine.begin() as conn:
        group_id = uuid.uuid4()
        _insert_group_row(conn, group_id=group_id)
        _insert_member_row(conn, group_id=group_id, display_name="小码")
    with pytest.raises(sa.exc.IntegrityError):
        with migrated_engine.begin() as conn:
            _insert_member_row(conn, group_id=group_id, display_name="小码")


def test_migration_level_duplicate_user_invite_rejected(migrated_engine) -> None:
    """AC：部分唯一 (group_id, user_id)——同群同用户二次邀请被拒；
    agent 成员（user_id NULL）多行互不冲突（NULL 不参与唯一约束）。"""
    user_id = uuid.uuid4()
    with migrated_engine.begin() as conn:
        group_id = uuid.uuid4()
        _insert_group_row(conn, group_id=group_id)
        # 两个 agent 成员 user_id 均 NULL——不冲突
        _insert_member_row(conn, group_id=group_id, display_name="小码")
        _insert_member_row(conn, group_id=group_id, display_name="鲸落")
        # 用户成员
        _insert_member_row(
            conn, group_id=group_id, display_name="小英", member_type="user", user_id=user_id
        )
    with pytest.raises(sa.exc.IntegrityError):
        with migrated_engine.begin() as conn:
            _insert_member_row(
                conn,
                group_id=group_id,
                display_name="小英2",
                member_type="user",
                user_id=user_id,
            )


def test_migration_level_group_session_unique(migrated_engine) -> None:
    """design §3.2：session_id UNIQUE——两个群不能共用同一条时间线会话。"""
    session_id = uuid.uuid4()
    with migrated_engine.begin() as conn:
        _insert_group_row(conn, group_id=uuid.uuid4(), session_id=session_id)
    with pytest.raises(sa.exc.IntegrityError):
        with migrated_engine.begin() as conn:
            _insert_group_row(conn, group_id=uuid.uuid4(), session_id=session_id)


def test_downgrade_rolls_back_fully() -> None:
    """AC：downgrade 真实执行——两表消失、两列消失、原列保留（对称可回滚）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _create_pre_migration_tables(conn)
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(engine, mod, "upgrade")
    _run_migration_fn(engine, mod, "downgrade")
    with engine.begin() as conn:
        tables = _table_names(conn)
        assert "agent_group_members" not in tables
        assert "agent_group_chats" not in tables
        assert _pragma_column(conn, "agent_sessions", "session_kind") is None
        assert _pragma_column(conn, "agent_run_logs", "metadata") is None
        # 原有列不受 downgrade 影响
        assert _pragma_column(conn, "agent_sessions", "provider") is not None
        assert "ix_agent_sessions_session_kind" not in _index_names(conn, "agent_sessions")
    engine.dispose()


def test_upgrade_downgrade_upgrade_idempotent() -> None:
    """AC：up → down → up 循环可重复执行（幂等，无残留状态）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _create_pre_migration_tables(conn)
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(engine, mod, "upgrade")
    _run_migration_fn(engine, mod, "downgrade")
    _run_migration_fn(engine, mod, "upgrade")
    with engine.begin() as conn:
        tables = _table_names(conn)
        assert "agent_group_chats" in tables and "agent_group_members" in tables
        assert _pragma_column(conn, "agent_sessions", "session_kind") is not None
    engine.dispose()


# ---------------------------------------------------------------------------
# 3. ORM 契约（模型声明与 design §3.1-§3.3 逐列对齐，防 autogenerate 漂移）
# ---------------------------------------------------------------------------


def test_agent_session_session_kind_contract() -> None:
    """session_kind：String(16) NOT NULL + server_default 'chat' + Python 默认。"""
    field = AgentSession.model_fields["session_kind"]
    assert field.default == "chat"
    sa_column = field.sa_column
    assert isinstance(sa_column.type, sa.String)
    assert sa_column.type.length == 16
    assert sa_column.nullable is False
    assert sa_column.server_default is not None
    assert str(sa_column.server_default.arg) == "'chat'"


def test_agent_session_session_kind_index_declared() -> None:
    """ix_agent_sessions_session_kind 声明在 __table_args__（design §3.1）。"""
    table = AgentSession.__table__
    assert "ix_agent_sessions_session_kind" in {idx.name for idx in table.indexes}


def test_agent_run_log_metadata_reserved_name_mapping() -> None:
    """metadata_ 属性 ↔ DB 列名 metadata（保留名先例，daemon/model.py 同款）。"""
    field = AgentRunLog.model_fields["metadata_"]
    assert field.default is None
    sa_column = field.sa_column
    assert sa_column.name == "metadata"
    assert isinstance(sa_column.type, sa.JSON)
    assert sa_column.nullable is True
    # ORM 表层面：列名必须是 metadata（迁移/DB 对齐）
    assert "metadata" in AgentRunLog.__table__.columns
    assert "metadata_" not in AgentRunLog.__table__.columns


def test_agent_group_chat_table_contract() -> None:
    assert AgentGroupChat.__tablename__ == "agent_group_chats"
    expected = {
        "id",
        "session_id",
        "workspace_id",
        "title",
        "created_by",
        "agent_cross_mention",
        "cross_mention_depth",
        "context_window",
        "settings_json",
        "created_at",
        "ended_at",
        "deleted_at",
    }
    actual = set(AgentGroupChat.model_fields.keys())
    assert actual == expected, (
        f"AgentGroupChat field mismatch. missing={expected - actual}, extra={actual - expected}"
    )


def test_agent_group_chat_defaults() -> None:
    group = AgentGroupChat(
        session_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        title="项目协作群",
        created_by=uuid.uuid4(),
    )
    assert group.agent_cross_mention is True
    assert group.cross_mention_depth == 2
    assert group.context_window == 20
    assert group.settings_json is None
    assert group.ended_at is None
    assert group.deleted_at is None
    assert group.created_at is not None


def test_agent_group_chat_unique_constraints_declared() -> None:
    table = AgentGroupChat.__table__
    names = {c.name for c in table.constraints}
    assert "uq_agent_group_chats_session" in names
    session_col = table.columns["session_id"]
    fks = list(session_col.foreign_keys)
    assert len(fks) == 1 and fks[0].column.table.name == "agent_sessions"


def test_agent_group_member_table_contract() -> None:
    assert AgentGroupMember.__tablename__ == "agent_group_members"
    expected = {
        "id",
        "group_id",
        "member_type",
        "display_name",
        "user_id",
        "runtime_id",
        "workspace_id",
        "provider",
        "llm_provider_id",
        "agent_profile_id",
        "config_snapshot",
        "shadow_session_id",
        "shadow_status",
        "invited_by",
        "joined_at",
        "removed_at",
    }
    actual = set(AgentGroupMember.model_fields.keys())
    assert actual == expected, (
        f"AgentGroupMember field mismatch. missing={expected - actual}, extra={actual - expected}"
    )


def test_agent_group_member_defaults() -> None:
    member = AgentGroupMember(
        group_id=uuid.uuid4(),
        member_type="agent",
        display_name="小码",
    )
    assert member.shadow_status == "none"
    assert member.user_id is None
    assert member.runtime_id is None
    assert member.workspace_id is None
    assert member.provider is None
    assert member.llm_provider_id is None
    assert member.agent_profile_id is None
    assert member.config_snapshot is None
    assert member.shadow_session_id is None
    assert member.invited_by is None
    assert member.removed_at is None
    assert member.joined_at is not None


def test_agent_group_member_unique_constraints_declared() -> None:
    """UNIQUE(group_id, display_name) + 部分唯一 (group_id, user_id)。"""
    table = AgentGroupMember.__table__
    names = {c.name for c in table.constraints}
    assert "uq_agent_group_members_group_display_name" in names
    partial = [idx for idx in table.indexes if idx.name == "uq_agent_group_members_group_user"]
    assert len(partial) == 1
    assert partial[0].unique is True
    # 双方言部分唯一（PG postgresql_where / 测试 SQLite sqlite_where）
    assert partial[0].dialect_options["postgresql"]["where"] is not None
    assert partial[0].dialect_options["sqlite"]["where"] is not None


# ---------------------------------------------------------------------------
# 4. ORM 真实读写（db_session fixture：SQLite in-memory create_all）
# ---------------------------------------------------------------------------


def _make_group(db_session) -> AgentGroupChat:
    group = AgentGroupChat(
        session_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        title="项目协作群",
        created_by=uuid.uuid4(),
    )
    db_session.add(group)
    return group


async def test_orm_session_kind_default_round_trip(db_session) -> None:
    """AC：ORM 构造不传 session_kind → 'chat'（存量单聊语义零回归）。"""
    session = AgentSession(user_id=uuid.uuid4(), provider="claude")
    db_session.add(session)
    await db_session.commit()
    await db_session.refresh(session)
    assert session.session_kind == "chat"


async def test_orm_group_models_round_trip(db_session) -> None:
    """AC：群 + 用户成员 + agent 成员六要素列读写往返。"""
    group = _make_group(db_session)
    user_member = AgentGroupMember(
        group_id=group.id,
        member_type="user",
        display_name="小英",
        user_id=uuid.uuid4(),
        invited_by=group.created_by,
    )
    runtime_id = uuid.uuid4()
    ws_id = uuid.uuid4()
    llm_id = uuid.uuid4()
    profile_id = uuid.uuid4()
    shadow_session_id = uuid.uuid4()
    agent_member = AgentGroupMember(
        group_id=group.id,
        member_type="agent",
        display_name="小码",
        runtime_id=runtime_id,
        workspace_id=ws_id,
        provider="claude",
        llm_provider_id=llm_id,
        agent_profile_id=profile_id,
        config_snapshot={"machine_name": "dev-01", "agent_name": "小码", "profile_name": "默认"},
        shadow_session_id=shadow_session_id,
        shadow_status="active",
        invited_by=group.created_by,
    )
    db_session.add_all([user_member, agent_member])
    await db_session.commit()

    rows = (
        (await db_session.execute(sa.select(AgentGroupMember).order_by(AgentGroupMember.id)))
        .scalars()
        .all()
    )
    assert len(rows) == 2
    agent = next(r for r in rows if r.member_type == "agent")
    # 六要素逐列往返
    assert agent.display_name == "小码"
    assert agent.runtime_id == runtime_id
    assert agent.workspace_id == ws_id
    assert agent.provider == "claude"
    assert agent.llm_provider_id == llm_id
    assert agent.agent_profile_id == profile_id
    assert agent.config_snapshot == {
        "machine_name": "dev-01",
        "agent_name": "小码",
        "profile_name": "默认",
    }
    # 反向指针 + 状态
    assert agent.shadow_session_id == shadow_session_id
    assert agent.shadow_status == "active"
    # 群行默认值
    fresh = await db_session.get(AgentGroupChat, group.id)
    assert fresh is not None
    assert fresh.agent_cross_mention is True
    assert fresh.cross_mention_depth == 2
    assert fresh.context_window == 20


async def test_orm_run_log_metadata_round_trip(db_session) -> None:
    """AC：AgentRunLog.metadata_ 投影行身份 JSON 读写往返（列名 metadata）。"""
    from app.modules.agent.model import AgentRun

    run = AgentRun(agent_type="claude_code")
    db_session.add(run)
    await db_session.flush()
    log = AgentRunLog(
        run_id=run.id,
        channel="stdout",
        content_redacted="已定位问题",
        metadata_={"member_id": "m1", "member_name": "小码", "source_log_id": "log-1"},
    )
    db_session.add(log)
    await db_session.commit()

    fetched = await db_session.get(AgentRunLog, log.id)
    assert fetched is not None
    assert fetched.metadata_ == {"member_id": "m1", "member_name": "小码", "source_log_id": "log-1"}


async def test_orm_duplicate_display_name_rejected(db_session) -> None:
    """AC：UNIQUE(group_id, display_name)——用户与 agent 同名（或任意重复）被拒。"""
    group = _make_group(db_session)
    db_session.add(
        AgentGroupMember(
            group_id=group.id,
            member_type="agent",
            display_name="小码",
        )
    )
    await db_session.commit()
    db_session.add(
        AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name="小码",
            user_id=uuid.uuid4(),
        )
    )
    with pytest.raises(sa.exc.IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_orm_duplicate_user_invite_rejected(db_session) -> None:
    """AC：部分唯一 (group_id, user_id)——同群同用户重复邀请被拒；
    agent 成员多行（user_id NULL）不受约束。"""
    group = _make_group(db_session)
    user_id = uuid.uuid4()
    db_session.add_all(
        [
            AgentGroupMember(
                group_id=group.id, member_type="user", display_name="小英", user_id=user_id
            ),
            # 两个 agent 成员 user_id 均 NULL——不冲突
            AgentGroupMember(group_id=group.id, member_type="agent", display_name="小码"),
            AgentGroupMember(group_id=group.id, member_type="agent", display_name="鲸落"),
        ]
    )
    await db_session.commit()
    db_session.add(
        AgentGroupMember(
            group_id=group.id,
            member_type="user",
            display_name="小英2",
            user_id=user_id,
        )
    )
    with pytest.raises(sa.exc.IntegrityError):
        await db_session.commit()
    await db_session.rollback()


async def test_orm_group_session_unique_rejected(db_session) -> None:
    """design §3.2：session_id UNIQUE——两群共用同一条时间线会话被拒。"""
    session_id = uuid.uuid4()
    db_session.add(
        AgentGroupChat(
            session_id=session_id,
            workspace_id=uuid.uuid4(),
            title="群一",
            created_by=uuid.uuid4(),
        )
    )
    await db_session.commit()
    db_session.add(
        AgentGroupChat(
            session_id=session_id,
            workspace_id=uuid.uuid4(),
            title="群二",
            created_by=uuid.uuid4(),
        )
    )
    with pytest.raises(sa.exc.IntegrityError):
        await db_session.commit()
    await db_session.rollback()


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
