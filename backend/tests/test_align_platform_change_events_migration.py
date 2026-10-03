"""platform_change_events 迁移链去重守护（2026-09-26-migration-chain-dedupe）。

结构断言对齐先例 ``test_archive_tombstone_repair_migration.py``：矫正迁移
20260926234000 接单 head、重复分支（20260926063000 / merge 3931ff71bd32）
彻底移出 versions 目录、083000 改接主线 20260923090000。语义断言用 fake
bind 驱动矫正迁移的 information_schema 探测两形态：

- 旧结构（生产实况：ts timestamptz / severity(32) 可空无默认 / rule 可空 /
  detail varchar / stage 存在）→ 发出全部对齐 DDL（含 ts USING to_char
  数据转换、stage DROP、NULL 回填 UPDATE）；
- 目标结构（本地 dogfood 实况，063000 建表即 ORM 结构）→ 零 DDL 全 no-op；
- 非 PG 方言（SQLite 测试库）→ 直接返回零 DDL。
"""

from __future__ import annotations

import importlib.util
from pathlib import Path
from unittest.mock import patch

BACKEND_DIR = Path(__file__).resolve().parents[1]
VERSIONS_DIR = BACKEND_DIR / "migrations" / "versions"
MIGRATION_FILE = VERSIONS_DIR / "20260926234000_align_platform_change_events.py"


def _load_migration_module():
    spec = importlib.util.spec_from_file_location("align_migration", MIGRATION_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _ProbeRow:
    """information_schema 探测行的轻量替身（支持下标访问）。"""

    def __init__(self, data_type: str, nullable: str, max_len, default) -> None:
        self._row = (data_type, nullable, max_len, default)

    def __getitem__(self, idx):
        return self._row[idx]


class _FakeBind:
    """记录 DDL、按预置列元数据应答探测的假 bind。"""

    def __init__(self, dialect_name: str, columns: dict[str, tuple | None]) -> None:
        self.dialect = type("D", (), {"name": dialect_name})()
        self._columns = {
            name: (_ProbeRow(*meta) if meta is not None else None) for name, meta in columns.items()
        }
        self.statements: list[str] = []

    def execute(self, stmt, params=None):
        text = str(stmt)
        self.statements.append(text)
        if "information_schema.columns" in text:
            row = self._columns.get(params["c"])
            return type("R", (), {"first": lambda self_, r=row: r})()
        return None


def _invoke(mod, bind) -> None:
    """以 fake bind 替换 op.get_bind 上下文执行 upgrade。"""
    with patch.object(mod.op, "get_bind", return_value=bind):
        mod.upgrade()


# 旧结构（生产实况）：ts timestamptz / severity varchar(32) 可空无默认 /
# rule 可空 / provisional 无默认 / detail varchar / stage 存在。
OLD_SHAPE = {
    "ts": ("timestamp with time zone", "NO", None, None),
    "severity": ("character varying", "YES", 32, None),
    "rule": ("character varying", "YES", 128, None),
    "provisional": ("boolean", "NO", None, None),
    "detail": ("character varying", "YES", 2000, None),
    "stage": ("character varying", "YES", 64, None),
}

# 目标结构（本地 dogfood 实况 = ORM）：全部对齐步骤应 no-op。
TARGET_SHAPE = {
    "ts": ("character varying", "NO", 64, None),
    "severity": ("character varying", "NO", 16, "'info'::character varying"),
    "rule": ("character varying", "NO", 128, None),
    "provisional": ("boolean", "NO", None, "true"),
    "detail": ("text", "YES", None, None),
}


class TestMigrationStructure:
    def test_file_exists_and_single_head_chain(self) -> None:
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        assert MIGRATION_FILE.exists(), "矫正迁移文件缺失"
        cfg = Config(str(BACKEND_DIR / "alembic.ini"))
        heads = ScriptDirectory.from_config(cfg).get_heads()
        assert len(heads) == 1, f"expected single head, got {heads}"
        # 链尾锚定：20261002010000（platform_agent_logs 用量快照五列，
        # 2026-10-02-change-center-token-usage）down_revision 接本迁移后 head 前移。
        assert heads[0] == "20261003020000"  # 2026-10-03-local-usage-segment-attribution 水位表成为新 head

    def test_revision_chain(self) -> None:
        mod = _load_migration_module()
        assert mod.revision == "20260926234000"
        assert mod.down_revision == "20260926083000"

    def test_duplicate_branch_purged(self) -> None:
        """重复建表迁移与 merge 文件必须彻底移出 versions 目录。"""
        names = "\n".join(p.name for p in VERSIONS_DIR.glob("*.py"))
        assert "20260926063000" not in names, "重复建表迁移 063000 仍在链上"
        assert "3931ff71bd32" not in names, "merge 3931ff71bd32 仍在链上"

    def test_083000_reattached_to_mainline(self) -> None:
        source = (VERSIONS_DIR / "20260926083000_spec_workspace_last_writer.py").read_text(
            encoding="utf-8"
        )
        assert 'down_revision = "20260923090000"' in source


class TestAlignBehavior:
    def test_old_shape_emits_full_alignment(self) -> None:
        mod = _load_migration_module()
        bind = _FakeBind("postgresql", OLD_SHAPE)
        _invoke(mod, bind)
        joined = "\n".join(bind.statements)
        # 数据转换：ts timestamptz → varchar(64)，历史值转 ISO 8601 UTC 串。
        assert "ALTER COLUMN ts TYPE varchar(64)" in joined
        assert "to_char" in joined
        # NULL 回填（severity → 'info'，rule → ''）。
        assert "SET severity = 'info' WHERE severity IS NULL" in joined
        assert "SET rule = '' WHERE rule IS NULL" in joined
        # 约束与类型收紧。
        assert "ALTER COLUMN severity TYPE varchar(16)" in joined
        assert "ALTER COLUMN severity SET NOT NULL" in joined
        assert "ALTER COLUMN severity SET DEFAULT 'info'" in joined
        assert "ALTER COLUMN rule SET NOT NULL" in joined
        assert "ALTER COLUMN provisional SET DEFAULT true" in joined
        assert "ALTER COLUMN detail TYPE text" in joined
        # stage 列（063000/ORM 语义已废）存在即 DROP。
        assert "DROP COLUMN stage" in joined

    def test_target_shape_is_full_noop(self) -> None:
        mod = _load_migration_module()
        bind = _FakeBind("postgresql", TARGET_SHAPE)
        _invoke(mod, bind)
        ddls = [s for s in bind.statements if "ALTER" in s or "DROP" in s]
        assert ddls == [], f"目标结构库不应有任何 DDL，实际发出: {ddls}"

    def test_sqlite_dialect_short_circuits(self) -> None:
        mod = _load_migration_module()
        bind = _FakeBind("sqlite", OLD_SHAPE)
        _invoke(mod, bind)
        assert bind.statements == [], "SQLite（测试库）应整体 no-op"
