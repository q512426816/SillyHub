"""task-03 单元测试：McpToken 鉴权中间件。

覆盖验收标准 A-D：
- A. ``McpAuthContext``（workspace_id/scope/token_id）+ Starlette 中间件就位。
- B. 无 token / 坏 token / 吊销 token → 401；缺 scope → 403 + structlog 决策日志；缓存命中不查库。
- C. 与 ``/api`` 的 ``get_current_principal`` 物理隔离（CC-06），不引用 JWT / X-API-Key / ApiKeyService。
- D. 注入的上下文可经 ``request.state.mcp_auth`` 读取。

本测试**不依赖** task-02 的 ``service.py`` 真身：通过 monkeypatch
``auth._authenticate_token`` 注入桩返回值，专测中间件自身的解析 / 注入 / 拒绝逻辑。
"""

from __future__ import annotations

import uuid
from typing import Any

import pytest
from httpx import ASGITransport, AsyncClient
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route

from app.core.errors import AuthTokenMissing, PermissionDenied
from app.modules.mcp_gateway import auth as mcp_auth_module
from app.modules.mcp_gateway.auth import (
    MCP_AUTH_STATE_KEY,
    MCP_SCOPE_CONVERGE,
    MCP_SCOPE_DISPATCH,
    MCP_SCOPE_READ,
    McpAuthContext,
    McpAuthMiddleware,
    get_mcp_auth,
    require_mcp_scope,
)

WS_ID = uuid.uuid4()
TOKEN_ID = uuid.uuid4()


def _ctx(scope: frozenset[str] | None = None) -> McpAuthContext:
    return McpAuthContext(
        workspace_id=WS_ID,
        scope=scope if scope is not None else frozenset({MCP_SCOPE_READ}),
        token_id=TOKEN_ID,
    )


class _RecordingLogger:
    """structlog BoundLogger 的最小桩，记录事件用于断言决策日志。"""

    def __init__(self) -> None:
        self.events: list[dict[str, Any]] = []

    def _record(self, level: str, event: str, **kw: Any) -> None:
        self.events.append({"level": level, "event": event, **kw})

    def debug(self, event: str, **kw: Any) -> None:
        self._record("debug", event, **kw)

    def info(self, event: str, **kw: Any) -> None:
        self._record("info", event, **kw)

    def warning(self, event: str, **kw: Any) -> None:
        self._record("warning", event, **kw)

    def exception(self, event: str, **kw: Any) -> None:
        self._record("exception", event, **kw)


async def _echo(request: Request) -> JSONResponse:
    """下游：回显 request.state.mcp_auth（验证中间件注入透传）。"""
    ctx: McpAuthContext | None = getattr(request.state, MCP_AUTH_STATE_KEY, None)
    body: dict[str, Any] = {"authorized": ctx is not None}
    if ctx is not None:
        body.update(
            workspace_id=str(ctx.workspace_id),
            token_id=str(ctx.token_id),
            scope=sorted(ctx.scope),
        )
    return JSONResponse(body)


def _make_app() -> Starlette:
    app = Starlette(routes=[Route("/echo", _echo, methods=["GET", "OPTIONS"])])
    app.add_middleware(McpAuthMiddleware)
    return app


def _patch_auth(
    monkeypatch: pytest.MonkeyPatch,
    *,
    fake: Any = None,
    recorder: _RecordingLogger | None = None,
) -> None:
    """把 auth 模块的 _authenticate_token 换成 ``fake``，log 换成 recorder。"""
    if fake is not None:
        monkeypatch.setattr(mcp_auth_module, "_authenticate_token", fake)
    if recorder is not None:
        monkeypatch.setattr(mcp_auth_module, "log", recorder)


async def _client(app: Starlette) -> AsyncClient:
    transport = ASGITransport(app=app)
    return AsyncClient(transport=transport, base_url="http://test")


# ── 验收 B：401 各路径 ────────────────────────────────────────────────────────


async def test_missing_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """无 Authorization header → 401 MISSING。"""
    _patch_auth(monkeypatch, fake=_async_ok, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo")
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == "HTTP_401_MCP_TOKEN_MISSING"
    assert body["request_id"]  # 必返 request_id（项目错误形态）


async def test_malformed_authorization_header_returns_401(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """非 Bearer / 单段 header 视同无 token → 401 MISSING（不调 service）。"""
    calls: list[str] = []

    async def _spy(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext | None:
        calls.append(plaintext)
        return _ctx()

    _patch_auth(monkeypatch, fake=_spy, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        # “Basic xxx” 非 bearer；“Bearer” 单段。
        for header in ("Basic deadbeef", "Bearer"):
            resp = await c.get("/echo", headers={"Authorization": header})
            assert resp.status_code == 401
            assert resp.json()["code"] == "HTTP_401_MCP_TOKEN_MISSING"
    assert calls == []  # 坏 header 不应触达校验


async def test_query_param_token_not_accepted(monkeypatch: pytest.MonkeyPatch) -> None:
    """R-06：?token=xxx 不作回退（query 会被访问日志记录 → 明文泄漏）。"""
    calls: list[str] = []

    async def _spy(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext | None:
        calls.append(plaintext)
        return _ctx()

    _patch_auth(monkeypatch, fake=_spy, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo", params={"token": "shmcp_secret_from_url"})
    assert resp.status_code == 401
    assert resp.json()["code"] == "HTTP_401_MCP_TOKEN_MISSING"
    assert calls == []


async def test_unknown_or_revoked_token_returns_401(monkeypatch: pytest.MonkeyPatch) -> None:
    """service 返 None（未知 / 已吊销）→ 401 INVALID，message 统一不泄漏分支。"""
    rec = _RecordingLogger()

    async def _none(session: Any, *, settings: Any, plaintext: str) -> None:
        return None

    _patch_auth(monkeypatch, fake=_none, recorder=rec)
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo", headers={"Authorization": "Bearer shmcp_unknown"})
    assert resp.status_code == 401
    body = resp.json()
    assert body["code"] == "HTTP_401_MCP_TOKEN_INVALID"
    assert "revoked" in body["message"]  # 统一文案
    # 决策日志：记 invalid 事件（不含 token 凭据）。
    assert any(ev["event"] == "mcp.auth.invalid" for ev in rec.events)


async def test_backend_exception_returns_500(monkeypatch: pytest.MonkeyPatch) -> None:
    """校验层抛异常（DB / redis 全挂）→ 500，不伪装成 401 误导客户端。"""
    rec = _RecordingLogger()

    async def _boom(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext | None:
        raise RuntimeError("db unreachable")

    _patch_auth(monkeypatch, fake=_boom, recorder=rec)
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo", headers={"Authorization": "Bearer shmcp_x"})
    assert resp.status_code == 500
    assert resp.json()["code"] == "MCP_AUTH_ERROR"
    assert any(ev["event"] == "mcp.auth.error" and ev["level"] == "exception" for ev in rec.events)


# ── 验收 D：合法 token 注入上下文 ─────────────────────────────────────────────


async def test_valid_token_injects_context_and_authorizes(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """合法 token → 200，request.state.mcp_auth 透传到下游，字段齐全。"""
    _patch_auth(monkeypatch, fake=_async_ok, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo", headers={"Authorization": "Bearer shmcp_valid"})
    assert resp.status_code == 200
    body = resp.json()
    assert body["authorized"] is True
    assert body["workspace_id"] == str(WS_ID)
    assert body["token_id"] == str(TOKEN_ID)
    assert body["scope"] == [MCP_SCOPE_READ]


async def test_authenticate_seam_called_with_extracted_plaintext(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """缓存 / 查库都封在 service 里：中间件只负责把 header 里提取的明文原样透传。"""
    captured: dict[str, Any] = {}

    async def _capture(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext | None:
        captured["plaintext"] = plaintext
        captured["has_session"] = session is not None
        captured["settings_type"] = type(settings).__name__
        return _ctx()

    _patch_auth(monkeypatch, fake=_capture, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        resp = await c.get("/echo", headers={"Authorization": "Bearer shmcp_passthrough_token"})
    assert resp.status_code == 200
    # 提取出的明文与 header 中一致（含前缀，未做修剪 / 哈希）。
    assert captured["plaintext"] == "shmcp_passthrough_token"
    # 给了 service 一个真实 session（供其查库 / 刷 last_used），不是 None。
    assert captured["has_session"] is True


async def test_options_preflight_skips_auth(monkeypatch: pytest.MonkeyPatch) -> None:
    """CORS 预检 OPTIONS 无 Authorization 属正常，放行不 401。"""
    calls: list[str] = []

    async def _spy(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext | None:
        calls.append(plaintext)
        return _ctx()

    _patch_auth(monkeypatch, fake=_spy, recorder=_RecordingLogger())
    client = await _client(_make_app())
    async with client as c:
        resp = await c.options("/echo")
    assert resp.status_code == 200
    assert resp.json()["authorized"] is False  # 未注入上下文（OPTIONS 不鉴权）
    assert calls == []


# ── 验收 B（scope 403）+ require_mcp_scope / get_mcp_auth ─────────────────────


def test_require_mcp_scope_allowed_is_noop() -> None:
    """token 持有所需 scope → 直接返回，不抛。"""
    ctx = _ctx(frozenset({MCP_SCOPE_READ, MCP_SCOPE_DISPATCH}))
    # 不抛即通过。
    require_mcp_scope(ctx, MCP_SCOPE_READ)
    require_mcp_scope(ctx, MCP_SCOPE_DISPATCH)


def test_require_mcp_scope_denied_raises_403_and_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """缺所需 scope → PermissionDenied(403) + structlog 记 scope_denied 决策日志。"""
    rec = _RecordingLogger()
    monkeypatch.setattr(mcp_auth_module, "log", rec)
    ctx = _ctx(frozenset({MCP_SCOPE_READ}))  # 只剩 read

    with pytest.raises(PermissionDenied) as exc_info:
        require_mcp_scope(ctx, MCP_SCOPE_CONVERGE)

    assert exc_info.value.http_status == 403
    assert exc_info.value.code == "HTTP_403_PERMISSION_DENIED"
    assert exc_info.value.details == {
        "required_scope": MCP_SCOPE_CONVERGE,
        "workspace_id": str(WS_ID),
    }
    # 决策日志：warning 级，含 required / granted / 标识符，不含 token 凭据。
    denied = [ev for ev in rec.events if ev["event"] == "mcp.auth.scope_denied"]
    assert len(denied) == 1
    assert denied[0]["level"] == "warning"
    assert denied[0]["required_scope"] == MCP_SCOPE_CONVERGE
    assert denied[0]["granted"] == [MCP_SCOPE_READ]
    assert denied[0]["workspace_id"] == str(WS_ID)
    assert denied[0]["token_id"] == str(TOKEN_ID)
    # R-06：日志里不应出现 token 明文 / sha256 字样。
    serialized = str(denied[0])
    assert "shmcp_" not in serialized


def test_get_mcp_auth_returns_context_when_present() -> None:
    req = Request({"type": "http"})
    ctx = _ctx()
    setattr(req.state, MCP_AUTH_STATE_KEY, ctx)
    assert get_mcp_auth(req) is ctx


def test_get_mcp_auth_missing_raises_401() -> None:
    """request.state 无上下文（中间件未挂）→ fail-closed 401。"""
    req = Request({"type": "http"})
    with pytest.raises(AuthTokenMissing):
        get_mcp_auth(req)


# ── 验收 C：与 /api get_current_principal 物理隔离（CC-06）─────────────────────


def test_middleware_does_not_reference_api_principal_path() -> None:
    """CC-06：auth.py 不得引用 JWT / X-API-Key / ApiKeyService / get_current_principal。

    这些都是 /api 通道的鉴权路径；MCP 中间件走独立 McpToken 通道，源码层面物理隔离，
    现有 /api/* 路由零回归。用源码文本断言而非运行期（更直接、不依赖 import 副作用）。
    """
    import inspect

    src = inspect.getsource(mcp_auth_module)
    for forbidden in (
        "get_current_principal",
        "decode_access_token",
        "ApiKeyService",
        "_extract_api_key",
        "X-API-Key",
    ):
        assert forbidden not in src, (
            f"auth.py 不应引用 /api 鉴权路径的 {forbidden!r}（CC-06 物理隔离）"
        )


# ── 共享桩 ────────────────────────────────────────────────────────────────────


async def _async_ok(session: Any, *, settings: Any, plaintext: str) -> McpAuthContext:
    """桩：任何 token 都判合法，返回只读 scope 的上下文。"""
    return _ctx(frozenset({MCP_SCOPE_READ}))


# ── task-02 ↔ task-03 契约桥接：McpTokenPrincipal → McpAuthContext ─────────────


async def test_authenticate_seam_converts_principal_to_context(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """service 返 McpTokenPrincipal（scope: list）→ 缝口转成 McpAuthContext（scope: frozenset）。

    task-02 的 service 用 list[str]（JSON 缓存友好）；task-03 对 tool handler 暴露的
    McpAuthContext 用 frozenset[str]（每次工具调用 ``in`` 判定 O(1)）。本测试钉死这层适配，
    防止 service 改 Principal 字段时 middleware 静默漏字段。
    """
    from app.modules.mcp_gateway.service import McpTokenPrincipal, McpTokenService

    principal = McpTokenPrincipal(
        token_id=TOKEN_ID,
        workspace_id=WS_ID,
        scope=[MCP_SCOPE_READ, MCP_SCOPE_DISPATCH],  # list，含重复风险由转换吸收
    )

    async def _fake_authenticate(self: McpTokenService, plaintext: str) -> McpTokenPrincipal | None:
        return principal

    monkeypatch.setattr(McpTokenService, "authenticate", _fake_authenticate)
    # 缝口内部会懒 import McpTokenService —— 同一 class 对象，patch 生效。
    result = await mcp_auth_module._authenticate_token(
        session=object(), settings=object(), plaintext="shmcp_whatever"
    )
    assert isinstance(result, McpAuthContext)
    assert result.workspace_id == WS_ID
    assert result.token_id == TOKEN_ID
    assert isinstance(result.scope, frozenset)
    assert result.scope == frozenset({MCP_SCOPE_READ, MCP_SCOPE_DISPATCH})


async def test_authenticate_seam_returns_none_when_service_returns_none(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """service 返 None（未知 / 吊销）→ 缝口透传 None，由 middleware 转 401。"""
    from app.modules.mcp_gateway.service import McpTokenService

    async def _fake_authenticate(self: McpTokenService, plaintext: str) -> None:
        return None

    monkeypatch.setattr(McpTokenService, "authenticate", _fake_authenticate)
    result = await mcp_auth_module._authenticate_token(
        session=object(), settings=object(), plaintext="shmcp_unknown"
    )
    assert result is None
