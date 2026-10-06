"""agent_kind → agent_kinds JSON 迁移测试（change 2026-10-06 / task-07 / FR-02 / R-01）。

不跑 alembic 命令链（env.py 走 asyncio.run，与 pytest 异步夹具冲突）；改用
MigrationContext + Operations 直驱迁移模块的 upgrade/downgrade——对真实
SQLite 引擎执行同样的 op 序列（batch_alter_table 语义一致）。PG 分支由生产
开发库 2026-10-06 实跑背书（upgrade/downgrade/再 upgrade 往返 + 终态断言）。

断言面（design §数据模型）：
- 终态：agent_kind 列不存在、agent_kinds 在；存量单值行转单元素数组（值域不变）；
- 索引：复合索引 ix_llm_providers_user_agent_default 退役、(user_id) 维度在位（R-01）；
- 回程：agent_kind 恢复为数组首元素、复合索引恢复原形态（可回退）。
"""

from __future__ import annotations

import importlib.util
import sqlite3
import uuid
from pathlib import Path

from alembic.migration import MigrationContext
from alembic.operations import Operations
from sqlalchemy import create_engine

BACKEND_DIR = Path(__file__).resolve().parents[4]
MIGRATION_FILE = BACKEND_DIR / "migrations" / "versions" / "20261006120000_provider_agent_kinds.py"

# 迁移前一形态的最小 llm_providers 表（列/索引与 20260725 create 迁移一致的最小集）。
_PRE_SCHEMA = """
CREATE TABLE llm_providers (
    id CHAR(32) NOT NULL PRIMARY KEY,
    user_id CHAR(32) NOT NULL,
    name VARCHAR(128) NOT NULL,
    agent_kind VARCHAR(32) NOT NULL,
    encrypted_api_key BLOB NOT NULL,
    key_id VARCHAR(64) NOT NULL,
    auth_field VARCHAR(64) NOT NULL,
    api_format VARCHAR(32) NOT NULL,
    multimodal VARCHAR(8) NOT NULL,
    is_default BOOLEAN NOT NULL,
    created_at DATETIME NOT NULL,
    updated_at DATETIME NOT NULL
);
CREATE INDEX ix_llm_providers_user ON llm_providers (user_id);
CREATE INDEX ix_llm_providers_user_agent_default ON llm_providers (user_id, agent_kind, is_default);
"""


def _load_module():
    spec = importlib.util.spec_from_file_location("provider_agent_kinds_migration", MIGRATION_FILE)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def test_roundtrip_single_value_becomes_single_element_array(tmp_path: Path) -> None:
    db = tmp_path / "mig.db"
    engine = create_engine(f"sqlite:///{db}")
    with engine.begin() as conn:
        for stmt in [s.strip() for s in _PRE_SCHEMA.split(";") if s.strip()]:
            conn.exec_driver_sql(stmt)
        conn.exec_driver_sql(
            "INSERT INTO llm_providers (id, user_id, name, agent_kind, encrypted_api_key,"
            " key_id, auth_field, api_format, multimodal, is_default, created_at, updated_at)"
            " VALUES (?,?,?,?,X'00','v1','ANTHROPIC_AUTH_TOKEN','anthropic','auto',0,'t','t')",
            ((str(uuid.uuid4()).replace("-", "")), "u1", "p1", "claude"),
        )
        conn.exec_driver_sql(
            "INSERT INTO llm_providers (id, user_id, name, agent_kind, encrypted_api_key,"
            " key_id, auth_field, api_format, multimodal, is_default, created_at, updated_at)"
            " VALUES (?,?,?,?,X'00','v1','ZAI_API_KEY','anthropic','auto',1,'t','t')",
            ((str(uuid.uuid4()).replace("-", "")), "u1", "p2", "pi"),
        )

    mod = _load_module()

    # ── upgrade：Operations 直驱（真实 SQLite 引擎，batch 语义一致）──
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)
        mod.op = op
        mod.upgrade()

    raw = sqlite3.connect(db)
    cols = [r[1] for r in raw.execute("PRAGMA table_info(llm_providers)")]
    assert "agent_kind" not in cols
    assert "agent_kinds" in cols
    idx = {r[1] for r in raw.execute("PRAGMA index_list(llm_providers)")}
    assert "ix_llm_providers_user_agent_default" not in idx  # R-01 退役
    assert "ix_llm_providers_user" in idx  # (user_id) 维度在位
    rows = dict(raw.execute("SELECT name, agent_kinds FROM llm_providers"))
    assert rows["p1"] == '["claude"]'  # FR-02 值域不变性（单元素数组）
    assert rows["p2"] == '["pi"]'

    # ── downgrade：对称回程 ──
    with engine.begin() as conn:
        ctx = MigrationContext.configure(conn)
        op = Operations(ctx)
        mod.op = op
        mod.downgrade()

    cols2 = [r[1] for r in raw.execute("PRAGMA table_info(llm_providers)")]
    assert "agent_kind" in cols2
    assert "agent_kinds" not in cols2
    idx2 = {r[1] for r in raw.execute("PRAGMA index_list(llm_providers)")}
    assert "ix_llm_providers_user_agent_default" in idx2  # 复合索引恢复
    kinds_back = dict(raw.execute("SELECT name, agent_kind FROM llm_providers"))
    assert kinds_back["p1"] == "claude"  # 首元素恢复
    assert kinds_back["p2"] == "pi"
    raw.close()
    engine.dispose()
