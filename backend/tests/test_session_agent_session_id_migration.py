"""Mapping test for the ``20260821120000_backfill_session_agent_session_id`` data
migration（task-02 / DS-2，变更 2026-08-21-session-reopen-resume）。

背景：reopen 硬依赖 ``agent_sessions.agent_session_id``（SDK resume key，空则 409），
但存量历史会话该列全 NULL。本迁移一次性回填：为 ``agent_session_id IS NULL`` 且
``provider IN ('claude','codex')`` 且 ``deleted_at IS NULL`` 的会话，取其
``agent_runs`` 中 ``created_at`` 最新且 ``session_id`` 非空那条的值（fork 场景取
最新 id）。无合格 run 的老会话保持 NULL（reopen 维持 409，design 风险表已登记）。

测试范式参照 ``tests/test_session_zombie_migration.py``：迁移本体用 PG 方言 raw
SQL，SQLite 跑不了完整 ``op.upgrade()``，故用 **SQLite 兼容的等价 SQL** replay
取值逻辑验证；真实 PG ``alembic upgrade head`` 列为 manual verify。
"""

from __future__ import annotations

import importlib
import inspect
import os
import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa

REVISION_ID = "20260821130000"
DOWN_REVISION_ID = "20260821120000"  # merge 收口迁移之后（rebase 合线后单头链）


def _load_migration(revision_id: str):
    """Load migration module by matching revision ID in filename.

    Mirrors the helper in test_session_zombie_migration.py.
    """
    from pathlib import Path

    backend_root = Path(__file__).resolve().parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. Migration metadata（AC：单 head 链 / 零结构变更 / downgrade no-op）
# ---------------------------------------------------------------------------


def test_migration_metadata():
    mod = _load_migration(REVISION_ID)
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID
    assert mod.branch_labels is None
    assert mod.depends_on is None
    assert callable(mod.upgrade)
    assert callable(mod.downgrade)


def test_revision_id_fits_alembic_version_column():
    # alembic_version.version_num is varchar(32) — revision id must fit.
    assert len(REVISION_ID) <= 32


def test_alembic_single_head_chain():
    """迁移挂载后 alembic 图仍是单 head 且本迁移仍在链上（AC：不破坏单 head 链）。

    不连 DB，仅 ScriptDirectory 静态解析 versions/ 目录。
    不钉死 head 值——后续变更推进 head 不应打破本守卫（修法同
    ``app/modules/agent/tests/test_mission_session_id.py`` 的
    ``test_migration_is_single_head_after_mount``）。
    """
    from pathlib import Path

    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parent.parent
    sd = ScriptDirectory(str(backend_root / "migrations"))
    heads = sd.get_heads()
    assert len(heads) == 1, f"expected single head, got {heads}"
    chain = {rev.revision for rev in sd.walk_revisions()}
    assert REVISION_ID in chain, f"migration {REVISION_ID} not reachable from head {heads[0]}"


def test_downgrade_is_noop():
    """AC：downgrade 为 no-op 不抛错（不可逆，原 NULL 无法区分从未上报与回填后清空）。"""
    mod = _load_migration(REVISION_ID)
    assert mod.downgrade() is None  # no-op：不抛 NotImplementedError、无回滚 SQL


def test_downgrade_comment_explains_irreversibility():
    """AC：downgrade 注释说明不可逆理由。"""
    mod = _load_migration(REVISION_ID)
    src = inspect.getsource(mod.downgrade)
    assert "不可逆" in src, "downgrade 须注释说明不可逆理由"


def test_upgrade_body_is_single_pure_data_update():
    """Guard：upgrade() 仅 1 条 op.execute UPDATE，零结构变更（task-02 constraints）。

    防误加 add_column/drop_column/create_index 等 schema 操作。
    """
    mod = _load_migration(REVISION_ID)
    src = inspect.getsource(mod.upgrade)
    blocks = re.findall(r'"""(.*?)"""', src, re.DOTALL)
    assert len(blocks) == 1, f"expected exactly 1 raw SQL block, got {len(blocks)}"
    sql = blocks[0]
    assert sql.count("UPDATE agent_sessions") == 1
    # 取值规则 / 三重守卫必须齐备
    assert "ORDER BY r.created_at DESC" in sql
    assert "LIMIT 1" in sql
    assert "r.session_id IS NOT NULL" in sql
    assert "s.agent_session_id IS NULL" in sql
    assert "s.provider IN ('claude', 'codex')" in sql
    assert "s.deleted_at IS NULL" in sql
    # 结构变更禁忌（纯 data migration）
    for forbidden in (
        "add_column",
        "drop_column",
        "create_index",
        "create_table",
        "drop_table",
    ):
        assert forbidden not in sql, f"data migration must not call {forbidden}"
        assert forbidden not in src, f"data migration must not call {forbidden}"


# ---------------------------------------------------------------------------
# 2. 取值逻辑（SQLite 兼容等价 replay）
#    PG 用 ``UPDATE agent_sessions s SET ...`` 别名语法；SQLite UPDATE 不支持
#    别名，等价改写为 ``UPDATE agent_sessions SET ... (WHERE ... = agent_sessions.id)``。
#    取值语义完全一致。
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC).replace(tzinfo=None)
T1 = NOW - timedelta(hours=3)
T2 = NOW - timedelta(hours=2)
T3 = NOW - timedelta(hours=1)
T4 = NOW  # 最新


def _create_tables(engine):
    """Recreate the minimal agent_sessions + agent_runs schema on SQLite."""
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE agent_sessions (
                    id CHAR(36) PRIMARY KEY NOT NULL,
                    provider VARCHAR(30) NOT NULL,
                    agent_session_id VARCHAR(255),
                    deleted_at DATETIME
                )
                """
            )
        )
        conn.execute(
            sa.text(
                """
                CREATE TABLE agent_runs (
                    id CHAR(36) PRIMARY KEY NOT NULL,
                    agent_session_id CHAR(36),
                    session_id VARCHAR(128),
                    created_at DATETIME
                )
                """
            )
        )


def _insert_session(conn, *, provider="claude", agent_session_id=None, deleted_at=None):
    sid = str(uuid.uuid4())
    conn.execute(
        sa.text(
            "INSERT INTO agent_sessions (id, provider, agent_session_id, deleted_at) "
            "VALUES (:id, :provider, :asid, :deleted_at)"
        ),
        {"id": sid, "provider": provider, "asid": agent_session_id, "deleted_at": deleted_at},
    )
    return sid


def _insert_run(conn, session_id, session_key, created_at):
    conn.execute(
        sa.text(
            "INSERT INTO agent_runs (id, agent_session_id, session_id, created_at) "
            "VALUES (:id, :sid, :key, :cat)"
        ),
        {"id": str(uuid.uuid4()), "sid": session_id, "key": session_key, "cat": created_at},
    )


def _apply_backfill_sqlite(conn):
    """SQLite-compatible replay of the migration's single UPDATE.

    PG 原文用 ``UPDATE agent_sessions s SET ... WHERE s.agent_session_id IS NULL ...``；
    SQLite UPDATE 目标表不支持别名，等价改写（子查询内用全表名关联）。取值语义一致：
    取 created_at 最新且 session_id 非空那条 run 的 session_id。
    """
    conn.execute(
        sa.text(
            """
            UPDATE agent_sessions
            SET agent_session_id = (
                SELECT r.session_id FROM agent_runs r
                WHERE r.agent_session_id = agent_sessions.id
                  AND r.session_id IS NOT NULL
                ORDER BY r.created_at DESC
                LIMIT 1
            )
            WHERE agent_sessions.agent_session_id IS NULL
              AND agent_sessions.provider IN ('claude', 'codex')
              AND agent_sessions.deleted_at IS NULL
            """
        )
    )


def _fetch_session(conn, sid):
    row = conn.execute(
        sa.text("SELECT agent_session_id FROM agent_sessions WHERE id = :id"),
        {"id": sid},
    ).fetchone()
    return row[0]


@pytest.fixture()
def backfilled_engine():
    """Build schema, seed fixtures, apply backfill, yield engine for assertions."""
    engine = sa.create_engine("sqlite:///:memory:")
    _create_tables(engine)

    before = {}
    with engine.begin() as conn:
        # 1. 多 run 取 created_at 最新非空 session_id（fork 场景 → 最新 id）
        before["multi_run"] = _insert_session(conn)
        _insert_run(conn, before["multi_run"], "alpha", T1)
        _insert_run(conn, before["multi_run"], "fork-latest", T3)

        # 2. 最新一条 run 的 session_id 为 NULL → 回退取更早的非空值
        before["latest_run_null"] = _insert_session(conn)
        _insert_run(conn, before["latest_run_null"], "bravo", T2)
        _insert_run(conn, before["latest_run_null"], None, T4)

        # 3. 关联 run 的 session_id 全 NULL → 保持 NULL（无合格 run）
        before["all_null_runs"] = _insert_session(conn)
        _insert_run(conn, before["all_null_runs"], None, T1)
        _insert_run(conn, before["all_null_runs"], None, T3)

        # 4. 完全无关联 run → 保持 NULL
        before["no_runs"] = _insert_session(conn)

        # ── 守卫用例：不得被改动 ──
        # 5. provider 非 claude/codex 排除（即使有合格 run）
        before["other_provider"] = _insert_session(conn, provider="gemini")
        _insert_run(conn, before["other_provider"], "charlie", T2)

        # 6. 软删行（deleted_at 非空）排除
        before["soft_deleted"] = _insert_session(conn, deleted_at=NOW)
        _insert_run(conn, before["soft_deleted"], "delta", T2)

        # 7. agent_session_id 已非空 → 不动（存量补空，绝不覆盖已有值；
        #    增量最新值覆盖是 task-01 的职责，与本迁移分离）
        before["already_set"] = _insert_session(conn, agent_session_id="existing-key")
        _insert_run(conn, before["already_set"], "echo", T4)

    with engine.begin() as conn:
        _apply_backfill_sqlite(conn)

    yield engine, before
    engine.dispose()


def test_multi_run_takes_latest_created_at(backfilled_engine):
    """AC：多 run 取 created_at 最新且 session_id 非空那条的值（fork 取最新 id）。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["multi_run"]) == "fork-latest"


def test_latest_run_null_session_id_falls_back(backfilled_engine):
    """边界：最新 run 的 session_id 为 NULL 时取更早的非空值（IS NOT NULL 过滤）。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["latest_run_null"]) == "bravo"


def test_all_null_runs_stays_null(backfilled_engine):
    """AC：关联 run 的 session_id 全 NULL → 保持 NULL（reopen 维持 409，预期内）。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["all_null_runs"]) is None


def test_no_runs_stays_null(backfilled_engine):
    """AC：无关联 run 的老会话保持 NULL。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["no_runs"]) is None


def test_other_provider_untouched(backfilled_engine):
    """AC：provider 非 claude/codex 不被回填。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["other_provider"]) is None


def test_soft_deleted_untouched(backfilled_engine):
    """AC：软删行（deleted_at 非空）不被回填。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["soft_deleted"]) is None


def test_already_set_untouched(backfilled_engine):
    """AC：agent_session_id 已非空的行绝不被覆盖（即使有更新的 run 值）。"""
    engine, before = backfilled_engine
    with engine.begin() as conn:
        assert _fetch_session(conn, before["already_set"]) == "existing-key"
