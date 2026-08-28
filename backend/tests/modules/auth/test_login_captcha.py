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
    # 592e0435 开关允许本地 .env 设 AUTH_CAPTCHA_ENABLED=false（CI 无 .env 走默认
    # True）。本文件契约是「开关开」的生产路径——显式钉 True，消除本地/CI 环境差
    # 异（否则开关关时 needs_captcha 恒 False、token 不被消费，token 一次性与
    # 401 明示两用例在本地必红）；下方免验证开关用例自会显式改回 False。
    monkeypatch.setattr(get_settings(), "auth_captcha_enabled", True)
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
async def test_captcha_verified_then_wrong_password_returns_401(
    client: AsyncClient, bob, fake_redis
) -> None:
    """阈值触发后,带有效 captcha_token 但密码错 → 应 401 密码错误,而非 423 又要验证码。

    回归保护:修复前这里返回 423(密码错误被吞成"要验证码",且 token 已被白白消费),
    导致用户陷"验证→又让验证"循环、永远看不到密码错误提示。
    """
    # 触发 needs_captcha:前 2 次 401 + 第 3 次 423
    for _ in range(2):
        await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423

    # 点「我不是机器人」过验证 → 拿一次性 token
    captcha_id = (await client.get("/api/auth/captcha/confirm")).json()["captcha_id"]
    token = (await client.post("/api/auth/captcha/verify", json={"captcha_id": captcha_id})).json()[
        "captcha_token"
    ]
    assert token

    # 带有效 token + 错密码 → 必须明确提示密码错(401),不再绕回验证码(423)
    resp = await client.post(
        "/api/auth/login",
        json={"account": "bob", "password": "wrong", "captcha_token": token},
    )
    assert resp.status_code == 401, resp.text
    assert "AUTH_INVALID_CREDENTIALS" in resp.json()["code"]
    # token 仍被一次性消费(即便密码错,验证已通过)
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


@pytest.mark.asyncio
async def test_captcha_disabled_switch_bypasses_threshold(
    client: AsyncClient, bob, fake_redis, monkeypatch: pytest.MonkeyPatch
) -> None:
    """ql-20260827-006：AUTH_CAPTCHA_ENABLED=false → 失败计数超阈值也不 423,免验证码登录。"""
    # 本用例全程走 fake_redis（含恢复段,见下）,7 个请求会撞默认 5 次/分钟限流 429
    # 干扰断言——本用例考察验证码开关,显式调高限流隔离关注点(限流另有专测)。
    monkeypatch.setattr(get_settings(), "auth_login_rate_limit_per_minute", 100)
    # 失败至阈值(3)→ 423,确认验证码已触发态
    for _ in range(2):
        resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
        assert resp.status_code == 401
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423
    # 开关关闭:needs_captcha 短路 → 同场景不再 423,正确密码免验证码直接登录
    monkeypatch.setattr(get_settings(), "auth_captcha_enabled", False)
    resp = await client.post("/api/auth/login", json={"account": "bob", "password": "Xx1!abcd"})
    assert resp.status_code == 200
    assert resp.json()["access_token"]
    # 开关恢复后生产默认路径不变:成功登录已清计数,再失败至阈值重新触发 423。
    # 不用 monkeypatch.undo()——它会连 fixture 的 fake_redis 补丁一并撤销,
    # CI 无真实 Redis 时失败计数静默丢失(record_login_failure 降级返回 0),
    # 第 3 次仍 401 而非 423;显式只翻回开关,Redis 替身保持挂载。
    monkeypatch.setattr(get_settings(), "auth_captcha_enabled", True)
    for _ in range(3):
        resp = await client.post("/api/auth/login", json={"account": "bob", "password": "wrong"})
    assert resp.status_code == 423
