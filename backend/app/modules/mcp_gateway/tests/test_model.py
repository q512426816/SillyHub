"""ORM 元数据级测试：McpTokenORM / McpWebhookORM / AgentRun.read_only（task-01）。

Change 2026-08-06-public-mcp-server task-01 / design §8.1 §8.2 §8.3。

只校验 schema 契约（表名 / 字段 / 列约束 / FK ondelete / 索引），不触 DB ——
verify 阶段在 worktree 装 .venv 后由 pytest 实跑（task-01 不跑测试约束）。
持久化 / 唯一约束落库行为留 token service（task-03）的集成测试覆盖。
"""

from __future__ import annotations

import uuid

import pytest
from sqlmodel import SQLModel

from app.modules.agent.model import AgentRun
from app.modules.mcp_gateway.model import McpTokenORM, McpWebhookORM

# ---------------------------------------------------------------------------
# McpTokenORM
# ---------------------------------------------------------------------------


def test_mcp_token_is_table_model() -> None:
    """McpTokenORM 必须是 SQLModel table，映射到 mcp_tokens。"""
    assert issubclass(McpTokenORM, SQLModel)
    assert McpTokenORM.__table__ is not None
    assert McpTokenORM.__tablename__ == "mcp_tokens"
    # 注册到共享 metadata（alembic autogenerate / create_all 才能扫到）。
    assert "mcp_tokens" in SQLModel.metadata.tables


def test_mcp_token_field_contract() -> None:
    """design §8.1 / task-01 provides 要求的字段全部就位。"""
    fields = set(McpTokenORM.model_fields.keys())
    required = {
        "id",
        "workspace_id",
        "name",
        "token_hash",
        "scope",
        "created_by",
        "created_at",
        "last_used_at",
        "revoked_at",
    }
    assert required.issubset(fields), f"missing fields: {required - fields}"


def test_mcp_token_column_types_and_nullability() -> None:
    """核心列类型 / 可空性对齐 design §8.1。"""
    table = McpTokenORM.__table__

    # workspace_id / name / token_hash / scope / created_at 均 NOT NULL。
    for col_name in ("workspace_id", "name", "token_hash", "scope", "created_at"):
        col = table.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"

    # 审计 / 吊销列 nullable（design §8.1 last_used_at / revoked_at nullable）。
    for col_name in ("created_by", "last_used_at", "revoked_at"):
        col = table.columns[col_name]
        assert col.nullable is True, f"{col_name} must be nullable"

    # 长度上限。
    assert table.columns["name"].type.length == 100
    assert table.columns["token_hash"].type.length == 128


def test_mcp_token_foreign_key_ondelete_semantics() -> None:
    """FK ondelete 语义（design §8.1）：workspace CASCADE、created_by SET NULL。"""
    table = McpTokenORM.__table__

    ws_fks = list(table.columns["workspace_id"].foreign_keys)
    assert len(ws_fks) == 1
    assert ws_fks[0].column.table.name == "workspaces"
    assert ws_fks[0].ondelete == "CASCADE"

    created_by_fks = list(table.columns["created_by"].foreign_keys)
    assert len(created_by_fks) == 1
    assert created_by_fks[0].column.table.name == "users"
    assert created_by_fks[0].ondelete == "SET NULL"


def test_mcp_token_index_contract() -> None:
    """design §8.1 索引要求：token_hash 唯一索引、workspace_id 普通索引。"""
    indexes = {idx.name: idx for idx in McpTokenORM.__table__.indexes}
    assert "ix_mcp_tokens_token_hash" in indexes
    assert indexes["ix_mcp_tokens_token_hash"].unique is True
    assert [c.name for c in indexes["ix_mcp_tokens_token_hash"].columns] == ["token_hash"]

    assert "ix_mcp_tokens_workspace_id" in indexes
    assert indexes["ix_mcp_tokens_workspace_id"].unique is False
    assert [c.name for c in indexes["ix_mcp_tokens_workspace_id"].columns] == ["workspace_id"]


def test_mcp_token_defaults() -> None:
    """id 自动 UUID、created_at 自动填充、scope 默认空列表。"""
    token = McpTokenORM(
        workspace_id=uuid.uuid4(),
        name="ci-token",
        token_hash="abc123",
    )
    assert token.id is not None
    assert token.scope == []
    assert token.last_used_at is None
    assert token.revoked_at is None


# ---------------------------------------------------------------------------
# McpWebhookORM
# ---------------------------------------------------------------------------


def test_mcp_webhook_is_table_model() -> None:
    """McpWebhookORM 必须是 SQLModel table，映射到 mcp_webhooks。"""
    assert issubclass(McpWebhookORM, SQLModel)
    assert McpWebhookORM.__table__ is not None
    assert McpWebhookORM.__tablename__ == "mcp_webhooks"
    assert "mcp_webhooks" in SQLModel.metadata.tables


def test_mcp_webhook_field_contract() -> None:
    """design §8.2 / task-01 provides 要求的字段全部就位。"""
    fields = set(McpWebhookORM.model_fields.keys())
    required = {"id", "token_id", "workspace_id", "url", "secret", "events", "active", "created_at"}
    assert required.issubset(fields), f"missing fields: {required - fields}"


def test_mcp_webhook_column_types_and_nullability() -> None:
    """核心列类型 / 可空性对齐 design §8.2。"""
    table = McpWebhookORM.__table__

    for col_name in (
        "token_id",
        "workspace_id",
        "url",
        "secret",
        "events",
        "active",
        "created_at",
    ):
        col = table.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"

    # 长度上限。
    assert table.columns["url"].type.length == 500
    assert table.columns["secret"].type.length == 128


def test_mcp_webhook_foreign_key_ondelete_semantics() -> None:
    """FK ondelete 语义（design §8.2 / task-01 铁律5）：token_id 与 workspace_id 均 CASCADE。"""
    table = McpWebhookORM.__table__

    token_fks = list(table.columns["token_id"].foreign_keys)
    assert len(token_fks) == 1
    assert token_fks[0].column.table.name == "mcp_tokens"
    assert token_fks[0].ondelete == "CASCADE"

    ws_fks = list(table.columns["workspace_id"].foreign_keys)
    assert len(ws_fks) == 1
    assert ws_fks[0].column.table.name == "workspaces"
    assert ws_fks[0].ondelete == "CASCADE"


def test_mcp_webhook_index_contract() -> None:
    """token_id / workspace_id 普通索引就位。"""
    indexes = {idx.name: idx for idx in McpWebhookORM.__table__.indexes}
    assert "ix_mcp_webhooks_token_id" in indexes
    assert indexes["ix_mcp_webhooks_token_id"].unique is False
    assert "ix_mcp_webhooks_workspace_id" in indexes
    assert indexes["ix_mcp_webhooks_workspace_id"].unique is False


def test_mcp_webhook_defaults() -> None:
    """id 自动 UUID、active 默认 True、events 默认空列表。"""
    webhook = McpWebhookORM(
        token_id=uuid.uuid4(),
        workspace_id=uuid.uuid4(),
        url="https://example.com/hook",
        secret="s3cret",
    )
    assert webhook.id is not None
    assert webhook.active is True
    assert webhook.events == []


# ---------------------------------------------------------------------------
# AgentRun.read_only（design §8.3）
# ---------------------------------------------------------------------------


def test_agent_run_has_read_only_nullable_bool() -> None:
    """design §8.3：AgentRun.read_only 列就位，nullable bool 兼容老行 NULL。"""
    assert "read_only" in AgentRun.model_fields

    col = AgentRun.__table__.columns["read_only"]
    assert col.nullable is True, "read_only 必须 nullable 让老 run 行 NULL 零回归"


def test_agent_run_read_only_python_default_none() -> None:
    """Python default=None（NULL = 非只读），风格对齐 gate_status / is_resume。"""
    run = AgentRun(agent_type="claude_code")
    assert run.read_only is None


# ---------------------------------------------------------------------------
# 迁移文件存在性
# ---------------------------------------------------------------------------


def test_migration_file_exists() -> None:
    """task-01 迁移文件落地（文件名校验，revision 串校验由 alembic upgrade 兜）。"""
    from pathlib import Path

    migration_dir = Path(__file__).resolve().parents[4] / "migrations" / "versions"
    matches = list(migration_dir.glob("*add_mcp_tokens_webhooks_run_readonly*.py"))
    assert len(matches) == 1, f"Expected 1 migration file, found {len(matches)}"


@pytest.mark.parametrize(
    "model,table_name",
    [
        (McpTokenORM, "mcp_tokens"),
        (McpWebhookORM, "mcp_webhooks"),
    ],
)
def test_models_map_to_expected_tables(model: type, table_name: str) -> None:
    """表名单数语义对齐 design §8（mcp_tokens / mcp_webhooks）。"""
    assert model.__tablename__ == table_name
