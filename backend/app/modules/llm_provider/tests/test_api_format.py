"""task-03（change 2026-08-08-llm-provider-openai-format）api_format 双格式测试。

覆盖 task-03 acceptance（FR-01~04 / NFR-02 零回归）：
- ``_build_auth_headers`` 双格式（openai_chat 恒 Bearer；anthropic 按 auth_field，D-002@v1）；
- ``_strip_openai_suffix`` 剥 ``/chat/completions``（FR-02 / D-001@v1，兼容尾斜杠 + 非标 URL 兜底）；
- ``_candidate_urls`` 双格式（openai ``[base/models, base/v1/models]``；anthropic 逐字不变，NFR-02）；
- ``fetch_models`` inline openai 形态（剥路径 + Bearer + 命中 ``/models``）；
- ``probe_provider`` openai 形态（剥路径 + Bearer）；
- create/update/read 透传 api_format（DB，FR-01）；
- anthropic 零回归（默认 api_format=anthropic 时行为逐字不变）。

mock 范式照 test_probe.py / test_fetch_models.py：``getaddrinfo`` 返公网 IP 放行 SSRF +
``httpx.AsyncClient`` 替身（不打真实网络）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.llm_provider.probe import probe_provider
from app.modules.llm_provider.schema import (
    FetchModelsRequest,
    LlmProviderCreate,
    LlmProviderUpdate,
)
from app.modules.llm_provider.service import LlmProviderService

# ── 共用 helpers（照 test_probe.py / test_llm_provider.py 范式）─────────────────

_PUBLIC_GAI = [(2, 1, 6, "", ("93.184.216.34", 0))]
_MODELS_BODY = {"data": [{"id": "zen-model-1", "owned_by": "opencode"}]}


def _make_response(status_code: int, body: Any = None) -> MagicMock:
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


async def _create_user(session: AsyncSession, *, label: str = "") -> uuid.UUID:
    from app.modules.auth.model import User

    uid = uuid.uuid4()
    session.add(
        User(
            id=uid,
            email=f"apif-{uid.hex[:8]}-{label}@example.com",
            username=f"apif-{uid.hex[:8]}",
            password_hash="irrelevant",
            display_name=f"ApiFormat {label}",
            status="active",
        )
    )
    await session.commit()
    return uid


# ════════════════════════════════════════════════════════════════════════════
# 1. _build_auth_headers 双格式（D-002@v1 / FR-03）
# ════════════════════════════════════════════════════════════════════════════


class TestBuildAuthHeaders:
    """openai_chat 恒 Bearer；anthropic 按 auth_field（D-002@v1）。"""

    def test_openai_chat_always_bearer(self) -> None:
        h = LlmProviderService._build_auth_headers("sk-x", "ANTHROPIC_API_KEY", "openai_chat")
        assert h == {"Authorization": "Bearer sk-x"}

    def test_openai_chat_ignores_auth_field(self) -> None:
        """openai 格式忽略 auth_field：即使传 ANTHROPIC_API_KEY 仍是纯 Bearer。"""
        h = LlmProviderService._build_auth_headers("sk-x", "ANTHROPIC_AUTH_TOKEN", "openai_chat")
        assert h == {"Authorization": "Bearer sk-x"}
        assert "x-api-key" not in h

    def test_anthropic_auth_token_bearer(self) -> None:
        h = LlmProviderService._build_auth_headers("sk-x", "ANTHROPIC_AUTH_TOKEN", "anthropic")
        assert h == {"Authorization": "Bearer sk-x"}

    def test_anthropic_api_key_x_api_key(self) -> None:
        h = LlmProviderService._build_auth_headers("sk-x", "ANTHROPIC_API_KEY", "anthropic")
        assert h == {"x-api-key": "sk-x", "anthropic-version": "2023-06-01"}
        assert "Authorization" not in h

    def test_default_api_format_is_anthropic(self) -> None:
        """不传 api_format → 默认 anthropic（NFR-02 零回归）。"""
        assert LlmProviderService._build_auth_headers("sk-x", "ANTHROPIC_API_KEY") == {
            "x-api-key": "sk-x",
            "anthropic-version": "2023-06-01",
        }


# ════════════════════════════════════════════════════════════════════════════
# 2. _strip_openai_suffix（FR-02 / D-001@v1）
# ════════════════════════════════════════════════════════════════════════════


class TestStripOpenaiSuffix:
    @pytest.mark.parametrize(
        "url, expected",
        [
            ("https://opencode.ai/zen/v1/chat/completions", "https://opencode.ai/zen/v1"),
            ("https://opencode.ai/zen/v1/chat/completions/", "https://opencode.ai/zen/v1"),
            ("https://x.example/v1/chat/completions//", "https://x.example/v1"),
            ("https://x.example/v1", "https://x.example/v1"),  # 无后缀原样返回（R-06 兜底）
            ("https://x.example", "https://x.example"),
            ("https://x.example/models", "https://x.example/models"),  # 非标尾原样
        ],
    )
    def test_strip(self, url: str, expected: str) -> None:
        assert LlmProviderService._strip_openai_suffix(url) == expected


# ════════════════════════════════════════════════════════════════════════════
# 3. _candidate_urls 双格式（FR-04 / NFR-02）
# ════════════════════════════════════════════════════════════════════════════


class TestCandidateUrls:
    def test_openai_full_url_strips_then_models(self) -> None:
        """完整 chat URL → 剥 /chat/completions → [base/models, base/v1/models]。"""
        urls = LlmProviderService._candidate_urls(
            "https://opencode.ai/zen/v1/chat/completions", "openai_chat"
        )
        assert urls[0] == "https://opencode.ai/zen/v1/models"
        assert urls[1] == "https://opencode.ai/zen/v1/v1/models"

    def test_openai_base_without_v1(self) -> None:
        """base 不含 /v1 → [base/models, base/v1/models]（兼容 base 是否含 /v1）。"""
        urls = LlmProviderService._candidate_urls("https://x.example", "openai_chat")
        assert "https://x.example/models" in urls
        assert "https://x.example/v1/models" in urls

    def test_anthropic_default_unchanged_regression(self) -> None:
        """NFR-02：anthropic（默认）候选 URL 与改动前逐字一致。"""
        urls = LlmProviderService._candidate_urls("https://api.anthropic.com")
        assert urls == ["https://api.anthropic.com/v1/models"]

    def test_anthropic_strip_subpath_regression(self) -> None:
        """NFR-02：anthropic 剥 /anthropic 子路径双候选不变。"""
        urls = LlmProviderService._candidate_urls("https://relay.example.com/anthropic")
        assert urls == [
            "https://relay.example.com/anthropic/v1/models",
            "https://relay.example.com/v1/models",
        ]

    def test_no_api_format_defaults_anthropic(self) -> None:
        """不传 api_format → anthropic 行为（NFR-02）。"""
        assert LlmProviderService._candidate_urls("https://api.anthropic.com") == [
            "https://api.anthropic.com/v1/models"
        ]


# ════════════════════════════════════════════════════════════════════════════
# 4. fetch_models inline openai 形态（FR-02/03/04 端到端，mock httpx）
# ════════════════════════════════════════════════════════════════════════════


class TestFetchModelsOpenAiInline:
    @pytest.mark.asyncio
    async def test_openai_inline_strips_url_and_uses_bearer(self, db_session: AsyncSession) -> None:
        """inline 形态 openai_chat：完整 chat URL → 命中 base/models + Bearer 头。"""
        svc = LlmProviderService(db_session)
        req = FetchModelsRequest(
            base_url="https://opencode.ai/zen/v1/chat/completions",
            api_key="sk-test-openai-key",
            api_format="openai_chat",
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200))

            resp = await svc.fetch_models(uuid.uuid4(), req)

        first_url = client.get.await_args_list[0].args[0]
        headers = client.get.await_args_list[0].kwargs.get("headers") or {}
        assert first_url == "https://opencode.ai/zen/v1/models"
        assert headers.get("Authorization") == "Bearer sk-test-openai-key"
        assert "x-api-key" not in headers
        assert [m.id for m in resp.models] == ["zen-model-1"]

    @pytest.mark.asyncio
    async def test_inline_default_api_format_is_anthropic(self, db_session: AsyncSession) -> None:
        """NFR-02：inline 形态不传 api_format → anthropic 走 /v1/models + auth_field 头。"""
        svc = LlmProviderService(db_session)
        req = FetchModelsRequest(
            base_url="https://api.anthropic.com",
            api_key="sk-anthropic-key",
        )
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.service.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200))

            await svc.fetch_models(uuid.uuid4(), req)

        first_url = client.get.await_args_list[0].args[0]
        headers = client.get.await_args_list[0].kwargs.get("headers") or {}
        assert first_url == "https://api.anthropic.com/v1/models"
        assert headers.get("Authorization") == "Bearer sk-anthropic-key"


# ════════════════════════════════════════════════════════════════════════════
# 5. probe_provider openai 形态（FR-03/04，mock httpx）
# ════════════════════════════════════════════════════════════════════════════


class TestProbeOpenAi:
    @pytest.mark.asyncio
    async def test_openai_probe_strips_url_and_uses_bearer(self) -> None:
        with (
            patch("app.modules.tool_gateway.tool_policy.socket.getaddrinfo") as mock_gai,
            patch("app.modules.llm_provider.probe.httpx.AsyncClient") as mock_cls,
        ):
            mock_gai.return_value = _PUBLIC_GAI
            client = _wire_async_client(mock_cls, get_return_value=_make_response(200))

            result = await probe_provider(
                base_url="https://opencode.ai/zen/v1/chat/completions",
                api_key="sk-probe-openai",
                api_format="openai_chat",
            )

        assert result.ok is True
        first_url = client.get.await_args_list[0].args[0]
        headers = client.get.await_args_list[0].kwargs.get("headers") or {}
        assert first_url == "https://opencode.ai/zen/v1/models"
        assert headers.get("Authorization") == "Bearer sk-probe-openai"


# ════════════════════════════════════════════════════════════════════════════
# 6. create/update/read 透传 api_format（DB，FR-01）
# ════════════════════════════════════════════════════════════════════════════


class TestApiFormatPassthrough:
    @pytest.mark.asyncio
    async def test_create_openai_persists_and_reads_back(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="a")
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="opencode-zen",
                agent_kind="claude",
                api_key="sk-create-openai-1234",
                base_url="https://opencode.ai/zen/v1/chat/completions",
                model="zen-1",
                api_format="openai_chat",
            ),
        )
        assert row.api_format == "openai_chat"
        read = svc._to_read(row)
        assert read.api_format == "openai_chat"

    @pytest.mark.asyncio
    async def test_create_default_api_format_is_anthropic(self, db_session: AsyncSession) -> None:
        """NFR-02：不传 api_format → 默认 anthropic 落库。"""
        user_id = await _create_user(db_session, label="b")
        svc = LlmProviderService(db_session)
        row = await svc.create(
            user_id,
            LlmProviderCreate(
                name="anthropic-default",
                agent_kind="claude",
                api_key="sk-create-anthropic-1234",
                base_url="https://api.anthropic.com",
            ),
        )
        assert row.api_format == "anthropic"

    @pytest.mark.asyncio
    async def test_update_changes_api_format(self, db_session: AsyncSession) -> None:
        user_id = await _create_user(db_session, label="c")
        svc = LlmProviderService(db_session)
        created = await svc.create(
            user_id,
            LlmProviderCreate(
                name="to-switch",
                agent_kind="claude",
                api_key="sk-update-openai-1234",
                base_url="https://api.anthropic.com",
            ),
        )
        assert created.api_format == "anthropic"

        updated = await svc.update(
            created.id,
            user_id,
            LlmProviderUpdate(api_format="openai_chat"),
        )
        assert updated.api_format == "openai_chat"
