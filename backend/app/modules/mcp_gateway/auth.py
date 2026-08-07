"""MCP gateway 鉴权中间件（/mcp mount 独立通道，与 /api 的鉴权路径物理隔离，CC-06）。

本模块只做三件事，对应 design §5.2 P2 / D-002：

1. 定义 :class:`McpAuthContext` 契约（字段 ``workspace_id`` / ``scope`` / ``token_id``），
   供 task-05/06 的 MCP tool handler 消费（task-03 ``provides``）。
2. :class:`McpAuthMiddleware` —— Starlette ``BaseHTTPMiddleware``，解析
   ``Authorization: Bearer <McpToken>``，复用 task-02 ``McpTokenService.authenticate``
   的 Redis 正/负缓存校验，命中即把上下文挂到 ``request.state.mcp_auth``。
   - 无 token / 坏 token / 已吊销 token → ``401``（直接返 ``JSONResponse``，不走 FastAPI 异常处理器，
     因为本中间件挂在 ``/mcp`` 这条独立 ASGI 子 app 上，父 app 的 ``register_exception_handlers`` 拦不到）。
3. :func:`require_mcp_scope` —— tool handler 入口按 scope 拒绝越界，缺所需 scope 抛
   :class:`~app.core.errors.PermissionDenied`（``403``）并 structlog 记决策日志。

R-06：永不把 token 明文 / sha256 写进日志或响应；日志只带 ``token_id``（UUID，非敏感）+
``workspace_id`` + ``scope`` 集合。

transport / FastMCP http_app 如何挂本中间件、tool handler 如何读 ``request.state.mcp_auth``
属 task-04 spike-A 范围（CC-07 / R-01），本 task 先按 Starlette 标准实现。
"""

from __future__ import annotations

import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass

from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse, Response

from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.errors import AuthTokenMissing, PermissionDenied
from app.core.logging import get_logger

log = get_logger(__name__)

# ── Scope 常量（design §8.1：scope ∈ {read, dispatch, converge}）──────────────
# tool handler（task-05/06）按此引用，避免散落字符串。
MCP_SCOPE_READ = "read"
MCP_SCOPE_DISPATCH = "dispatch"
MCP_SCOPE_CONVERGE = "converge"
MCP_SCOPES: frozenset[str] = frozenset({MCP_SCOPE_READ, MCP_SCOPE_DISPATCH, MCP_SCOPE_CONVERGE})

# request.state 上的属性名；tool handler 经此键取上下文。
MCP_AUTH_STATE_KEY = "mcp_auth"


@dataclass(frozen=True, slots=True)
class McpAuthContext:
    """MCP 鉴权上下文（task-03 ``provides`` 契约）。

    由 :class:`McpAuthMiddleware` 在校验通过后构造并挂到 ``request.state.mcp_auth``；
    task-05/06 的 tool handler 经 :func:`get_mcp_auth` 读取，再按需调
    :func:`require_mcp_scope` 做越界校验。

    Attributes:
        workspace_id: token 绑定的工作区（design §8.1 ``mcp_tokens.workspace_id``）。
            tool handler 的所有 workspace 操作必须落在此 id 上，客户端传了不一致的值即越权。
        scope: token 被授予的 scope 集合（``read`` / ``dispatch`` / ``converge``）。
            用 ``frozenset`` 做 O(1) 成员判定。
        token_id: ``mcp_tokens.id``（UUID，非敏感），仅供审计日志 / last_used 刷新定位行，
            永不作为鉴权凭据。
    """

    workspace_id: uuid.UUID
    scope: frozenset[str]
    token_id: uuid.UUID


def _extract_bearer(request: Request) -> str | None:
    """解析 ``Authorization: Bearer <token>``（仅 header，刻意不做 ``?token=`` 回退）。

    与 :mod:`app.core.auth_deps` 的同名函数不同，MCP 通道**只认 header**：query 参数
    会被反代 / 访问日志记录，明文 token 一旦落盘即构成泄漏（R-06）。
    """
    raw = request.headers.get("authorization") or request.headers.get("Authorization")
    if not raw:
        return None
    parts = raw.split()
    if len(parts) == 2 and parts[0].lower() == "bearer":
        return parts[1].strip() or None
    return None


def _mcp_error_response(
    request: Request,
    *,
    http_status: int,
    code: str,
    message: str,
    details: dict[str, object] | None = None,
) -> JSONResponse:
    """按项目统一错误形态（``errors._error_payload``）直接返回 ``JSONResponse``。

    本中间件挂在 ``/mcp`` ASGI 子 app 上，父 FastAPI 的 ``AppError`` 处理器拦不到，
    故不能 raise —— 必须自己构造响应。``request_id`` 取 header（与父 app 的
    ``request_id_middleware`` 对齐），缺则现生成。
    """
    rid = request.headers.get("x-request-id") or str(uuid.uuid4())
    return JSONResponse(
        status_code=http_status,
        content={
            "code": code,
            "message": message,
            "request_id": rid,
            "details": details,
        },
    )


async def _authenticate_token(
    session: object,
    *,
    settings: object,
    plaintext: str,
) -> McpAuthContext | None:
    """调用 task-02 :class:`McpTokenService.authenticate` 并把结果转成 :class:`McpAuthContext`。

    task-02 的 service 返的是它自己的 :class:`~app.modules.mcp_gateway.service.McpTokenPrincipal`
    （``scope: list[str]``，缓存 value 用 JSON 序列化）；task-03 对 tool handler 暴露的契约是
    :class:`McpAuthContext`（``scope: frozenset[str]``，每次工具调用都做成员判定，frozenset
    O(1)）。本函数即两者间的 1 行适配：``list → frozenset``。类型故意分两个，避免 service
    反向 import auth（service 不依赖 auth，依赖单向 auth → service，无循环导入）。

    独立成函数还有两个作用：

    1. **懒导入 service**：service.py 顶层不 import auth，但本模块在运行期需要 service ——
       放函数体内 lazy import，两模块都能先独立完成加载。
    2. **测试缝**：单测 monkeypatch ``auth._authenticate_token`` 注入桩上下文，无需真起
       McpTokenService / DB（service 的正/负缓存 / 查库由其自己单测覆盖）。

    契约（task-02 ↔ task-03 接口）：
        ``McpTokenService(session, settings=settings).authenticate(plaintext)``
        返回 :class:`McpTokenPrincipal`（命中）或 ``None``（未知 / 已吊销 / 无前缀）。
    """
    from app.modules.mcp_gateway.service import McpTokenService

    principal = await McpTokenService(session, settings=settings).authenticate(plaintext)
    if principal is None:
        return None
    return McpAuthContext(
        workspace_id=principal.workspace_id,
        scope=frozenset(principal.scope),
        token_id=principal.token_id,
    )


class McpAuthMiddleware(BaseHTTPMiddleware):
    """``/mcp`` mount 的独立鉴权中间件。

    每个进 ``/mcp`` 的请求都过这里：无/坏/吊销 token → 401；合法 token → 把
    :class:`McpAuthContext` 挂到 ``request.state.mcp_auth`` 放行。scope 越界不在本层判
    （中间件不知道每个 tool 要什么 scope），而由 tool handler 调
    :func:`require_mcp_scope` 自行拒绝。

    与 ``/api`` 通道的鉴权依赖物理隔离（CC-06）：本中间件只认 MCP Bearer token，
    不解析 ``/api`` 用的浏览器/长期密钥凭据，两者互不影响，现有 ``/api/*``
    路由零回归。
    """

    async def dispatch(
        self,
        request: Request,
        call_next: Callable[[Request], Awaitable[Response]],
    ) -> Response:
        # CORS 预检（OPTIONS）放行：父 app 的 CORSMiddleware 已处理跨域，但子 app 仍可能
        # 收到 OPTIONS，此时无 Authorization header 属正常，不应 401。
        if request.method == "OPTIONS":
            return await call_next(request)

        token = _extract_bearer(request)
        if not token:
            log.info("mcp.auth.missing", path=request.url.path, method=request.method)
            return _mcp_error_response(
                request,
                http_status=401,
                code="HTTP_401_MCP_TOKEN_MISSING",
                message="MCP Bearer token is required.",
                details={"hint": "Send 'Authorization: Bearer <mcp_token>'."},
            )

        # 缓存命中优先 / redis 故障降级直查 DB 都封在 McpTokenService.authenticate 内
        # （复用平台长期密钥的 best-effort 缓存模式）。这里只开一个短 session 给它用。
        try:
            async with get_session_factory()() as session:
                ctx = await _authenticate_token(session, settings=get_settings(), plaintext=token)
        except Exception:
            # 缓存层故障已被 service 内部降级吞掉；能冒到这里说明 DB 也不可达 ——
            # 返 500（不伪装成 401 误导客户端以为 token 错），并 structlog 记全栈。
            log.exception("mcp.auth.error", path=request.url.path)
            return _mcp_error_response(
                request,
                http_status=500,
                code="MCP_AUTH_ERROR",
                message="MCP authentication backend is unavailable.",
            )

        if ctx is None:
            # 未知 / 已吊销：message 故意统一，不泄漏是哪种（对齐平台长期密钥做法）。
            log.info("mcp.auth.invalid", path=request.url.path)
            return _mcp_error_response(
                request,
                http_status=401,
                code="HTTP_401_MCP_TOKEN_INVALID",
                message="MCP token is invalid, expired, or revoked.",
            )

        # 访问 request.state 即惰性建好 Starlette State（勿用 scope.setdefault("state", {})，
        # 那会把 scope["state"] 钉成普通 dict，setattr 落到 dict 实例属性上无法透传下游）。
        setattr(request.state, MCP_AUTH_STATE_KEY, ctx)
        log.debug(
            "mcp.auth.authorized",
            workspace_id=str(ctx.workspace_id),
            token_id=str(ctx.token_id),
            scope=sorted(ctx.scope),
        )
        return await call_next(request)


def get_mcp_auth(request: Request) -> McpAuthContext:
    """从 ``request.state`` 取 :class:`McpAuthContext`。

    供 task-04 spike 确认的 FastMCP tool 注入点调用（FastMCP 能否访问 ``request.state``
    是 CC-07 / R-01 的待验证项；本函数是“无论注入机制如何，上下文总在 request.state”的稳定读取口）。

    缺失即说明中间件未生效（mount 配置错误），fail-closed 抛 401 而非放行。
    """
    ctx = getattr(request.state, MCP_AUTH_STATE_KEY, None)
    if ctx is None:
        raise AuthTokenMissing(
            "MCP auth context is missing on request (middleware not wired).",
            details={"hint": "McpAuthMiddleware must be mounted on the /mcp ASGI app."},
        )
    return ctx


def require_mcp_scope(auth_ctx: McpAuthContext, required_scope: str) -> None:
    """tool handler 越界校验：``required_scope`` 不在 ``auth_ctx.scope`` 即抛 403。

    design §5.1「8 个 tool handler（按 scope 拒绝越界）」的统一入口。命中所需 scope
    立即返回；不命中则 structlog 记**决策日志**（``mcp.auth.scope_denied``，warning 级，
    带 ``required_scope`` / ``granted`` / ``workspace_id`` / ``token_id``，不含 token 凭据）
    再抛 :class:`~app.core.errors.PermissionDenied`（``HTTP_403``）。

    该异常最终如何呈现给 MCP 客户端（JSON-RPC error / HTTP 403）由 task-04 spike-A
    在 FastMCP 错误转换层决定；本函数只负责“决策 + 抛”。
    """
    if required_scope in auth_ctx.scope:
        return

    log.warning(
        "mcp.auth.scope_denied",
        workspace_id=str(auth_ctx.workspace_id),
        token_id=str(auth_ctx.token_id),
        required_scope=required_scope,
        granted=sorted(auth_ctx.scope),
    )
    raise PermissionDenied(
        f"MCP token lacks required scope '{required_scope}'.",
        details={
            "required_scope": required_scope,
            "workspace_id": str(auth_ctx.workspace_id),
        },
    )


__all__ = [
    "MCP_AUTH_STATE_KEY",
    "MCP_SCOPES",
    "MCP_SCOPE_CONVERGE",
    "MCP_SCOPE_DISPATCH",
    "MCP_SCOPE_READ",
    "McpAuthContext",
    "McpAuthMiddleware",
    "get_mcp_auth",
    "require_mcp_scope",
]
