"""上报协议 v2 machine 块单测（2026-09-30-tool-report-activation-wrong-machine
task-03 / FR-01）。

钉死四组行为：

1. 落列组——entries 带 ``machine`` 块 → ``platform_agent_logs`` 两列
   （reported_machine_id / reported_machine_name）落值；组内最新 entry 身份写
   tool_report 会话 ``config_snapshot.latest_reported_machine``。
2. 兼容组——老 CLI 不带块（键完全不出现）→ 两列 NULL、快照无
   latest_reported_machine 键、200 不报错（extra=ignore 既有行为）。
3. 覆盖组——整行覆盖语义：重推同 log_path 带/不带块，两列随最新上报翻转。
4. 幂等组——同值重推快照稳定（dict 替换不叠加）。

HTTP 侧复用 test_agent_log_push.py 的 shpsync_headers fixture 与 entry 样式。
"""

from __future__ import annotations

import copy
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.platform_sync.model import AgentSessionLogORM

from .test_agent_log_push import CODEX_ENTRY

MACHINE_BLOCK: dict[str, Any] = {
    "machine_id": "0f1e2d3c-4b5a-4c6d-8e9f-a0b1c2d3e4f5",
    "hostname": "DESKTOP-HJ0AM09",
}


def _body(entries: list[dict]) -> dict:
    return {
        "schema_version": 1,
        "pushed_at": "2026-09-30T03:00:00.000Z",
        "agent_cwd": "C:/Users/qinyi/IdeaProjects/multi-agent-platform",
        "entries": entries,
    }


def _entry_with_machine(machine: dict | None, *, last_seen_at: str) -> dict:
    entry = copy.deepcopy(CODEX_ENTRY)
    entry["log_path"] = f"C:/Users/qinyi/.codex/sessions/machine-{last_seen_at}.jsonl"
    entry["agent_cwd"] = "C:/Users/qinyi/IdeaProjects/multi-agent-platform"
    entry["last_seen_at"] = last_seen_at
    # 非空 ctx 聚合（change_key）——聚合键可预期（空 ctx 形态是 "{harness}|" 单桶）。
    entry["change_key"] = "2026-09-30-machine-test"
    if machine is not None:
        entry["machine"] = machine
    return entry


async def _log_rows(db_session: AsyncSession, log_path: str) -> AgentSessionLogORM | None:
    db_session.expire_all()
    return (
        await db_session.execute(
            select(AgentSessionLogORM).where(AgentSessionLogORM.log_path == log_path)
        )
    ).scalar_one_or_none()


class TestMachineBlockIngest:
    @pytest.mark.asyncio
    async def test_machine_block_persisted_and_snapshot_written(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """带 machine 块 → 两列落值 + 组内最新 entry 身份写会话快照。"""
        _ws_id, headers = shpsync_headers
        older = _entry_with_machine(
            {"machine_id": "old-id-000", "hostname": "OLD-HOST"},
            last_seen_at="2026-09-30T02:00:00.000Z",
        )
        newer = _entry_with_machine(MACHINE_BLOCK, last_seen_at="2026-09-30T02:30:00.000Z")
        resp = await client.post("/api/agent-logs", json=_body([older, newer]), headers=headers)
        assert resp.status_code == 200, resp.text

        row = await _log_rows(db_session, newer["log_path"])
        assert row is not None
        assert row.reported_machine_id == MACHINE_BLOCK["machine_id"]
        assert row.reported_machine_name == MACHINE_BLOCK["hostname"]

        # 聚合会话快照：最新 entry（02:30）胜出。
        db_session.expire_all()
        session_row = (
            await db_session.execute(
                select(AgentSession).where(
                    AgentSession.origin == "tool_report",
                    AgentSession.aggregation_key == "2026-09-30-machine-test",
                )
            )
        ).scalar_one_or_none()
        assert session_row is not None, "聚合分支应建 tool_report 会话"
        snap = session_row.config_snapshot or {}
        assert snap.get("latest_reported_machine") == {
            "machine_id": MACHINE_BLOCK["machine_id"],
            "hostname": MACHINE_BLOCK["hostname"],
        }
        # harness 既有键保留（合并非替换）。
        assert snap.get("harness") == "codex"

    @pytest.mark.asyncio
    async def test_no_machine_block_legacy_compatible(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """老 CLI 不带块 → 两列 NULL + 快照无该键 + 200（零破坏）。"""
        _ws_id, headers = shpsync_headers
        entry = _entry_with_machine(None, last_seen_at="2026-09-30T02:10:00.000Z")
        resp = await client.post("/api/agent-logs", json=_body([entry]), headers=headers)
        assert resp.status_code == 200, resp.text

        row = await _log_rows(db_session, entry["log_path"])
        assert row is not None
        assert row.reported_machine_id is None
        assert row.reported_machine_name is None

        db_session.expire_all()
        session_row = (
            await db_session.execute(
                select(AgentSession).where(
                    AgentSession.origin == "tool_report",
                    AgentSession.aggregation_key == "2026-09-30-machine-test",
                )
            )
        ).scalar_one()
        assert "latest_reported_machine" not in (session_row.config_snapshot or {})

    @pytest.mark.asyncio
    async def test_row_overwrite_flips_columns(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """整行覆盖：重推同 log_path 不带块 → 两列回 None（上报为准）。"""
        _ws_id, headers = shpsync_headers
        path = "C:/Users/qinyi/.codex/sessions/machine-overwrite.jsonl"
        with_block = _entry_with_machine(MACHINE_BLOCK, last_seen_at="2026-09-30T02:20:00.000Z")
        with_block["log_path"] = path
        resp = await client.post("/api/agent-logs", json=_body([with_block]), headers=headers)
        assert resp.status_code == 200, resp.text
        row = await _log_rows(db_session, path)
        assert row is not None and row.reported_machine_id == MACHINE_BLOCK["machine_id"]

        without_block = copy.deepcopy(with_block)
        without_block["last_seen_at"] = "2026-09-30T02:25:00.000Z"
        without_block.pop("machine")
        resp = await client.post("/api/agent-logs", json=_body([without_block]), headers=headers)
        assert resp.status_code == 200, resp.text
        row = await _log_rows(db_session, path)
        assert row is not None
        assert row.reported_machine_id is None
        assert row.reported_machine_name is None

    @pytest.mark.asyncio
    async def test_repush_same_machine_snapshot_stable(
        self,
        client: AsyncClient,
        shpsync_headers: tuple[Any, dict[str, str]],
        db_session: AsyncSession,
    ) -> None:
        """同值重推 → 快照稳定（幂等，不叠加嵌套）。"""
        _ws_id, headers = shpsync_headers
        entry = _entry_with_machine(MACHINE_BLOCK, last_seen_at="2026-09-30T02:40:00.000Z")
        for _ in range(2):
            resp = await client.post("/api/agent-logs", json=_body([entry]), headers=headers)
            assert resp.status_code == 200, resp.text
        db_session.expire_all()
        session_row = (
            await db_session.execute(
                select(AgentSession).where(
                    AgentSession.origin == "tool_report",
                    AgentSession.aggregation_key == "2026-09-30-machine-test",
                )
            )
        ).scalar_one()
        snap = session_row.config_snapshot or {}
        assert snap.get("latest_reported_machine") == {
            "machine_id": MACHINE_BLOCK["machine_id"],
            "hostname": MACHINE_BLOCK["hostname"],
        }
