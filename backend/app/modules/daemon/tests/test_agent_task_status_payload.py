"""agent_task_status 扩展载荷透传单测（task-08 / FR-04）。

变更 2026-08-27-background-subagent-progress task-05：``AgentTaskStatusEvent``
（schema.py）增补后台异步子代理生命周期字段（tool_use_id / summary /
last_tool_name / elapsed_ms / total_tokens / tool_uses / async）并把 status
扩为四态（running / completed / failed / stopped）；notify 端点
（daemon/router.py ``notify_agent_task_status``）经 ``publish_session_event``
按 ``by_alias=True`` 整包转发到 ``agent_session:{id}`` 频道。

本文件对齐 ``test_session_plan_bash_events.py`` 的 HTTP harness（client +
auth_headers + mocked Redis publish，helpers 直接复用该文件），覆盖：

- 扩展载荷全字段透传：publish payload 键全量（含 ``async`` 契约名——DTO
  字段 ``async_`` 经 by_alias 发布为 ``async``，design §8 R-06）；
- status 四个取值（含新增终态 ``stopped``）均被端点接受并原样发布；
- 旧载荷兼容：running + task_id/task_name（无任何扩展字段）不报错、
  照常发布（向后兼容，旧 daemon 零升级）。

Redis is mocked (AsyncMock); no live broker. Production code is not modified.
"""

from __future__ import annotations

import uuid
from unittest.mock import patch

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from .test_session_plan_bash_events import (
    _admin_id,
    _create_runtime,
    _create_session_with_run,
    _decode_publishes,
    _mock_redis,
)

# 扩展载荷发布后的全量键集（model_dump(by_alias=True) 输出全部字段——含 None，
# 故旧载荷发布的 payload 也带全部键，只是扩展字段值为 None）。
_EXPECTED_PAYLOAD_KEYS = {
    "event",
    "session_id",
    "run_id",
    "task_id",
    "task_name",
    "status",
    "progress",
    "message",
    "tool_use_id",
    "summary",
    "last_tool_name",
    "elapsed_ms",
    "total_tokens",
    "tool_uses",
    # async_ 字段按 alias 输出为契约名 "async"（by_alias 发布）
    "async",
}


async def _notify(
    client: AsyncClient,
    auth_headers: dict[str, str],
    db_session: AsyncSession,
    payload: dict,
) -> tuple[int, object, list[tuple[str, dict]], uuid.UUID]:
    """建 runtime+会话（admin 本人 = runtime owner）→ POST notify → 返回
    (status_code, body, decoded publishes, session_id)。"""
    user_id = await _admin_id(db_session)
    rt = await _create_runtime(db_session, user_id)
    ag_session, _run = await _create_session_with_run(db_session, user_id, rt.id)
    redis = _mock_redis()

    with patch("app.modules.daemon.run_sync.service.get_redis", return_value=redis):
        resp = await client.post(
            f"/api/daemon/sessions/{ag_session.id}/agent-task-status",
            json={
                "event": "agent_task_status",
                "session_id": str(ag_session.id),
                **payload,
            },
            headers=auth_headers,
        )

    return (
        resp.status_code,
        (resp.json() if resp.content else None),
        _decode_publishes(redis),
        ag_session.id,
    )


class TestAgentTaskStatusExtendedPayload:
    """task-05 / FR-04：notify 端点收扩展载荷 → Redis publish 字段全量含 "async"。"""

    @pytest.mark.asyncio
    async def test_extended_payload_published_full_fields_with_async_alias(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """后台异步子代理终态载荷（stopped + 全部扩展字段 + async 别名）→ 200，
        publish payload 键全量（含 "async" 契约名）、逐字段透传。"""
        run_id = uuid.uuid4()
        status_code, body, publishes, session_id = await _notify(
            client,
            auth_headers,
            db_session,
            {
                "run_id": str(run_id),
                "task_id": "task-bg-01",
                "task_name": "后台扫描子代理",
                "status": "stopped",
                # 后台异步子代理生命周期扩展字段（task-05 / design §8）
                "tool_use_id": "toolu_dispatch_01",
                "summary": "已完成 backend 目录扫描并产出摘要",
                "last_tool_name": "Grep",
                "elapsed_ms": 18_650,
                "total_tokens": 20480,
                "tool_uses": 12,
                # async 是 Python 关键字：daemon 侧按契约名 "async" 发送
                "async": True,
            },
        )

        assert status_code == 200
        assert body == {"ok": True}
        assert len(publishes) == 1
        channel, payload = publishes[0]
        # 频道 + 键全量：by_alias dump 输出全部字段（含 None），async_ → "async"
        assert channel == f"agent_session:{session_id}"
        assert set(payload.keys()) == _EXPECTED_PAYLOAD_KEYS
        # 逐字段透传断言（含别名键的值）
        assert payload["event"] == "agent_task_status"
        assert payload["run_id"] == str(run_id)
        assert payload["task_id"] == "task-bg-01"
        assert payload["task_name"] == "后台扫描子代理"
        assert payload["status"] == "stopped"
        assert payload["tool_use_id"] == "toolu_dispatch_01"
        assert payload["summary"] == "已完成 backend 目录扫描并产出摘要"
        assert payload["last_tool_name"] == "Grep"
        assert payload["elapsed_ms"] == 18_650
        assert payload["total_tokens"] == 20480
        assert payload["tool_uses"] == 12
        # R-06 契约名：payload 里是 "async" 键（不是 "async_"），值透传
        assert payload["async"] is True

    @pytest.mark.asyncio
    async def test_populate_by_name_accepts_field_name_async_(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """``populate_by_name``：入参用字段名 ``async_`` 也能解析（后端代码读
        ``async_``、daemon 发 ``async``，两种名字都可用），发布仍按 alias。"""
        status_code, _body, publishes, _sid = await _notify(
            client,
            auth_headers,
            db_session,
            {
                "run_id": str(uuid.uuid4()),
                "task_id": "task-bg-02",
                "task_name": "后台测试子代理",
                "status": "completed",
                "async_": False,
            },
        )

        assert status_code == 200
        assert len(publishes) == 1
        payload = publishes[0][1]
        assert payload["async"] is False

    @pytest.mark.asyncio
    @pytest.mark.parametrize("status_value", ["running", "completed", "failed", "stopped"])
    async def test_status_values_accepted(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        status_value: str,
    ) -> None:
        """status 四态（含 task-05 新增终态 stopped）均被端点接受并原样发布。"""
        status_code, body, publishes, _sid = await _notify(
            client,
            auth_headers,
            db_session,
            {
                "run_id": str(uuid.uuid4()),
                "task_id": "task-bg-status",
                "task_name": "后台子代理",
                "status": status_value,
            },
        )

        assert status_code == 200, body
        assert len(publishes) == 1
        assert publishes[0][1]["status"] == status_value


class TestAgentTaskStatusLegacyPayloadCompatible:
    """旧 daemon 兼容：running + task_id/task_name（无扩展字段）不报错。"""

    @pytest.mark.asyncio
    async def test_legacy_running_payload_still_published(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """旧载荷（task-02 时代契约：event/session_id/run_id/task_id/task_name/
        status/progress）→ 200 且照常发布；扩展字段缺省 None（含 "async": None）。"""
        run_id = uuid.uuid4()
        status_code, body, publishes, session_id = await _notify(
            client,
            auth_headers,
            db_session,
            {
                "run_id": str(run_id),
                "task_id": "t-1",
                "task_name": "scan",
                "status": "running",
                "progress": 42,
            },
        )

        assert status_code == 200, body
        assert body == {"ok": True}
        assert len(publishes) == 1
        channel, payload = publishes[0]
        assert channel == f"agent_session:{session_id}"
        # 旧字段原样透传（与 test_session_plan_bash_events 的既有断言同口径）
        assert payload["event"] == "agent_task_status"
        assert payload["task_id"] == "t-1"
        assert payload["task_name"] == "scan"
        assert payload["status"] == "running"
        assert payload["progress"] == 42
        # 扩展字段全为缺省 None（模型可选字段），不影响旧消费方（前端按需读取）
        assert payload["tool_use_id"] is None
        assert payload["summary"] is None
        assert payload["last_tool_name"] is None
        assert payload["elapsed_ms"] is None
        assert payload["total_tokens"] is None
        assert payload["tool_uses"] is None
        assert payload["async"] is None
