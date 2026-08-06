"""task-01（2026-08-06-provider-switch-live-session）凭证探测测试。

覆盖 task-01 acceptance：
- 有效凭证 → ``ok=True``；
- 无效 key（401/403）→ ``ok=False`` + 鉴权失败原因；
- 网络错 / 超时 → ``ok=False``（不抛异常，D-003 不破坏会话）。

mock 范式（同 test_fetch_models.py，constraints：不打真实网络）：
- ``patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo")`` 返回公网 IP，
  让 SSRF 检查放行（hermetic，避免真实 DNS）；
- ``patch("app.modules.llm_provider.probe.httpx.AsyncClient")`` 模拟
  ``async with ... as client: await client.get(...)`` 形态。

probe 无 DB 依赖（无状态查询，design §9 豁免生命周期契约），故测试不声明 ``db_session``。
"""

from __future__ import annotations

from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest

from app.modules.llm_provider.probe import ProviderProbeResult, probe_provider

# ── 共用常量 / helpers（照 test_fetch_models.py 范式）──────────────────────────

# 公网示例 IP（非私网段），让 SSRF 检查放行（避免真实 DNS）。
_PUBLIC_GAI = [(2, 1, 6, "", ("93.184.216.34", 0))]
_MODELS_BODY = {"data": [{"id": "claude-sonnet-4", "owned_by": "anthropic"}]}


def _make_response(status_code: int, body: Any = None) -> MagicMock:
    """构造 httpx.Response 替身：``.status_code`` + ``.json()``（探测默认实现只读 status_code）。"""
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body if body is not None else _MODELS_BODY
    return resp


def _wire_async_client(
    mock_client_cls: MagicMock,
    *,
    get_return_value: Any = None,
    get_side_effect: Any = None,
) -> AsyncMock:
    """配置 ``patch(...probe.httpx.AsyncClient)`` 的类 mock 支持
    ``async with httpx.AsyncClient(...) as client: await client.get(...)``。

    返回内部 client mock，便于 ``client.get.assert_called_with`` 断言鉴权头。
    """
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


# ════════════════════════════════════════════════════════════════════════════
# 1. 有效凭证 / 鉴权头构造
# ════════════════════════════════════════════════════════════════════════════


class TestProbeValidCredentials:
    """acceptance：有效凭证 → ok=True（200 响应）。"""

    @pytest.mark.asyncio
    async def test_valid_credentials_returns_ok(self) -> None:
        """200 → ProviderProbeResult(ok=True, error=None)。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-valid-secret-key-0001",
            )

        assert isinstance(result, ProviderProbeResult)
        assert result.ok is True
        assert result.error is None

    @pytest.mark.asyncio
    async def test_default_auth_field_uses_bearer_header(self) -> None:
        """auth_field 默认 ANTHROPIC_AUTH_TOKEN → Authorization: Bearer <key>。"""
        plaintext = "sk-bearer-secret-key-0099"
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200))

            await probe_provider(
                base_url="https://api.anthropic.com",
                api_key=plaintext,
            )

        assert client.get.await_count == 1
        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == f"Bearer {plaintext}"
        assert "x-api-key" not in headers

    @pytest.mark.asyncio
    async def test_anthropic_api_key_field_uses_x_api_key_header(self) -> None:
        """auth_field=ANTHROPIC_API_KEY → x-api-key + anthropic-version（FR-03）。"""
        plaintext = "sk-xapikey-secretkey-4242"
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200))

            await probe_provider(
                base_url="https://api.anthropic.com",
                api_key=plaintext,
                auth_field="ANTHROPIC_API_KEY",
            )

        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("x-api-key") == plaintext
        assert headers.get("anthropic-version") == "2023-06-01"
        assert "Authorization" not in headers


# ════════════════════════════════════════════════════════════════════════════
# 2. 无效 key（401/403）→ ok=False + 鉴权失败原因
# ════════════════════════════════════════════════════════════════════════════


class TestProbeAuthFailure:
    """acceptance：无效 key → ok=False + 原因（401/403 立即终止）。"""

    @pytest.mark.asyncio
    async def test_401_returns_not_ok_with_reason(self) -> None:
        """上游 401 → ok=False + 鉴权失败原因。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(401))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-wrong-key-12345",
            )

        assert result.ok is False
        assert result.error is not None
        assert "401" in result.error

    @pytest.mark.asyncio
    async def test_403_returns_not_ok_with_reason(self) -> None:
        """上游 403 → ok=False + 鉴权失败原因（与 401 同类）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(403))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-forbidden-key-0001",
            )

        assert result.ok is False
        assert result.error is not None
        assert "403" in result.error

    @pytest.mark.asyncio
    async def test_401_does_not_try_further_candidates(self) -> None:
        """401 立即终止，不再试下一候选（再试也是 401/403，无意义）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            # 只被调一次（首个候选即 401 终止）
            _wire_async_client(mock_cls, get_return_value=_make_response(401))

            result = await probe_provider(
                # 带 /anthropic 子路径 → 有 2 个候选，但 401 应在首个候选终止
                base_url="https://relay.example.com/anthropic",
                api_key="sk-multi-candidate-key",
            )

        assert result.ok is False
        # 仅首个候选被请求（401 后立即返回，不继续候选 2）
        assert mock_cls.return_value.__aenter__.return_value.get.await_count == 1


# ════════════════════════════════════════════════════════════════════════════
# 3. 网络错 / 超时 → ok=False（不抛异常，D-003）
# ════════════════════════════════════════════════════════════════════════════


class TestProbeNetworkFailure:
    """acceptance：网络错误不抛异常返回 ok=False。"""

    @pytest.mark.asyncio
    async def test_connect_error_returns_not_ok(self) -> None:
        """httpx.ConnectError → ok=False（不抛异常，归类失败原因）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ConnectError("refused"))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-connerr-key-0007",
            )

        assert result.ok is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_read_timeout_returns_not_ok(self) -> None:
        """httpx.ReadTimeout → ok=False（不抛异常；超时归类失败原因）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ReadTimeout("read timed out"))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-timeout-key-0008",
            )

        assert result.ok is False
        assert result.error is not None

    @pytest.mark.asyncio
    async def test_no_exception_raised_on_network_error(self) -> None:
        """D-003 守护：网络错绝不在调用方抛异常（保留原供应商不破坏运行中会话）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ConnectError("network down"))

            # 不 pytest.raises —— 函数必须正常返回 ProviderProbeResult
            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-no-raise-key-0009",
            )

        assert isinstance(result, ProviderProbeResult)
        assert result.ok is False


# ════════════════════════════════════════════════════════════════════════════
# 4. 候选兜底 + 全候选失败
# ════════════════════════════════════════════════════════════════════════════


class TestProbeCandidateFallback:
    """候选 URL 顺序尝试：404 → 剥离子路径再试；全候选失败归类原因。"""

    @pytest.mark.asyncio
    async def test_first_candidate_404_second_succeeds(self) -> None:
        """首个候选 404 → 剥离 ``/anthropic`` 子路径再试 200 → ok=True。

        base_url=``https://relay.example.com/anthropic``：
        - 候选1 ``/anthropic/v1/models`` → 404
        - 候选2 ``/v1/models``（剥离 /anthropic）→ 200
        """
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls,
                get_side_effect=[
                    _make_response(404),
                    _make_response(200),
                ],
            )

            result = await probe_provider(
                base_url="https://relay.example.com/anthropic",
                api_key="sk-relay-secretkey-9999",
            )

        assert result.ok is True
        assert client.get.await_count == 2
        first_url = client.get.await_args_list[0].args[0]
        second_url = client.get.await_args_list[1].args[0]
        assert first_url == "https://relay.example.com/anthropic/v1/models"
        assert second_url == "https://relay.example.com/v1/models"

    @pytest.mark.asyncio
    async def test_all_candidates_500_returns_not_ok(self) -> None:
        """全候选 5xx → ok=False + 最后一次 HTTP 状态原因。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(500))

            result = await probe_provider(
                base_url="https://api.anthropic.com",
                api_key="sk-server-error-key-01",
            )

        assert result.ok is False
        assert result.error is not None
        assert "500" in result.error


# ════════════════════════════════════════════════════════════════════════════
# 5. SSRF 防护（断言「拒绝」，照 test_fetch_models 范式）
# ════════════════════════════════════════════════════════════════════════════


# 每个 case：(标签, getaddrinfo sockaddr) → 必须返回 ok=False + SSRF 原因。
_SSRF_PRIVATE_CASES = [
    ("ipv4_10", [(2, 1, 6, "", ("10.0.0.5", 0))]),
    ("ipv4_127", [(2, 1, 6, "", ("127.0.0.1", 0))]),
    ("ipv4_192", [(2, 1, 6, "", ("192.168.1.1", 0))]),
    ("ipv4_169_254", [(2, 1, 6, "", ("169.254.169.254", 0))]),  # 云元数据端点
    ("ipv6_loopback", [(10, 1, 6, "", ("::1", 0, 0, 0))]),
    ("ipv6_ula_fc00", [(10, 1, 6, "", ("fc00::1", 0, 0, 0))]),  # fc00::/7 ULA
]


class TestProbeSsrf:
    """SSRF 防护：私网/保留 IPv4+IPv6 全部拒（复用 fetch_models 范式 / D-006）。

    断言「ok=False」+ SSRF 原因（不抛异常，D-003 归类失败）。
    """

    @pytest.mark.parametrize(
        "case_name, gai_value",
        _SSRF_PRIVATE_CASES,
        ids=[c[0] for c in _SSRF_PRIVATE_CASES],
    )
    @pytest.mark.asyncio
    async def test_private_ip_rejected(self, case_name: str, gai_value: list[Any]) -> None:
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = gai_value
            # 即便 SSRF 漏判，httpx 也不打真实网络（防御性兜底）。
            _wire_async_client(mock_cls, get_return_value=_make_response(200))

            result = await probe_provider(
                base_url=f"https://{case_name}.test.internal",
                api_key="sk-ssrf-key-00000",
            )

        assert result.ok is False
        assert result.error is not None
        assert "安全策略" in result.error or "SSRF" in result.error
        # httpx 永不被调（SSRF 在请求前拦截）
        assert mock_cls.return_value.__aenter__.return_value.get.await_count == 0

    @pytest.mark.asyncio
    async def test_dns_resolve_failure_rejected(self) -> None:
        """DNS 解析失败（gaierror）同样拒（安全侧，不 fallback）。"""
        import socket

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.side_effect = socket.gaierror("name or service not known")
            _wire_async_client(mock_cls, get_return_value=_make_response(200))

            result = await probe_provider(
                base_url="https://nonexistent.invalid",
                api_key="sk-dnsfail-key-0000",
            )

        assert result.ok is False
        assert result.error is not None
