"""task-10（2026-07-28-llm-provider-presets-and-usage）后端用量查询测试。

照 ``test_fetch_models.py`` 的 mock httpx 范式（``patch httpx.AsyncClient`` + ``AsyncMock``
+ ``patch tool_policy.socket.getaddrinfo`` 返公网 IP 防 DNS），覆盖 design §5.2 / D-005：

- 6 家正常解析（3 balance：DeepSeek / 硅基(.cn/.com) / OpenRouter；3 token_plan handler：
  Kimi（Kimi & Kimi-For-Coding 同 handler）/ 智谱（/api/monitor/usage/quota/limit + 裸 key
  + unit 分窗）/ MiniMax（general 桶 + weekly_status==1 才周桶））—— 多 tier 逐条字段断言；
- 错误两态（D-005）：401/403→``success:false``+``is_valid:false``（翻红，不 raise）；
  404/未知→``success:false``（不支持，不 raise）；超时/5xx/429/网络→``raise LlmProviderUsageTransient``
  （5xx，前端保留上次值）；
- detect 路由（D-004）：Kimi vs Kimi-For-Coding 同 ``api.kimi.com``→同 handler；智谱 bigmodel.cn /
  api.z.ai；未知 base_url（moonshot / anthropic / dashscope）→ ``success:false`` 暂不支持；
- SSRF（D-009）：私网 IPv4+IPv6+DNS 失败 → ``success:false``（确定性，保持 200 vs 5xx 干净两态），
  httpx 永不被调（SSRF 在请求前拦）；15s 超时生效（NFR-01）；
- api_key 安全（NFR-02）：provider_id 形态真解密，明文 key 不入 ``UsageResult`` 响应、不入日志，
  仅局部变量用于鉴权头（智谱裸 key / 其余 Bearer）。

与 task 卡差异说明：卡称「7 家（含 Kimi=moonshot）」，但 cc-switch ``balance.rs``/``coding_plan.rs``
detect 不含 ``api.moonshot.cn``（通用 Kimi 无套餐用量端点），后端 ``_detect_usage_provider`` 同步
判 None → 真实可查为 6 家（3 balance + 3 token_plan handler，Kimi/Kimi-For-Coding 共用一 handler）。
故「Kimi=moonshot」测为不支持（detect None → success:false），非正常解析用例。

SQLite + aiosqlite（backend 测试基线），断言不绑死 PG 专有函数（memory ``backend-test-sqlite-vs-pg``）；
时间断言用 test 内值（memory ``test-module-level-time-constant-pitfall``）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.llm_provider.schema import LlmProviderCreate, UsageResult
from app.modules.llm_provider.service import (
    LlmProviderService,
    LlmProviderUsageTransient,
)

# ── 共用常量 / helpers（照 test_fetch_models.py 范式）─────────────────────────

_PUBLIC_GAI = [(2, 1, 6, "", ("93.184.216.34", 0))]


def _make_response(status_code: int, body: Any = None) -> MagicMock:
    """httpx.Response 替身：``.status_code`` + ``.json()`` + ``.text``。"""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body if body is not None else {}
    resp.text = "" if body is None else str(body)
    return resp


def _wire_async_client(
    mock_client_cls: MagicMock,
    *,
    get_return_value: Any = None,
    get_side_effect: Any = None,
) -> AsyncMock:
    """配置 ``patch(httpx.AsyncClient)`` 支持 ``async with ... as client: await client.get()``。"""
    client = AsyncMock()
    if get_side_effect is not None:
        client.get.side_effect = get_side_effect
    elif get_return_value is not None:
        client.get.return_value = get_return_value

    ctx_instance = AsyncMock()
    ctx_instance.__aenter__.return_value = client
    ctx_instance.__aexit__.return_value = None
    mock_client_cls.return_value = ctx_instance
    return client


async def _create_user(session: AsyncSession, *, label: str = "u") -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"u-{uid.hex[:8]}-{label}@example.com",
            username=f"u-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"Usage Test {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


async def _seed_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    base_url: str,
    api_key: str = "sk-usage-secretkey-0001",
    name: str = "usage-provider",
):
    """用 service.create 落一个真实加密 api_key 的 provider（query_usage 需真解密）。"""
    svc = LlmProviderService(session)
    return await svc.create(
        user_id,
        LlmProviderCreate(name=name, base_url=base_url, api_key=api_key),
    )


# ════════════════════════════════════════════════════════════════════════════
# 1. 6 家正常解析（mock httpx 返各家用量端点 body）
# ════════════════════════════════════════════════════════════════════════════


class TestUsageSuccess:
    """balance 3 家 + token_plan 3 handler 正常解析为多 tier UsageData。"""

    @pytest.mark.asyncio
    async def test_deepseek_balance_multi_currency(self, db_session: AsyncSession) -> None:
        """DeepSeek /user/balance：balance_infos 多币种多 tier，remaining=total_balance。"""
        user_id = await _create_user(db_session, label="ds")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        body = {
            "is_available": True,
            "balance_infos": [
                {"currency": "CNY", "total_balance": "10.50"},
                {"currency": "USD", "total_balance": "5"},
            ],
        }
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        assert result.data is not None and len(result.data) == 2
        assert result.data[0].unit == "CNY" and result.data[0].remaining == 10.5
        assert result.data[1].unit == "USD" and result.data[1].remaining == 5.0
        # NFR-01：15s 超时透传给 httpx.AsyncClient
        assert mock_cls.call_args.kwargs.get("timeout") == 15.0

    @pytest.mark.asyncio
    async def test_siliconflow_cn_cny(self, db_session: AsyncSession) -> None:
        """硅基 .cn → CNY；remaining=totalBalance。"""
        user_id = await _create_user(db_session, label="sfcn")
        row = await _seed_provider(db_session, user_id, base_url="https://api.siliconflow.cn")
        body = {"data": {"totalBalance": 88.8}}
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        assert result.data is not None
        tier = result.data[0]
        assert tier.unit == "CNY"
        assert tier.remaining == 88.8
        assert tier.plan_name == "硅基流动"

    @pytest.mark.asyncio
    async def test_siliconflow_com_usd(self, db_session: AsyncSession) -> None:
        """硅基 .com → USD（.cn/.com 变体分流）。"""
        user_id = await _create_user(db_session, label="sfcom")
        row = await _seed_provider(db_session, user_id, base_url="https://api.siliconflow.com")
        body = {"data": {"totalBalance": 12.3}}
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        assert result.data is not None
        assert result.data[0].unit == "USD"
        assert "国际" in result.data[0].plan_name

    @pytest.mark.asyncio
    async def test_openrouter_credits(self, db_session: AsyncSession) -> None:
        """OpenRouter /api/v1/credits：remaining=total_credits-total_usage。"""
        user_id = await _create_user(db_session, label="or")
        row = await _seed_provider(db_session, user_id, base_url="https://openrouter.ai/api")
        body = {"data": {"total_credits": 100, "total_usage": 30}}
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        assert result.data is not None
        tier = result.data[0]
        assert tier.remaining == 70.0
        assert tier.total == 100.0
        assert tier.used == 30.0
        assert tier.unit == "USD"

    @pytest.mark.parametrize(
        "base_url",
        ["https://api.kimi.com/coding/", "https://api.kimi.com"],
        ids=["kimi_for_coding", "kimi"],
    )
    @pytest.mark.asyncio
    async def test_kimi_token_plan_multi_tier(
        self, db_session: AsyncSession, base_url: str
    ) -> None:
        """Kimi & Kimi-For-Coding 同 api.kimi.com → 同 handler；limits→5h窗 / usage→周窗。

        limits[{limit:500,remaining:250}] → 5h窗 used 50%；usage{limit:10000,remaining:4000}
        → 周窗 used 60%。
        """
        user_id = await _create_user(db_session, label="kimi")
        row = await _seed_provider(db_session, user_id, base_url=base_url)
        body = {
            "limits": [
                {
                    "detail": {
                        "limit": 500,
                        "remaining": 250,
                        "resetTime": "2026-08-01T00:00:00+00:00",
                    }
                }
            ],
            "usage": {"limit": 10000, "remaining": 4000, "resetTime": "2026-08-08T00:00:00+00:00"},
        }
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        tiers = result.data
        assert tiers is not None and len(tiers) == 2
        assert tiers[0].plan_name == "5小时窗"
        assert tiers[0].used == 50.0 and tiers[0].remaining == 50.0 and tiers[0].unit == "%"
        assert tiers[0].extra is not None  # 重置时间
        assert tiers[1].plan_name == "周限额"
        assert tiers[1].used == 60.0 and tiers[1].remaining == 40.0

    @pytest.mark.asyncio
    async def test_zhipu_token_plan_unit_split(self, db_session: AsyncSession) -> None:
        """智谱 /api/monitor/usage/quota/limit：unit 3→5h窗 / 6→周窗；level 前缀；裸 key 头。

        ⚠️ 真实端点 /api/monitor/usage/quota/limit（非 design §5 写的 /api/paas/...）；
        Authorization 头不加 Bearer（裸 key）—— 本用例断言之。
        """
        plaintext = "sk-zhipu-rawkey-no-bearer-99"
        user_id = await _create_user(db_session, label="zp")
        row = await _seed_provider(
            db_session,
            user_id,
            base_url="https://open.bigmodel.cn/api/anthropic",
            api_key=plaintext,
        )
        body = {
            "success": True,
            "data": {
                "level": "Max",
                "limits": [
                    {
                        "type": "TOKENS_LIMIT",
                        "percentage": 30,
                        "unit": 3,
                        "nextResetTime": 1735400000000,
                    },
                    {
                        "type": "TOKENS_LIMIT",
                        "percentage": 50,
                        "unit": 6,
                        "nextResetTime": 1735800000000,
                    },
                ],
            },
        }
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        tiers = result.data
        assert tiers is not None and len(tiers) == 2
        assert tiers[0].plan_name == "Max·5小时窗"
        assert tiers[0].used == 30.0 and tiers[0].remaining == 70.0
        assert tiers[1].plan_name == "Max·周限额"
        assert tiers[1].used == 50.0 and tiers[1].remaining == 50.0
        # 智谱裸 key：Authorization 头不加 Bearer 前缀
        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == plaintext
        assert not headers["Authorization"].startswith("Bearer ")

    @pytest.mark.asyncio
    async def test_minimax_weekly_active(self, db_session: AsyncSession) -> None:
        """MiniMax general 桶 + weekly_status==1 → 5h 窗 + 周窗两条。

        5h remain 40 → used 60；周 remain 60 → used 40。
        """
        user_id = await _create_user(db_session, label="mm")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.minimaxi.com/anthropic"
        )
        body = {
            "base_resp": {"status_code": 0},
            "model_remains": [
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 40,
                    "end_time": 1735400000000,
                    "current_weekly_status": 1,
                    "current_weekly_remaining_percent": 60,
                    "weekly_end_time": 1735800000000,
                },
                {"model_name": "video", "current_interval_remaining_percent": 99},  # 跳过非 general
            ],
        }
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        tiers = result.data
        assert tiers is not None and len(tiers) == 2
        assert tiers[0].plan_name == "5小时窗"
        assert tiers[0].used == 60.0 and tiers[0].remaining == 40.0
        assert tiers[1].plan_name == "周限额"
        assert tiers[1].used == 40.0 and tiers[1].remaining == 60.0

    @pytest.mark.asyncio
    async def test_minimax_weekly_inactive_only_5h(self, db_session: AsyncSession) -> None:
        """MiniMax weekly_status != 1（无周限额）→ 仅 5h 窗一条。"""
        user_id = await _create_user(db_session, label="mmw")
        row = await _seed_provider(db_session, user_id, base_url="https://api.minimax.io/anthropic")
        body = {
            "base_resp": {"status_code": 0},
            "model_remains": [
                {
                    "model_name": "general",
                    "current_interval_remaining_percent": 25,
                    "end_time": 1735400000000,
                    "current_weekly_status": 3,  # 无周限额
                }
            ],
        }
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is True
        tiers = result.data
        assert tiers is not None and len(tiers) == 1
        assert tiers[0].plan_name == "5小时窗"
        assert tiers[0].used == 75.0


# ════════════════════════════════════════════════════════════════════════════
# 2. 错误两态分类（D-005）
# ════════════════════════════════════════════════════════════════════════════


class TestUsageErrorClassification:
    """401/403→success:false+is_valid:false（翻红）；404→success:false（不支持）；
    超时/5xx/429/网络→raise LlmProviderUsageTransient（瞬时 5xx）。"""

    @pytest.mark.asyncio
    async def test_401_deterministic_invalid(self, db_session: AsyncSession) -> None:
        """上游 401 → success:false + data[0].is_valid=False（翻红，不 raise）。"""
        user_id = await _create_user(db_session, label="e401")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(401))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert result.data is not None and len(result.data) == 1
        assert result.data[0].is_valid is False
        assert result.data[0].invalid_message is not None

    @pytest.mark.asyncio
    async def test_403_deterministic_invalid(self, db_session: AsyncSession) -> None:
        """上游 403 → 同 401 翻红（确定性）。"""
        user_id = await _create_user(db_session, label="e403")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(403))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert result.data is not None
        assert result.data[0].is_valid is False

    @pytest.mark.asyncio
    async def test_404_deterministic_unsupported(self, db_session: AsyncSession) -> None:
        """上游 404 → success:false 灰提示（确定性，不 raise，区别于鉴权翻红）。"""
        user_id = await _create_user(db_session, label="e404")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(404))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert result.error is not None  # 灰提示文案
        # 404 不翻红（无 is_valid:false 的 data）
        assert result.data is None or all(d.is_valid is not False for d in result.data)

    @pytest.mark.asyncio
    async def test_timeout_raises_transient(self, db_session: AsyncSession) -> None:
        """httpx.ReadTimeout → raise LlmProviderUsageTransient（5xx，前端保留上次值）。"""
        user_id = await _create_user(db_session, label="eto")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ReadTimeout("read timed out"))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderUsageTransient) as exc_info:
                await svc.query_usage(row.id, user_id)

        assert exc_info.value.http_status >= 500

    @pytest.mark.asyncio
    async def test_500_raises_transient(self, db_session: AsyncSession) -> None:
        """上游 500 → raise LlmProviderUsageTransient（瞬时）。"""
        user_id = await _create_user(db_session, label="e500")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(500))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderUsageTransient):
                await svc.query_usage(row.id, user_id)

    @pytest.mark.asyncio
    async def test_429_raises_transient(self, db_session: AsyncSession) -> None:
        """上游 429 → raise LlmProviderUsageTransient（限流，瞬时）。"""
        user_id = await _create_user(db_session, label="e429")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(429))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderUsageTransient):
                await svc.query_usage(row.id, user_id)

    @pytest.mark.asyncio
    async def test_connect_error_raises_transient(self, db_session: AsyncSession) -> None:
        """httpx.ConnectError（网络）→ raise LlmProviderUsageTransient（瞬时）。"""
        user_id = await _create_user(db_session, label="enet")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ConnectError("connection refused"))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderUsageTransient):
                await svc.query_usage(row.id, user_id)

    @pytest.mark.asyncio
    async def test_unknown_provider_returns_unsupported(self, db_session: AsyncSession) -> None:
        """未知 base_url（detect 不到，如 moonshot/anthropic/dashscope）→ success:false 暂不支持。

        httpx 永不被调（detect 在请求前短路）。
        """
        user_id = await _create_user(db_session, label="eunk")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.moonshot.cn/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, {}))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert "暂不支持" in (result.error or "")
        # detect 短路：httpx 永不被调
        assert mock_cls.called is False


# ════════════════════════════════════════════════════════════════════════════
# 3. detect_provider 路由（D-004）
# ════════════════════════════════════════════════════════════════════════════


class TestUsageDetectRouting:
    """``_detect_usage_provider`` 按 base_url 子串路由（照 cc-switch，不加 DB 字段）。"""

    @pytest.mark.parametrize(
        "base_url, expected",
        [
            ("https://api.deepseek.com/anthropic", "deepseek"),
            ("https://api.siliconflow.cn", "siliconflow"),
            ("https://api.siliconflow.com", "siliconflow"),
            ("https://openrouter.ai/api", "openrouter"),
            ("https://api.kimi.com/coding/", "kimi"),
            ("https://api.kimi.com", "kimi"),  # Kimi（moonshot 不在此；api.kimi.com 通用）
            ("https://open.bigmodel.cn/api/anthropic", "zhipu"),
            ("https://api.z.ai/api/anthropic", "zhipu"),
            ("https://api.minimaxi.com/anthropic", "minimax"),
            ("https://api.minimax.io/anthropic", "minimax"),
        ],
    )
    def test_detect_known(self, base_url: str, expected: str) -> None:
        assert LlmProviderService._detect_usage_provider(base_url) == expected

    @pytest.mark.parametrize(
        "base_url",
        [
            "https://api.anthropic.com",
            "https://api.moonshot.cn/anthropic",  # 通用 Kimi（moonshot）无套餐用量端点
            "https://dashscope.aliyuncs.com/apps/anthropic",
            "https://coding.dashscope.aliyuncs.com/apps/anthropic",
            "https://my-relay.example.com",
        ],
    )
    def test_detect_unknown_returns_none(self, base_url: str) -> None:
        """未知 / 非目标（官方 / moonshot / 百炼 / 中转）→ None（不支持）。"""
        assert LlmProviderService._detect_usage_provider(base_url) is None

    def test_kimi_and_kimi_for_coding_share_handler(self) -> None:
        """Kimi vs Kimi-For-Coding 同 api.kimi.com → 同 detect 结果（同 handler）。"""
        a = LlmProviderService._detect_usage_provider("https://api.kimi.com")
        b = LlmProviderService._detect_usage_provider("https://api.kimi.com/coding/")
        assert a == b == "kimi"


# ════════════════════════════════════════════════════════════════════════════
# 4. SSRF（D-009）：私网 IPv4+IPv6+DNS 失败 → success:false，httpx 永不被调
# ════════════════════════════════════════════════════════════════════════════


_SSRF_PRIVATE_CASES = [
    ("ipv4_10", [(2, 1, 6, "", ("10.0.0.5", 0))]),
    ("ipv4_127", [(2, 1, 6, "", ("127.0.0.1", 0))]),
    ("ipv4_192", [(2, 1, 6, "", ("192.168.1.1", 0))]),
    ("ipv4_172_16", [(2, 1, 6, "", ("172.16.5.4", 0))]),
    ("ipv4_169_254", [(2, 1, 6, "", ("169.254.169.254", 0))]),
    ("ipv4_0_0_0_0", [(2, 1, 6, "", ("0.0.0.0", 0))]),
    ("ipv6_loopback", [(10, 1, 6, "", ("::1", 0, 0, 0))]),
    ("ipv6_ula_fc00", [(10, 1, 6, "", ("fc00::1", 0, 0, 0))]),
    ("ipv6_ula_fd00", [(10, 1, 6, "", ("fd00::1234", 0, 0, 0))]),
    ("ipv6_link_local", [(10, 1, 6, "", ("fe80::1", 0, 0, 0))]),
]


class TestUsageSsrf:
    """SSRF：可查供应商（detect 通过）但 host 解析到私网/保留段 → success:false，httpx 不被调。

    与 fetch-models 的 raise 不同——usage 走 D-005 两态：SSRF=确定性 → success:false，
    保持「200 vs 5xx」干净两态（前端灰提示「上游地址被安全策略拒绝」）。
    """

    @pytest.mark.parametrize(
        "case_name, gai_value",
        _SSRF_PRIVATE_CASES,
        ids=[c[0] for c in _SSRF_PRIVATE_CASES],
    )
    @pytest.mark.asyncio
    async def test_private_ip_returns_blocked(
        self,
        db_session: AsyncSession,
        case_name: str,
        gai_value: list[Any],
    ) -> None:
        user_id = await _create_user(db_session, label=f"ssrf-{case_name}")
        # detectable base_url（先过 detect 再到 SSRF 检查）
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = gai_value
            _wire_async_client(
                mock_cls, get_return_value=_make_response(200, {"data": {"totalBalance": 1}})
            )

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert "安全策略拒绝" in (result.error or "")
        # SSRF 在请求前拦截：httpx.AsyncClient 永不被实例化
        assert mock_cls.called is False

    @pytest.mark.asyncio
    async def test_dns_resolve_failure_returns_blocked(self, db_session: AsyncSession) -> None:
        """DNS 解析失败（gaierror）→ 同样 success:false（安全侧不 fallback）。"""
        import socket

        user_id = await _create_user(db_session, label="ssrf-dns")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic"
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.side_effect = socket.gaierror("name or service not known")
            _wire_async_client(mock_cls, get_return_value=_make_response(200, {}))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        assert result.success is False
        assert mock_cls.called is False


# ════════════════════════════════════════════════════════════════════════════
# 5. api_key 安全（NFR-02）：明文不入响应 / 不入日志
# ════════════════════════════════════════════════════════════════════════════


class TestUsageApiKeySafety:
    """provider_id 形态真解密；明文 key 仅用于鉴权头，不入 UsageResult 响应 / 不入日志。"""

    @pytest.mark.asyncio
    async def test_plaintext_key_not_in_response(self, db_session: AsyncSession) -> None:
        plaintext = "sk-usage-plaintext-secret-123456"
        user_id = await _create_user(db_session, label="safe")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic", api_key=plaintext
        )
        body = {"is_available": True, "balance_infos": [{"currency": "CNY", "total_balance": "1"}]}
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200, body))

            svc = LlmProviderService(db_session)
            result = await svc.query_usage(row.id, user_id)

        # 明文 key 永不进 UsageResult 序列化（NFR-02）
        assert plaintext not in result.model_dump_json()
        # 鉴权头用的是后端解密出的明文（证明 provider_id 形态真解密）
        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == f"Bearer {plaintext}"

    @pytest.mark.asyncio
    async def test_plaintext_key_not_in_logs(
        self, db_session: AsyncSession, caplog: pytest.LogCaptureFixture
    ) -> None:
        """401 鉴权失败路径：上游 body 仅记 debug，明文 key 不入 info/warning 日志。"""
        plaintext = "sk-usage-logsafe-secret-7890"
        user_id = await _create_user(db_session, label="safelog")
        row = await _seed_provider(
            db_session, user_id, base_url="https://api.deepseek.com/anthropic", api_key=plaintext
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(401))

            svc = LlmProviderService(db_session)
            result: UsageResult = await svc.query_usage(row.id, user_id)

        assert result.success is False
        # 明文 key 不出现在任何捕获日志行（鉴权失败 log.info 仅记 provider/status）
        for record in caplog.records:
            assert plaintext not in record.getMessage()
