"""task-01（change 2026-08-23-sessions-workspace-hub）``GET /sessions`` owner_name 与 limit 上限单测.

覆盖 FR-05 / D-108@v2 / D-103@v1：

- owner_name：router 层批量查 ``users`` 注入，display_name 展示名优先、回退
  ``users.username`` 登录名（ql-20260823-003：用户反馈树里应显示名称不是登录名；
  照 OwnerRead /
  terminating_at 的 IN 批查先例）——本人会话 = 本人用户名；属主用户行存在
  但 username 未回填的旧数据（username-login 迁移前旧账号）→ null
  （brownfield 不崩、不阻断列表）。
- limit 上限：le=100 → le=500（portal 一次拉取，D-103），limit=500 通过、
  limit=501 → 422 边界。
- OpenAPI schema 反映 owner_name 新字段（acceptance，供 task-02 gen:types）。

夹具范式镜像 ``test_sessions_list_filters.py``（in-memory SQLite + httpx client）。
"""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

from httpx import AsyncClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.agent.model import AgentSession
from app.modules.auth.model import User

# ── Helpers（范式照抄 test_sessions_list_filters.py）────────────────────────


async def _get_admin(db_session: AsyncSession) -> User:
    admin = (
        (await db_session.execute(select(User).where(User.email == "admin@example.com")))
        .scalars()
        .first()
    )
    assert admin is not None
    return admin


async def _make_session(
    session: AsyncSession,
    user_id: uuid.UUID,
    runtime_id: uuid.UUID | None,
) -> AgentSession:
    now = datetime.now(UTC)
    sess = AgentSession(
        id=uuid.uuid4(),
        user_id=user_id,
        runtime_id=runtime_id,
        lease_id=None,
        provider="claude",
        status="ended",
        agent_session_id=None,
        turn_count=1,
        created_at=now,
        last_active_at=now,
        ended_at=now,
    )
    session.add(sess)
    await session.commit()
    return sess


# ── owner_name（FR-05 / D-108@v2）───────────────────────────────────────────


class TestOwnerName:
    async def test_owner_name_prefers_display_name(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """ql-20260823-003：display_name 展示名优先——树里显示名称不是登录名。"""
        admin = await _get_admin(db_session)
        admin.username = "qinyi_admin"
        admin.display_name = "秦毅"
        await db_session.commit()
        s = await _make_session(db_session, admin.id, None)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        item = body["items"][0]
        assert item["id"] == str(s.id)
        assert item["owner_name"] == "秦毅"

    async def test_owner_name_falls_back_to_username(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """display_name 未填 → 回退 username 登录名。"""
        admin = await _get_admin(db_session)
        admin.username = "qinyi_admin"
        admin.display_name = None
        await db_session.commit()
        await _make_session(db_session, admin.id, None)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["items"][0]["owner_name"] == "qinyi_admin"

    async def test_legacy_owner_without_username_returns_null(
        self,
        client: AsyncClient,
        auth_headers: dict[str, str],
        db_session: AsyncSession,
    ) -> None:
        """无主旧数据：属主用户行存在但 display_name/username 均未回填
        （旧账号）→ owner_name=null，列表不崩不丢行。"""
        admin = await _get_admin(db_session)
        # 根 conftest 的 admin fixture 不写 username（None）；display_name 需
        # 显式清空——两字段皆空才是该 brownfield。
        assert admin.username is None
        admin.display_name = None
        await db_session.commit()
        s = await _make_session(db_session, admin.id, None)

        resp = await client.get("/api/daemon/sessions", headers=auth_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["total"] == 1
        assert body["items"][0]["id"] == str(s.id)
        assert body["items"][0]["owner_name"] is None


# ── limit 上限边界（D-103@v1）───────────────────────────────────────────────


class TestLimitBoundary:
    async def test_limit_500_ok(self, client: AsyncClient, auth_headers: dict[str, str]) -> None:
        resp = await client.get("/api/daemon/sessions", params={"limit": 500}, headers=auth_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json()["limit"] == 500

    async def test_limit_501_rejected_422(
        self, client: AsyncClient, auth_headers: dict[str, str]
    ) -> None:
        resp = await client.get("/api/daemon/sessions", params={"limit": 501}, headers=auth_headers)
        assert resp.status_code == 422


# ── OpenAPI 反映新字段（acceptance：供 task-02 gen:types）───────────────────


class TestOpenApiSchema:
    async def test_openapi_exposes_owner_name(self) -> None:
        """非 dev 环境 openapi.json 端点关闭（main.py BS-5），直接经 app.openapi()
        断言 schema——与 pnpm gen:types 消费的 OpenAPI 产物同源。"""
        from app.main import app

        props = app.openapi()["components"]["schemas"]["AgentSessionRead"]["properties"]
        assert "owner_name" in props
