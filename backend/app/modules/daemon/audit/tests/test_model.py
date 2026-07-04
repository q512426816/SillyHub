"""Unit + persistence tests for PolicyAuditLog (D-006@v1, task-09)."""

from __future__ import annotations

from datetime import datetime

import pytest
from sqlalchemy import select
from sqlmodel import SQLModel

from app.modules.daemon.audit.model import PolicyAuditLog


def test_policy_audit_log_is_table_model() -> None:
    """PolicyAuditLog must be a SQLModel table mapped to policy_audit_log."""
    assert issubclass(PolicyAuditLog, SQLModel)
    assert PolicyAuditLog.__table__ is not None
    assert PolicyAuditLog.__tablename__ == "policy_audit_log"
    # 注册到 BaseModel.metadata（autogenerate / create_all 才能扫到）
    assert "policy_audit_log" in SQLModel.metadata.tables


def test_policy_audit_log_field_contract() -> None:
    """所有审计字段就位（design §7.4）."""
    fields = set(PolicyAuditLog.model_fields.keys())
    for required in (
        "id",
        "runtime_id",
        "workspace_id",
        "decision",
        "provider",
        "tool",
        "path",
        "reason",
        "created_at",
    ):
        assert required in fields, f"missing audit field: {required}"


def test_policy_audit_log_core_columns_not_nullable() -> None:
    """审计核心字段列级 NOT NULL、无 default（SQLModel sa_column 字段实例化不校验，
    NOT NULL 由 DB 层强制——参考 test_lease_kind_column_contract 风格验证列约束）."""
    table = PolicyAuditLog.__table__
    for col_name in ("decision", "provider", "tool", "path", "reason", "runtime_id"):
        col = table.columns[col_name]
        assert col.nullable is False, f"{col_name} must be NOT NULL"
        assert col.server_default is None, (
            f"{col_name} has no server_default (audit values are caller-supplied)"
        )


def test_policy_audit_log_indexes_present() -> None:
    """索引就位：(runtime_id, created_at desc), decision, workspace_id (task-09)."""
    index_names = {idx.name for idx in PolicyAuditLog.__table__.indexes}
    assert "idx_policy_audit_log_runtime_created" in index_names
    assert "idx_policy_audit_log_decision" in index_names
    assert "idx_policy_audit_log_workspace_id" in index_names


def test_policy_audit_log_default_id_and_created_at() -> None:
    """id 自动生成 UUID、created_at 自动填充（与 DaemonRuntime 同风格）."""
    log = PolicyAuditLog(
        runtime_id=__import__("uuid").uuid4(),
        decision="ALLOW",
        provider="claude",
        tool="Write",
        path="/repo/a.txt",
        reason="within allowed_roots",
    )
    assert log.id is not None
    assert isinstance(log.created_at, datetime)


@pytest.mark.asyncio
async def test_policy_audit_log_persist_and_query(db_session) -> None:
    """内存 SQLite 插入 + 按 runtime_id 查询 OK（参考 daemon/tests async fixture 风格）."""
    import uuid

    rid = uuid.uuid4()
    wid = uuid.uuid4()
    log = PolicyAuditLog(
        runtime_id=rid,
        workspace_id=wid,
        decision="DENY",
        provider="codex",
        tool="Bash",
        path="/etc/passwd",
        reason="outside allowed_roots",
    )
    db_session.add(log)
    await db_session.commit()
    await db_session.refresh(log)

    result = await db_session.execute(
        select(PolicyAuditLog).where(PolicyAuditLog.runtime_id == rid)
    )
    fetched = result.scalars().all()
    assert len(fetched) == 1
    row = fetched[0]
    assert row.decision == "DENY"
    assert row.provider == "codex"
    assert row.tool == "Bash"
    assert row.path == "/etc/passwd"
    assert row.workspace_id == wid
    assert isinstance(row.created_at, datetime)
