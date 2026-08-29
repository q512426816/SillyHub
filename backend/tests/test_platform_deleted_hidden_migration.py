"""Mapping test for the ``20260829130000_add_platform_deleted_and_quicklog_hidden``
schema migration（task-01 / design §9 / §5.3 / §5.4 / FR-04 / FR-03b，变更
2026-08-29-change-delete-closure-and-spec-pull）。

背景：变更中心删除闭环需要两个标记列——

1. ``spec_file_manifest.platform_deleted``：平台删除墓碑（design §5.4）。变更中心
   删除入口（task-06）置 TRUE 后，apply_ops add/rename 复活拦截、_write_spec_root
   落盘排除（task-02）、_ensure_change_row manifest 兜底锚点（task-04）均以此列为
   数据基础。与既有 ``exists``（增量协议软删，daemon/CLI 对账可置回）语义分离。
2. ``quicklog_entries.hidden``：quicklog 文件对账软隐藏（design §5.3）。apply_ops
   落 quicklog 文件后 ql_id 不在文件集合中的 pushed 行置 TRUE，读侧过滤（task-05），
   留底不硬删。

两列均 BOOLEAN NOT NULL DEFAULT FALSE；存量行默认 FALSE 即目标态（零语义变化），
无数据回填、无索引、不动其它表。

本迁移为纯 dialect 无关 ``op.add_column``（区别于 session_agent_session_id 回填迁移
的 PG raw SQL），SQLite 可真实执行：除元数据/AST 结构断言外，另用
``Operations.context`` 在 SQLite 内存库上跑 upgrade/downgrade 验证真实副作用（列
出现/消失、BOOLEAN 类型、NOT NULL、server_default 对存量行与新插入行补 FALSE、
显式 NULL 被拒）。PG 侧 ``alembic upgrade head`` 留 manual verify（constraint）。

测试范式参照 ``tests/test_session_agent_session_id_migration.py``。
"""

from __future__ import annotations

import ast
import importlib
import inspect
import os
import uuid

import pytest
import sqlalchemy as sa
from sqlmodel import Session, SQLModel

from app.modules.platform_sync.model import QuicklogEntryORM
from app.modules.spec_workspace.model import SpecFileManifest

REVISION_ID = "20260829130000"
DOWN_REVISION_ID = "4766d997cf09"  # execute 实测唯一 head（alembic heads 单头）


def _load_migration(revision_id: str):
    """Load migration module by matching revision ID in filename.

    Mirrors the helper in test_session_agent_session_id_migration.py.
    """
    from pathlib import Path

    backend_root = Path(__file__).resolve().parent.parent
    versions_dir = backend_root / "migrations" / "versions"
    for f in os.listdir(str(versions_dir)):
        if f.endswith(".py") and revision_id in f and f != "__init__.py":
            return importlib.import_module(f"migrations.versions.{f[:-3]}")
    raise ImportError(f"No migration found for revision {revision_id} in {versions_dir}")


# ---------------------------------------------------------------------------
# 1. Migration metadata（AC：单 revision / 接唯一 head / upgrade+downgrade 可调用）
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
    """迁移挂载后 alembic 图仍是单 head（R-05 单头约束，design §9）。

    不连 DB，仅 ScriptDirectory 静态解析 versions/ 目录（照
    test_session_agent_session_id_migration 同款「单 head 且 REVISION_ID 在链上」断言，
    防后续迁移推进 head 后本测试腐烂）。
    """
    from pathlib import Path

    from alembic.script import ScriptDirectory

    backend_root = Path(__file__).resolve().parent.parent
    sd = ScriptDirectory(str(backend_root / "migrations"))
    heads = sd.get_heads()
    assert len(heads) == 1, f"expected single head, got {heads}"
    chain_ids = {rev.revision for rev in sd.walk_revisions()}
    assert REVISION_ID in chain_ids, f"revision {REVISION_ID} not reachable from head"


# ---------------------------------------------------------------------------
# 2. upgrade/downgrade 结构断言（AST 静态解析：恰好两条 add_column，无其它结构操作）
# ---------------------------------------------------------------------------


def _fn_op_calls(mod, fn_name: str) -> list[str]:
    """Parse ``op.*`` call names inside the migration function body via AST."""
    tree = ast.parse(inspect.getsource(getattr(mod, fn_name)))
    return [
        node.func.attr
        for node in ast.walk(tree)
        if isinstance(node, ast.Call)
        and isinstance(node.func, ast.Attribute)
        and isinstance(node.func.value, ast.Name)
        and node.func.value.id == "op"
    ]


def _add_column_specs(mod) -> list[dict]:
    """Extract (table, column, type, nullable, server_default) per op.add_column."""
    tree = ast.parse(inspect.getsource(mod.upgrade))
    specs: list[dict] = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute)):
            continue
        if node.func.attr != "add_column":
            continue
        table = node.args[0].value
        col_call = node.args[1]
        col_name = col_call.args[0].value
        col_type = col_call.args[1].func.attr  # sa.Boolean() → "Boolean"
        kwargs: dict = {}
        for kw in col_call.keywords:
            if kw.arg == "nullable":
                kwargs["nullable"] = kw.value.value
            elif kw.arg == "server_default" and isinstance(kw.value, ast.Call):
                # sa.false() → "false"；sa.text(...) → "text"
                kwargs["server_default"] = kw.value.func.attr
        specs.append(
            {
                "table": table,
                "column": col_name,
                "type": col_type,
                **kwargs,
            }
        )
    return specs


def test_upgrade_is_exactly_two_add_columns():
    """AC/constraints：恰好两条 add_column，无 create/drop index、不动其它表。"""
    mod = _load_migration(REVISION_ID)
    calls = _fn_op_calls(mod, "upgrade")
    assert calls.count("add_column") == 2
    assert set(calls) == {"add_column"}, f"constraints 禁止其它结构操作，实际调用：{calls}"
    specs = _add_column_specs(mod)
    assert [(s["table"], s["column"]) for s in specs] == [
        ("spec_file_manifest", "platform_deleted"),
        ("quicklog_entries", "hidden"),
    ]


def test_upgrade_column_defs_boolean_not_null_default_false():
    """AC：两列均 sa.Boolean + nullable=False + server_default=sa.false()。"""
    specs = _add_column_specs(_load_migration(REVISION_ID))
    for spec in specs:
        assert spec["type"] == "Boolean", spec
        assert spec["nullable"] is False, spec
        assert spec["server_default"] == "false", spec


def test_downgrade_drops_both_columns():
    """AC：downgrade 对称两条 drop_column，无其它结构操作。"""
    mod = _load_migration(REVISION_ID)
    calls = _fn_op_calls(mod, "downgrade")
    assert calls.count("drop_column") == 2
    assert set(calls) == {"drop_column"}, f"downgrade 仅 drop 两条列，实际调用：{calls}"


# ---------------------------------------------------------------------------
# 3. SQLite 真实执行（Operations.context 跑 upgrade/downgrade，断言真实副作用）
#    纯 dialect 无关 add_column 可在 SQLite 方言执行；PG upgrade head 留 manual verify。
# ---------------------------------------------------------------------------


def _create_pre_migration_tables(conn) -> None:
    """迁移前形态的最小两张表（不含新列）+ 各一条存量行（考验 server_default 补值）。"""
    conn.execute(
        sa.text(
            """
            CREATE TABLE spec_file_manifest (
                id CHAR(36) PRIMARY KEY NOT NULL,
                workspace_id CHAR(36) NOT NULL,
                path TEXT NOT NULL
            )
            """
        )
    )
    conn.execute(
        sa.text(
            """
            CREATE TABLE quicklog_entries (
                id CHAR(36) PRIMARY KEY NOT NULL,
                workspace_id CHAR(36) NOT NULL,
                ql_id VARCHAR(128) NOT NULL
            )
            """
        )
    )
    conn.execute(
        sa.text("INSERT INTO spec_file_manifest (id, workspace_id, path) VALUES (:id, :ws, :p)"),
        {"id": str(uuid.uuid4()), "ws": str(uuid.uuid4()), "p": "changes/x/design.md"},
    )
    conn.execute(
        sa.text("INSERT INTO quicklog_entries (id, workspace_id, ql_id) VALUES (:id, :ws, :q)"),
        {"id": str(uuid.uuid4()), "ws": str(uuid.uuid4()), "q": "ql-20260829-001"},
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


def test_upgrade_adds_columns_with_boolean_not_null_default(migrated_engine):
    """AC：列存在 + BOOLEAN 类型 + NOT NULL + server_default false（dflt_value=0）。"""
    with migrated_engine.begin() as conn:
        assert _pragma_column(conn, "spec_file_manifest", "platform_deleted") == (
            "BOOLEAN",
            1,
            "0",
        )
        assert _pragma_column(conn, "quicklog_entries", "hidden") == ("BOOLEAN", 1, "0")


def test_server_default_backfills_existing_rows(migrated_engine):
    """边界：存量行不回填 SQL 也拿到 FALSE（server_default 补值，行为与现状一致）。"""
    with migrated_engine.begin() as conn:
        row = conn.execute(
            sa.text("SELECT platform_deleted FROM spec_file_manifest LIMIT 1")
        ).fetchone()
        assert row is not None and row[0] in (0, False)
        row = conn.execute(sa.text("SELECT hidden FROM quicklog_entries LIMIT 1")).fetchone()
        assert row is not None and row[0] in (0, False)


def test_server_default_fills_new_rows_without_column(migrated_engine):
    """正常路径：新插入不指定列 → server_default 落 FALSE（DB 级默认，非仅 ORM 侧）。"""
    with migrated_engine.begin() as conn:
        conn.execute(
            sa.text(
                "INSERT INTO spec_file_manifest (id, workspace_id, path) VALUES (:id, :ws, :p)"
            ),
            {"id": str(uuid.uuid4()), "ws": str(uuid.uuid4()), "p": "changes/y/tasks.md"},
        )
        row = conn.execute(
            sa.text("SELECT platform_deleted FROM spec_file_manifest WHERE path = :p"),
            {"p": "changes/y/tasks.md"},
        ).fetchone()
        assert row is not None and row[0] in (0, False)


def test_explicit_null_rejected_by_not_null(migrated_engine):
    """异常路径：显式插 NULL 违反 NOT NULL 被拒（防 NULL 墓碑语义漂移）。"""
    with pytest.raises(sa.exc.IntegrityError):
        with migrated_engine.begin() as conn:
            conn.execute(
                sa.text(
                    "INSERT INTO quicklog_entries (id, workspace_id, ql_id, hidden) "
                    "VALUES (:id, :ws, :q, NULL)"
                ),
                {"id": str(uuid.uuid4()), "ws": str(uuid.uuid4()), "q": "ql-x"},
            )


def test_downgrade_drops_columns_for_real():
    """downgrade 真实执行：两列消失、原列保留（对称可回滚）。"""
    engine = sa.create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        _create_pre_migration_tables(conn)
    mod = _load_migration(REVISION_ID)
    _run_migration_fn(engine, mod, "upgrade")
    _run_migration_fn(engine, mod, "downgrade")
    with engine.begin() as conn:
        assert _pragma_column(conn, "spec_file_manifest", "platform_deleted") is None
        assert _pragma_column(conn, "quicklog_entries", "hidden") is None
        # 原有列不受 downgrade 影响
        assert _pragma_column(conn, "spec_file_manifest", "path") is not None
    engine.dispose()


# ---------------------------------------------------------------------------
# 4. ORM 字段（AC：默认 False 无需显式传参 + create_all 读写往返）
# ---------------------------------------------------------------------------


def test_orm_fields_default_false_without_explicit_param():
    """AC：构造新行无需显式传参，platform_deleted / hidden 默认 False。"""
    manifest = SpecFileManifest(
        workspace_id=uuid.uuid4(),
        path="changes/z/design.md",
        content_hash="a" * 64,
    )
    assert manifest.platform_deleted is False

    entry = QuicklogEntryORM(workspace_id=uuid.uuid4(), ql_id="ql-20260829-002")
    assert entry.hidden is False


@pytest.fixture()
def orm_engine():
    """仅建两张 ORM 表（FK 目标表缺失 SQLite 不强制，可插入）。"""
    eng = sa.create_engine("sqlite:///:memory:")
    SQLModel.metadata.create_all(
        eng,
        tables=[SpecFileManifest.__table__, QuicklogEntryORM.__table__],
    )
    yield eng
    eng.dispose()


def test_spec_manifest_platform_deleted_round_trip(orm_engine):
    """ORM 读写往返：默认 False 落库 → 置 True 持久化 → 重读仍 True。"""
    with Session(orm_engine) as session:
        row = SpecFileManifest(
            workspace_id=uuid.uuid4(),
            path="changes/r/design.md",
            content_hash="b" * 64,
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        assert row.platform_deleted is False
        row_id = row.id

        row.platform_deleted = True
        session.add(row)
        session.commit()

    with Session(orm_engine) as session:
        fetched = session.get(SpecFileManifest, row_id)
        assert fetched is not None
        assert fetched.platform_deleted is True


def test_quicklog_entry_hidden_round_trip(orm_engine):
    """ORM 读写往返：默认 False 落库 → 置 True 持久化 → 重读仍 True。"""
    with Session(orm_engine) as session:
        row = QuicklogEntryORM(
            workspace_id=uuid.uuid4(),
            ql_id="ql-20260829-003",
            payload={"title": "测试"},
        )
        session.add(row)
        session.commit()
        session.refresh(row)
        assert row.hidden is False
        row_id = row.id

        row.hidden = True
        session.add(row)
        session.commit()

    with Session(orm_engine) as session:
        fetched = session.get(QuicklogEntryORM, row_id)
        assert fetched is not None
        assert fetched.hidden is True


def test_orm_columns_declared_not_null_boolean():
    """ORM 声明与迁移一致：Boolean + nullable=False（防 autogenerate 漂移）。"""
    spec_col = SpecFileManifest.__table__.columns["platform_deleted"]
    assert isinstance(spec_col.type, sa.Boolean)
    assert spec_col.nullable is False

    ql_col = QuicklogEntryORM.__table__.columns["hidden"]
    assert isinstance(ql_col.type, sa.Boolean)
    assert ql_col.nullable is False
