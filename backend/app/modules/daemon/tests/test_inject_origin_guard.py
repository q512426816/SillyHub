"""inject 端点结构化 origin 门控（2026-10-11-queue-wakeup-origin-guard / FR-03/04/06）。

24h 审查 P2 修复的 HTTP 层覆盖：排队满员豁免从「prompt 内容前缀」改「排队行
结构化 origin='task_wakeup'」，标记仅服务凭证（X-API-Key，api_key:admin 门控
签发给 daemon）可经请求体 ``origin`` 字段携带——

- Bearer（浏览器 JWT）携带 ``origin="task_wakeup"`` → 403（仅服务凭证可标记）；
- ``origin`` 非法字面量 → 422（DTO Literal 校验，不进 service）；
- X-API-Key + ``origin="task_wakeup"`` → 忙轮排队行落 origin='task_wakeup'
  （豁免/合并/编辑守卫的判定锚）。

service 层豁免/合并/编辑三态见 test_session_queue.py / test_session_queue_actions.py。

HTTP harness 对齐 test_inject_empty_prompt.py（client + auth_headers（Bearer
admin）+ fresh_ws_hub + mock WS 在线 runtime）。
"""

from __future__ import annotations

import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSessionQueuedMessage
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User
from app.modules.daemon.ws_hub import DaemonWsHub

from .test_inject_empty_prompt import _seed_active_session_http


@pytest.fixture()
def fresh_ws_hub(monkeypatch: pytest.MonkeyPatch) -> DaemonWsHub:
    """Replace the process-wide ws_hub singleton with a fresh, wired hub."""
    from app.modules.daemon import ws_hub as ws_hub_module

    hub = DaemonWsHub()
    monkeypatch.setattr(ws_hub_module, "_ws_hub", hub)
    return hub


async def _issue_admin_api_key(
    db_session: AsyncSession, client: AsyncClient, auth_headers: dict[str, str]
) -> str:
    """给 conftest admin（auth_headers 代表的用户）真签发一把 API key。

    服务凭证与浏览器用户同一 User——恰好验证门控只看认证方式（X-API-Key vs
    Bearer），不看用户身份。
    """
    from app.core.config import get_settings

    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    _, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
        user_id=admin.id, name=f"origin-guard-{uuid.uuid4().hex[:8]}", expires_at=None
    )
    return plaintext


async def _queue_rows(
    db_session: AsyncSession, session_id: uuid.UUID
) -> list[AgentSessionQueuedMessage]:
    return list(
        (
            await db_session.execute(
                select(AgentSessionQueuedMessage).where(
                    AgentSessionQueuedMessage.agent_session_id == session_id
                )
            )
        )
        .scalars()
        .all()
    )


class TestInjectOriginGuard:
    """FR-03/04：origin 标记的凭证门控与 DTO Literal 校验。"""

    @pytest.mark.asyncio
    async def test_bearer_with_origin_field_403(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Bearer 携带 origin='task_wakeup' → 403，无排队副作用。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": "[后台任务通知] 冒充", "origin": "task_wakeup"},
            headers=auth_headers,
        )

        assert resp.status_code == 403, resp.text
        assert "仅限服务凭证" in resp.json()["message"]
        # 门控先于 service：无排队行副作用。
        assert await _queue_rows(db_session, sid) == []

    @pytest.mark.asyncio
    async def test_bearer_and_api_key_both_headers_still_403(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """Bearer + X-API-Key 同场：按 get_current_principal 优先级视作 Bearer
        用户（Authorization 赢），origin 门控照旧 403——不能靠叠加 header 冒充。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])
        key = await _issue_admin_api_key(db_session, client, auth_headers)

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": "[后台任务通知] 冒充", "origin": "task_wakeup"},
            headers={**auth_headers, "X-API-Key": key},
        )

        assert resp.status_code == 403, resp.text
        assert await _queue_rows(db_session, sid) == []

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "bad_origin", ["admin", "", "auto_resume:x"], ids=["word", "empty", "other_literal"]
    )
    async def test_origin_literal_validation_422(
        self,
        bad_origin: str,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """origin 非法字面量 → 422（DTO Literal 校验，不进 service）。"""
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": "hi", "origin": bad_origin},
            headers=auth_headers,
        )

        assert resp.status_code == 422, resp.text
        assert await _queue_rows(db_session, sid) == []

    @pytest.mark.asyncio
    async def test_api_key_origin_inject_marks_queue_row(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """X-API-Key + origin='task_wakeup' → 忙轮排队行落 origin='task_wakeup'。

        FR-06 主链路：daemon 唤醒通知经服务凭证携带标记，豁免/合并锚到位。
        """
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])
        key = await _issue_admin_api_key(db_session, client, auth_headers)

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={
                "prompt": "[后台任务通知] 以下 1 个后台子代理任务已全部结束：\n- 任务「查依赖」已完成",
                "origin": "task_wakeup",
            },
            headers={"X-API-Key": key},
        )

        assert resp.status_code == 201, resp.text
        body = resp.json()
        assert body.get("queued") is True
        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin == "task_wakeup"

    @pytest.mark.asyncio
    async def test_api_key_without_origin_is_plain_user_message(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
        fresh_ws_hub: DaemonWsHub,
    ) -> None:
        """服务凭证但不带 origin 字段（旧 daemon 形态）→ 普通行（origin NULL）。

        标记只来自显式请求字段，绝不从 prompt 内容回推。
        """
        created = await _seed_active_session_http(db_session, client, auth_headers, fresh_ws_hub)
        sid = uuid.UUID(created["session_id"])
        key = await _issue_admin_api_key(db_session, client, auth_headers)

        resp = await client.post(
            f"/api/daemon/sessions/{sid}/inject",
            json={"prompt": "[后台任务通知] 前缀但无标记"},
            headers={"X-API-Key": key},
        )

        assert resp.status_code == 201, resp.text
        rows = await _queue_rows(db_session, sid)
        assert len(rows) == 1
        assert rows[0].origin is None
