"""mcp webhook SSRF 双查（design §5 B2 / R-06）。

覆盖：
- create() 注册前校验：私网 / 云元数据 / loopback / IPv6 私网 url → SsrfBlocked(400)；
- create() 坏 scheme → UnsafeRepoUrl(400)；
- create() 公网域名放行（conftest _hermetic_dns 把域名解析成公网 IP）；
- _deliver_one 投递前逐跳复查：私网 url → 不触 httpx、不重试、best-effort return（R-06）；
- _deliver_one 公网 url → 正常 POST（投递语义不被破坏）。
"""

from __future__ import annotations

import hashlib
import uuid

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.ssrf import UnsafeRepoUrl
from app.modules.mcp_gateway.model import McpTokenORM, McpWebhookORM
from app.modules.mcp_gateway.service import McpWebhookService, WebhookDispatcher
from app.modules.tool_gateway.tool_policy import SsrfBlocked
from app.modules.workspace.model import Workspace

# ── helpers（与 test_webhook.py 同构）──────────────────────────────────────


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ssrf-ws-{uuid.uuid4().hex[:6]}",
        slug=f"ssrf-ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ssrf-{uuid.uuid4().hex[:8]}",
        status="active",
    )
    session.add(ws)
    await session.commit()
    await session.refresh(ws)
    return ws


async def _make_token(session: AsyncSession, workspace_id: uuid.UUID) -> McpTokenORM:
    row = McpTokenORM(
        id=uuid.uuid4(),
        workspace_id=workspace_id,
        name="t",
        token_hash=hashlib.sha256(uuid.uuid4().bytes).hexdigest(),
        scope=["read"],
        created_by=None,
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


def _session_factory(session: AsyncSession):
    class _CM:
        async def __aenter__(self) -> AsyncSession:
            return session

        async def __aexit__(self, *exc) -> None:
            return None

    return _CM()


# ── create() SSRF ──────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "url",
    [
        "http://127.0.0.1/cb",
        "http://169.254.169.254/latest/",
        "http://10.0.0.5/cb",
        "http://[::1]/cb",
    ],
)
async def test_create_rejects_private_url(db_session: AsyncSession, url: str):
    svc = McpWebhookService(db_session)
    with pytest.raises(SsrfBlocked):
        await svc.create(
            token_id=uuid.uuid4(),  # SSRF 校验先于 ORM 写入，FK 无关
            workspace_id=uuid.uuid4(),
            url=url,
            secret="s",
            events=["x"],
        )


async def test_create_rejects_bad_scheme(db_session: AsyncSession):
    svc = McpWebhookService(db_session)
    with pytest.raises(UnsafeRepoUrl):
        await svc.create(
            token_id=uuid.uuid4(),
            workspace_id=uuid.uuid4(),
            url="ftp://hooks.example.com/cb",
            secret="s",
            events=["x"],
        )


async def test_create_allows_public_domain(db_session: AsyncSession):
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, ws.id)
    svc = McpWebhookService(db_session)
    row = await svc.create(
        token_id=token.id,
        workspace_id=ws.id,
        url="https://hooks.example.com/cb",
        secret="s",
        events=["worker.completed"],
    )
    assert row.url == "https://hooks.example.com/cb"
    assert row.active is True


# ── _deliver_one SSRF（投递前逐跳复查）────────────────────────────────────


def _patch_httpx_post_recorder(monkeypatch: pytest.MonkeyPatch) -> list[str]:
    """记录 _deliver_one 实际发起的 POST url；私网 url 应为空列表。"""
    posts: list[str] = []

    class _FakeClient:
        def __call__(self, *args, **kwargs):
            return self

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, **kwargs):
            posts.append(str(url))

            class _Resp:
                status_code = 200

            return _Resp()

    monkeypatch.setattr("app.modules.mcp_gateway.service.httpx.AsyncClient", _FakeClient())
    return posts


async def test_deliver_one_skips_private_url_without_post(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, ws.id)
    # 直接构造一条 url 指向私网的 webhook（绕过 create 校验，模拟注册后 DNS 重绑定）。
    wh = McpWebhookORM(
        id=uuid.uuid4(),
        token_id=token.id,
        workspace_id=ws.id,
        url="http://127.0.0.1/secret",
        secret="enc",
        events=["worker.completed"],
        active=True,
    )
    db_session.add(wh)
    await db_session.commit()
    await db_session.refresh(wh)

    posts = _patch_httpx_post_recorder(monkeypatch)
    dispatcher = WebhookDispatcher(_session_factory(db_session))
    await dispatcher._deliver_one(wh, b"{}", "sig")  # 不抛（best-effort）
    assert posts == [], "私网 url 投递前应被 SSRF 拦下，不应发起 POST"


async def test_deliver_one_posts_public_url(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
):
    ws = await _make_workspace(db_session)
    token = await _make_token(db_session, ws.id)
    svc = McpWebhookService(db_session)
    wh = await svc.create(
        token_id=token.id,
        workspace_id=ws.id,
        url="https://hooks.example.com/cb",
        secret="s",
        events=["worker.completed"],
    )
    posts = _patch_httpx_post_recorder(monkeypatch)
    dispatcher = WebhookDispatcher(_session_factory(db_session))
    await dispatcher._deliver_one(wh, b"{}", "sig")
    assert posts == ["https://hooks.example.com/cb"]
