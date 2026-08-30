"""changes.location CHECK 约束扩值（active/archive/deleted）迁移测试。

生产事故（2026-08-30，crrcdt.ppdmq.top）：变更中心删除变更 500——生产 PG 的
``ck_changes_location`` 只允许 ``active/archive``（202605300900 建表迁移定义），
而 ORM 模型从未声明该约束（模型↔迁移漂移）：本地测试走 SQLite ``create_all``
（无此约束）全绿，线上 PG 直接 ``CheckViolation``。

修复双件套：①迁移扩三值；②模型同步声明同名 CheckConstraint——create_all 与
PG 行为从此对齐（漂移修复），``deleted`` 合法、非法值两侧一致拒绝。
"""

import re
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260829230000_expand_changes_location_check.py"
)


class TestMigrationStructure:
    def test_migration_file_exists_and_single_head_chain(self) -> None:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        assert MIGRATION_FILE.exists(), "迁移文件缺失"
        cfg = Config(str(MIGRATION_FILE.parents[2] / "alembic.ini"))
        sd = ScriptDirectory.from_config(cfg)
        heads = sd.get_heads()
        assert len(heads) == 1, f"expected single head, got {heads}"

    def test_upgrade_expands_check_to_three_values(self) -> None:
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        upgrade = text.split("def upgrade")[1].split("def downgrade")[0]
        assert 'drop_constraint("ck_changes_location"' in upgrade
        assert "deleted" in upgrade, "扩值必须包含 deleted"
        assert upgrade.count("create_check_constraint") == 1

    def test_downgrade_restores_two_values(self) -> None:
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        downgrade = text.split("def downgrade")[1]
        assert 'drop_constraint("ck_changes_location"' in downgrade
        assert "deleted" not in downgrade, "降级必须回到两值"
        assert downgrade.count("create_check_constraint") == 1


class TestModelCheckConstraintParity:
    """模型侧约束对齐（防再漂移）：create_all 建出的表必须带同名三值 CHECK。"""

    @pytest.fixture()
    def session(self):
        import uuid as uuid_mod

        from sqlalchemy import create_engine
        from sqlalchemy.orm import Session
        from sqlmodel import SQLModel

        from app.modules.change.model import Change

        engine = create_engine("sqlite://")
        # SQLite 默认不强制外键——只建 changes 表即可（workspace_id 用随机 uuid）
        SQLModel.metadata.create_all(engine, tables=[Change.__table__])
        with Session(engine) as s:
            s.ws_id = uuid_mod.uuid4()
            yield s

    def test_table_declares_named_check(self) -> None:
        from app.modules.change.model import Change

        checks = [c for c in Change.__table__.constraints if type(c).__name__ == "CheckConstraint"]
        assert any(getattr(c, "name", None) == "ck_changes_location" for c in checks), (
            "模型必须声明 ck_changes_location（与 PG 对齐，防漂移复发）"
        )
        compiled = str(next(c for c in checks if c.name == "ck_changes_location").sqltext)
        assert re.search(r"deleted", compiled, re.I)

    def test_location_deleted_is_persistable(self, session) -> None:
        import uuid as uuid_mod

        from app.modules.change.model import Change

        row = Change(
            id=uuid_mod.uuid4(),
            workspace_id=session.ws_id,
            change_key="2026-08-30-x",
            path="changes/2026-08-30-x",
            location="deleted",
        )
        session.add(row)
        session.commit()  # 约束允许 deleted（生产 500 的直接回归锚）
        session.refresh(row)
        assert row.location == "deleted"

    def test_location_bogus_rejected(self, session) -> None:
        import uuid as uuid_mod

        from app.modules.change.model import Change

        session.add(
            Change(
                id=uuid_mod.uuid4(),
                workspace_id=session.ws_id,
                change_key="2026-08-30-y",
                path="changes/2026-08-30-y",
                location="bogus",
            )
        )
        with pytest.raises(IntegrityError):
            session.commit()
