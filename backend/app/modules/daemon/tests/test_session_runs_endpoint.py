"""task-07 单测：GET /sessions/{id}/runs 暴露 error_detail + SSE 推 run_error 事件。

钉死两条 FR-02 透传链路（design §7.4 / §7.5 error_event_push）：
- ``GET /api/daemon/sessions/{id}/runs``：返回该 session 的 run 列表，每项含
  ``error_detail``（失败 run 透传 ModelError 序列化值；成功/无错误 run 为 null）。
- SSE ``/api/daemon/sessions/{id}/stream``：当 ``turn_completed`` 报告 failed run 且
  该 run 有 ``error_detail`` 时，在既有成功事件流之外**追加**一个 ``run_error`` 数据帧
  （含 run_id + error{type,code,message,...}），不改既有 turn_completed 帧。

归属/存在性沿用其它 session 端点的 404 资源隐藏语义（task-06）。
参照 test_session_sse.py 的 client + auth_headers + db_session 范式。
"""

from __future__ import annotations

import json
import uuid
from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy import select

from app.modules.agent.model import AgentRun, AgentSession

# ── Helpers ──────────────────────────────────────────────────────────────────


async def _admin_id(db_session) -> uuid.UUID:
    from app.modules.auth.model import User

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin.id


def _ModelError() -> dict:
    """构造一个落库形态的 error_detail（= ModelErrorDTO.model_dump(mode='json')）。"""
    return {
        "type": "auth_failed",
        "code": "401",
        "message": "API 凭证无效或已失效",
        "retryable": False,
        "hint": "请检查并更新该供应商的 API Key",
        "raw": "API Error: 401 invalid api key",
    }


async def _seed_session_with_runs(
    db_session,
    *,
    owner_id: uuid.UUID,
) -> tuple[uuid.UUID, AgentRun, AgentRun]:
    """建一个 owner 的 session + 失败 run(带 error_detail) + 完成 run(无 error_detail)。"""
    sid = uuid.uuid4()
    db_session.add(
        AgentSession(
            id=sid,
            user_id=owner_id,
            provider="claude",
            status="active",
        )
    )
    failed_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status="failed",
        agent_session_id=sid,
        error_detail=_ModelError(),
        started_at=datetime.now(UTC),
        error_code="interactive_interrupted",  # D-009：与 error_detail 正交共存
    )
    completed_run = AgentRun(
        id=uuid.uuid4(),
        agent_type="claude_code",
        status="completed",
        agent_session_id=sid,
        error_detail=None,
        started_at=datetime.now(UTC),
    )
    db_session.add_all([failed_run, completed_run])
    await db_session.commit()
    await db_session.refresh(failed_run)
    await db_session.refresh(completed_run)
    return sid, failed_run, completed_run


# ── GET /sessions/{id}/runs (AC: 返回 error_detail) ───────────────────────────


class TestListSessionRuns:
    @pytest.mark.asyncio
    async def test_returns_runs_with_error_detail(self, client, auth_headers, db_session) -> None:
        """失败 run 的 error_detail 完整透传；完成 run 的 error_detail 为 null。"""
        admin = await _admin_id(db_session)
        sid, failed_run, completed_run = await _seed_session_with_runs(db_session, owner_id=admin)

        resp = await client.get(f"/api/daemon/sessions/{sid}/runs", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = resp.json()
        assert isinstance(items, list)
        assert len(items) == 2

        by_status = {it["status"]: it for it in items}
        # 失败 run：error_detail 完整透传
        failed_item = by_status["failed"]
        assert failed_item["id"] == str(failed_run.id)
        assert failed_item["error_detail"] == _ModelError()
        # error_code 与 error_detail 正交共存（D-009，前端可用作调度层错误兜底）
        assert failed_item["error_code"] == "interactive_interrupted"
        # 完成 run：error_detail 为 null
        completed_item = by_status["completed"]
        assert completed_item["id"] == str(completed_run.id)
        assert completed_item["error_detail"] is None

    @pytest.mark.asyncio
    async def test_returns_config_snapshot_and_usage_fields(
        self, client, auth_headers, db_session
    ) -> None:
        """gap-fix（FR-07 whoLine / FR-08 历史 usage）：run 项透传轮次配置快照
        （agent_profile_snapshot / llm_provider_id）与 usage（input/output_tokens），
        均 nullable——未配置 / 老 run 行为 null（前端如实显示不编造）。"""
        from app.core.crypto import get_cipher
        from app.modules.llm_provider.model import LlmProvider

        admin = await _admin_id(db_session)
        sid = uuid.uuid4()
        db_session.add(AgentSession(id=sid, user_id=admin, provider="claude", status="active"))
        cipher = get_cipher()
        ct, key_id = cipher.encrypt("sk-test-key")
        provider = LlmProvider(
            id=uuid.uuid4(),
            user_id=admin,
            name="GLM",
            agent_kind="claude",
            encrypted_api_key=ct,
            key_id=key_id,
            model="glm-4.7",
            is_default=False,
            api_format="anthropic",
        )
        snapshot: dict = {
            "id": str(uuid.uuid4()),
            "name": "知识经理",
            "provider": "claude",
            "model": None,
            "system_prompt": "你是知识经理。",
            "mcp_refs": [],
            "skill_refs": [],
            "allowed_roots_overlay": None,
            "version": 1,
        }
        configured = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="completed",
            agent_session_id=sid,
            started_at=datetime.now(UTC),
            agent_profile_snapshot=snapshot,
            llm_provider_id=provider.id,
            input_tokens=1234,
            output_tokens=567,
        )
        plain = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="completed",
            agent_session_id=sid,
            started_at=datetime.now(UTC),
        )
        db_session.add_all([provider, configured, plain])
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/runs", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        items = {it["id"]: it for it in resp.json()}
        assert len(items) == 2

        # 配置轮：快照 + 供应商 id + usage 完整透传
        cfg = items[str(configured.id)]
        assert cfg["agent_profile_snapshot"] == snapshot
        assert cfg["llm_provider_id"] == str(provider.id)
        assert cfg["input_tokens"] == 1234
        assert cfg["output_tokens"] == 567
        # 未配置轮（老 run 行）：新字段全 null
        plain_item = items[str(plain.id)]
        assert plain_item["agent_profile_snapshot"] is None
        assert plain_item["llm_provider_id"] is None
        assert plain_item["input_tokens"] is None
        assert plain_item["output_tokens"] is None

    @pytest.mark.asyncio
    async def test_empty_session_returns_empty_list(self, client, auth_headers, db_session) -> None:
        """有 session 但无 run → 200 空列表（不报错）。"""
        admin = await _admin_id(db_session)
        sid = uuid.uuid4()
        db_session.add(
            AgentSession(
                id=sid,
                user_id=admin,
                provider="claude",
                status="active",
            )
        )
        await db_session.commit()

        resp = await client.get(f"/api/daemon/sessions/{sid}/runs", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == []

    @pytest.mark.asyncio
    async def test_404_missing_or_cross_user_session(
        self, client, auth_headers, db_session
    ) -> None:
        """不存在的 session → 404（资源隐藏，不泄露存在性）。"""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/runs", headers=auth_headers)
        assert resp.status_code == 404

    @pytest.mark.asyncio
    async def test_401_unauthenticated(self, client) -> None:
        """无认证 → 401。"""
        resp = await client.get(f"/api/daemon/sessions/{uuid.uuid4()}/runs")
        assert resp.status_code == 401


# ── SSE run_error 事件 (AC: 失败 turn_completed 后追加 run_error 帧) ──────────


class TestStreamRunErrorEvent:
    @pytest.mark.asyncio
    async def test_failed_turn_emits_run_error_after_turn_completed(
        self, client, auth_headers, db_session
    ) -> None:
        """turn_completed(status=failed) 且 run 有 error_detail → 在 turn_completed 帧
        之后追加 run_error 帧（含 run_id + error{type,...}），turn_completed 帧本身不变。"""
        admin = await _admin_id(db_session)
        sid, failed_run, _completed = await _seed_session_with_runs(db_session, owner_id=admin)

        turn_completed_raw = json.dumps(
            {
                "event": "turn_completed",
                "session_id": str(sid),
                "run_id": str(failed_run.id),
                "status": "failed",
                "exit_code": 1,
                "input_tokens": 10,
                "output_tokens": 5,
                "timestamp": "2026-07-29T10:00:00Z",
            }
        )
        ended_raw = json.dumps(
            {
                "event": "session_ended",
                "session_id": str(sid),
                "run_id": None,
                "status": "ended",
                "reason": "manual",
            }
        )

        pubsub = MagicMock()
        pubsub.subscribe = AsyncMock()
        pubsub.unsubscribe = AsyncMock()
        pubsub.aclose = AsyncMock()
        delivered = {"turn": False, "ended": False}

        async def fake_get_message(timeout=None):
            if not delivered["turn"]:
                delivered["turn"] = True
                return {"type": "message", "data": turn_completed_raw}
            if not delivered["ended"]:
                delivered["ended"] = True
                return {"type": "message", "data": ended_raw}
            return None

        pubsub.get_message = fake_get_message
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = pubsub

        with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(f"/api/daemon/sessions/{sid}/stream", headers=auth_headers)
        body = resp.text
        assert resp.status_code == 200, body

        # 1) 既有 turn_completed 帧原样透传（不改成功/失败事件流）
        assert f"data: {turn_completed_raw}\n\n" in body

        # 2) 紧随其后追加 run_error 帧，载荷含 run_id + error
        assert "run_error" in body
        # 抽出 run_error 帧的 JSON 载荷核对
        run_error_line = next(
            ln for ln in body.split("\n") if ln.startswith("data: ") and "run_error" in ln
        )
        payload = json.loads(run_error_line[len("data: ") :])
        assert payload["event"] == "run_error"
        assert payload["run_id"] == str(failed_run.id)
        assert payload["session_id"] == str(sid)
        assert payload["error"] == _ModelError()

        # 3) turn_completed 帧出现在 run_error 帧之前（顺序：先透传，后追加）
        assert body.index(f"data: {turn_completed_raw}\n\n") < body.index(run_error_line)

    @pytest.mark.asyncio
    async def test_completed_turn_does_not_emit_run_error(
        self, client, auth_headers, db_session
    ) -> None:
        """turn_completed(status=completed) → 不追加 run_error（不改成功事件流）。"""
        admin = await _admin_id(db_session)
        sid, _failed, completed_run = await _seed_session_with_runs(db_session, owner_id=admin)

        turn_completed_raw = json.dumps(
            {
                "event": "turn_completed",
                "session_id": str(sid),
                "run_id": str(completed_run.id),
                "status": "completed",
                "exit_code": 0,
                "input_tokens": 10,
                "output_tokens": 5,
                "timestamp": "2026-07-29T10:00:00Z",
            }
        )
        ended_raw = json.dumps(
            {
                "event": "session_ended",
                "session_id": str(sid),
                "run_id": None,
                "status": "ended",
                "reason": "manual",
            }
        )

        pubsub = MagicMock()
        pubsub.subscribe = AsyncMock()
        pubsub.unsubscribe = AsyncMock()
        pubsub.aclose = AsyncMock()
        delivered = {"turn": False, "ended": False}

        async def fake_get_message(timeout=None):
            if not delivered["turn"]:
                delivered["turn"] = True
                return {"type": "message", "data": turn_completed_raw}
            if not delivered["ended"]:
                delivered["ended"] = True
                return {"type": "message", "data": ended_raw}
            return None

        pubsub.get_message = fake_get_message
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = pubsub

        with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(f"/api/daemon/sessions/{sid}/stream", headers=auth_headers)
        body = resp.text
        assert resp.status_code == 200, body
        assert f"data: {turn_completed_raw}\n\n" in body
        # 成功 turn 不产生 run_error 帧
        assert "run_error" not in body

    @pytest.mark.asyncio
    async def test_failed_turn_without_error_detail_does_not_emit_run_error(
        self, client, auth_headers, db_session
    ) -> None:
        """历史 failed run 无 error_detail（brownfield）→ turn_completed 透传但不追加
        run_error（无 ModelError 可推，前端按 status 兜底，design §9）。"""
        admin = await _admin_id(db_session)
        sid = uuid.uuid4()
        db_session.add(AgentSession(id=sid, user_id=admin, provider="claude", status="active"))
        # 历史 failed run，无 error_detail
        legacy_run = AgentRun(
            id=uuid.uuid4(),
            agent_type="claude_code",
            status="failed",
            agent_session_id=sid,
            error_detail=None,
            started_at=datetime.now(UTC),
        )
        db_session.add(legacy_run)
        await db_session.commit()
        await db_session.refresh(legacy_run)

        turn_completed_raw = json.dumps(
            {
                "event": "turn_completed",
                "session_id": str(sid),
                "run_id": str(legacy_run.id),
                "status": "failed",
                "exit_code": 1,
                "timestamp": "2026-07-29T10:00:00Z",
            }
        )
        ended_raw = json.dumps(
            {
                "event": "session_ended",
                "session_id": str(sid),
                "run_id": None,
                "status": "ended",
                "reason": "manual",
            }
        )

        pubsub = MagicMock()
        pubsub.subscribe = AsyncMock()
        pubsub.unsubscribe = AsyncMock()
        pubsub.aclose = AsyncMock()
        delivered = {"turn": False, "ended": False}

        async def fake_get_message(timeout=None):
            if not delivered["turn"]:
                delivered["turn"] = True
                return {"type": "message", "data": turn_completed_raw}
            if not delivered["ended"]:
                delivered["ended"] = True
                return {"type": "message", "data": ended_raw}
            return None

        pubsub.get_message = fake_get_message
        mock_redis = MagicMock()
        mock_redis.pubsub.return_value = pubsub

        with patch("app.modules.agent.service.get_redis", return_value=mock_redis):
            resp = await client.get(f"/api/daemon/sessions/{sid}/stream", headers=auth_headers)
        body = resp.text
        assert resp.status_code == 200, body
        assert f"data: {turn_completed_raw}\n\n" in body
        # 无 error_detail → 不追加 run_error
        assert "run_error" not in body
