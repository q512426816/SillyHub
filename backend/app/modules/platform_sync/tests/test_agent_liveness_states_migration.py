"""agent_liveness_states 四列迁移测试（2026-09-07-agent-liveness-states task-07）。

结构断言对齐先例 ``backend/tests/test_changes_location_check_migration.py``：
迁移文件存在、alembic 单 head 链且 down_revision 接既有 head、upgrade 四次
``add_column``（全 nullable 不回填）、downgrade 对称反序 drop；另加 ORM
``create_all`` 侧四列逐列对齐断言（防模型↔迁移漂移，先例事故防复发）与
``AgentLogListItem`` 旧行口径断言（design §5.3：存量行 state NULL 不回填，
unknown 归一由响应 schema validator 承载）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

from alembic.script import ScriptDirectory
from sqlalchemy import DateTime, String, create_engine, inspect
from sqlalchemy.orm import Session
from sqlmodel import SQLModel

MIGRATION_FILE = (
    Path(__file__).resolve().parents[4]
    / "migrations"
    / "versions"
    / "20260907141041_agent_liveness_states.py"
)
#: 本迁移期望接续的既有唯一 head（写卡时 20260905004300，执行前 alembic heads 实测）。
PRIOR_HEAD = "20260905004300"
#: 四列名（upgrade add_column / downgrade drop / ORM 声明三处共用）。
LIVENESS_COLUMNS = ("state", "state_derived_at", "state_evidence", "last_event_at")


def _script_directory() -> ScriptDirectory:
    from alembic.config import Config

    cfg = Config(str(MIGRATION_FILE.parents[2] / "alembic.ini"))
    return ScriptDirectory.from_config(cfg)


class TestMigrationStructure:
    def test_migration_file_exists_and_single_head_chain(self) -> None:
        assert MIGRATION_FILE.exists(), "迁移文件缺失"
        heads = _script_directory().get_heads()
        assert len(heads) == 1, f"expected single head, got {heads}"

    def test_revision_is_head_and_chains_to_prior_head(self) -> None:
        rev = MIGRATION_FILE.stem.split("_")[0]
        script = _script_directory().get_revision(rev)
        assert script.down_revision == PRIOR_HEAD, "down_revision 必须接既有唯一 head"

    def test_upgrade_adds_four_nullable_columns(self) -> None:
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        upgrade = text.split("def upgrade")[1].split("def downgrade")[0]
        assert upgrade.count("add_column") == 4, "upgrade 必须恰好四次 add_column"
        assert upgrade.count('"platform_agent_logs"') == 4
        for name in LIVENESS_COLUMNS:
            assert f'"{name}"' in upgrade, f"upgrade 缺 {name} 列"
        assert "nullable=True" in upgrade
        assert "nullable=False" not in upgrade, "四列必须全 nullable（存量行不回填）"

    def test_upgrade_column_types_match_design(self) -> None:
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        upgrade = text.split("def upgrade")[1].split("def downgrade")[0]
        # design §5.3 列型：state String(16) / state_evidence String(200) /
        # 时间两列 DateTime(timezone=True)（D-003：结构化 datetime 非 ISO 原文）。
        assert "sa.String(length=16)" in upgrade
        assert "sa.String(length=200)" in upgrade
        assert upgrade.count("sa.DateTime(timezone=True)") == 2

    def test_downgrade_drops_four_columns_symmetrically(self) -> None:
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        downgrade = text.split("def downgrade")[1]
        assert downgrade.count("drop_column") == 4, "downgrade 必须对称 drop 四列"
        for name in LIVENESS_COLUMNS:
            assert f'"{name}"' in downgrade, f"downgrade 缺 {name} 列"


class TestOrmColumnParity:
    """ORM 侧四列逐列对齐（防模型↔迁移漂移，changes.location 事故先例防复发）。"""

    def test_orm_declares_four_nullable_liveness_columns(self) -> None:
        from app.modules.platform_sync.model import AgentSessionLogORM

        table = AgentSessionLogORM.__table__
        for name in LIVENESS_COLUMNS:
            assert name in table.columns, f"ORM 缺 {name} 列"
            col = table.columns[name]
            assert col.nullable is True, f"{name} 必须 nullable（存量行不回填）"
            if name == "state":
                assert isinstance(col.type, String), "state 必须 String"
                assert col.type.length == 16, "state 列宽必须 String(16)"
            elif name == "state_evidence":
                assert isinstance(col.type, String), "state_evidence 必须 String"
                assert col.type.length == 200, "state_evidence 列宽必须 String(200)"
            else:
                assert isinstance(col.type, DateTime), f"{name} 必须 DateTime"
                assert col.type.timezone is True, f"{name} 必须 timezone-aware（D-003）"

    def test_create_all_table_columns_match_design(self) -> None:
        from app.modules.platform_sync.model import AgentSessionLogORM

        engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(engine, tables=[AgentSessionLogORM.__table__])
        cols = {c["name"]: c for c in inspect(engine).get_columns("platform_agent_logs")}
        for name in LIVENESS_COLUMNS:
            assert name in cols, f"create_all 建表缺 {name} 列（模型↔迁移漂移）"
            assert cols[name]["nullable"] is True
        assert isinstance(cols["state"]["type"], String)
        assert cols["state"]["type"].length == 16
        assert isinstance(cols["state_evidence"]["type"], String)
        assert cols["state_evidence"]["type"].length == 200

    def test_row_persistable_without_liveness_columns(self) -> None:
        """旧行口径：登记链路（task-08 之前的既有写入）不设状态四列可直接落库。"""
        from app.modules.platform_sync.model import AgentSessionLogORM

        engine = create_engine("sqlite://")
        SQLModel.metadata.create_all(engine, tables=[AgentSessionLogORM.__table__])
        with Session(engine) as s:
            row = AgentSessionLogORM(
                workspace_id=uuid.uuid4(),
                log_path="C:\\tmp\\legacy.jsonl",
                harness="claude-code",
            )
            s.add(row)
            s.commit()
            s.refresh(row)
            assert row.state is None
            assert row.state_derived_at is None
            assert row.state_evidence is None
            assert row.last_event_at is None


class TestListItemStateNormalization:
    """GET /agent-logs 旧行口径（design §5.3）：state NULL → 响应归一 unknown。"""

    @staticmethod
    def _orm_row(**overrides: object) -> SimpleNamespace:
        base: dict[str, object] = dict(
            id=uuid.uuid4(),
            workspace_id=uuid.uuid4(),
            log_path="C:\\tmp\\legacy.jsonl",
            harness="claude-code",
            format=None,
            session_id=None,
            originator=None,
            detected_via=None,
            agent_cwd=None,
            exists=True,
            size_bytes=None,
            mtime_ms=None,
            first_seen_at=None,
            last_seen_at=None,
            invocations=None,
            last_command=None,
            scan_run_id=None,
            pushed_at=None,
            agent_session_id=None,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
            state=None,
            state_derived_at=None,
            state_evidence=None,
            last_event_at=None,
        )
        base.update(overrides)
        return SimpleNamespace(**base)

    def test_legacy_null_state_normalized_to_unknown(self) -> None:
        from app.modules.platform_sync.schema import AgentLogListItem

        item = AgentLogListItem.model_validate(self._orm_row())
        assert item.state == "unknown", "旧行 state NULL 必须归一 unknown"
        assert item.state_derived_at is None
        assert item.state_evidence is None
        assert item.last_event_at is None

    def test_present_state_passthrough(self) -> None:
        from app.modules.platform_sync.schema import AgentLogListItem

        derived = datetime(2026, 9, 7, 12, 0, tzinfo=UTC)
        item = AgentLogListItem.model_validate(
            self._orm_row(
                state="blocked",
                state_derived_at=derived,
                state_evidence="PERMISSION_REQUEST(write)",
                last_event_at=derived,
            )
        )
        assert item.state == "blocked"
        assert item.state_derived_at == derived
        assert item.state_evidence == "PERMISSION_REQUEST(write)"
        assert item.last_event_at == derived
