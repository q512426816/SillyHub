"""archive-tombstone 冤案一次性数据修复迁移测试（20260923090000）。

结构断言对齐先例 ``test_changes_location_check_migration.py``：迁移文件存在、
alembic 单 head 链且 down_revision 接既有 head（20260923040000）。语义断言直接
执行迁移模块的 ``REPAIR_SQL``（数据迁移判据提为模块级常量的可导入单点）：
deleted×归档阶段（'archive'/'archived' 两代拼写）→ archive；真删除（brainstorm/
scan 期）与活跃行不动。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

MIGRATION_FILE = (
    Path(__file__).resolve().parents[1]
    / "migrations"
    / "versions"
    / "20260923090000_repair_archive_tombstone_victims.py"
)
#: 本迁移接续的既有唯一 head（change-events-channel task-01 建表迁移）。
PRIOR_HEAD = "20260923040000"


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("repair_migration", MIGRATION_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class TestMigrationStructure:
    def test_migration_file_exists_and_single_head_chain(self) -> None:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        assert MIGRATION_FILE.exists(), "迁移文件缺失"
        cfg = Config(str(MIGRATION_FILE.parents[2] / "alembic.ini"))
        sd = ScriptDirectory.from_config(cfg)
        heads = sd.get_heads()
        assert len(heads) == 1, f"expected single head, got {heads}"

    def test_revision_chain(self) -> None:
        mod = _load_migration_module()
        assert mod.revision == "20260923090000"
        assert mod.down_revision == PRIOR_HEAD, "down_revision 必须接 20260923040000 单 head"

    def test_downgrade_noop(self) -> None:
        mod = _load_migration_module()
        text = MIGRATION_FILE.read_text(encoding="utf-8")
        assert "def downgrade" in text
        mod.downgrade()  # no-op 不抛（数据修复不可逆）


def test_repair_sql_semantics_on_sqlite():
    """REPAIR_SQL 判据语义：只翻 deleted×归档阶段，真删除/活跃行不动。"""
    from sqlalchemy import create_engine, text

    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE changes (id INTEGER PRIMARY KEY, change_key TEXT,"
                " location TEXT, current_stage TEXT)"
            )
        )
        rows = [
            ("victim-cli-spelling", "deleted", "archive"),  # 冤案（CLI 拼写，观测形态）
            ("victim-platform-spelling", "deleted", "archived"),  # 冤案（平台终态拼写兜底）
            ("genuine-delete-brainstorm", "deleted", "brainstorm"),  # 真删除（历史 3 例同形态）
            ("genuine-delete-scan", "deleted", "scan"),
            ("normal-archived", "archive", "archived"),  # 已正确行不动
            ("active-row", "active", "execute"),
        ]
        for key, loc, stage in rows:
            conn.execute(
                text(
                    "INSERT INTO changes (change_key, location, current_stage) VALUES (:k, :l, :s)"
                ),
                {"k": key, "l": loc, "s": stage},
            )

        mod = _load_migration_module()
        conn.execute(text(mod.REPAIR_SQL))

        flipped = dict(conn.execute(text("SELECT change_key, location FROM changes")).all())
    assert flipped["victim-cli-spelling"] == "archive"
    assert flipped["victim-platform-spelling"] == "archive"
    assert flipped["genuine-delete-brainstorm"] == "deleted", "真删除（brainstorm 期）不复活"
    assert flipped["genuine-delete-scan"] == "deleted", "真删除（scan 期）不复活"
    assert flipped["normal-archived"] == "archive"
    assert flipped["active-row"] == "active"
