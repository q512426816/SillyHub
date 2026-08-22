"""task-01（2026-08-22-team-session-unify）：AgentMission.session_id 列 + 活跃态部分唯一索引。

design §5 Phase1 / §8 / D-006@v1：
- session_id：Uuid FK agent_sessions.id、NOT NULL、普通索引（写法仿 project_id 字段）；
- uq_agent_missions_session_active：部分唯一索引（WHERE converged_at IS NULL AND
  cancelled_at IS NULL）——一个会话同时至多一个未收敛未取消的 mission（R-07 /
  Grill NEW-3 并发守卫，懒建 SELECT...FOR UPDATE 的数据库侧兜底）；
- agent_sessions / agent_runs 等表结构不变（design §8 不改变的表）。

兼容说明：session_id NOT NULL 但带 default_factory=uuid.uuid4——存量构造路径
（mission.py start_mission / orchestrator team_mission_entry / 既有测试）不传
session_id 仍可构造（SQLite 测试不强制 FK；PG 生产下随机 uuid 会触发 FK 失败，
即时暴露未接线创建路径，task-03/05/13 接线后所有入口显式传入）。

迁移侧：PG ``alembic upgrade head`` 为 manual verify（本 worktree 无可达 PG），
此处按 ``tests/test_session_agent_session_id_migration.py`` 先例做静态链检查 +
SQLite create_all 等价行为验证（部分索引双方言 where 同语义）。
"""

from __future__ import annotations

import importlib
import os
import uuid
from datetime import UTC, datetime

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentMission, AgentRun, AgentSession

REVISION_ID = "20260822090000"
DOWN_REVISION_ID = "20260821130000"  # 执行时 alembic heads 确认的单 head

# 迁移应创建的索引 / 约束名（与 model __table_args__/Column(index=True) 对齐）
PLAIN_INDEX = "ix_agent_missions_session_id"
UNIQUE_INDEX = "uq_agent_missions_session_active"
FK_NAME = "fk_agent_missions_session_id"
PARTIAL_WHERE = "converged_at IS NULL AND cancelled_at IS NULL"
# QA P1 修复：索引条件加 session_id IS NOT NULL（NULL 行不参与唯一约束）
PARTIAL_WHERE_WITH_SESSION = (
    "session_id IS NOT NULL AND converged_at IS NULL AND cancelled_at IS NULL"
)

# task-01 前 AgentMission 既有字段（守卫：新列之外零漂移）
PRE_EXISTING_FIELDS = {
    "id",
    "workspace_id",
    "project_id",
    "scope_workspace_ids",
    "change_id",
    "objective",
    "constraints",
    "budget_tokens",
    "budget_usd",
    "worker_preset",
    "main_agent_config",
    "created_by",
    "created_at",
    "cancelled_at",
    "converged_at",
}


# ── 1. Model 契约（纯元数据，无 DB） ─────────────────────────────────────────


def test_agent_mission_session_id_field_present() -> None:
    """session_id 新增，且既有 15 个字段零漂移（design §8 仅加一列）。"""
    actual = set(AgentMission.model_fields.keys())
    assert "session_id" in actual, "AgentMission 缺 session_id 字段"
    assert actual >= PRE_EXISTING_FIELDS, f"既有字段漂移：missing={PRE_EXISTING_FIELDS - actual}"
    assert actual == PRE_EXISTING_FIELDS | {"session_id"}, (
        f"意外新增字段：extra={actual - PRE_EXISTING_FIELDS - {'session_id'}}"
    )


def test_session_id_uuid_nullable_fk_agent_sessions() -> None:
    """D-006@v1（验收返工）：Uuid、FK agent_sessions.id、nullable——external
    mission（无会话存量入口）为 NULL，非 NULL 即绑定会话（QA P1 修复）。"""
    sa_column = AgentMission.model_fields["session_id"].sa_column
    assert sa_column.nullable is True
    fks = list(sa_column.foreign_keys)
    assert len(fks) == 1, f"expected 1 FK on session_id, got {len(fks)}"
    fk = fks[0]
    assert fk.column.table.name == "agent_sessions"
    assert fk.column.name == "id"


def test_session_id_plain_index_declared() -> None:
    """session_id 普通索引（迁移侧 ix_agent_missions_session_id 同名对齐）。"""
    table = AgentMission.__table__
    idx = next((i for i in table.indexes if i.name == PLAIN_INDEX), None)
    assert idx is not None, f"missing index {PLAIN_INDEX}"
    assert not idx.unique


def test_partial_unique_index_declared() -> None:
    """活跃态部分唯一索引：unique + PG/SQLite 双方言 where（design §8 / Grill NEW-3）。"""
    table = AgentMission.__table__
    idx = next((i for i in table.indexes if i.name == UNIQUE_INDEX), None)
    assert idx is not None, f"missing index {UNIQUE_INDEX}"
    assert idx.unique is True
    assert [c.name for c in idx.columns] == ["session_id"]
    # kwargs 存进 idx.dialect_options，按方言取 where 文本
    pg_where = idx.dialect_options["postgresql"]["where"]
    sqlite_where = idx.dialect_options["sqlite"]["where"]
    for where in (pg_where, sqlite_where):
        assert PARTIAL_WHERE_WITH_SESSION in str(where)


def test_session_id_none_for_external_missions() -> None:
    """存量 external 入口兼容（QA P1 修复）：不传 session_id → None（原
    default_factory 随机 uuid 会违反 FK 压断 PG 上的 4 个无会话创建入口）。"""
    m = AgentMission(workspace_id=uuid.uuid4(), objective="x")
    assert m.session_id is None


# ── 2. 部分唯一索引行为（SQLite create_all 等价验证） ────────────────────────


async def _make_mission(
    session: AsyncSession,
    *,
    session_id: uuid.UUID | None = None,
    converged_at: datetime | None = None,
    cancelled_at: datetime | None = None,
) -> AgentMission:
    m = AgentMission(
        workspace_id=uuid.uuid4(),
        objective="团队目标",
        session_id=session_id,
        converged_at=converged_at,
        cancelled_at=cancelled_at,
    )
    session.add(m)
    await session.commit()
    await session.refresh(m)
    return m


class TestActiveMissionPartialUniqueIndex:
    @pytest.mark.asyncio
    async def test_second_active_mission_same_session_rejected(
        self, db_session: AsyncSession
    ) -> None:
        """验收：同 session 两个活跃（未收敛未取消）mission，第二条唯一约束冲突。"""
        sid = uuid.uuid4()
        await _make_mission(db_session, session_id=sid)
        with pytest.raises(IntegrityError):
            await _make_mission(db_session, session_id=sid)
        await db_session.rollback()

    @pytest.mark.asyncio
    async def test_converged_mission_frees_session_slot(self, db_session: AsyncSession) -> None:
        """验收：converge 置位后同 session 可再建新 mission。"""
        sid = uuid.uuid4()
        await _make_mission(db_session, session_id=sid, converged_at=datetime.now(UTC))
        second = await _make_mission(db_session, session_id=sid)
        assert second.converged_at is None and second.cancelled_at is None

    @pytest.mark.asyncio
    async def test_cancelled_mission_frees_session_slot(self, db_session: AsyncSession) -> None:
        """验收：cancel 置位后同 session 可再建新 mission。"""
        sid = uuid.uuid4()
        await _make_mission(db_session, session_id=sid, cancelled_at=datetime.now(UTC))
        second = await _make_mission(db_session, session_id=sid)
        assert second.converged_at is None and second.cancelled_at is None

    @pytest.mark.asyncio
    async def test_active_missions_different_sessions_coexist(
        self, db_session: AsyncSession
    ) -> None:
        """边界：不同 session 的活跃 mission 互不冲突（索引按 session 分组）。"""
        await _make_mission(db_session, session_id=uuid.uuid4())
        await _make_mission(db_session, session_id=uuid.uuid4())

    @pytest.mark.asyncio
    async def test_null_session_active_missions_coexist(self, db_session: AsyncSession) -> None:
        """QA P1 修复验收：external mission（session_id NULL）多个活跃互不冲突
        （索引条件含 session_id IS NOT NULL，NULL 行不参与唯一约束）。"""
        await _make_mission(db_session, session_id=None)
        await _make_mission(db_session, session_id=None)


# ── 3. 不改变的表（design §8） ──────────────────────────────────────────────


def test_agent_sessions_model_fields_unchanged() -> None:
    """agent_sessions 不加字段（design §8 不改变的表；口径同 test_agent_session_model）。"""
    expected = {
        "id",
        "user_id",
        "runtime_id",
        "lease_id",
        "change_id",
        "workspace_id",
        "provider",
        "status",
        "agent_session_id",
        "config",
        "turn_count",
        "cwd",
        "created_at",
        "last_active_at",
        "ended_at",
        "deleted_at",
        "agent_profile_id",
        "llm_provider_id",
        "config_snapshot",
    }
    assert set(AgentSession.model_fields.keys()) == expected


def test_agent_run_role_column_unchanged_nullable() -> None:
    """AgentRun.role 保持 nullable String(30)（task-07 三值逻辑守卫的前提）。"""
    sa_column = AgentRun.model_fields["role"].sa_column
    assert sa_column.nullable is True
    assert sa_column.type.length == 30


# ── 4. 迁移链静态检查（先例：tests/test_session_agent_session_id_migration.py） ─


def _load_migration():
    from pathlib import Path

    backend_root = Path(__file__).resolve().parents[4]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and f != "__init__.py" and REVISION_ID in f:
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {REVISION_ID}")


def test_migration_revision_chain() -> None:
    """迁移挂 20260821130000（执行时 alembic heads 确认的单 head）之后。"""
    mod = _load_migration()
    assert mod.revision == REVISION_ID
    assert mod.down_revision == DOWN_REVISION_ID


def test_migration_is_single_head_after_mount() -> None:
    """挂载后 alembic 图单 head（多 head 会阻断 upgrade，卡片要求停并报告）。"""
    from pathlib import Path

    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parents[4]
    heads = ScriptDirectory(str(backend_root / "migrations")).get_heads()
    assert heads == [REVISION_ID], f"expected single head {REVISION_ID}, got {heads}"


def test_migration_upgrade_adds_column_fk_and_indexes() -> None:
    """upgrade 四件套：add_column(nullable，QA P1) + FK + 普通索引 + 部分唯一索引。"""
    import inspect

    mod = _load_migration()
    src = inspect.getsource(mod.upgrade)
    assert 'sa.Column("session_id", sa.Uuid(), nullable=True)' in src
    assert FK_NAME in src
    assert '"agent_sessions"' in src
    assert f'"{PLAIN_INDEX}"' in src
    assert f'"{UNIQUE_INDEX}"' in src
    assert "unique=True" in src
    # 部分唯一条件以模块常量传入，值与 model __table_args__ 同文本
    assert PARTIAL_WHERE_WITH_SESSION in str(mod._PARTIAL_WHERE)
    assert src.count("_PARTIAL_WHERE") == 2  # postgresql_where + sqlite_where
    # 双方言 where（SQLite create_all/等价 replay 同语义）
    assert "postgresql_where" in src
    assert "sqlite_where" in src


def test_migration_downgrade_symmetric() -> None:
    """downgrade 对称：drop 唯一索引 → 普通索引 → FK → 列。"""
    import inspect

    src = inspect.getsource(_load_migration().downgrade)
    assert f'"{UNIQUE_INDEX}"' in src
    assert f'"{PLAIN_INDEX}"' in src
    assert FK_NAME in src
    assert '"session_id"' in src
    # 对称顺序：唯一索引在普通索引之前 drop（与 upgrade 创建顺序相反）
    assert src.index(f'"{UNIQUE_INDEX}"') < src.index(f'"{PLAIN_INDEX}"')


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
