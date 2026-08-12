"""Tests for ``WebhookDispatcher`` + ``/mcp-webhooks`` CRUD（task-11 / design §7.3 §8.2）。

覆盖 acceptance：
- events 过滤命中（订阅该事件或 "*"）/ 不命中；
- X-Signature HMAC-SHA256 可被接收方校验（hex，body 含 event/workspace_id/.../timestamp）；
- deliver 异步不阻塞（返回即释放，投递在后台 task）；
- 5xx/超时/异常触发指数退避（1s/4s/16s/64s，共最多 5 次），2xx 不重试，耗尽不抛；
- CRUD 三端点经 require_permission(WORKSPACE_WRITE) 越权 403；
- secret 加密存（库内非明文，get_cipher 可还原），POST/GET 响应不回显明文/密文。
"""

from __future__ import annotations

import asyncio
import hashlib
import hmac
import json
import uuid

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.crypto import get_cipher
from app.core.security import create_access_token, password_hasher
from app.modules.auth.model import User
from app.modules.mcp_gateway.model import McpTokenORM, McpWebhookORM
from app.modules.mcp_gateway.service import (
    McpWebhookService,
    WebhookDispatcher,
    _decode_secret,
    _encode_secret,
)
from app.modules.workspace.model import Workspace

# ── helpers ────────────────────────────────────────────────────────────────


async def _allow_public_url(*_args: object, **_kwargs: object) -> None:
    """测试桩：模拟 assert_public_url 放行（公网域名）。

    brownfield 测试债（task-03 constraints）：既有 webhook 用例的
    ``https://hooks.example.com/cb`` 真实 DNS 不可解析 → task-03 新增的
    create() / _deliver_one() assert_public_url 校验会抛 SsrfBlocked 击穿 ~7 用例。
    这里 autouse mock 放行，让既有 CRUD / deliver 用例不触真实 DNS；SSRF 拒绝路径
    留给 task-07 的 test_webhook_ssrf.py 单测。
    """


@pytest.fixture(autouse=True)
def _mock_assert_public_url(monkeypatch: pytest.MonkeyPatch) -> None:
    """autouse：本套件内 mock ``app.modules.mcp_gateway.service.assert_public_url``
    放行所有 URL，避免真实 DNS 拖红既有 CRUD / deliver 用例。"""

    monkeypatch.setattr(
        "app.modules.mcp_gateway.service.assert_public_url",
        _allow_public_url,
    )


async def _make_user(session: AsyncSession, *, admin: bool) -> tuple[User, str]:
    user = User(
        id=uuid.uuid4(),
        email=f"user-{uuid.uuid4().hex[:6]}@example.com",
        password_hash=password_hasher.hash("x"),
        status="active",
        is_platform_admin=admin,
    )
    session.add(user)
    await session.commit()
    await session.refresh(user)
    token, _ = create_access_token(
        user_id=user.id,
        email=user.email,
        is_admin=user.is_platform_admin,
        settings=get_settings(),
    )
    return user, token


async def _make_workspace(session: AsyncSession) -> Workspace:
    ws = Workspace(
        id=uuid.uuid4(),
        name=f"ws-{uuid.uuid4().hex[:6]}",
        slug=f"ws-{uuid.uuid4().hex[:6]}",
        root_path=f"/tmp/ws-{uuid.uuid4().hex[:8]}",
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
    """把单个 db_session 包成零参 context-manager factory（匹配 WebhookDispatcher 构造）。"""

    class _CM:
        async def __aenter__(self) -> AsyncSession:
            return session

        async def __aexit__(self, *exc) -> None:
            return None

    return _CM


# ── secret 加密存取 ─────────────────────────────────────────────────────────


def test_secret_roundtrip_and_not_plaintext() -> None:
    """_encode_secret 产出不含明文；get_cipher 可还原；同明文两次加密结果不同（nonce）。"""
    plain = "whsec_super_secret"
    stored = _encode_secret(plain)
    assert plain not in stored
    assert _decode_secret(stored) == plain
    # 与 get_cipher 直接 decrypt 一致（key_id:hex(ct) 编码正确）
    key_id, _, hex_ct = stored.partition(":")
    assert get_cipher().decrypt(bytes.fromhex(hex_ct), key_id) == plain
    assert _encode_secret(plain) != stored  # 随机 nonce → 密文不重复


# ── WebhookDispatcher ───────────────────────────────────────────────────────


async def _seed_webhook(
    session: AsyncSession,
    workspace_id: uuid.UUID,
    *,
    events: list[str],
    secret: str = "s3cr3t",
    active: bool = True,
) -> McpWebhookORM:
    token = await _make_token(session, workspace_id)
    svc = McpWebhookService(session)
    row = await svc.create(
        token_id=token.id,
        workspace_id=workspace_id,
        url="https://hooks.example.com/cb",
        secret=secret,
        events=events,
    )
    if not active:  # create 恒置 active=True；测试需 inactive 行时创建后翻回
        row.active = False
        session.add(row)
        await session.commit()
        await session.refresh(row)
    return row


@pytest.mark.asyncio
async def test_deliver_event_filtering(db_session: AsyncSession) -> None:
    """events 过滤：'worker.completed' 命中订阅该事件或 '*' 的 webhook，不命中其它。"""
    ws = await _make_workspace(db_session)
    hit_specific = await _seed_webhook(db_session, ws.id, events=["worker.completed"])
    hit_star = await _seed_webhook(db_session, ws.id, events=["*"])
    await _seed_webhook(db_session, ws.id, events=["worker.failed"])  # 不命中
    await _seed_webhook(db_session, ws.id, events=["worker.completed"], active=False)  # inactive

    dispatcher = WebhookDispatcher(_session_factory(db_session))
    matched = await dispatcher._matching_webhooks(workspace_id=ws.id, event="worker.completed")
    ids = {w.id for w in matched}
    assert ids == {hit_specific.id, hit_star.id}


@pytest.mark.asyncio
async def test_deliver_async_non_blocking_and_signature(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """deliver 返回即释放（不 await httpx）；派发的 task 用正确 HMAC 签名 POST。"""
    ws = await _make_workspace(db_session)
    secret = "topsecret"
    wh = await _seed_webhook(db_session, ws.id, events=["worker.completed"], secret=secret)

    captured: dict = {}
    started = asyncio.Event()
    release = asyncio.Event()

    class _FakeResp:
        status_code = 200

    class _FakeClient:
        def __init__(self, **kwargs) -> None:
            captured["client_kwargs"] = kwargs

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, content=None, headers=None):
            started.set()
            await release.wait()  # 模拟慢对端：deliver 不应被此阻塞
            captured["url"] = url
            captured["body"] = content
            captured["headers"] = headers
            return _FakeResp()

    monkeypatch.setattr("app.modules.mcp_gateway.service.httpx.AsyncClient", _FakeClient)

    dispatcher = WebhookDispatcher(_session_factory(db_session))
    payload = {
        "mission_id": str(uuid.uuid4()),
        "worker_id": str(uuid.uuid4()),
        "status": "completed",
        "error_code": None,
    }
    n = await dispatcher.deliver(ws.id, "worker.completed", payload)
    assert n == 1
    # deliver 已返回，但后台 task 还卡在 release（证明非阻塞）
    await asyncio.wait_for(started.wait(), timeout=1)
    assert "url" not in captured  # post 尚未完成

    release.set()
    await asyncio.sleep(0)  # 让后台 task 跑完
    for _ in range(50):
        if "url" in captured:
            break
        await asyncio.sleep(0.01)

    assert captured["url"] == wh.url
    assert captured["client_kwargs"]["trust_env"] is False
    body = captured["body"]
    sig = captured["headers"]["X-Signature"]
    expected = hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()
    assert sig == expected  # 接收方可校验
    parsed = json.loads(body.decode())
    assert parsed["event"] == "worker.completed"
    assert parsed["workspace_id"] == str(ws.id)
    assert parsed["status"] == "completed"
    assert "timestamp" in parsed
    assert secret not in body.decode()  # 明文不入 body


@pytest.mark.asyncio
async def test_deliver_retry_exhaustion_does_not_raise(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """5xx 持续失败 → 退避 1/4/16/64（打桩 sleep）共 5 次后不抛异常。"""
    ws = await _make_workspace(db_session)
    await _seed_webhook(db_session, ws.id, events=["*"])

    sleeps: list[float] = []
    attempts = {"n": 0}

    async def _fake_sleep(s: float) -> None:
        sleeps.append(s)

    class _FakeResp:
        status_code = 500

    class _FakeClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, content=None, headers=None):
            attempts["n"] += 1
            return _FakeResp()

    monkeypatch.setattr("app.modules.mcp_gateway.service.httpx.AsyncClient", _FakeClient)
    monkeypatch.setattr("app.modules.mcp_gateway.service.asyncio.sleep", _fake_sleep)

    dispatcher = WebhookDispatcher(_session_factory(db_session))
    wh = (await dispatcher._matching_webhooks(workspace_id=ws.id, event="worker.failed"))[0]
    # 直接调 _deliver_one（同步等待全部重试），不应抛
    await dispatcher._deliver_one(wh, b"{}", "sig")
    assert attempts["n"] == 5  # 1 首发 + 4 退避重试
    assert sleeps == [1.0, 4.0, 16.0, 64.0]


@pytest.mark.asyncio
async def test_deliver_2xx_no_retry(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    ws = await _make_workspace(db_session)
    await _seed_webhook(db_session, ws.id, events=["*"])
    attempts = {"n": 0}

    class _FakeResp:
        status_code = 204

    class _FakeClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, content=None, headers=None):
            attempts["n"] += 1
            return _FakeResp()

    monkeypatch.setattr("app.modules.mcp_gateway.service.httpx.AsyncClient", _FakeClient)
    dispatcher = WebhookDispatcher(_session_factory(db_session))
    wh = (await dispatcher._matching_webhooks(workspace_id=ws.id, event="e"))[0]
    await dispatcher._deliver_one(wh, b"{}", "sig")
    assert attempts["n"] == 1  # 2xx 不重试


@pytest.mark.asyncio
async def test_deliver_exception_retries_and_does_not_raise(
    db_session: AsyncSession, monkeypatch: pytest.MonkeyPatch
) -> None:
    """出站抛异常（超时/连接错）→ 退避重试，耗尽不抛。"""
    ws = await _make_workspace(db_session)
    await _seed_webhook(db_session, ws.id, events=["*"])
    attempts = {"n": 0}

    async def _fake_sleep(s: float) -> None:
        return None

    class _FakeClient:
        def __init__(self, **kwargs) -> None:
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *exc):
            return None

        async def post(self, url, content=None, headers=None):
            attempts["n"] += 1
            raise TimeoutError("connect timeout")

    monkeypatch.setattr("app.modules.mcp_gateway.service.httpx.AsyncClient", _FakeClient)
    monkeypatch.setattr("app.modules.mcp_gateway.service.asyncio.sleep", _fake_sleep)
    dispatcher = WebhookDispatcher(_session_factory(db_session))
    wh = (await dispatcher._matching_webhooks(workspace_id=ws.id, event="e"))[0]
    await dispatcher._deliver_one(wh, b"{}", "sig")
    assert attempts["n"] == 5


@pytest.mark.asyncio
async def test_deleted_webhook_not_matched(db_session: AsyncSession) -> None:
    """DELETE 后该 webhook 不再被 deliver 命中（acceptance）。"""
    ws = await _make_workspace(db_session)
    wh = await _seed_webhook(db_session, ws.id, events=["*"])
    svc = McpWebhookService(db_session)
    assert await svc.delete(webhook_id=wh.id, workspace_id=ws.id) is True
    dispatcher = WebhookDispatcher(_session_factory(db_session))
    matched = await dispatcher._matching_webhooks(workspace_id=ws.id, event="worker.failed")
    assert matched == []
    # 二次删除 → False（→ router 404）
    assert await svc.delete(webhook_id=wh.id, workspace_id=ws.id) is False


# ── CRUD API ────────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_crud_create_list_delete_and_secret_not_echoed(
    client: AsyncClient, db_session: AsyncSession
) -> None:
    ws = await _make_workspace(db_session)
    token_row = await _make_token(db_session, ws.id)
    _, token = await _make_user(db_session, admin=True)
    h = {"Authorization": f"Bearer {token}"}

    resp = await client.post(
        f"/api/workspaces/{ws.id}/mcp-webhooks",
        headers=h,
        json={
            "token_id": str(token_row.id),
            "url": "https://hooks.example.com/cb",
            "secret": "my-secret",
            "events": ["worker.completed", "*"],
        },
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["url"] == "https://hooks.example.com/cb"
    assert body["events"] == ["worker.completed", "*"]
    assert body["active"] is True
    assert "secret" not in body  # 不明文/密文回显
    wh_id = body["id"]

    # 库内存的是密文（非明文）
    from sqlalchemy import select

    row = (
        await db_session.execute(select(McpWebhookORM).where(McpWebhookORM.id == uuid.UUID(wh_id)))
    ).scalar_one()
    assert "my-secret" not in row.secret
    assert (
        get_cipher().decrypt(
            bytes.fromhex(row.secret.partition(":")[2]), row.secret.partition(":")[0]
        )
        == "my-secret"
    )

    # GET 列表不含 secret
    listing = await client.get(f"/api/workspaces/{ws.id}/mcp-webhooks", headers=h)
    assert listing.status_code == 200
    items = listing.json()["items"]
    assert len(items) == 1
    assert "secret" not in items[0]

    # DELETE → 204，再删 → 404
    deleted = await client.delete(f"/api/workspaces/{ws.id}/mcp-webhooks/{wh_id}", headers=h)
    assert deleted.status_code == 204
    again = await client.delete(f"/api/workspaces/{ws.id}/mcp-webhooks/{wh_id}", headers=h)
    assert again.status_code == 404


@pytest.mark.asyncio
async def test_crud_forbidden_for_non_writer(client: AsyncClient, db_session: AsyncSession) -> None:
    """三端点越权（非 writer）→ 403。"""
    ws = await _make_workspace(db_session)
    token_row = await _make_token(db_session, ws.id)
    _, token = await _make_user(db_session, admin=False)
    h = {"Authorization": f"Bearer {token}"}

    post = await client.post(
        f"/api/workspaces/{ws.id}/mcp-webhooks",
        headers=h,
        json={
            "token_id": str(token_row.id),
            "url": "https://x",
            "secret": "s",
            "events": ["*"],
        },
    )
    assert post.status_code == 403
    get = await client.get(f"/api/workspaces/{ws.id}/mcp-webhooks", headers=h)
    assert get.status_code == 403
    delete = await client.delete(f"/api/workspaces/{ws.id}/mcp-webhooks/{uuid.uuid4()}", headers=h)
    assert delete.status_code == 403
