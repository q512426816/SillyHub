"""登录限流 + 点按式人机确认 契约测试(安全止血:登录爆破防护)。

覆盖:
- 同 IP 60s 窗口超 5 次 → 429
- 连续失败达阈值(3)→ 423 need_captcha
- 完整流程:失败触发 → confirm 取 captcha_id → verify 拿 token → login 带 token 成功
- captcha_id 一次性(重复 verify 失败)
- captcha_token 一次性消费
- Redis 故障降级放行(不阻断登录)
"""

from __future__ import annotations

import pytest
from httpx import AsyncClient

from app.core.config import get_settings
from app.core.security import password_hasher
from app.modules.auth.model import User


class _FakeRedis:
    """In-memory async Redis stand-in:支持 GET/SET(ex)/DELETE/INCR/EXPIRE。不模拟 TTL 过期。"""

    def __init__(self) -> None:
        self.store: dict[str, str] = {}

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def set(self, key: str, value: str, ex: int | None = None) -> None:
        self.store[key] = str(value)

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)

    async def incr(self, key: str) -> int:
        v = int(self.store.get(key, "0")) + 1
        self.store[key] = str(v)
        return v

    async def expire(self, key: str, seconds: int) -> bool:
        return True


@pytest.fixture
async def bob(db_session):
    settings = get_settings()
    password_hasher.configure(settings.auth_bcrypt_rounds)
    user = User(
        email="bob@example.com",
        username="bob",
        password_hash=password_hasher.hash("Xx1!abcd"),
        status="active",
        login_enabled=True,
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


@pytest.fixture
def fake_redis(monkeypatch: pytest.MonkeyPatch) -> _FakeRedis:
    fake = _FakeRedis()
    monkeypatch.setattr("app.modules.auth.captcha_service.get_redis", lambda: fake)
    return fake


@pytest.mark.asyncio
async def test_rate_limit_blocks_sixth_attempt(client: AsyncClient, bob, fake_redis) -> None:
    """同 IP 成功登录 5 次后第 6 次 → 429(用成功登录避免与失败计数纠缠)。"""
    for _ in range(5):
        resp = await client.post("/api/auth/login", json={"account": "bob", "password": "Xx1!abcd"})
        assert resp.status_code == 200, resp.text
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "Xx1!abcd"})
    assert resp.status_code == 429
    assert "LOGIN_RATE_LIMITED" in resp.json()["code"]


@pytest.mark.asyncio
async def test_failures_trigger_captcha(client: AsyncClient, bob, fake_redis) -> None:
    """连续失败:前 2 次 401,第 3 次 record→fails=3 → 423 need_captcha。"""
    for _ in range(2):
        resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
        assert resp.status_code == 401
    # 第 3 次:失败计数达阈值 → 423(且提示需要验证码)
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423
    body = resp.json()
    assert "CAPTCHA_REQUIRED" in body["code"]
    assert body["details"]["need_captcha"] is True


@pytest.mark.asyncio
async def test_full_captcha_login_flow(client: AsyncClient, bob, fake_redis) -> None:
    """触发 → confirm 取 id → verify 拿 token → login 带 token 成功;id/token 一次性。"""
    # 触发 needs_captcha(2 次 401 + 第 3 次 423)
    for _ in range(2):
        await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423

    # 点「我不是机器人」→ 取一次性 captcha_id
    resp = await client.get("/api/auth/captcha/confirm")
    assert resp.status_code == 200
    captcha_id = resp.json()["captcha_id"]
    assert captcha_id
    # id 已存后端(redis)
    assert f"captcha:confirm:{captcha_id}" in fake_redis.store

    # verify → 拿 token
    resp = await client.post("/api/auth/captcha/verify", json={"captcha_id": captcha_id})
    assert resp.status_code == 200
    assert resp.json()["success"] is True
    token = resp.json()["captcha_token"]
    assert token

    # confirm id 一次性:用过即删
    assert f"captcha:confirm:{captcha_id}" not in fake_redis.store

    # login 带正确 token + 正确密码 → 200
    resp = await client.post(
        "/api/auth/login",
        json={"account": "bob", "password": "Xx1!abcd", "captcha_token": token},
    )
    assert resp.status_code == 200, resp.text
    # token 一次性:login 消费后即删
    assert f"captcha:token:{token}" not in fake_redis.store


@pytest.mark.asyncio
async def test_confirm_id_single_use(client: AsyncClient, fake_redis) -> None:
    """同一 captcha_id 第二次 verify → success=False(一次性,防重放)。"""
    resp = await client.get("/api/auth/captcha/confirm")
    captcha_id = resp.json()["captcha_id"]
    # 第一次 verify → 成功
    resp = await client.post("/api/auth/captcha/verify", json={"captcha_id": captcha_id})
    assert resp.json()["success"] is True
    # 第二次 verify 同一 id → 失败
    resp = await client.post("/api/auth/captcha/verify", json={"captcha_id": captcha_id})
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body["captcha_token"] is None


@pytest.mark.asyncio
async def test_verify_unknown_id_fails(client: AsyncClient, fake_redis) -> None:
    """伪造/不存在的 captcha_id → success=False。"""
    resp = await client.post("/api/auth/captcha/verify", json={"captcha_id": "not-exist"})
    assert resp.status_code == 200
    assert resp.json()["success"] is False
    assert resp.json()["captcha_token"] is None


@pytest.mark.asyncio
async def test_redis_down_degrades_open(client: AsyncClient, bob, monkeypatch) -> None:
    """Redis 全挂:限流/captcha 降级放行,登录仍可用(与 api_key 缓存降级哲学一致)。"""

    def raising() -> None:
        raise RuntimeError("redis down")

    monkeypatch.setattr("app.modules.auth.captcha_service.get_redis", raising)

    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "Xx1!abcd"})
    assert resp.status_code == 200, resp.text
