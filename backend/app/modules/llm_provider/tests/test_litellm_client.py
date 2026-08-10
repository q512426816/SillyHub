"""task-09（change 2026-08-08-llm-provider-openai-format）litellm_client 单测。

覆盖 task-09 acceptance（FR-06 / R-09 best-effort / R-03 model_name 全局唯一 / R-02 key 脱敏）：
- ``litellm_model_name(user_id, provider_id)`` = ``f"usr-{user_id}-{provider_id}"``（R-03）；
- ``register`` 成功（200/201）→ True + POST /model/new body 含 model_name / api_base(剥 chat/completions) /
  api_key(明文，仅请求体) / provider=openai + Authorization Bearer master_key；
- ``register`` 幂等（409/400 "Already present"）→ True；
- ``register`` 失败（500）→ False（不抛，R-09）；
- ``register`` 网络异常 → False（不抛，R-09）；
- ``unregister`` 成功 / 不存在(404) / 异常 → 静默 None（幂等 best-effort）；
- 明文 api_key 永不进日志（mock log.warning 断言 kwargs 不含明文 key，R-02/NFR-01）。

mock httpx.AsyncClient（不打真实 LiteLLM，spike-litellm-routing 未跑前纯单测验证契约）。
"""

from __future__ import annotations

import uuid
from typing import Any
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.modules.llm_provider.litellm_client import (
    litellm_model_name,
    register,
    unregister,
)

# ── 共用 helpers ────────────────────────────────────────────────────────────

_UID = uuid.UUID("11111111-1111-1111-1111-111111111111")
_PID = uuid.UUID("22222222-2222-2222-2222-222222222222")
_PLAIN_KEY = "sk-plain-openai-key-1234567890"
_MASTER_KEY = "sk-litellm-master-test"


def _make_provider(
    *,
    api_format: str = "openai_chat",
    base_url: str = "https://opencode.ai/zen/v1/chat/completions",
    model: str | None = "zen-1",
) -> MagicMock:
    """构造 LlmProvider-row-like mock（含 register 需要的字段）。"""
    p = MagicMock()
    p.id = _PID
    p.user_id = _UID
    p.api_format = api_format
    p.base_url = base_url
    p.model = model
    p.encrypted_api_key = b"cipher-text"
    p.key_id = "v1"
    return p


def _make_cipher() -> MagicMock:
    cipher = MagicMock()
    cipher.decrypt.return_value = _PLAIN_KEY
    return cipher


def _make_response(status_code: int, body: Any = None) -> MagicMock:
    resp = MagicMock()
    resp.status_code = status_code
    resp.json.return_value = body or {}
    return resp


def _wire_post_client(
    mock_cls: MagicMock,
    *,
    status: int = 200,
    exc: BaseException | None = None,
) -> AsyncMock:
    """mock httpx.AsyncClient 的 async-context-manager + post。"""
    client = AsyncMock()
    if exc is not None:
        client.post.side_effect = exc
    else:
        client.post.return_value = _make_response(status)
    ctx = AsyncMock()
    ctx.__aenter__.return_value = client
    ctx.__aexit__.return_value = None
    mock_cls.return_value = ctx
    return client


@pytest.fixture(autouse=True)
def _settings(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    """统一注入 LiteLLM settings（litellm_base_url + master_key），不读真 env。"""
    s = MagicMock()
    s.litellm_base_url = "http://litellm:4000"
    s.litellm_master_key = _MASTER_KEY
    monkeypatch.setattr("app.modules.llm_provider.litellm_client.get_settings", lambda: s)
    return s


# ════════════════════════════════════════════════════════════════════════════
# 1. litellm_model_name 命名约定（R-03）
# ════════════════════════════════════════════════════════════════════════════


class TestLitellmModelName:
    def test_name_format(self) -> None:
        assert litellm_model_name(_UID, _PID) == f"usr-{_UID}-{_PID}"

    def test_name_global_unique_per_user_provider(self) -> None:
        """不同 user/provider 组合产不同 model_name（R-03 多用户上游路由隔离）。"""
        uid2 = uuid.UUID("33333333-3333-3333-3333-333333333333")
        assert litellm_model_name(_UID, _PID) != litellm_model_name(uid2, _PID)
        assert litellm_model_name(_UID, _PID) != litellm_model_name(_UID, uid2)


# ════════════════════════════════════════════════════════════════════════════
# 2. register（POST /model/new，幂等 best-effort）
# ════════════════════════════════════════════════════════════════════════════


class TestRegister:
    @pytest.mark.asyncio
    async def test_register_success_200_body_and_header(self) -> None:
        """200 → True；POST /model/new body 含 model_name + api_base(剥) + api_key + model(openai/<model> 前缀)；
        **不含 provider 字段**（spike 第 2 项实测：纯名+provider 字段导致 router upsert 失败）；Authorization Bearer master_key。"""
        provider = _make_provider()
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_post_client(mock_cls, status=200)
            result = await register(provider, user_id=_UID, cipher=_make_cipher())

        assert result is True
        call = client.post.await_args
        assert call.args[0] == "http://litellm:4000/model/new"
        body = call.kwargs["json"]
        assert body["model_name"] == f"usr-{_UID}-{_PID}"
        params = body["litellm_params"]
        # api_base 剥 /chat/completions（复用 _strip_openai_suffix）
        assert params["api_base"] == "https://opencode.ai/zen/v1"
        assert params["api_key"] == _PLAIN_KEY  # 明文仅请求体
        # spike 第 2 项实测：model 必须 openai/<model> 前缀（不带 provider 字段，靠前缀路由）
        assert params["model"] == "openai/zen-1"
        assert "provider" not in params  # provider 字段会导致 upsert 失败 deployment 被 drop
        # task-12 gap-A 二次诊断定稿（2026-08-10 实测）：litellm 1.95.0 对 openai 上游默认走 Responses
        # API（调上游 /responses 返 object="response"），openai adapter 解析失败。原 use_responses_api
        # 字段在 1.95.0 源码不存在（无操作）。真正生效的是顶层 model_info.mode=chat 强制 Chat Completions。
        assert "use_responses_api" not in params  # 1.95.0 无此字段，不写
        assert body["model_info"]["mode"] == "chat"
        headers = call.kwargs["headers"]
        assert headers["Authorization"] == f"Bearer {_MASTER_KEY}"

    @pytest.mark.asyncio
    async def test_register_success_201(self) -> None:
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            _wire_post_client(mock_cls, status=201)
            result = await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        assert result is True

    @pytest.mark.asyncio
    async def test_register_idempotent_409(self) -> None:
        """409（已存在）→ True（幂等，可重试 set-default）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            _wire_post_client(mock_cls, status=409)
            result = await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        assert result is True

    @pytest.mark.asyncio
    async def test_register_idempotent_400_already_present(self) -> None:
        """400 "Already present" → True（LiteLLM 重复注册常见返回，幂等视成功）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            _wire_post_client(mock_cls, status=400)
            result = await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        assert result is True

    @pytest.mark.asyncio
    async def test_register_failed_500_returns_false_no_raise(self) -> None:
        """500 → False（R-09 best-effort，不抛）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            _wire_post_client(mock_cls, status=500)
            result = await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        assert result is False

    @pytest.mark.asyncio
    async def test_register_network_error_returns_false_no_raise(self) -> None:
        """网络异常 → False（R-09 不抛，set_default 主流程不被阻塞）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            _wire_post_client(mock_cls, exc=ConnectionError("litellm down"))
            result = await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        assert result is False

    @pytest.mark.asyncio
    async def test_register_model_none_defaults_prefixed(self) -> None:
        """provider.model=None → litellm_params.model 兜底 "openai/gpt-3.5-turbo"（带前缀，防 LiteLLM upsert 失败）。"""
        provider = _make_provider(model=None)
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_post_client(mock_cls, status=200)
            await register(provider, user_id=_UID, cipher=_make_cipher())
        body = client.post.await_args.kwargs["json"]
        assert body["litellm_params"]["model"] == "openai/gpt-3.5-turbo"

    @pytest.mark.asyncio
    async def test_register_model_already_prefixed_not_doubled(self) -> None:
        """provider.model 已带 ``openai/`` 前缀 → 不重复加（防御未来扩展，如 model 含 / 的自定义 provider）。"""
        provider = _make_provider(model="openai/zen-1")
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_post_client(mock_cls, status=200)
            await register(provider, user_id=_UID, cipher=_make_cipher())
        body = client.post.await_args.kwargs["json"]
        assert body["litellm_params"]["model"] == "openai/zen-1"

    @pytest.mark.asyncio
    async def test_register_failure_log_excludes_plaintext_key(self) -> None:
        """R-02/NFR-01：失败路径 log.warning 调用参数不含明文 api_key。"""
        with (
            patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls,
            patch("app.modules.llm_provider.litellm_client.log") as mock_log,
        ):
            _wire_post_client(mock_cls, status=500)
            await register(_make_provider(), user_id=_UID, cipher=_make_cipher())
        mock_log.warning.assert_called_once()
        for call in mock_log.warning.call_args_list:
            blob = str(call.args) + str(call.kwargs)
            assert _PLAIN_KEY not in blob, f"明文 api_key 泄漏进日志: {blob}"


# ════════════════════════════════════════════════════════════════════════════
# 3. unregister（POST /model/delete，幂等 best-effort 静默）
# ════════════════════════════════════════════════════════════════════════════


def _wire_client_with_info(
    mock_cls: MagicMock,
    *,
    info_data: list[dict] | None = None,
    info_status: int = 200,
    info_exc: BaseException | None = None,
    delete_exc: BaseException | None = None,
) -> AsyncMock:
    """mock httpx.AsyncClient 的 GET /model/info + POST /model/delete。

    task-09 返工（spike-litellm-routing 实测）后 unregister 是双调用：先 GET /model/info
    找 model_id，再逐个 POST /model/delete {id: model_id}。本 helper 同时 wire get + post。
    """
    client = AsyncMock()
    if info_exc is not None:
        client.get.side_effect = info_exc
    else:
        info_resp = MagicMock()
        info_resp.status_code = info_status
        info_resp.json.return_value = {"data": info_data or []}
        client.get.return_value = info_resp
    if delete_exc is not None:
        client.post.side_effect = delete_exc
    else:
        del_resp = MagicMock()
        del_resp.status_code = 200
        client.post.return_value = del_resp
    ctx = AsyncMock()
    ctx.__aenter__.return_value = client
    ctx.__aexit__.return_value = None
    mock_cls.return_value = ctx
    return client


class TestUnregister:
    @pytest.mark.asyncio
    async def test_unregister_get_info_then_delete_by_model_id(self) -> None:
        """GET /model/info 返 2 个同 model_name 的 model_id → 逐个 POST /model/delete {id: model_id}。

        spike-litellm-routing 实测（2026-08-09）：delete 的 id 期望 **model_id（uuid）** 非 model_name
        （传 model_name 返 400 not found）；重复 register 累积多 deployment，unregister 需删所有匹配。
        """
        model_name = f"usr-{_UID}-{_PID}"
        info_data = [
            {"model_name": model_name, "model_info": {"id": "mid-aaa"}},
            {"model_name": model_name, "model_info": {"id": "mid-bbb"}},
            {"model_name": "usr-other", "model_info": {"id": "mid-ccc"}},  # 不匹配，不删
        ]
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_client_with_info(mock_cls, info_data=info_data)
            await unregister(model_name)

        # GET /model/info 调用 + master key 鉴权
        assert client.get.await_args.args[0] == "http://litellm:4000/model/info"
        assert client.get.await_args.kwargs["headers"]["Authorization"] == f"Bearer {_MASTER_KEY}"
        # 2 次 DELETE（按 model_id，非 model_name）；不匹配的 usr-other 不删
        assert client.post.await_count == 2
        deleted_ids = [c.kwargs["json"]["id"] for c in client.post.await_args_list]
        assert deleted_ids == ["mid-aaa", "mid-bbb"]
        for c in client.post.await_args_list:
            assert c.args[0] == "http://litellm:4000/model/delete"
            assert c.kwargs["headers"]["Authorization"] == f"Bearer {_MASTER_KEY}"

    @pytest.mark.asyncio
    async def test_unregister_no_matching_model_silent(self) -> None:
        """GET 返 data 但无 model_name 匹配 → 不 DELETE（幂等静默，model 已不存在）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_client_with_info(
                mock_cls, info_data=[{"model_name": "usr-other", "model_info": {"id": "mid-x"}}]
            )
            await unregister(f"usr-{_UID}-{_PID}")  # 不抛即通过
        assert client.post.await_count == 0  # 无匹配 → 不删

    @pytest.mark.asyncio
    async def test_unregister_get_error_silent_no_raise(self) -> None:
        """GET /model/info 异常 → 静默不抛，不 DELETE（R-09 best-effort，避免不确定状态误删）。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_client_with_info(mock_cls, info_exc=ConnectionError("litellm down"))
            await unregister(f"usr-{_UID}-{_PID}")  # 不抛即通过
        assert client.post.await_count == 0  # GET 失败 → 不删

    @pytest.mark.asyncio
    async def test_unregister_get_non_200_silent_no_delete(self) -> None:
        """GET /model/info 非 200（如 500）→ 不删（避免误操作），静默不抛。"""
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_client_with_info(mock_cls, info_status=500)
            await unregister(f"usr-{_UID}-{_PID}")
        assert client.post.await_count == 0

    @pytest.mark.asyncio
    async def test_unregister_single_delete_error_continues(self) -> None:
        """单个 DELETE 异常不阻塞其余（R-09 best-effort）：第 1 个 delete 抛错，第 2 个仍调。"""
        model_name = f"usr-{_UID}-{_PID}"
        info_data = [
            {"model_name": model_name, "model_info": {"id": "mid-aaa"}},
            {"model_name": model_name, "model_info": {"id": "mid-bbb"}},
        ]
        with patch("app.modules.llm_provider.litellm_client.httpx.AsyncClient") as mock_cls:
            client = _wire_client_with_info(mock_cls, info_data=info_data)
            # post 第 1 次抛错，第 2 次成功
            client.post.side_effect = [ConnectionError("delete 1 down"), MagicMock(status_code=200)]
            await unregister(model_name)  # 不抛即通过
        assert client.post.await_count == 2  # 第 1 个失败后仍调第 2 个
