"""登录限流 + 滑块验证码 契约测试(安全止血:登录爆破防护)。

覆盖:
- 同 IP 60s 窗口超 5 次 → 429
- 连续失败达阈值(3)→ 423 need_captcha
- 完整流程:失败触发 → slider 取图 → verify 正确位置拿 token → login 带 token 成功
- 位置错误 → success=False
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
    """触发 → slider → verify 正确位置 → login 带 token 成功;token 一次性消费。"""
    # 触发 needs_captcha(2 次 401 + 第 3 次 423)
    for _ in range(2):
        await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423

    # 取滑块图
    resp = await client.get("/api/auth/captcha/slider")
    assert resp.status_code == 200
    cap = resp.json()
    captcha_id = cap["captcha_id"]
    assert cap["bg_image"].startswith("data:image/png;base64,")
    assert cap["slider_image"].startswith("data:image/png;base64,")
    # target_x 仅存后端(redis),前端拿不到——测试从 fake_redis 读出校验用
    target_x = int(fake_redis.store[f"captcha:slider:{captcha_id}"])

    # 正确位置 verify → 拿 token
    resp = await client.post(
        "/api/auth/captcha/verify", json={"captcha_id": captcha_id, "x": target_x}
    )
    assert resp.status_code == 200
    token = resp.json()["captcha_token"]
    assert token

    # slider 一次性:用过即删
    assert f"captcha:slider:{captcha_id}" not in fake_redis.store

    # login 带正确 token + 正确密码 → 200
    resp = await client.post(
        "/api/auth/login",
        json={"account": "bob", "password": "Xx1!abcd", "captcha_token": token},
    )
    assert resp.status_code == 200, resp.text
    # token 一次性:login 消费后即删
    assert f"captcha:token:{token}" not in fake_redis.store


@pytest.mark.asyncio
async def test_verify_wrong_position_fails(client: AsyncClient, fake_redis) -> None:
    """拖动位置偏离超容差 → success=False(且 slider 作废防爆破 target)。"""
    resp = await client.get("/api/auth/captcha/slider")
    captcha_id = resp.json()["captcha_id"]
    target_x = int(fake_redis.store[f"captcha:slider:{captcha_id}"])
    # 偏离 100px(远超 6px 容差)
    resp = await client.post(
        "/api/auth/captcha/verify",
        json={"captcha_id": captcha_id, "x": target_x + 100},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["success"] is False
    assert body["captcha_token"] is None
    # 错误也作废 slider(一次性,防穷举 target)
    assert f"captcha:slider:{captcha_id}" not in fake_redis.store


@pytest.mark.asyncio
async def test_redis_down_degrades_open(client: AsyncClient, bob, monkeypatch) -> None:
    """Redis 全挂:限流/captcha 降级放行,登录仍可用(与 api_key 缓存降级哲学一致)。"""

    def raising() -> None:
        raise RuntimeError("redis down")

    monkeypatch.setattr("app.modules.auth.captcha_service.get_redis", raising)

    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "Xx1!abcd"})
    assert resp.status_code == 200, resp.text
