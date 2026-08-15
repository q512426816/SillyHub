"""task-07（sessions-portal / FR-08 / D-009@v1）供应商额度端点测试。

覆盖 ``GET /api/llm-providers/{id}/quota``（弱依赖 R-05）：

- GLM 供应商：复用 ``usage_handlers.query_zhipu_quota`` → ``query_zhipu``（含
  ``_classify_zhipu_window`` / ``_parse_zhipu_tiers`` 解析链）返回 windows
  （5 小时窗 / 周限额，含剩余百分比与重置时间）；
- 非 GLM 供应商（base_url 判定，复用 ``_detect_usage_provider`` 既有方式）→
  HTTP 200 + ``{"quota": null}``，httpx 永不被调（判定在请求前短路）；
- 上游失败（网络异常 / HTTP 500 / 业务错）→ HTTP 200 + ``quota=null``，绝不 5xx；
- 鉴权 / owner（D-008）：未带 Bearer → 401；不存在 → 404；跨用户 → 403。

mock 范式照 ``test_usage.py``（patch ``httpx.AsyncClient`` 返各家用量端点 body +
patch ``tool_policy.socket.getaddrinfo`` 返公网 IP 防 DNS），HTTP 层断言真实响应体
（照 ``test_router.py`` 的 ``client`` + ``auth_headers`` 范式）。上游 body 用固定
毫秒时间戳（时间不敏感，不真等）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

# ── 共用常量 / helpers（照 test_usage.py 范式）─────────────────────────────────

_PUBLIC_GAI = [(2, 1, 6, "", ("93.184.216.34", 0))]

_USAGE_CLIENT_PATCH = "app.modules.llm_provider.usage_handlers.httpx.AsyncClient"


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


async def _create_provider_via_http(
    client: AsyncClient,
    auth_headers: dict,
    *,
    base_url: str,
    name: str = "glm-quota",
    model: str = "glm-4.7",
    api_key: str = "sk-zhipu-quota-secret-0001",
) -> str:
    """经 HTTP POST 落一个真实加密 api_key 的 provider（owner = 当前认证用户），返回 id。"""
    create = await client.post(
        "/api/llm-providers",
        headers=auth_headers,
        json={
            "name": name,
            "api_key": api_key,
            "base_url": base_url,
            "model": model,
        },
    )
    assert create.status_code == 201, create.text
    return create.json()["id"]


# 智谱 /api/monitor/usage/quota/limit 成功 body（unit 3→5h 窗 / 6→周窗，
# percentage=已用百分比，nextResetTime=固定毫秒时间戳，不真等时间）
_ZHIPU_OK_BODY = {
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


# ════════════════════════════════════════════════════════════════════════════
# 1. GLM 供应商：复用解析链返回 windows
# ════════════════════════════════════════════════════════════════════════════


class TestQuotaGlmSuccess:
    """GLM 供应商 → 200 + quota 含 5 小时窗 / 周限额（剩余与重置时间）。"""

    @pytest.mark.asyncio
    async def test_glm_returns_windows(self, client: AsyncClient, auth_headers: dict) -> None:
        """unit 3→5h 窗（used 30 → left 70）、unit 6→周窗（used 50 → left 50）+ 重置时间。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            quota_client = _wire_async_client(
                mock_cls, get_return_value=_make_response(200, _ZHIPU_OK_BODY)
            )

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["quota"] is not None
        assert body["quota"]["model"] == "glm-4.7"
        windows = body["quota"]["windows"]
        assert len(windows) == 2
        # 5 小时窗：label（含套餐等级前缀）+ 剩余百分比 + 重置时间
        assert "5小时窗" in windows[0]["label"]
        assert windows[0]["left"] == 70.0
        assert windows[0]["reset"]  # ISO8601 重置时间存在
        # 周限额
        assert "周限额" in windows[1]["label"]
        assert windows[1]["left"] == 50.0
        assert windows[1]["reset"]
        # 复用既有数据源：真实端点 /api/monitor/usage/quota/limit + 裸 key 头（不加 Bearer）
        url = quota_client.get.await_args.args[0]
        assert url == "https://open.bigmodel.cn/api/monitor/usage/quota/limit"
        headers = quota_client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == "sk-zhipu-quota-secret-0001"
        assert not headers["Authorization"].startswith("Bearer ")
        # 明文 key 永不进响应（NFR-02）
        assert "sk-zhipu-quota-secret-0001" not in resp.text

    @pytest.mark.asyncio
    async def test_glm_z_ai_variant(self, client: AsyncClient, auth_headers: dict) -> None:
        """api.z.ai 变体 base_url 同样判定 GLM（复用 _detect_usage_provider）。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://api.z.ai/api/anthropic", name="zai"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, _ZHIPU_OK_BODY))

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json()["quota"] is not None
        assert len(resp.json()["quota"]["windows"]) == 2


# ════════════════════════════════════════════════════════════════════════════
# 2. 非 GLM 供应商 → 200 + quota=null（判定在请求前短路）
# ════════════════════════════════════════════════════════════════════════════


class TestQuotaNonGlm:
    """非 GLM 供应商（deepseek / anthropic 官方 / 中转）→ 200 + quota=null。"""

    @pytest.mark.parametrize(
        "base_url",
        [
            "https://api.deepseek.com/anthropic",
            "https://api.anthropic.com",
            "https://my-relay.example.com",
        ],
        ids=["deepseek", "anthropic_official", "relay"],
    )
    @pytest.mark.asyncio
    async def test_non_glm_returns_null(
        self, client: AsyncClient, auth_headers: dict, base_url: str
    ) -> None:
        pid = await _create_provider_via_http(
            client, auth_headers, base_url=base_url, name=f"non-glm-{uuid.uuid4().hex[:6]}"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, {}))

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}
        # GLM 判定在请求前短路：httpx 永不被实例化
        assert mock_cls.called is False

    @pytest.mark.asyncio
    async def test_missing_credentials_returns_null(
        self, client: AsyncClient, auth_headers: dict
    ) -> None:
        """缺 api_key（空字符串加密后解密为空）→ 200 + quota=null（缺凭证降级）。"""
        create = await client.post(
            "/api/llm-providers",
            headers=auth_headers,
            json={
                "name": "glm-nokey",
                "api_key": "",
                "base_url": "https://open.bigmodel.cn/api/anthropic",
                "model": "glm-4.7",
            },
        )
        assert create.status_code == 201, create.text
        pid = create.json()["id"]

        with patch(_USAGE_CLIENT_PATCH) as mock_cls:
            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}
        assert mock_cls.called is False


# ════════════════════════════════════════════════════════════════════════════
# 3. 上游失败 / 异常 → 200 + quota=null（绝不 5xx）
# ════════════════════════════════════════════════════════════════════════════


class TestQuotaUpstreamFailure:
    """网络异常 / HTTP 500 / 业务错 / 空数据 → 一律 200 + quota=null。"""

    @pytest.mark.asyncio
    async def test_network_error_returns_null(
        self, client: AsyncClient, auth_headers: dict
    ) -> None:
        """httpx.ConnectError → 200 + quota=null（不 raise 5xx）。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ConnectError("connection refused"))

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}

    @pytest.mark.asyncio
    async def test_timeout_returns_null(self, client: AsyncClient, auth_headers: dict) -> None:
        """httpx.ReadTimeout → 200 + quota=null。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ReadTimeout("read timed out"))

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}

    @pytest.mark.asyncio
    async def test_upstream_500_returns_null(self, client: AsyncClient, auth_headers: dict) -> None:
        """上游 HTTP 500（UsageUpstreamError）→ 200 + quota=null。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(500))

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}

    @pytest.mark.asyncio
    async def test_business_error_returns_null(
        self, client: AsyncClient, auth_headers: dict
    ) -> None:
        """上游业务错（success:false）→ 200 + quota=null。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(
                mock_cls, get_return_value=_make_response(200, {"success": False, "msg": "bad key"})
            )

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}

    @pytest.mark.asyncio
    async def test_empty_tiers_returns_null(self, client: AsyncClient, auth_headers: dict) -> None:
        """2xx 但 limits 无 TOKENS_LIMIT 条目（空 tier）→ 200 + quota=null。"""
        pid = await _create_provider_via_http(
            client, auth_headers, base_url="https://open.bigmodel.cn/api/anthropic"
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch(_USAGE_CLIENT_PATCH) as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(
                mock_cls,
                get_return_value=_make_response(
                    200, {"success": True, "data": {"level": None, "limits": []}}
                ),
            )

            resp = await client.get(f"/api/llm-providers/{pid}/quota", headers=auth_headers)

        assert resp.status_code == 200, resp.text
        assert resp.json() == {"quota": None}


# ════════════════════════════════════════════════════════════════════════════
# 4. 鉴权 / owner（D-008）
# ════════════════════════════════════════════════════════════════════════════


class TestQuotaAuthAndOwnership:
    """鉴权同既有供应商端点：401 / 404 / 403（不泄漏存在性）。"""

    @pytest.mark.asyncio
    async def test_requires_auth(self, client: AsyncClient) -> None:
        """未带 Bearer → 401（get_current_user）。"""
        resp = await client.get(f"/api/llm-providers/{uuid.uuid4()}/quota")
        assert resp.status_code == 401, resp.text

    @pytest.mark.asyncio
    async def test_nonexistent_returns_404(self, client: AsyncClient, auth_headers: dict) -> None:
        """provider_id 不存在 → LlmProviderNotFound 404。"""
        resp = await client.get(f"/api/llm-providers/{uuid.uuid4()}/quota", headers=auth_headers)
        assert resp.status_code == 404, resp.text

    @pytest.mark.asyncio
    async def test_other_users_provider_returns_403(
        self,
        client: AsyncClient,
        auth_headers: dict,
        db_session: AsyncSession,
    ) -> None:
        """跨用户 → PermissionDenied 403（service.get 先 SELECT 到行再比对 user_id）。"""
        from app.modules.auth.model import User
        from app.modules.llm_provider.schema import LlmProviderCreate
        from app.modules.llm_provider.service import LlmProviderService

        uid = uuid.uuid4()
        db_session.add(
            User(
                id=uid,
                email=f"quota-other-{uid.hex[:8]}@example.com",
                username=f"quota-{uid.hex[:8]}",
                password_hash="irrelevant",
                display_name="Quota Other",
                status="active",
            )
        )
        await db_session.commit()
        svc = LlmProviderService(db_session)
        row = await svc.create(
            uid,
            LlmProviderCreate(
                name="other-quota",
                api_key="sk-other-quota-secret-1234",
                base_url="https://open.bigmodel.cn/api/anthropic",
                model="glm-4.7",
            ),
        )

        resp = await client.get(f"/api/llm-providers/{row.id}/quota", headers=auth_headers)

        assert resp.status_code == 403, resp.text
