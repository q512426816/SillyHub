"""task-04（FR-03 / D-003@v1）：/api/daemon/llm-proxy 透传端点契约测试。

master key 收窄后唯一注入点：daemon 子进程 Bearer（shk_live_ 或 JWT）打本代理，
backend 校验凭据 + ``usr-<uid>-<pid>`` model 归属断言（Grill UB-4b）后，注入
``settings.litellm_master_key`` 流式转发 LiteLLM（ Grill UB-4a 分流复用 task-01
凭据解析口径）。

覆盖（task-04 acceptance + step-14 QA 修正）：
  1. 无凭据 / 坏 Bearer → 401（不透传）；
  2. 他人 uid 的 usr 模型名 → 403（堵借用他人上游 key，UB-4b）；
  3. 本人 usr 模型名 → 流式转发：上游 URL / Authorization=master key / 响应体逐块透传；
  4. 无 model 字段（GET /models 类）→ 放行转发（warn 日志）；
  5. JWT Bearer 路径同样放行（对齐 get_current_user 口径）；
  6. master key 未配置 → 503 fail-fast（绝不匿名转发）；
  7. 非白名单路径（LiteLLM admin API：/model/new、/key/generate、/user/*）
     → 404 不触上游（step-14 QA H-1）；query string 拼回上游 URL（QA L-2）。

基建范式：根 conftest ``db_engine`` + autouse ``_redirect_session_factory``（端点鉴权
走 ``get_session_factory()`` 短 session）；httpx ``ASGITransport`` 直连最小 app
（仿 test_ws_auth._build_app）；上游 httpx.AsyncClient 以 monkeypatch 假客户端捕获
转发参数（真实 httpx 模块只替换 AsyncClient 属性，Timeout/HTTPError 保持真身）。
"""

from __future__ import annotations

import uuid
from typing import Any

import httpx
import pytest
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.modules.auth.api_key_service import ApiKeyService
from app.modules.auth.model import User

# ── seed / app helpers（范式对齐 test_ws_auth.py）────────────────────────────


async def _seed_user(db_session: AsyncSession, *, name: str) -> User:
    user = User(
        id=uuid.uuid4(),
        email=f"llmproxy-{name}-{uuid.uuid4()}@example.com",
        username=f"llmproxy-{name}",
        password_hash="x",
        display_name=name,
        status="active",
    )
    db_session.add(user)
    await db_session.commit()
    await db_session.refresh(user)
    return user


async def _issue_api_key(db_session: AsyncSession, *, user: User) -> str:
    """真签发一把 shk_live_ key（走 ApiKeyService.create 全链路，bcrypt 已降档）。"""
    _, plaintext = await ApiKeyService(db_session, settings=get_settings()).create(
        user_id=user.id, name=f"llm-proxy-{user.display_name}", expires_at=None
    )
    return plaintext


def _build_app() -> Any:
    from fastapi import FastAPI

    from app.modules.daemon.router import router

    app = FastAPI()
    app.include_router(router, prefix="/api")
    return app


class _FakeUpstreamResponse:
    """假上游流式响应：aiter_raw 逐块产出 + aclose 记录（断言资源回收）。"""

    def __init__(
        self,
        *,
        status_code: int = 200,
        headers: dict[str, str] | None = None,
        chunks: tuple[bytes, ...] = (b'{"ok":', b"true}"),
    ) -> None:
        self.status_code = status_code
        self.headers = httpx.Headers(headers or {"content-type": "application/json"})
        self._chunks = chunks
        self.closed = False

    async def aiter_raw(self):
        for chunk in self._chunks:
            yield chunk

    async def aclose(self) -> None:
        self.closed = True


def _install_fake_upstream(
    monkeypatch: pytest.MonkeyPatch,
    *,
    response: _FakeUpstreamResponse | None = None,
) -> dict[str, Any]:
    """把 router 模块用的 httpx.AsyncClient 换成假客户端，返回捕获字典。

    端点以 ``httpx.AsyncClient(...)`` 构造 + ``build_request`` + ``send(stream=True)``
    转发；假客户端把 init kwargs / method / url / headers / content 全记进 captured。
    """
    captured: dict[str, Any] = {}
    resp = response or _FakeUpstreamResponse()

    class _FakeAsyncClient:
        def __init__(self, **kwargs: Any) -> None:
            captured["init"] = kwargs

        async def __aenter__(self) -> "_FakeAsyncClient":
            return self

        async def __aexit__(self, *exc: Any) -> None:
            pass

        def build_request(self, method: str, url: str, **kwargs: Any) -> Any:
            captured["method"] = method
            captured["url"] = url
            captured.update(kwargs)
            return object()

        async def send(self, request: Any, *, stream: bool = False) -> _FakeUpstreamResponse:
            captured["stream"] = stream
            return resp

        async def aclose(self) -> None:
            pass

    monkeypatch.setattr(httpx, "AsyncClient", _FakeAsyncClient)
    return captured


@pytest.fixture(autouse=True)
def _reset_llm_proxy_client():
    """ql-20260826-011：转发客户端改进程级单例后，测试间必须复位。

    上游假客户端经 monkeypatch 替换 httpx.AsyncClient 构造——若上一用例的
    假实例残留在单例里，后续用例（monkeypatch 已还原）会继续用旧假客户端，
    破坏隔离。每用例前后清空单例。
    """
    from app.modules.daemon import router as daemon_router

    daemon_router._LLM_PROXY_CLIENT = None
    yield
    daemon_router._LLM_PROXY_CLIENT = None


@pytest.fixture()
def proxy_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    """隔离 LiteLLM 网关 settings（env 覆盖 + 清 settings 缓存重建）。

    根 conftest autouse ``_reset_settings_cache`` 在 fixture setup 前已 cache_clear，
    但 setenv 发生在其后，故此处再清一次保证请求期 get_settings() 读到 env 覆盖。
    """
    monkeypatch.setenv("LITELLM_BASE_URL", "http://litellm-test:4000")
    monkeypatch.setenv("LITELLM_MASTER_KEY", "sk-litellm-master-test")
    get_settings.cache_clear()


@pytest.fixture()
async def proxy_client():
    app = _build_app()
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


pytestmark = pytest.mark.asyncio


# ════════════════════════════════════════════════════════════════════════════
# 1. 鉴权失败（Grill UB-4a）：401 且不触达上游
# ════════════════════════════════════════════════════════════════════════════


class TestLlmProxyAuth:
    async def test_no_credentials_401(
        self, db_session: AsyncSession, proxy_client: AsyncClient, proxy_settings: None
    ) -> None:
        resp = await proxy_client.get("/api/daemon/llm-proxy/v1/models")
        assert resp.status_code == 401

    async def test_invalid_bearer_401(
        self, db_session: AsyncSession, proxy_client: AsyncClient, proxy_settings: None
    ) -> None:
        resp = await proxy_client.get(
            "/api/daemon/llm-proxy/v1/models",
            headers={"Authorization": "Bearer not-a-jwt"},
        )
        assert resp.status_code == 401

    async def test_master_key_unset_503(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """master key 未配置 → 503 fail-fast，绝不匿名转发上游。"""
        monkeypatch.setenv("LITELLM_BASE_URL", "http://litellm-test:4000")
        monkeypatch.delenv("LITELLM_MASTER_KEY", raising=False)
        get_settings.cache_clear()

        owner = await _seed_user(db_session, name="nokey")
        key = await _issue_api_key(db_session, user=owner)
        resp = await proxy_client.get("/api/daemon/llm-proxy/v1/models", headers={"X-API-Key": key})
        assert resp.status_code == 503


# ════════════════════════════════════════════════════════════════════════════
# 2. model 归属断言（Grill UB-4b）
# ════════════════════════════════════════════════════════════════════════════


class TestLlmProxyPathWhitelist:
    """step-14 QA H-1：路径白名单——LiteLLM admin API 不得经代理可达。

    master key 注入使本代理等同 admin 通道：/model/new、/key/generate、/user/*
    等管理端点同 base_url 下以 master key 为管理员凭证，任意路径透传 = 任意
    有效用户可打 admin API。非白名单路径 404 且不触上游。
    """

    async def test_post_model_new_404_not_forwarded(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """POST /model/new（LiteLLM admin 端点）→ 404，上游不被触达。"""
        owner = await _seed_user(db_session, name="wl")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/model/new",
            headers={"Authorization": f"Bearer {key}"},
            json={"model_name": "evil", "litellm_params": {"model": "gpt-4o"}},
        )
        assert resp.status_code == 404
        # 404 短路：上游 client 未被构造（captured 无 init）。
        assert "init" not in captured

    async def test_get_key_generate_404_not_forwarded(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """GET /key/generate（admin key 签发端点）→ 404，不触上游。"""
        owner = await _seed_user(db_session, name="wl2")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.get(
            "/api/daemon/llm-proxy/key/generate",
            headers={"X-API-Key": key},
        )
        assert resp.status_code == 404
        assert "init" not in captured

    async def test_user_admin_path_404(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """/user/<uid>（admin 用户管理面）→ 404，不触上游。"""
        owner = await _seed_user(db_session, name="wl3")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.get(
            f"/api/daemon/llm-proxy/user/{owner.id}",
            headers={"X-API-Key": key},
        )
        assert resp.status_code == 404
        assert "init" not in captured

    async def test_v1_prefix_required(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """不带 v1/ 前缀的同名路径（/messages）→ 404（白名单锚定 v1/ 推理面）。"""
        owner = await _seed_user(db_session, name="wl4")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/messages",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": f"usr-{owner.id}-{uuid.uuid4()}"},
        )
        assert resp.status_code == 404
        assert "init" not in captured

    async def test_query_string_forwarded(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """step-14 QA L-2：带 query string 的白名单路径 → ?… 拼回上游 URL。"""
        owner = await _seed_user(db_session, name="wl5")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.get(
            "/api/daemon/llm-proxy/v1/models?limit=10",
            headers={"X-API-Key": key},
        )
        assert resp.status_code == 200
        assert captured["url"] == "http://litellm-test:4000/v1/models?limit=10"


class TestLlmProxyModelOwnership:
    async def test_foreign_usr_model_403(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """本人有效凭据 + 他人 uid 的 usr 模型名 → 403，上游不被触达。"""
        owner = await _seed_user(db_session, name="owner")
        intruder_model_owner = await _seed_user(db_session, name="other")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/v1/messages",
            headers={"Authorization": f"Bearer {key}"},
            json={
                "model": f"usr-{intruder_model_owner.id}-{uuid.uuid4()}",
                "messages": [{"role": "user", "content": "hi"}],
            },
        )
        assert resp.status_code == 403
        # 403 短路：上游 client 未被构造（captured 无 init）。
        assert "init" not in captured

    async def test_malformed_usr_model_denied_not_forwarded_as_owned(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """usr- 前缀但 uid 非法（非 UUID）→ 不命中归属断言也不 403（LiteLLM 自会 404）。"""
        owner = await _seed_user(db_session, name="malformed")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/v1/messages",
            headers={"Authorization": f"Bearer {key}"},
            json={"model": "usr-not-a-uuid-xxx", "messages": []},
        )
        # 非 usr<uuid>-<uuid> 形态 → 无归属断言 → 放行转发（上游无该 deployment 自会失败）
        assert resp.status_code == 200
        assert captured["url"] == "http://litellm-test:4000/v1/messages"


# ════════════════════════════════════════════════════════════════════════════
# 3. 本人放行 → 流式转发 + master key 注入
# ════════════════════════════════════════════════════════════════════════════


class TestLlmProxyForwarding:
    async def test_own_usr_model_forwarded_with_master_key(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """本人 usr 模型名 → 200；上游收到 master key Bearer、原 path、原 body；
        响应体逐块透传、上游响应头透传（content-type）、上游连接被回收。"""
        owner = await _seed_user(db_session, name="fwd")
        key = await _issue_api_key(db_session, user=owner)
        fake_resp = _FakeUpstreamResponse(
            status_code=200,
            headers={"content-type": "application/json", "x-upstream": "litellm"},
        )
        captured = _install_fake_upstream(monkeypatch, response=fake_resp)
        body = {
            "model": f"usr-{owner.id}-{uuid.uuid4()}",
            "messages": [{"role": "user", "content": "hi"}],
        }

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/v1/messages",
            headers={"Authorization": f"Bearer {key}", "accept": "application/json"},
            json=body,
        )

        assert resp.status_code == 200
        assert resp.text == '{"ok":true}'  # 两块 chunk 逐块透传拼接
        assert resp.headers["content-type"] == "application/json"
        assert resp.headers["x-upstream"] == "litellm"

        # 上游请求断言：URL 拼接 + Authorization 换 master key + 流式 + body 透传。
        assert captured["url"] == "http://litellm-test:4000/v1/messages"
        assert captured["method"] == "POST"
        assert captured["stream"] is True
        fwd_headers = captured["headers"]
        assert fwd_headers["Authorization"] == "Bearer sk-litellm-master-test"
        # 转发剥离 hop-by-hop / 原 Authorization 不残留第二份（headers 是 dict，键天然唯一）。
        lowered = [k.lower() for k in fwd_headers]
        assert lowered.count("authorization") == 1
        assert "host" not in lowered
        assert "connection" not in lowered
        # body 透传（读流后 content= 重新发出，与归属断言解析共用一份内存副本）。
        assert b'"model"' in captured["content"]
        # 响应消费完上游连接已回收（aclose 被调）。
        assert fake_resp.closed is True

    async def test_get_models_without_model_forwarded(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """GET /v1/models（无 body model 字段）→ 放行转发（warn 日志，不 403）。"""
        owner = await _seed_user(db_session, name="getmodels")
        key = await _issue_api_key(db_session, user=owner)
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.get("/api/daemon/llm-proxy/v1/models", headers={"X-API-Key": key})
        assert resp.status_code == 200
        assert captured["url"] == "http://litellm-test:4000/v1/models"
        assert captured["method"] == "GET"
        assert captured["headers"]["Authorization"] == "Bearer sk-litellm-master-test"

    async def test_jwt_bearer_forwarded(
        self,
        db_session: AsyncSession,
        proxy_client: AsyncClient,
        proxy_settings: None,
        monkeypatch: pytest.MonkeyPatch,
    ) -> None:
        """非 shk_live_ 前缀 Bearer → JWT 解码 + DB 查用户路径（对齐 task-01 口径）。"""
        from app.core.security import create_access_token

        owner = await _seed_user(db_session, name="jwt")
        token, _ = create_access_token(
            user_id=owner.id,
            email=owner.email,
            is_admin=False,
            settings=get_settings(),
        )
        captured = _install_fake_upstream(monkeypatch)

        resp = await proxy_client.post(
            "/api/daemon/llm-proxy/v1/messages",
            headers={"Authorization": f"Bearer {token}"},
            json={"model": f"usr-{owner.id}-{uuid.uuid4()}"},
        )
        assert resp.status_code == 200
        assert captured["headers"]["Authorization"] == "Bearer sk-litellm-master-test"
