"""Mapping test for the ``20260713_fix_session_zombie`` data migration (task-02).

Background — D-004@v1（变更 2026-07-13-fix-interactive-session-zombie）：历史
``agent_sessions.status='pending'`` 僵尸会话按背后 ``agent_runs`` 终态一次性
收口。映射规则：

  run.status='completed' → session.status='ended'   ended_at=run.finished_at
  run.status='killed'    → session.status='ended'   （D-003 kill=正常终止）
  run.status='failed'    → session.status='failed'  ended_at=run.finished_at
  无关联 run / run 仍 running/pending（孤儿） → session.status='ended'  ended_at=now()

仅处理 ``status='pending' AND deleted_at IS NULL``。

测试范式参照 ``tests/modules/daemon/test_migration_daemon_entity_binding.py``：
迁移本体用 PG 方言 raw SQL（``UPDATE ... FROM ...`` / ``NOW()``），SQLite 跑不了
完整 ``op.upgrade()``，故此处用 **SQLite 兼容的等价 SQL** replay 映射逻辑验证
正确性；真实 PG ``alembic upgrade head`` 列为 manual verify（D-004 evidence）。
"""

from __future__ import annotations

import re
import uuid
from datetime import UTC, datetime, timedelta

import pytest
import sqlalchemy as sa


def _parse_sqlite_dt(value):
    """SQLite returns DATETIME columns as strings; normalize for comparison."""
    if value is None or isinstance(value, datetime):
        return value
    # 2026-07-13 10:21:02.402711  (microseconds optional)
    return (
        datetime.strptime(value, "%Y-%m-%d %H:%M:%S.%f")
        if "." in value
        else datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
    )


REVISION_ID = "20260713_fix_session_zombie"
DOWN_REVISION_ID = "20260712_team_orch"


def _load_migration(revision_id: str):
    """Load migration module by matching revision ID in filename.

    Mirrors the helper in test_migration_daemon_entity_binding.py.
    """
    import importlib
    import os
    from pathlib import Path

    backend_root = Path(__file__).resolve().parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. Migration metadata（AC-01 / AC-07）
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


def test_downgrade_is_irreversible():
    """AC-07: downgrade raises NotImplementedError, no rollback SQL."""
    mod = _load_migration(REVISION_ID)
    with pytest.raises(NotImplementedError):
        mod.downgrade()


# ---------------------------------------------------------------------------
# 2. 映射逻辑（AC-02 ~ AC-06）
#    SQLite-compatible replay of the 3 UPDATE statements from upgrade().
#    PG uses ``UPDATE ... FROM ...`` + ``NOW()``；SQLite uses correlated
#    subqueries + ``CURRENT_TIMESTAMP``。映射语义完全一致。
# ---------------------------------------------------------------------------

NOW = datetime.now(UTC).replace(tzinfo=None)
T1 = NOW - timedelta(hours=3)
T2 = NOW - timedelta(hours=2)
T3 = NOW - timedelta(hours=1)


def _create_tables(engine):
    """Recreate the minimal agent_sessions + agent_runs schema on SQLite."""
    with engine.begin() as conn:
        conn.execute(
            sa.text(
                """
                CREATE TABLE agent_sessions (
                    id CHAR(36) PRIMARY KEY NOT NULL,
                    status VARCHAR(20) NOT NULL DEFAULT 'pending',
                    ended_at DATETIME,
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
                    status VARCHAR(20) NOT NULL,
                    finished_at DATETIME
                )
                """
            )
        )


def _insert_session(conn, status="pending", deleted_at=None, sid=None):
    sid = sid or str(uuid.uuid4())
    conn.execute(
        sa.text(
            "INSERT INTO agent_sessions (id, status, ended_at, deleted_at) "
            "VALUES (:id, :status, NULL, :deleted_at)"
        ),
        {"id": sid, "status": status, "deleted_at": deleted_at},
    )
    return sid


def _insert_run(conn, session_id, status, finished_at):
    conn.execute(
        sa.text(
            "INSERT INTO agent_runs (id, agent_session_id, status, finished_at) "
            "VALUES (:id, :sid, :status, :fin)"
        ),
        {"id": str(uuid.uuid4()), "sid": session_id, "status": status, "fin": finished_at},
    )
    return session_id


def _apply_mapping_sqlite(conn):
    """Replay the 3 UPDATE statements with SQLite-compatible syntax.

    Equivalent to the migration's upgrade() but portable:
      1. completed/killed → ended, ended_at = run.finished_at
      2. failed → failed, ended_at = run.finished_at
      3. orphan (no terminal run) → ended, ended_at = now()

    Order matters: UPDATE 1+2 run first, UPDATE 3 mops up remaining pending.
    """
    # 1. completed / killed → ended
    conn.execute(
        sa.text(
            """
            UPDATE agent_sessions
            SET status = 'ended',
                ended_at = (
                    SELECT r.finished_at FROM agent_runs r
                    WHERE r.agent_session_id = agent_sessions.id
                      AND r.status IN ('completed', 'killed')
                )
            WHERE status = 'pending' AND deleted_at IS NULL
              AND EXISTS (
                    SELECT 1 FROM agent_runs r
                    WHERE r.agent_session_id = agent_sessions.id
                      AND r.status IN ('completed', 'killed')
                )
            """
        )
    )
    # 2. failed → failed
    conn.execute(
        sa.text(
            """
            UPDATE agent_sessions
            SET status = 'failed',
                ended_at = (
                    SELECT r.finished_at FROM agent_runs r
                    WHERE r.agent_session_id = agent_sessions.id
                      AND r.status = 'failed'
                )
            WHERE status = 'pending' AND deleted_at IS NULL
              AND EXISTS (
                    SELECT 1 FROM agent_runs r
                    WHERE r.agent_session_id = agent_sessions.id
                      AND r.status = 'failed'
                )
            """
        )
    )
    # 3. orphan (no terminal run) → ended, now()
    conn.execute(
        sa.text(
            """
            UPDATE agent_sessions
            SET status = 'ended', ended_at = CURRENT_TIMESTAMP
            WHERE status = 'pending' AND deleted_at IS NULL
              AND NOT EXISTS (
                    SELECT 1 FROM agent_runs r
                    WHERE r.agent_session_id = agent_sessions.id
                      AND r.status IN ('completed', 'killed', 'failed')
                )
            """
        )
    )


def _fetch_session(conn, sid):
    row = conn.execute(
        sa.text("SELECT status, ended_at FROM agent_sessions WHERE id = :id"),
        {"id": sid},
    ).fetchone()
    return row[0], _parse_sqlite_dt(row[1])


@pytest.fixture()
def mapped_engine():
    """Build schema, seed fixtures, apply mapping, yield engine for assertions."""
    engine = sa.create_engine("sqlite:///:memory:")
    _create_tables(engine)

    before = {}
    with engine.begin() as conn:
        # 4 pending zombies（deleted_at IS NULL）
        before["completed_run"] = _insert_session(conn)
        _insert_run(conn, before["completed_run"], "completed", T1)

        before["failed_run"] = _insert_session(conn)
        _insert_run(conn, before["failed_run"], "failed", T2)

        before["killed_run"] = _insert_session(conn)
        _insert_run(conn, before["killed_run"], "killed", T3)

        before["orphan_no_run"] = _insert_session(conn)  # no run row at all

        # guardian cases — must NOT change
        before["active_session"] = _insert_session(conn, status="active")
        before["deleted_pending"] = _insert_session(conn, status="pending", deleted_at=NOW)
        _insert_run(conn, before["deleted_pending"], "completed", T1)

    with engine.begin() as conn:
        _apply_mapping_sqlite(conn)

    yield engine, before
    engine.dispose()


def test_completed_run_mapped_to_ended(mapped_engine):
    """AC-02 / AC-06: completed run → session=ended, ended_at=run.finished_at."""
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["completed_run"])
    assert status == "ended"
    assert ended_at == T1


def test_failed_run_mapped_to_failed(mapped_engine):
    """AC-03 / AC-06: failed run → session=failed, ended_at=run.finished_at."""
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["failed_run"])
    assert status == "failed"
    assert ended_at == T2


def test_killed_run_mapped_to_ended_d003(mapped_engine):
    """AC-02: killed run → session=ended (D-003 kill=正常终止), ended_at=run.finished_at."""
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["killed_run"])
    assert status == "ended"
    assert ended_at == T3


def test_orphan_no_run_mapped_to_ended_now(mapped_engine):
    """AC-04 / AC-06: orphan (no run) → session=ended, ended_at≈now().

    用 test 内 datetime.now() 比较（非模块级 NOW 常量）——全量 pytest 下
    collection 到本 test 执行可能间隔很久（>10min），模块级 NOW 会失真。
    """
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["orphan_no_run"])
    assert status == "ended"
    assert ended_at is not None
    now_at_assert = datetime.now(UTC).replace(tzinfo=None)
    assert abs((now_at_assert - ended_at.replace(tzinfo=None)).total_seconds()) < 120


def test_active_session_untouched(mapped_engine):
    """AC-05: status='active' must NOT be changed (only pending is in scope)."""
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["active_session"])
    assert status == "active"
    assert ended_at is None


def test_deleted_pending_untouched(mapped_engine):
    """AC-05: pending + deleted_at non-null (soft-deleted) must NOT be changed."""
    engine, before = mapped_engine
    with engine.begin() as conn:
        status, ended_at = _fetch_session(conn, before["deleted_pending"])
    assert status == "pending"
    assert ended_at is None


def _upgrade_sql_blocks():
    """Return the list of raw-SQL string blocks inside upgrade().

    Strips comments so count guards reflect actual executable SQL, not
    explanatory prose. Used to assert structural invariants (D-002/D-005).
    """
    import inspect
    import re as _re

    mod = _load_migration(REVISION_ID)
    src = inspect.getsource(mod.upgrade)
    # 提取三引号字符串块（migration 用 op.execute("""...""")）
    blocks = _re.findall(r'"""(.*?)"""', src, _re.DOTALL)
    # 去掉 SQL 行注释（-- ...）和每行前导空白，便于子串计数
    cleaned = []
    for b in blocks:
        lines = [ln for ln in b.splitlines() if not ln.strip().startswith("--")]
        cleaned.append("\n".join(lines))
    return cleaned


def test_upgrade_body_contains_three_updates():
    """Guard: the real migration's upgrade() emits 3 op.execute UPDATE statements.

    This protects against accidental schema ops (add_column/drop_column) —
    D-002@v1 mandates zero structural change.
    """
    blocks = _upgrade_sql_blocks()
    assert len(blocks) == 3
    joined = "\n".join(blocks)
    # 3 个 UPDATE agent_sessions（无其他表结构操作）
    assert joined.count("UPDATE agent_sessions") == 3
    # 映射覆盖三类终态：completed/killed 合并 + failed + 孤儿
    assert "completed" in joined and "killed" in joined
    assert "failed" in joined
    assert "NOT EXISTS" in joined
    # 结构变更禁忌（D-002@v1 零结构变更）
    for forbidden in (
        "add_column",
        "drop_column",
        "create_index",
        "create_table",
        "drop_table",
    ):
        assert forbidden not in joined, f"data migration must not call {forbidden} (D-002@v1)"


def test_upgrade_uses_only_pending_and_not_deleted_guard():
    """AC-05 guard: every UPDATE must filter status='pending' AND deleted_at IS NULL."""
    blocks = _upgrade_sql_blocks()
    assert len(blocks) == 3
    for b in blocks:
        # 每条 UPDATE 都带 pending + deleted_at IS NULL 守卫
        assert re.search(r"status\s*=\s*'pending'", b), b
        assert "deleted_at IS NULL" in b, b
