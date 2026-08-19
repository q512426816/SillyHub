"""task-01 smoke：quicklog_entries 表建表 + 复合唯一约束 + upsert 幂等基础。

真实约束由 task-02 端点测试覆盖；此处验证 ORM/migration 契约落地（D-003/D-004）。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from sqlalchemy import inspect, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.platform_sync.model import QuicklogEntryORM


@pytest.mark.asyncio
async def test_quicklog_entries_table_created(db_engine: Any) -> None:
    def _inspect(sync_conn) -> tuple[list[str], list[str]]:
        insp = inspect(sync_conn)
        return (
            [c["name"] for c in insp.get_columns("quicklog_entries")],
            [uc["name"] for uc in insp.get_unique_constraints("quicklog_entries")],
        )

    async with db_engine.connect() as conn:
        cols, uq = await conn.run_sync(_inspect)
    assert "id" in cols
    assert "workspace_id" in cols
    assert "ql_id" in cols
    assert "payload" in cols
    assert "created_at" in cols
    assert "updated_at" in cols
    assert "uq_quicklog_entries_workspace_ql" in uq


@pytest.mark.asyncio
async def test_upsert_idempotent_same_ql(db_session: AsyncSession) -> None:
    """同 (workspace_id, ql_id) 二次写入整条覆盖（D-004 幂等 upsert 契约）。"""
    ws = uuid.uuid4()
    entry = QuicklogEntryORM(
        workspace_id=ws,
        ql_id="ql-20260817-001-abc",
        payload={"ql_id": "ql-20260817-001-abc", "title": "v1"},
    )
    db_session.add(entry)
    await db_session.commit()

    # 更新 payload（upsert 覆盖语义由 task-02 端点实现；此处验证同 key 行可更新）
    entry.payload = {"ql_id": "ql-20260817-001-abc", "title": "v2"}
    await db_session.commit()

    rows = (await db_session.execute(select(QuicklogEntryORM))).scalars().all()
    assert len(rows) == 1
    assert rows[0].payload is not None  # mypy 收窄（payload 为 dict|None 列）
    assert rows[0].payload["title"] == "v2"
