"""task-12（2026-07-27-llm-provider-fetch-models）后端测试。

覆盖 design §7 测试策略 / §5.1 错误分类：
- fetch-models 7 类场景：正常 / 401→AUTH_FAILED / 404 候选兜底 / 全候选失败→ALL_FAILED /
  超时→TIMEOUT / SSRF 拒私网 IPv4+IPv6 / 双形态（provider_id 解密 + base_url+key 直传）；
- migration 单头 ``202607270900`` + upgrade/downgrade 可回滚（防多 head 分叉）；
- context.py ``_inject_provider_config`` 透传 ``settings_config``（task-04 / D-009）；
- task-12 gap fix：``service.create/update`` 持久化 ``settings_config``（task-01 字段曾漏传构造调用）。

mock httpx 方式（constraints：不打真实网络）：
- 项目无 ``respx`` / ``httpx_mock`` 依赖（pyproject dev 仅 httpx + pytest-*），
  故用 ``unittest.mock.patch`` + ``AsyncMock`` 模拟 ``httpx.AsyncClient`` 的
  ``async with ... as client`` + ``await client.get(...)`` 形态（design §7）。
- SSRF 路径照 ``tool_gateway/tests/test_policy.py:127-154`` 范式 patch
  ``app.modules.tool_gateway.tool_policy.socket.getaddrinfo``；所有 fetch 测试均
  patch getaddrinfo 返回公网 IP，避免真实 DNS（hermetic）。

SQLite + aiosqlite（backend 测试基线），断言不绑死 PG 专有函数
（memory ``backend-test-sqlite-vs-pg``）；时间断言用 test 内 ``datetime.now()``
（memory ``test-module-level-time-constant-pitfall``）。
"""

from __future__ import annotations

import importlib
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.llm_provider.model import LlmProvider
from app.modules.llm_provider.schema import (
    FetchModelsRequest,
    LlmProviderCreate,
    LlmProviderUpdate,
)
from app.modules.llm_provider.service import (
    LlmProviderAuthFailed,
    LlmProviderModelsAllFailed,
    LlmProviderModelsTimeout,
    LlmProviderModelsUnsupported,
    LlmProviderService,
    LlmProviderSsrfBlocked,
)

# ── 共用常量 / helpers ──────────────────────────────────────────────────────

# 公网示例 IP（非私网段），用于 fetch 测试让 SSRF 检查放行（避免真实 DNS）。
_PUBLIC_GAI = [(2, 1, 6, "", ("93.184.216.34", 0))]
_FETCH_MODELS_BODY = {
    "data": [
        {"id": "claude-sonnet-4", "owned_by": "anthropic"},
        {"id": "claude-opus-4", "owned_by": None},
    ]
}


def _make_response(status_code: int, body: Any = None) -> MagicMock:
    """构造 httpx.Response 替身：``.status_code`` + ``.json()``。"""
    resp = MagicMock()
    resp.status_code = status_code
    # _parse_models_response 调 resp.json()（同步）；默认给合法 OpenAI 兼容体。
    resp.json.return_value = body if body is not None else _FETCH_MODELS_BODY
    return resp


def _wire_async_client(
    mock_client_cls: MagicMock,
    *,
    get_return_value: Any = None,
    get_side_effect: Any = None,
) -> AsyncMock:
    """配置 ``patch(...httpx.AsyncClient)`` 的类 mock 支持
    ``async with httpx.AsyncClient(...) as client: await client.get(...)``。

    ``httpx.AsyncClient(timeout=...)`` 返回 ``mock_client_cls.return_value``；
    将其设为 AsyncMock，使 ``__aenter__`` / ``__aexit__`` 可 await，且
    ``__aenter__`` 返回内部 ``client``（同样 AsyncMock，``.get`` 可配置）。

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


async def _create_user(session: AsyncSession, *, label: str = "fm") -> uuid.UUID:
    """插入 User 行（FK 兼容）；照 test_llm_provider 范式。"""
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"fm-{uid.hex[:8]}-{label}@example.com",
            username=f"fm-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"FM Test {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


# ════════════════════════════════════════════════════════════════════════════
# 1. fetch-models 各错误分支（mock httpx，不打真实网络）
# ════════════════════════════════════════════════════════════════════════════


class TestFetchModelsHttpxMocked:
    """mock httpx 覆盖正常 / 401 / 候选兜底 / 全失败 / 超时 / 解析错（design §5.1）。"""

    @pytest.mark.asyncio
    async def test_normal_fetch_returns_models(self, db_session: AsyncSession) -> None:
        """200 → 解析 data 列表返回 [{id, owned_by}]（owned_by 缺失归 None）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY))

            svc = LlmProviderService(db_session)
            resp = await svc.fetch_models(
                uuid.uuid4(),
                FetchModelsRequest(
                    base_url="https://api.anthropic.com",
                    api_key="sk-test-normalk-e-y0123",
                ),
            )

        ids = [m.id for m in resp.models]
        assert ids == ["claude-sonnet-4", "claude-opus-4"]
        assert resp.models[0].owned_by == "anthropic"
        assert resp.models[1].owned_by is None  # 上游缺失 owned_by → None

    @pytest.mark.asyncio
    async def test_normal_fetch_uses_bearer_header_for_auth_token(
        self, db_session: AsyncSession
    ) -> None:
        """auth_field=ANTHROPIC_AUTH_TOKEN（默认）→ Authorization: Bearer <key>。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY)
            )

            svc = LlmProviderService(db_session)
            await svc.fetch_models(
                uuid.uuid4(),
                FetchModelsRequest(
                    base_url="https://api.anthropic.com",
                    api_key="sk-bearer-secret-key-99",
                ),
            )

        # client.get(url, headers=...) —— 断言鉴权头
        assert client.get.await_count == 1
        _url, kwargs = client.get.await_args.args[0], client.get.await_args.kwargs
        headers = kwargs.get("headers") or {}
        assert headers.get("Authorization") == "Bearer sk-bearer-secret-key-99"
        assert "x-api-key" not in headers

    @pytest.mark.asyncio
    async def test_normal_fetch_uses_api_key_header_for_anthropic_api_key(
        self, db_session: AsyncSession
    ) -> None:
        """auth_field=ANTHROPIC_API_KEY → x-api-key + anthropic-version。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY)
            )

            svc = LlmProviderService(db_session)
            await svc.fetch_models(
                uuid.uuid4(),
                FetchModelsRequest(
                    base_url="https://api.anthropic.com",
                    api_key="sk-xapikey-secretkey-42",
                    auth_field="ANTHROPIC_API_KEY",
                ),
            )

        assert client.get.await_count == 1
        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("x-api-key") == "sk-xapikey-secretkey-42"
        assert headers.get("anthropic-version") == "2023-06-01"
        assert "Authorization" not in headers

    @pytest.mark.asyncio
    async def test_401_raises_auth_failed(self, db_session: AsyncSession) -> None:
        """上游 401 → LlmProviderAuthFailed（立即终止，不再试候选）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(401))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderAuthFailed) as exc_info:
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-wrong-key-12345",
                    ),
                )

        assert exc_info.value.http_status == 401

    @pytest.mark.asyncio
    async def test_403_also_raises_auth_failed(self, db_session: AsyncSession) -> None:
        """上游 403 → 同样 LlmProviderAuthFailed（design §5.1：401/403 同类）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(403))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderAuthFailed):
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-forbidden-key-0001",
                    ),
                )

    @pytest.mark.asyncio
    async def test_404_candidate_fallback_succeeds(self, db_session: AsyncSession) -> None:
        """首个候选 404 → 剥离 ``/anthropic`` 子路径再试成功（cc-switch 范式）。

        base_url=``https://relay.example.com/anthropic``：
        - 候选1 ``/anthropic/v1/models`` → 404
        - 候选2 ``/v1/models``（剥离 /anthropic）→ 200
        """
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls,
                get_side_effect=[
                    _make_response(404),
                    _make_response(200, _FETCH_MODELS_BODY),
                ],
            )

            svc = LlmProviderService(db_session)
            resp = await svc.fetch_models(
                uuid.uuid4(),
                FetchModelsRequest(
                    base_url="https://relay.example.com/anthropic",
                    api_key="sk-relay-secretkey-9999",
                ),
            )

        # 两次 GET：第一个候选 404，第二个候选 200 命中
        assert client.get.await_count == 2
        first_url = client.get.await_args_list[0].args[0]
        second_url = client.get.await_args_list[1].args[0]
        assert first_url == "https://relay.example.com/anthropic/v1/models"
        assert second_url == "https://relay.example.com/v1/models"
        assert [m.id for m in resp.models] == ["claude-sonnet-4", "claude-opus-4"]

    @pytest.mark.asyncio
    async def test_all_candidates_404_raises_unsupported(self, db_session: AsyncSession) -> None:
        """全部候选终态 404/405 → LlmProviderModelsUnsupported（中转站未开放）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(404))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderModelsUnsupported) as exc_info:
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-unsupported-key-0045",
                    ),
                )

        assert exc_info.value.http_status == 404

    @pytest.mark.asyncio
    async def test_all_candidates_500_raises_all_failed(self, db_session: AsyncSession) -> None:
        """全部候选 5xx（非 404/405）→ LlmProviderModelsAllFailed。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(500))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderModelsAllFailed) as exc_info:
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-server-error-key-01",
                    ),
                )

        assert exc_info.value.http_status == 502

    @pytest.mark.asyncio
    async def test_network_error_on_first_candidate_then_second_succeeds(
        self, db_session: AsyncSession
    ) -> None:
        """第一候选连接错误（httpx.HTTPError 子类）→ continue 下一候选 → 成功。

        覆盖 service ``except httpx.HTTPError: continue`` 分支（与超时区分）。
        """
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls,
                get_side_effect=[
                    httpx.ConnectError("connection refused"),
                    _make_response(200, _FETCH_MODELS_BODY),
                ],
            )

            svc = LlmProviderService(db_session)
            resp = await svc.fetch_models(
                uuid.uuid4(),
                FetchModelsRequest(
                    base_url="https://relay.example.com/anthropic",
                    api_key="sk-neterr-key-0000007",
                ),
            )

        assert client.get.await_count == 2
        assert [m.id for m in resp.models] == ["claude-sonnet-4", "claude-opus-4"]

    @pytest.mark.asyncio
    async def test_timeout_raises_timeout(self, db_session: AsyncSession) -> None:
        """httpx.TimeoutException → LlmProviderModelsTimeout（NFR-03 10s 超时）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_side_effect=httpx.ReadTimeout("read timed out"))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderModelsTimeout) as exc_info:
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-timeout-key-0000008",
                    ),
                )

        assert exc_info.value.http_status == 504

    @pytest.mark.asyncio
    async def test_non_json_body_raises_all_failed(self, db_session: AsyncSession) -> None:
        """200 但 body 非 JSON（resp.json() 抛 ValueError）→ AllFailed（解析错）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            resp_mock = _make_response(200)
            resp_mock.json.side_effect = ValueError("not json")
            _wire_async_client(mock_cls, get_return_value=resp_mock)

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderModelsAllFailed):
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-badjson-key-0000009",
                    ),
                )

    @pytest.mark.asyncio
    async def test_missing_data_list_raises_all_failed(self, db_session: AsyncSession) -> None:
        """200 + 合法 JSON 但缺 ``data`` 列表 → AllFailed（body 结构不符）。"""
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(
                mock_cls, get_return_value=_make_response(200, {"unexpected": "shape"})
            )

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderModelsAllFailed):
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://api.anthropic.com",
                        api_key="sk-nodata-key-0000010",
                    ),
                )


# ════════════════════════════════════════════════════════════════════════════
# 2. SSRF 拒私网 IPv4 + IPv6（断言「拒绝」，照 test_policy.py 范式）
# ════════════════════════════════════════════════════════════════════════════


# 每个 case：(标签, getaddrinfo sockaddr 列表) → 必须抛 LlmProviderSsrfBlocked。
# IPv4 sockaddr = (ip, port)；IPv6 sockaddr = (ip, port, flowinfo, scopeid)；
# assert_public_hostname 只取 sockaddr[0] 做 ip_address 判定，family 不参与判定。
_SSRF_PRIVATE_CASES = [
    # IPv4 私网 / 保留段（design §5.1 / task-03：复用 _PRIVATE_NETWORKS 含 0.0.0.0/8）
    ("ipv4_10", [(2, 1, 6, "", ("10.0.0.5", 0))]),
    ("ipv4_127", [(2, 1, 6, "", ("127.0.0.1", 0))]),
    ("ipv4_192", [(2, 1, 6, "", ("192.168.1.1", 0))]),
    ("ipv4_172_16", [(2, 1, 6, "", ("172.16.5.4", 0))]),
    ("ipv4_169_254", [(2, 1, 6, "", ("169.254.169.254", 0))]),  # 云元数据端点
    ("ipv4_0_0_0_0", [(2, 1, 6, "", ("0.0.0.0", 0))]),  # task-03 关键：字符串前缀漏网项
    # IPv6 私网 / 保留段（task-03 新补 _PRIVATE_NETWORKS_V6）
    ("ipv6_loopback", [(10, 1, 6, "", ("::1", 0, 0, 0))]),
    ("ipv6_ula_fc00", [(10, 1, 6, "", ("fc00::1", 0, 0, 0))]),  # fc00::/7 ULA
    ("ipv6_ula_fd00", [(10, 1, 6, "", ("fd00::1234", 0, 0, 0))]),  # fc00::/7 另一端
    ("ipv6_link_local", [(10, 1, 6, "", ("fe80::1", 0, 0, 0))]),  # fe80::/10
]


class TestFetchModelsSsrf:
    """SSRF 防护：私网/保留 IPv4+IPv6 全部拒（design §5.1 / task-03 / D-006）。

    断言「拒绝」（抛 LlmProviderSsrfBlocked）而非「允许」（constraints）。
    """

    @pytest.mark.parametrize(
        "case_name, gai_value",
        _SSRF_PRIVATE_CASES,
        ids=[c[0] for c in _SSRF_PRIVATE_CASES],
    )
    @pytest.mark.asyncio
    async def test_private_ip_rejected(
        self,
        db_session: AsyncSession,
        case_name: str,
        gai_value: list[Any],
    ) -> None:
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = gai_value
            # 即便 SSRF 漏判，httpx 也不打真实网络（防御性兜底）。
            _wire_async_client(mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderSsrfBlocked) as exc_info:
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url=f"https://{case_name}.test.internal",
                        api_key="sk-ssrf-key-00000",
                    ),
                )

        assert exc_info.value.http_status == 400
        # httpx 永不被调（SSRF 在请求前拦截）
        assert mock_cls.return_value.__aenter__.return_value.get.await_count == 0

    @pytest.mark.asyncio
    async def test_dns_resolve_failure_rejected(self, db_session: AsyncSession) -> None:
        """DNS 解析失败（gaierror）同样拒（安全侧，不 fallback）。"""
        import socket

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.side_effect = socket.gaierror("name or service not known")
            _wire_async_client(mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY))

            svc = LlmProviderService(db_session)
            with pytest.raises(LlmProviderSsrfBlocked):
                await svc.fetch_models(
                    uuid.uuid4(),
                    FetchModelsRequest(
                        base_url="https://nonexistent.invalid",
                        api_key="sk-dnsfail-key-0000",
                    ),
                )


# ════════════════════════════════════════════════════════════════════════════
# 3. 双形态：provider_id（后端解密）+ base_url+api_key 直传（不落库）
# ════════════════════════════════════════════════════════════════════════════


class TestFetchModelsDualForm:
    """双形态凭证解析（D-001）：provider_id 解密形态 + base_url+key 直传形态。"""

    @pytest.mark.asyncio
    async def test_provider_id_form_decrypts_and_fetches(self, db_session: AsyncSession) -> None:
        """编辑态 provider_id：service 查行 + cipher.decrypt 取明文 key 拉模型。"""
        user_id = await _create_user(db_session, label="pid")
        plaintext = "sk-encrypted-secret-key-4321"
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="pid-provider",
                base_url="https://api.anthropic.com",
                api_key=plaintext,
                settings_config={"env": {"FOO": "bar"}, "model": "claude-sonnet-4"},
            ),
        )

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(
                mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY)
            )

            resp = await svc.fetch_models(user_id, FetchModelsRequest(provider_id=row.id))

        assert [m.id for m in resp.models] == ["claude-sonnet-4", "claude-opus-4"]
        # 明文 api_key 永不进响应（NFR-02 / design §8）
        dump = resp.model_dump_json()
        assert plaintext not in dump
        # 鉴权头用的是后端解密出的明文 key（证明 provider_id 形态真解密）
        headers = client.get.await_args.kwargs.get("headers") or {}
        assert headers.get("Authorization") == f"Bearer {plaintext}"

    @pytest.mark.asyncio
    async def test_inline_form_does_not_persist(self, db_session: AsyncSession) -> None:
        """新建态 base_url+api_key 直传：不落库、不留 provider 行（D-001 / NFR-02）。"""
        user_id = await _create_user(db_session, label="inline")
        plaintext = "sk-inline-secretkey-8888"

        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            _wire_async_client(mock_cls, get_return_value=_make_response(200, _FETCH_MODELS_BODY))

            svc = LlmProviderService(db_session)
            resp = await svc.fetch_models(
                user_id,
                FetchModelsRequest(
                    base_url="https://api.anthropic.com",
                    api_key=plaintext,
                ),
            )

        # 响应正常 + 明文不入响应
        assert [m.id for m in resp.models] == ["claude-sonnet-4", "claude-opus-4"]
        assert plaintext not in resp.model_dump_json()
        # 该用户零 provider 行（inline 形态用完即弃，不写库）
        rows = (
            (await db_session.execute(select(LlmProvider).where(LlmProvider.user_id == user_id)))
            .scalars()
            .all()
        )
        assert rows == []

    @pytest.mark.asyncio
    async def test_provider_id_form_without_api_key_raises_auth_failed(
        self, db_session: AsyncSession
    ) -> None:
        """provider 行明文 key 为空 → LlmProviderAuthFailed（_resolve_fetch_credentials 守护）。"""
        user_id = await _create_user(db_session, label="nokey")
        svc = LlmProviderService(db_session)
        # 直接落一个 api_key="" 的 provider（真实加密空明文）
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="empty-key",
                base_url="https://api.anthropic.com",
                api_key="",  # 空明文
            ),
        )

        with pytest.raises(LlmProviderAuthFailed):
            await svc.fetch_models(user_id, FetchModelsRequest(provider_id=row.id))


# ════════════════════════════════════════════════════════════════════════════
# 4. migration 单头 + upgrade/downgrade（防多 head 分叉）
# ════════════════════════════════════════════════════════════════════════════


_BACKEND_ROOT = Path(__file__).resolve().parents[4]  # backend/
_MIGRATION_MODULE = "migrations.versions.202607270900_add_llm_provider_settings_config"
_EXPECTED_HEAD = "202607270900"


class TestSettingsConfigMigration:
    """task-01 migration 单头 ``202607270900`` + upgrade/downgrade 可回滚。

    - ``alembic heads`` 单头（防多 head 分叉，memory ``migration-chain-fragmentation-pattern``）；
    - ``upgrade()`` 真加 ``settings_config`` 列（``sa.JSON()`` 跨 SQLite/PG 方言）；
    - ``downgrade()`` 可回滚不报错。
    """

    def test_alembic_single_head(self) -> None:
        """``alembic heads`` 仅 ``202607270900``（单 head，无分叉）。"""
        from alembic.config import Config
        from alembic.script import ScriptDirectory

        config = Config(str(_BACKEND_ROOT / "alembic.ini"))
        script = ScriptDirectory.from_config(config)
        heads = script.get_heads()
        assert heads == [_EXPECTED_HEAD], (
            f"期望单头 {_EXPECTED_HEAD}，实际 heads={heads}（多 head 分叉）"
        )

    def test_upgrade_adds_settings_config_column(self) -> None:
        """``upgrade()`` 给 ``llm_providers`` 加 ``settings_config`` JSON 列。"""
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy import create_engine, text

        migration = importlib.import_module(_MIGRATION_MODULE)
        engine = create_engine("sqlite://")
        with engine.begin() as conn:
            # 预建无 settings_config 的最小表（模拟迁移前态）
            conn.execute(text("CREATE TABLE llm_providers (id VARCHAR(32) PRIMARY KEY)"))
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                migration.upgrade()
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(llm_providers)"))}

        assert "settings_config" in cols
        assert migration.revision == _EXPECTED_HEAD
        assert migration.down_revision == "202607251600"

    def test_downgrade_removes_settings_config_column(self) -> None:
        """``downgrade()`` 删 ``settings_config`` 列（回滚不报错）。"""
        from alembic.migration import MigrationContext
        from alembic.operations import Operations
        from sqlalchemy import create_engine, text

        migration = importlib.import_module(_MIGRATION_MODULE)
        engine = create_engine("sqlite://")
        with engine.begin() as conn:
            conn.execute(text("CREATE TABLE llm_providers (id VARCHAR(32) PRIMARY KEY)"))
            ctx = MigrationContext.configure(conn)
            with Operations.context(ctx):
                migration.upgrade()
            with Operations.context(ctx):
                migration.downgrade()
            cols = {row[1] for row in conn.execute(text("PRAGMA table_info(llm_providers)"))}

        assert "settings_config" not in cols


# ════════════════════════════════════════════════════════════════════════════
# 5. context.py 透传 settings_config（task-04 / D-009）
# ════════════════════════════════════════════════════════════════════════════


async def _seed_default_provider(
    session: AsyncSession,
    user_id: uuid.UUID,
    *,
    settings_config: dict[str, Any] | None,
) -> LlmProvider:
    """直接 ORM 插入 claude + is_default=True 的 provider（task-04：含 settings_config 透传字段）。

    直插而非 ``service.create``：context.py 透传断言聚焦 ``provider.settings_config``
    列值原样入 ``provider_config``（task-04 契约），应与 CRUD 层解耦。用真实 cipher 加密
    api_key，与 service 落盘格式一致（context.py 会真解密）。
    """
    from app.core.crypto import get_cipher

    cipher = get_cipher()
    ct, key_id = cipher.encrypt("sk-context-secretkey-00")
    row = LlmProvider(
        id=uuid.uuid4(),
        user_id=user_id,
        name="ctx-default",
        agent_kind="claude",
        base_url="https://api.anthropic.com",
        encrypted_api_key=ct,
        key_id=key_id,
        model="claude-sonnet-4",
        auth_field="ANTHROPIC_AUTH_TOKEN",
        is_default=True,
        settings_config=settings_config,  # task-04 透传字段
    )
    session.add(row)
    await session.commit()
    await session.refresh(row)
    return row


async def _seed_lease(session: AsyncSession, user_id: uuid.UUID) -> Any:
    """落 DaemonRuntime + interactive DaemonTaskLease，返回 lease。"""
    from app.modules.daemon.model import DaemonRuntime, DaemonTaskLease

    rt = DaemonRuntime(
        id=uuid.uuid4(),
        user_id=user_id,
        name="ctx-test-daemon",
        provider="claude_code",
        status="online",
        last_heartbeat_at=datetime.now(UTC),
    )
    session.add(rt)
    await session.flush()

    now = datetime.now(UTC)
    lease = DaemonTaskLease(
        id=uuid.uuid4(),
        runtime_id=rt.id,
        agent_run_id=None,
        status="claimed",
        kind="interactive",
        claimed_at=now,
        lease_expires_at=None,
        metadata_={"provider": "claude_code"},  # 经 _normalize_lease_provider → claude
        created_at=now,
        updated_at=now,
    )
    session.add(lease)
    await session.commit()
    await session.refresh(rt)
    await session.refresh(lease)
    return lease


class TestContextSettingsConfigPassthrough:
    """context.py ``_inject_provider_config`` 透传 settings_config（task-04 / D-009）。

    断言 provider_config dict 含 ``settings_config`` 键且值等于 provider 行的
    ``settings_config``（透传不解密不加工）；None 时键值为 None（不省略键）。
    """

    @pytest.mark.asyncio
    async def test_provider_config_includes_settings_config(self, db_session: AsyncSession) -> None:
        from app.modules.daemon.lease.context import _inject_provider_config

        user_id = await _create_user(db_session, label="ctx")
        settings_cfg = {
            "env": {"CLAUDE_CODE_EFFORT_LEVEL": "max"},
            "attribution": {"commit": "", "pr": ""},
        }
        provider = await _seed_default_provider(db_session, user_id, settings_config=settings_cfg)
        lease = await _seed_lease(db_session, user_id)

        payload: dict[str, Any] = {}
        await _inject_provider_config(
            db_session,
            lease,
            dict(lease.metadata_ or {}),
            payload,
            agent_kind_raw="claude_code",
        )

        config = payload.get("provider_config")
        assert config is not None, "未注入 provider_config（默认 provider 应命中）"
        # task-04 核心：settings_config 原样透传
        assert "settings_config" in config
        assert config["settings_config"] == settings_cfg
        assert config["settings_config"] == provider.settings_config
        # 既有 8 字段仍在（含解密出的明文 api_key）
        assert config["agent_kind"] == "claude"
        assert config["api_key"] == "sk-context-secretkey-00"
        assert config["model"] == "claude-sonnet-4"

    @pytest.mark.asyncio
    async def test_provider_config_settings_config_none_kept_as_none(
        self, db_session: AsyncSession
    ) -> None:
        """settings_config=None（task-01 brownfield 老行）→ 键仍在，值为 None（不省略键）。"""
        from app.modules.daemon.lease.context import _inject_provider_config

        user_id = await _create_user(db_session, label="ctx-none")
        await _seed_default_provider(db_session, user_id, settings_config=None)
        lease = await _seed_lease(db_session, user_id)

        payload: dict[str, Any] = {}
        await _inject_provider_config(
            db_session,
            lease,
            dict(lease.metadata_ or {}),
            payload,
            agent_kind_raw="claude_code",
        )

        config = payload.get("provider_config")
        assert config is not None
        # 关键守护：None 不被省略成 absent（daemon 侧 ?.env ?? {} 链路判空依赖键存在）
        assert "settings_config" in config
        assert config["settings_config"] is None


# ════════════════════════════════════════════════════════════════════════════
# 6. service.create/update 持久化 settings_config（task-12 gap fix）
# ════════════════════════════════════════════════════════════════════════════


class TestSettingsConfigPersistence:
    """task-12 gap fix：``settings_config`` 经 create/update 真落库（task-01 字段曾漏传构造调用）。

    task-01 给 model + schema 加了 ``settings_config``，但 ``service.create()`` 的
    ``LlmProvider(...)`` 构造调用漏传该字段 → POST 创建静默丢字段，daemon toEnv/
    settings.json 合成失效（阻断 AC-04/05）。本组直接查库行断言字段持久化（非 None）。

    update 路径走 ``model_dump(exclude_unset=True)`` + 通用 ``setattr`` 循环，
    ``settings_config`` 在 schema 中（line 42）且未被 pop，故天然覆盖 —— 此处一并守护防回归。
    """

    @pytest.mark.asyncio
    async def test_create_persists_settings_config(self, db_session: AsyncSession) -> None:
        """create() 传入 settings_config → 库行 settings_config == 传入值（非 None）。"""
        user_id = await _create_user(db_session, label="sc")
        svc = LlmProviderService(db_session)
        settings_cfg = {
            "env": {"CLAUDE_CODE_EFFORT_LEVEL": "max"},
            "attribution": {"commit": "", "pr": ""},
        }

        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="sc-provider",
                base_url="https://api.anthropic.com",
                api_key="sk-sc-persist-key-0001",
                settings_config=settings_cfg,
            ),
        )

        # 返回对象已带值（非 None）
        assert row.settings_config == settings_cfg
        # 直接查库行（绕过内存对象，确认真落盘非 None）
        fresh = await db_session.get(LlmProvider, row.id)
        assert fresh is not None
        assert fresh.settings_config is not None
        assert fresh.settings_config == settings_cfg

    @pytest.mark.asyncio
    async def test_create_without_settings_config_defaults_none(
        self, db_session: AsyncSession
    ) -> None:
        """create() 不传 settings_config → 库行落 None（schema 默认；不报错不默认成空 dict）。"""
        user_id = await _create_user(db_session, label="scnil")
        svc = LlmProviderService(db_session)

        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="sc-nil-provider",
                base_url="https://api.anthropic.com",
                api_key="sk-sc-nil-key-0002",
            ),
        )

        fresh = await db_session.get(LlmProvider, row.id)
        assert fresh is not None
        assert fresh.settings_config is None

    @pytest.mark.asyncio
    async def test_update_changes_settings_config(self, db_session: AsyncSession) -> None:
        """update(PATCH) 传 settings_config → 库行被改写为新值（setattr 循环覆盖）。"""
        user_id = await _create_user(db_session, label="scup")
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="sc-up-provider",
                base_url="https://api.anthropic.com",
                api_key="sk-sc-up-key-0003",
                settings_config={"env": {"OLD": "1"}},
            ),
        )

        new_cfg = {"env": {"NEW": "2"}, "model": "claude-opus-4"}
        patched = await svc.update(
            row.id,
            user_id,
            LlmProviderUpdate(settings_config=new_cfg),
        )

        assert patched.settings_config == new_cfg
        fresh = await db_session.get(LlmProvider, row.id)
        assert fresh is not None
        assert fresh.settings_config == new_cfg  # 库行真改写
