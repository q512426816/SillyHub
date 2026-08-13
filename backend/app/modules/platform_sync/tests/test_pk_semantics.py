"""platform_change_progress 新主键语义测试（task-04 / design §5/§8/§9 / FR-01/02/04/05）。

task-01/02/03 把主键从 ``change_name``（全局唯一）改为独立 ``id`` UUID + 保留
``(workspace_id, change_name)`` 复合唯一约束（D-001@v1）。本文件覆盖四类语义（NFR-02）：

1. 跨 workspace 同名 upsert 各占一行、互不覆盖（FR-01 / R-04 / design §8）——改前第二个
   workspace INSERT 撞 change_name 单主键 → 500；
2. NULL 行 + workspace 行共存（FR-02 / D-003 / design §9）——shk_live_ 过渡期
   ``workspace_id=NULL`` 行不挡带 workspace 的同名行；
3. 同 workspace 并发双发冲突回退（FR-05 / R-03）——由 test_router.py 修复后的
   ``test_apply_catches_integrity_error_falls_back_to_update`` 覆盖（本文件不再重复）；
4. migration 回填（FR-04 / R-01）——仿 test_daemon_started_at：MigrationContext +
   Operations 驱动 upgrade()，验证旧数据 id 回填 + 主键改 id + 复合唯一保留 + NULL 行保留。

真实断言（不 mock 被测方法，constraints）；全部落 platform_sync/tests（allowed_paths）。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine, inspect, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import PlatformChangeProgressORM
from app.modules.platform_sync.service import PlatformSyncService
from app.modules.workspace.model import Workspace

# ISO 8601 UTC 串（契约 §7：字典序 == 时间序，T1 < T2 < T3）
T1 = "2026-08-10T13:00:00.000Z"
T2 = "2026-08-10T13:45:00.000Z"
T3 = "2026-08-10T14:30:00.000Z"


async def _make_workspace(session: AsyncSession) -> Workspace:
    """建 Workspace 行（镜像 test_workspace_router.py::_make_workspace 模式）。"""
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _find_row(
    session: AsyncSession, workspace_id: uuid.UUID | None, name: str
) -> PlatformChangeProgressORM | None:
    """按复合键 ``(workspace_id, change_name)`` 独立 DB 直查（不依赖被测 service）。"""
    stmt = select(PlatformChangeProgressORM).where(
        PlatformChangeProgressORM.change_name == name,
        PlatformChangeProgressORM.workspace_id.is_(None)
        if workspace_id is None
        else PlatformChangeProgressORM.workspace_id == workspace_id,
    )
    return (await session.execute(stmt)).scalar_one_or_none()


def _progress(name: str, stage: str) -> dict[str, Any]:
    """构造 serializeForSync 六表 body（project 名带 change 名，便于断言互不覆盖）。"""
    return {
        "project": {"name": name},
        "changes": [{"name": name, "current_stage": stage, "status": "in_progress"}],
        "stages": [],
        "steps": [],
        "batch_progress": [],
        "approvals": [],
    }


# ── FR-01 跨 workspace 同名 upsert 各占一行 ──────────────────────────────────────


async def test_cross_workspace_same_change_name_each_own_row(db_session: AsyncSession) -> None:
    """FR-01 / R-04：workspace A 与 B 同名 change 各占一行、互不覆盖。

    改前（change_name 单主键）第二个 workspace 的 INSERT 撞 PK → IntegrityError → 回退
    再查仍无 → 500（design §1 缺陷 1）；改后复合唯一约束 ``(workspace_id, change_name)``
    下跨 workspace 重名合法，各占一行（design §8「change_name 全表唯一 → 同 workspace 内
    唯一」）。
    """
    ws_a = await _make_workspace(db_session)
    ws_b = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)

    body_a = _progress("foo", "execute")
    body_b = _progress("foo", "plan")
    res_a = await svc.upsert_progress(ws_a.id, "foo", body_a, None, T2, "alice")
    res_b = await svc.upsert_progress(ws_b.id, "foo", body_b, None, T2, "bob")

    assert res_a.conflict is False
    assert res_b.conflict is False  # 非 500 / 非 409：两次都接受

    row_a = await _find_row(db_session, ws_a.id, "foo")
    row_b = await _find_row(db_session, ws_b.id, "foo")
    assert row_a is not None
    assert row_b is not None
    # 互不覆盖：各自 latest_progress 对应各自 body，元字段各自归属
    assert row_a.latest_progress == body_a
    assert row_b.latest_progress == body_b
    assert row_a.last_pusher == "alice"
    assert row_b.last_pusher == "bob"
    # 各占一行：独立 id（task-01 主键）+ 各自 workspace_id
    assert row_a.id is not None and row_b.id is not None
    assert row_a.id != row_b.id
    assert row_a.workspace_id == ws_a.id
    assert row_b.workspace_id == ws_b.id


# ── FR-02 NULL 行 + workspace 行共存 ──────────────────────────────────────────────


async def test_null_row_coexists_with_workspace_row(db_session: AsyncSession) -> None:
    """FR-02 / D-003：shk_live_ 过渡 NULL 行与带 workspace 行同 change_name 共存。

    改前 NULL 行占用 change_name 单主键，带 workspace 的同名行插不进去（500 / 演示用
    UPDATE 改绑绕过）；改后复合唯一约束对 NULL 不参与唯一性 → 两者共存（design §5/§9）。
    """
    ws = await _make_workspace(db_session)
    svc = PlatformSyncService(db_session)

    legacy_body = _progress("foo", "execute")
    ws_body = _progress("foo", "plan")
    # 1. shk_live_ 过渡路径：workspace_id=None 全局上行
    await svc.upsert_progress(None, "foo", legacy_body, None, T1, "legacy")
    # 2. shpsync_ 路径：带 workspace 行（改前 500，改后不抛）
    await svc.upsert_progress(ws.id, "foo", ws_body, None, T2, "alice")

    null_row = await _find_row(db_session, None, "foo")
    ws_row = await _find_row(db_session, ws.id, "foo")
    assert null_row is not None
    assert ws_row is not None
    assert null_row.latest_progress == legacy_body
    assert ws_row.latest_progress == ws_body
    # 独立 id、各自 workspace_id（NULL 行 / 带 workspace 行）
    assert null_row.id is not None and ws_row.id is not None
    assert null_row.id != ws_row.id
    assert null_row.workspace_id is None
    assert ws_row.workspace_id == ws.id

    # 列表投影按复合键各命中各行（FR-02）：全局聚合命中 NULL 行、workspace 命中其行
    null_names = [it["name"] for it in await svc.list_lightweight(None)]
    ws_names = [it["name"] for it in await svc.list_lightweight(ws.id)]
    assert null_names == ["foo"]
    assert ws_names == ["foo"]


# ── FR-04 migration 回填测试（仿 test_daemon_started_at 模式） ──────────────────


def _load_migration_module():
    """动态 import task-02 产出的 migration（按 ``*_platform_change_progress_id_pk.py``
    glob 匹配，避免硬编码时间戳；文件不在 package 链路上，用 spec_from_file_location）。"""
    import importlib.util

    versions_dir = Path(__file__).resolve().parents[4] / "migrations" / "versions"
    matches = sorted(versions_dir.glob("*_platform_change_progress_id_pk.py"))
    assert matches, f"migration file not found in {versions_dir}"
    spec = importlib.util.spec_from_file_location(
        "platform_change_progress_id_pk_migration", matches[0]
    )
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run_with_op(conn, fn) -> None:
    """在 ``op`` 绑定到 conn 的上下文里执行 migration 函数（仿 test_daemon_started_at）。

    ``MigrationContext.configure(conn, opts={})`` 必须显式给非 None ``opts``（空 dict）：
    不传则 opts 为 None，SchemaObjects 取 ``opts["target_metadata"]`` 触发 AttributeError。
    """
    mc = MigrationContext.configure(conn, opts={})
    with Operations.context(mc):
        fn()


def _build_old_table():
    """建迁移前基线表定义：change_name 单主键 + workspace_id 可空 + 复合唯一约束。

    对齐 20260810150000（建表）+ 20260811150000（加 workspace_id + 复合唯一）后的旧
    schema（task-02 前的目标态偏差即此处：change_name 仍是 primary_key）。
    """
    from sqlalchemy import Column, MetaData, Table, UniqueConstraint
    from sqlalchemy import types as sa_types

    metadata = MetaData()
    return Table(
        "platform_change_progress",
        metadata,
        Column("change_name", sa_types.String(), primary_key=True, nullable=False),
        Column("workspace_id", sa_types.Uuid(as_uuid=True), nullable=True),
        Column("latest_progress", sa_types.JSON(), nullable=True),
        Column("last_pushed_at", sa_types.String(64), nullable=True),
        Column("last_pusher", sa_types.String(255), nullable=True),
        Column("updated_at", sa_types.DateTime(timezone=True), nullable=False),
        UniqueConstraint(
            "workspace_id",
            "change_name",
            name="uq_platform_change_progress_workspace_change",
        ),
    )


def _seed_old_rows(conn, tbl) -> list[dict[str, Any]]:
    """插入旧数据（模拟生产 8 NULL + 2 workspace 的缩样：2 NULL 行 + 1 workspace 行）。"""
    now = datetime.now(UTC)
    rows: list[dict[str, Any]] = [
        {
            "change_name": "legacy-a",
            "workspace_id": None,
            "latest_progress": {"project": {"name": "legacy-a"}},
            "last_pushed_at": T1,
            "last_pusher": "legacy",
            "updated_at": now,
        },
        {
            "change_name": "legacy-b",
            "workspace_id": None,
            "latest_progress": {"project": {"name": "legacy-b"}},
            "last_pushed_at": T2,
            "last_pusher": "legacy",
            "updated_at": now,
        },
        {
            "change_name": "ws-change",
            "workspace_id": uuid.UUID("f0000000-0000-0000-0000-000000000001"),
            "latest_progress": {"project": {"name": "ws-change"}},
            "last_pushed_at": T3,
            "last_pusher": "alice",
            "updated_at": now,
        },
    ]
    conn.execute(tbl.insert(), rows)
    return rows


def _norm_uuid(value: Any) -> uuid.UUID | None:
    """SQLite 落库 UUID 为 CHAR(32) hex 串；raw ``SELECT *`` 无 Uuid 类型信息 → 归一回 uuid。"""
    if value is None:
        return None
    return value if isinstance(value, uuid.UUID) else uuid.UUID(str(value))


def _norm_progress(value: Any) -> Any:
    """SQLite 落库 JSON 为 TEXT 串；raw ``SELECT *`` 无 JSON 类型信息 → 归一回 dict。"""
    if isinstance(value, str):
        return json.loads(value)
    return value


def test_migration_id_pk_backfills_old_rows() -> None:
    """FR-04 / R-01：upgrade 后旧数据 id 回填保留 + 主键改 id + 复合唯一保留。

    - inspector 列含 ``id``；``get_pk_constraint`` 主键列 = ``["id"]``（change_name 已去
      主键，task-02）；
    - 旧数据保留：按行查 ``id`` 均非 None（uuid4 回填，design §8「现有行回填 id 保留」），
      且每行 workspace_id / change_name / latest_progress / 元字段原值不变（不丢进度镜像）；
    - 唯一约束 ``uq_platform_change_progress_workspace_change`` 存在（D-002 保留）。
    """
    migration = _load_migration_module()

    engine = create_engine("sqlite:///:memory:")
    with engine.connect() as conn:
        tbl = _build_old_table()
        tbl.metadata.create_all(conn)
        # 基线：迁移前无 id 列
        cols = {c["name"] for c in inspect(conn).get_columns("platform_change_progress")}
        assert "id" not in cols, "基线不应有 id 列"
        old_rows = _seed_old_rows(conn, tbl)

        _run_with_op(conn, migration.upgrade)

        # 主键改 id + 列含 id
        pk = inspect(conn).get_pk_constraint("platform_change_progress")
        assert pk["constrained_columns"] == ["id"], f"主键应为 id，实际 {pk['constrained_columns']}"
        cols = {c["name"] for c in inspect(conn).get_columns("platform_change_progress")}
        assert "id" in cols, "upgrade 后应有 id 列"

        # 旧数据保留：id 回填 + 原值不变（不丢进度镜像；raw SELECT 无类型信息，UUID/JSON
        # 以字符串形态返回，经 _norm_uuid/_norm_progress 归一后与原值比较）
        for orig in old_rows:
            row = (
                conn.execute(
                    text("SELECT * FROM platform_change_progress WHERE change_name = :cn"),
                    {"cn": orig["change_name"]},
                )
                .mappings()
                .one()
            )
            backfilled_id = _norm_uuid(row["id"])
            assert backfilled_id is not None, f"{orig['change_name']} 应回填 id"
            assert backfilled_id.version == 4, f"{orig['change_name']} 回填 id 应为 uuid4"
            assert _norm_uuid(row["workspace_id"]) == orig["workspace_id"]
            assert _norm_progress(row["latest_progress"]) == orig["latest_progress"]
            assert row["last_pushed_at"] == orig["last_pushed_at"]
            assert row["last_pusher"] == orig["last_pusher"]

        # 复合唯一约束保留（D-002）
        unique_names = {
            uc["name"] for uc in inspect(conn).get_unique_constraints("platform_change_progress")
        }
        assert "uq_platform_change_progress_workspace_change" in unique_names


def test_migration_revision_chain_intact() -> None:
    """migration 文件结构 sanity：revision / down_revision 非空 + upgrade/downgrade 可调用。"""
    migration = _load_migration_module()
    assert migration.revision, "migration 应有 revision id"
    assert migration.down_revision is not None, "down_revision 应指向前一个 head"
    assert callable(migration.upgrade)
    assert callable(migration.downgrade)
