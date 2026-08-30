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
from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import (
    AgentMission,
    AgentRun,
    AgentSession,
    mission_worker_sessions,
    mission_worker_sessions_tree,
)

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
    """agent_sessions 字段清单守卫（本变更 mission_session_id 未动该表；口径同
    test_agent_session_model）。

    2026-08-23-agent-activity-sessions task-03 后加会话化三列
    origin/aggregation_key/title（design §3.3.1）+ 2026-08-24 会话归档 archived_at +
    2026-08-25-team-subsession-governance task-01 会话树两列（parent_session_id /
    worker_done_at，design §5.A）+ 2026-08-26-team-subsession-recursion task-01
    tree_depth（design §5.A），清单同步为 26 字段；ql-20260831-002-f683 后为 27（+ctx_window_tokens）。
    """
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
        "origin",
        "aggregation_key",
        "title",
        # 2026-08-24 会话归档（agent_session_archive）：archived_at 时间戳列。
        "archived_at",
        # 2026-08-25-team-subsession-governance task-01（design §5.A）：会话树两列。
        "parent_session_id",
        "worker_done_at",
        # 2026-08-26-team-subsession-recursion task-01（design §5.A）：会话树深度列。
        "tree_depth",
        # ql-20260831-002-f683：会话级上下文窗口覆盖列。
        "ctx_window_tokens",
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
    """挂载后 alembic 图单 head（多 head 会阻断 upgrade，卡片要求停并报告）。

    2026-08-23-platform-agent-log-ingest：断言从「REVISION_ID 必须是 head」放宽为
    「单 head 且 REVISION_ID 仍在链上（head 可达祖先）」——后续迁移合法推进 head
    不应打破本测试（旧写法在任何新迁移落盘后即红）。
    """
    from pathlib import Path

    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parents[4]
    sd = ScriptDirectory(str(backend_root / "migrations"))
    heads = sd.get_heads()
    assert len(heads) == 1, f"expected single head, got {heads}"
    chain_ids = {rev.revision for rev in sd.walk_revisions()}
    assert REVISION_ID in chain_ids, f"revision {REVISION_ID} not reachable from head"


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


# ── 5. mission_worker_sessions_tree 递归 CTE（2026-08-26-team-subsession-recursion
#    task-01，design §5.A / FR-08）─────────────────────────────────────────────

# tree_depth 迁移（task-01）：revision / down_revision 与回填/索引静态断言用常量。
TREE_DEPTH_REVISION = "20260826020000"
TREE_DEPTH_DOWN_REVISION = "20260825230000"  # 执行时 alembic heads 确认的单 head
TREE_DEPTH_INDEX = "ix_agent_sessions_tree_depth"
TREE_DEPTH_BACKFILL = (
    "UPDATE agent_sessions SET tree_depth = CASE WHEN parent_session_id IS NULL THEN 0 ELSE 1 END"
)

# 种子时间基点（显式 created_at 保证 created_at 升序枚举可断言）。
_TTS0 = datetime(2026, 8, 26, 0, 0, 0, tzinfo=UTC)
_TTS1 = datetime(2026, 8, 26, 0, 0, 1, tzinfo=UTC)
_TTS2 = datetime(2026, 8, 26, 0, 0, 2, tzinfo=UTC)
_TTS3 = datetime(2026, 8, 26, 0, 0, 3, tzinfo=UTC)
_TTS4 = datetime(2026, 8, 26, 0, 0, 4, tzinfo=UTC)


async def _mk_session(
    session: AsyncSession,
    *,
    parent: uuid.UUID | None = None,
    created_at: datetime = _TTS0,
) -> AgentSession:
    """建一行 agent_sessions（parent 挂点显式传入，SQLite 不强制 FK 可造脏数据）。"""
    s = AgentSession(
        id=uuid.uuid4(),
        user_id=uuid.uuid4(),
        provider="claude",
        status="active",
        parent_session_id=parent,
        created_at=created_at,
    )
    session.add(s)
    await session.commit()
    await session.refresh(s)
    return s


class TestMissionWorkerSessionsTree:
    @pytest.mark.asyncio
    async def test_full_tree_three_levels_excludes_root(self, db_session: AsyncSession) -> None:
        """主控→分身→孙三层：返回分身+孙全树（created_at 升序），不含主控行。"""
        root = await _mk_session(db_session, created_at=_TTS0)
        mission = await _make_mission(db_session, session_id=root.id)
        w1 = await _mk_session(db_session, parent=root.id, created_at=_TTS1)
        w2 = await _mk_session(db_session, parent=root.id, created_at=_TTS2)
        g1 = await _mk_session(db_session, parent=w1.id, created_at=_TTS3)

        tree = await mission_worker_sessions_tree(db_session, mission.id)
        assert [s.id for s in tree] == [w1.id, w2.id, g1.id]
        assert root.id not in {s.id for s in tree}
        # 一层枚举（P1 保留）只含直接子会话——两层口径并存不互染。
        one_layer = await mission_worker_sessions(db_session, mission.id)
        assert [s.id for s in one_layer] == [w1.id, w2.id]

    @pytest.mark.asyncio
    async def test_no_grandchildren_equivalent_to_one_layer(self, db_session: AsyncSession) -> None:
        """无孙时全树与一层结果逐行等价（FR-08 零回归口径）。"""
        root = await _mk_session(db_session, created_at=_TTS0)
        mission = await _make_mission(db_session, session_id=root.id)
        w1 = await _mk_session(db_session, parent=root.id, created_at=_TTS1)
        w2 = await _mk_session(db_session, parent=root.id, created_at=_TTS2)

        tree = await mission_worker_sessions_tree(db_session, mission.id)
        one_layer = await mission_worker_sessions(db_session, mission.id)
        assert [s.id for s in tree] == [w1.id, w2.id]
        assert [s.id for s in tree] == [s.id for s in one_layer]

    @pytest.mark.asyncio
    async def test_missing_mission_returns_empty(self, db_session: AsyncSession) -> None:
        """mission 不存在 → 空列表（对齐一层枚举宽容口径）。"""
        assert await mission_worker_sessions_tree(db_session, uuid.uuid4()) == []

    @pytest.mark.asyncio
    async def test_external_mission_returns_empty(self, db_session: AsyncSession) -> None:
        """external mission（session_id NULL）→ 空列表。"""
        mission = await _make_mission(db_session, session_id=None)
        assert await mission_worker_sessions_tree(db_session, mission.id) == []

    @pytest.mark.asyncio
    async def test_root_without_children_returns_empty(self, db_session: AsyncSession) -> None:
        """无子树 → 空列表。"""
        root = await _mk_session(db_session)
        mission = await _make_mission(db_session, session_id=root.id)
        assert await mission_worker_sessions_tree(db_session, mission.id) == []

    @pytest.mark.asyncio
    async def test_cycle_dirty_data_no_hang_no_duplicates(self, db_session: AsyncSession) -> None:
        """脏数据成环（root 指向后代、后代指回 root）：UNION 去重 + MAX_TREE_DEPTH
        截断——不死循环、不重复行。"""
        # 2-环：root.parent=Y、Y.parent=root（脏数据，SQLite 不强制 FK/一致性）。
        y = await _mk_session(db_session, created_at=_TTS1)
        root = AgentSession(
            id=uuid.uuid4(),
            user_id=uuid.uuid4(),
            provider="claude",
            status="active",
            parent_session_id=y.id,
            created_at=_TTS0,
        )
        db_session.add(root)
        await db_session.commit()
        y.parent_session_id = root.id
        db_session.add(y)
        await db_session.commit()
        mission = await _make_mission(db_session, session_id=root.id)
        w = await _mk_session(db_session, parent=root.id, created_at=_TTS2)

        tree = await mission_worker_sessions_tree(db_session, mission.id)
        ids = [s.id for s in tree]
        assert len(ids) == len(set(ids)), f"重复行：{ids}"
        # 可达集：分身 w + 环上的 y（root 自身按契约剔除，重复出现被去重）
        assert set(ids) == {w.id, y.id}
        assert ids == [y.id, w.id]  # created_at 升序稳定

    @pytest.mark.asyncio
    async def test_dangling_parent_unreachable_not_included(self, db_session: AsyncSession) -> None:
        """脏数据 parent 指向不存在的行：不可达即不入树，不抛异常。"""
        root = await _mk_session(db_session, created_at=_TTS0)
        mission = await _make_mission(db_session, session_id=root.id)
        w = await _mk_session(db_session, parent=root.id, created_at=_TTS1)
        await _mk_session(db_session, parent=uuid.uuid4(), created_at=_TTS2)  # 悬挂 parent

        tree = await mission_worker_sessions_tree(db_session, mission.id)
        assert [s.id for s in tree] == [w.id]

    @pytest.mark.asyncio
    async def test_depth_beyond_max_truncated(self, db_session: AsyncSession) -> None:
        """深度超过 MAX_TREE_DEPTH(=4) 的脏链被截断（depth 1..4 保留，5+ 不入树）。"""
        root = await _mk_session(db_session, created_at=_TTS0)
        mission = await _make_mission(db_session, session_id=root.id)
        chain: list[AgentSession] = []
        parent = root.id
        for i in range(6):
            node = await _mk_session(
                db_session, parent=parent, created_at=_TTS4 + timedelta(seconds=i)
            )
            chain.append(node)
            parent = node.id

        tree = await mission_worker_sessions_tree(db_session, mission.id)
        assert [s.id for s in tree] == [n.id for n in chain[:4]]


# ── 6. tree_depth 迁移静态链检查（先例：上方 §4 / test_session_agent_session_id_migration.py）──


def _load_tree_depth_migration():
    from pathlib import Path

    backend_root = Path(__file__).resolve().parents[4]
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and f != "__init__.py" and TREE_DEPTH_REVISION in f:
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {TREE_DEPTH_REVISION}")


def test_tree_depth_migration_revision_chain() -> None:
    """迁移挂 20260825230000（执行时 alembic heads 确认的单 head）之后。"""
    mod = _load_tree_depth_migration()
    assert mod.revision == TREE_DEPTH_REVISION
    assert mod.down_revision == TREE_DEPTH_DOWN_REVISION


def test_tree_depth_migration_upgrade_source() -> None:
    """upgrade 三件套：add_column NOT NULL server_default 0 + 全表 CASE 回填 + 索引。

    回填是硬要求（Grill B1）：存量主控/普通=0（parent NULL）、存量分身=1，
    NOT NULL 保证迁移后无 NULL 读值。
    """
    import inspect

    mod = _load_tree_depth_migration()
    src = inspect.getsource(mod.upgrade)
    assert 'sa.Column("tree_depth", sa.Integer(), nullable=False' in src
    assert "server_default" in src
    assert TREE_DEPTH_BACKFILL in src
    assert f'"{TREE_DEPTH_INDEX}"' in src
    # 对称顺序：回填在建索引之前（索引一次成型，不因回填重复维护）
    assert src.index(TREE_DEPTH_BACKFILL) < src.index(f'"{TREE_DEPTH_INDEX}"')


def test_tree_depth_migration_downgrade_symmetric() -> None:
    """downgrade 对称：drop 索引 → drop 列。"""
    import inspect

    src = inspect.getsource(_load_tree_depth_migration().downgrade)
    assert f'"{TREE_DEPTH_INDEX}"' in src
    assert '"tree_depth"' in src
    assert src.index(f'"{TREE_DEPTH_INDEX}"') < src.index('"tree_depth"')


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
