"""daemon 网关端点（task-07 拆分）：llm-proxy 透传 + WS 通道 + 升级期鉴权。

原 notify_misc 的网关域：``/llm-proxy/{path}`` GET/POST 透传（task-04 /
FR-03 / D-003@v1）、``/ws`` daemon WebSocket（task-01 / task-06）、
``_authenticate_http_bearer`` / ``_authenticate_bearer_headers`` /
``_authenticate_ws_upgrade`` 三鉴权 helper 与 WS 心跳 payload 归属校验
（``_payload_runtime_id`` / ``_validate_payload_runtime_belongs``）。

patch 兼容（D-007，patch 目标在包 ``__init__`` 命名空间，本模块经 ``_router``
延迟解析）：``_LLM_PROXY_CLIENT`` 单例状态（test_llm_proxy.py reset fixture
直接对包属性赋 None）、``DaemonPermissionService``（WS permission 分支构造点，
test_ws_hub_permission patch）。``close_llm_proxy_client`` 经包 ``__init__``
重导出（main.py lifespan 消费面零改动）。
"""

from __future__ import annotations

import json
import re
import uuid
from collections.abc import AsyncGenerator
from typing import Any

import httpx
from fastapi import (
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
)
from fastapi.responses import StreamingResponse

import app.modules.daemon.router as _router
from app.core.config import get_settings
from app.core.db import get_session_factory
from app.core.logging import get_logger
from app.core.security import AccessTokenError, decode_access_token
from app.modules.auth.api_key_service import API_KEY_PREFIX, ApiKeyService
from app.modules.auth.model import User
from app.modules.daemon.model import DaemonInstance
from app.modules.daemon.protocol import (
    DAEMON_MSG_HEARTBEAT,
    DAEMON_MSG_PERMISSION_REQUEST,
    DAEMON_MSG_RPC_RESULT,
    PermissionRequestPayload,
)
from app.modules.daemon.router import router
from app.modules.daemon.service import DaemonService

log = get_logger("app.modules.daemon.router")

# ── llm-proxy 透传端点（task-04 / FR-03 / D-003@v1）───────────────────────────


# litellm_model_name（task-09 单一真相源，litellm_client.py:41）格式 ``usr-<uid>-<pid>``。
# 归属断言只信任能完整解析出两个 UUID 的形态；其余 model 名（claude-haiku-4-5 内置
# 档位名 / LiteLLM 部署名）无归属语义，不在此拦（LiteLLM 自会按无 deployment 失败）。
_LITELLM_MODEL_NAME_RE = re.compile(r"^usr-([0-9a-fA-F-]{36})-([0-9a-fA-F-]{36})$")

# 透传时剥离的 hop-by-hop / 逐跳头（RFC 7230 §6.1）+ Host（httpx 按目标 URL 自建）
# + Content-Length（body 经读流后重组，长度由 httpx 重算，透传旧值会错）。
_HOP_BY_HOP_HEADERS = frozenset(
    {
        "connection",
        "keep-alive",
        "proxy-authenticate",
        "proxy-authorization",
        "te",
        "trailers",
        "transfer-encoding",
        "upgrade",
        "host",
        "content-length",
    }
)

# 转发路径白名单（step-14 QA H-1）：只透传推理面端点，收紧 LiteLLM admin API
# 暴露面——同 base_url 下 /model/new、/key/generate、/user/* 等管理端点以 master
# key 为管理员凭证，任意路径透传 = 任意有效用户可打 admin API。白名单按 Claude
# Code 子进程 + LiteLLM 实际调用面定（/v1/messages 主通道 + /v1/models 探活为
# 刚需，completions / chat/completions / count_tokens 为 OpenAI 格式兼容面）；
# 不匹配 404（与 D-001 owner-only 同语义，不泄露端点存在性）。
_LLM_PROXY_PATH_RE = re.compile(
    r"^v1/(messages|models|completions|chat/completions|count_tokens)(/.*)?$"
)

# Claude Code 子进程实际使用的请求方法（POST /v1/messages 主通道 + GET /v1/models
# 探活 / OPTIONS·HEAD CORS 预检类）。其余方法无业务场景——api_route 的 methods 集
# 即显式白名单（不在列的 method 由 FastAPI 直接 405，降低攻击面）。
_LLM_PROXY_METHODS = ["GET", "POST", "OPTIONS", "HEAD"]

# 上游 LiteLLM 转发超时（对齐 R-02 应对策略；read 放宽给 SSE 逐 token 长流）。
_LLM_PROXY_TIMEOUT = httpx.Timeout(connect=10.0, read=300.0, write=60.0, pool=10.0)

# 进程级共享转发客户端（连接池复用）：本代理是所有 daemon 子进程 LLM 推理的
# 唯一出站通道，逐请求 new AsyncClient 意味着每次推理都做 TCP+TLS 握手、零
# 连接复用，高并发 agent 会话下握手延迟与 TIME_WAIT socket 线性累积。懒加载
# 单例 + app lifespan shutdown 关闭（对齐 core/redis.py 的 get_redis /
# close_redis 模式）；测试经 monkeypatch 替换 httpx.AsyncClient 时须先复位
# 本单例（见 test_llm_proxy.py 的 reset fixture）。#
# task-07 拆分注：单例状态本体存于包命名空间 ``app.modules.daemon.router.
# _LLM_PROXY_CLIENT``（``__init__`` 初始化为 None）——test_llm_proxy.py 的
# reset fixture 直接对包属性赋 None，本模块经 ``_router`` 延迟读写保持可复位。


def _get_llm_proxy_client() -> httpx.AsyncClient:
    """Return (and lazily create) the process-wide upstream forward client."""
    client = _router._LLM_PROXY_CLIENT
    if client is None:
        client = httpx.AsyncClient(timeout=_LLM_PROXY_TIMEOUT)
        _router._LLM_PROXY_CLIENT = client
    return client


async def close_llm_proxy_client() -> None:
    """Close the shared forward client on application shutdown."""
    client = _router._LLM_PROXY_CLIENT
    if client is not None:
        await client.aclose()
    _router._LLM_PROXY_CLIENT = None


def _extract_proxy_model_name(body_bytes: bytes, path: str) -> str | None:
    """从 POST body（JSON ``model`` 字段）或 path 中提取 model 名（task-04）。

    Claude Code 打 /v1/messages 时 model 在 body；path 兜底防御性保留（未来
    /models/{model} 类路由）。解析失败 / 非 JSON → None（无 model 语义，放行）。
    """
    if body_bytes:
        try:
            parsed = json.loads(body_bytes)
            if isinstance(parsed, dict) and isinstance(parsed.get("model"), str):
                return parsed["model"]
        except (ValueError, TypeError):
            return None
    seg = path.rstrip("/").rsplit("/", 1)[-1]
    return seg or None


# 拆 GET/POST 两个入口共享内部实现：api_route 多方法会让 FastAPI 为每个 method 生成
# 同名 operation id，openapi-typescript 生成重复 TS 标识符（api-types.ts 编译炸）。
# GET/HEAD 同读语义、POST 主通道；OPTIONS 由 Starlette CORSMiddleware 处理。
@router.get("/llm-proxy/{path:path}", include_in_schema=True)
async def llm_proxy_get(path: str, request: Request) -> StreamingResponse:
    return await _llm_proxy_impl(path, request)


@router.post("/llm-proxy/{path:path}", include_in_schema=True)
async def llm_proxy_post(path: str, request: Request) -> StreamingResponse:
    return await _llm_proxy_impl(path, request)


async def _llm_proxy_impl(path: str, request: Request) -> StreamingResponse:
    """LiteLLM 透传代理（task-04 / FR-03 / D-003@v1）——master key 唯一注入点。

    master key 收窄（Grill M-1）后 daemon 子进程不再持有 ``litellm_master_key``
    （context.py 两处 openai_chat 分支改下发 ``litellm_proxy`` 标记 + 代理地址），
    子进程的 ``Authorization: Bearer``（daemon apiKey 或 JWT）打本端点，backend：

    1. **鉴权**（Grill UB-4a）：不能走标准 ``get_current_principal`` Depends——
       其 Bearer 分支只认 JWT，而子进程 Bearer 值是 daemon 的 ``shk_live_``
       apiKey。复用 task-01 ``_authenticate_ws_upgrade`` 同款分流（X-API-Key /
       Bearer ``shk_live_`` 前缀 → ApiKeyService；否则 JWT decode + DB 查用户），
       经 :func:`_authenticate_http_bearer` 薄封装（HTTP Request 与 WebSocket
       的 ``headers`` API 同构）。失败 401。
    2. **model 归属断言**（Grill UB-4b）：POST body 的 ``model`` 字段形如
       ``usr-<uid>-<pid>``（litellm_model_name 单一真相源格式）时，断言 uid ==
       认证 user.id，不匹配 403——任何有效用户不能经代理消耗他人上游 key。
       无 model 字段（GET /models 类）放行转发并记 warn。
    3. **转发**：httpx AsyncClient 流式转发 ``settings.litellm_base_url + '/' +
       path``，注入 ``Authorization: Bearer {settings.litellm_master_key}``，
       响应经 StreamingResponse 逐块透传（上游状态码 + 头），剥离 hop-by-hop。

    master key 只存在于 backend 进程内（转发瞬间注入）：不进日志 / 响应 / 错误
    信息（constraints）。请求 body 读流后驻留内存副本转发（不落盘不复述）；
    httpx client 按请求短建短收（对齐 R-02，不占全局连接池 slot）。
    """
    settings = get_settings()
    if not settings.litellm_master_key:
        # fail-fast：master key 未配置时绝不匿名转发上游（503 比依赖上游拒绝更可诊断）。
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="llm proxy upstream not configured",
        )

    # ── 0. 路径白名单（step-14 QA H-1）──非推理面路径一律 404，不触上游。
    # master key 注入使本代理等同 admin 通道，任何非白名单路径（LiteLLM admin
    # API：/model/new、/key/generate、/user/* 等）都不得经代理可达。
    if _LLM_PROXY_PATH_RE.match(path) is None:
        log.warning("llm_proxy_path_not_allowed", method=request.method, path=path)
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="llm proxy path not allowed"
        )

    # ── 1. 鉴权（复用 task-01 分流口径，失败 401）──
    principal = await _authenticate_http_bearer(request)
    if principal is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="authentication required",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # ── 2. model 归属断言（Grill UB-4b）──
    body_bytes = b""
    model_name: str | None = None
    if request.method == "POST":
        body_bytes = await request.body()
        model_name = _extract_proxy_model_name(body_bytes, path)
        if model_name is not None:
            m = _LITELLM_MODEL_NAME_RE.match(model_name)
            if m is not None and m.group(1) != str(principal.id):
                # 不回显 model 名 / uid——403 detail 固定短语，不泄请求内容。
                log.warning(
                    "llm_proxy_model_ownership_mismatch",
                    path=path,
                    principal_user_id=str(principal.id),
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="model ownership mismatch",
                )

    if not model_name:
        # GET /models 等无 model 语义请求放行（warn 留痕，不拦——LiteLLM 侧
        # 列表按 master key 权限返回，无归属维度）。
        log.info("llm_proxy_request_without_model", method=request.method, path=path)

    # ── 3. 流式转发（master key 仅在此时注入）──
    # query string 透传（step-14 QA L-2）：原请求带 ?… 时拼回上游 URL（Claude Code
    # 打 /v1/messages?beta=true 类带参请求此前会被静默丢参）。
    upstream_url = f"{settings.litellm_base_url.rstrip('/')}/{path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"

    fwd_headers: dict[str, str] = {}
    for key, value in request.headers.items():
        # 剥离 hop-by-hop；Authorization 一律丢弃（大小写不敏感——httpx 下来的
        # 是小写 authorization），下方统一替换为 master key，绝不双发。
        if key.lower() not in _HOP_BY_HOP_HEADERS and key.lower() != "authorization":
            fwd_headers[key] = value
    fwd_headers["Authorization"] = f"Bearer {settings.litellm_master_key}"

    # 上游响应元数据经 holder 透出（StreamingResponse 需在返回前定状态码/头，
    # 而 httpx stream 模式不 raise_for_status，透传必须显式取 resp.status_code）。
    upstream_meta: dict[str, Any] = {}

    async def _forward() -> AsyncGenerator[bytes]:
        # 共享连接池客户端：不 per-request 关闭（shutdown 统一 close）；上游响应
        # 流仍逐请求 aclose（finally），连接归还池中复用。
        client = _get_llm_proxy_client()
        upstream_request = client.build_request(
            request.method,
            upstream_url,
            headers=fwd_headers,
            content=body_bytes if body_bytes else None,
        )
        upstream_response = await client.send(upstream_request, stream=True)
        upstream_meta["status_code"] = upstream_response.status_code
        upstream_meta["headers"] = upstream_response.headers
        try:
            async for chunk in upstream_response.aiter_raw():
                yield chunk
        finally:
            await upstream_response.aclose()

    # 先探一块拿到上游状态码 / 头（在返回 StreamingResponse 之前，此处抛错可
    # 落 502 而不是吞成 200 空响应）；空响应体（HEAD）走 StopAsyncIteration 分支。
    gen = _forward()
    chunks: list[bytes] = []
    try:
        chunks.append(await gen.__anext__())
    except StopAsyncIteration:
        pass
    except httpx.HTTPError as exc:
        log.warning("llm_proxy_upstream_failed", path=path, error_type=type(exc).__name__)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail="llm proxy upstream unavailable",
        ) from exc

    upstream_headers = upstream_meta.get("headers") or {}
    passthrough_headers = {
        k: v for k, v in upstream_headers.items() if k.lower() not in _HOP_BY_HOP_HEADERS
    }

    async def _replay() -> AsyncGenerator[bytes]:
        for chunk in chunks:
            yield chunk
        async for chunk in gen:
            yield chunk

    return StreamingResponse(
        _replay(),
        status_code=upstream_meta.get("status_code", status.HTTP_200_OK),
        headers=passthrough_headers,
    )


# ── WebSocket endpoint ───────────────────────────────────────────────────────


async def _authenticate_http_bearer(request: Request) -> User | None:
    """task-04（FR-03 / D-003@v1）：HTTP 请求凭据解析——WS 升级鉴权的 Request 版。

    :func:`_authenticate_ws_upgrade` 的分流口径逐字一致（X-API-Key →
    ApiKeyService；Bearer ``shk_live_`` 前缀短路 → ApiKeyService；否则 JWT
    decode + DB 查用户，active / 未软删）。HTTP ``Request.headers`` 与
    WebSocket ``headers`` API 同构，本 helper 把复用做到参数层（duck-typed
    ``headers`` 属性），供 llm-proxy 端点在标准 Depends 鉴权之外自解析
    （get_current_principal 的 Bearer 分支只认 JWT，不认子进程 shk_live_ Bearer）。

    返回 :class:`User`；无凭据 / 凭据无效 / 用户已失效返回 None（调用方 401）。
    """
    return await _authenticate_bearer_headers(request.headers)


async def _authenticate_bearer_headers(headers: Any) -> User | None:
    """task-04：凭据分流公共实现（WebSocket / Request ``headers`` 同构复用）。"""

    # 只认 header，不引入 query token 回退（design §5 将删除 query 回退）。
    raw_auth = headers.get("authorization") or headers.get("Authorization")
    api_key = headers.get("x-api-key") or headers.get("X-API-Key")
    if api_key:
        api_key = api_key.strip() or None

    async with get_session_factory()() as session:
        settings = get_settings()
        # 路径 1：X-API-Key header 直接走 ApiKeyService。
        if api_key is not None:
            user = await ApiKeyService(session, settings=settings).authenticate(plaintext=api_key)
            return user

        # 路径 2：Authorization Bearer——shk_live_ 前缀短路走 ApiKeyService
        # （对齐 auth_deps._extract_bearer 的 Bearer 语义），否则 JWT 解码。
        bearer: str | None = None
        if raw_auth:
            parts = raw_auth.split()
            if len(parts) == 2 and parts[0].lower() == "bearer":
                bearer = parts[1].strip() or None
        if bearer is None:
            return None

        if bearer.startswith(API_KEY_PREFIX):
            user = await ApiKeyService(session, settings=settings).authenticate(plaintext=bearer)
            return user

        # JWT 路径：解码 + DB 查用户（active / 未软删，与 get_current_user
        # 同口径）。任何解码失败都按无效凭据处理（调用方 401）。
        try:
            payload = decode_access_token(bearer, settings=settings)
        except AccessTokenError:
            log.info("bearer_auth_jwt_invalid")
            return None
        user = await session.get(User, payload.sub)
        if user is None or user.deleted_at is not None or user.status != "active":
            return None
        return user


async def _authenticate_ws_upgrade(websocket: WebSocket) -> User | None:
    """task-01（FR-01 / D-001@v1）：WS 升级期凭据解析，accept 前调用。

    WS 端点不能走标准 Depends 鉴权（get_current_principal 依赖 Request +
    DI session），starlette WebSocket 恰有同名 ``headers`` / ``query_params``
    API，故本 helper 直接读取升级请求头并自建短 session 解析 principal。

    解析顺序（与 get_current_principal 同源，Bearer 分流对齐 llm-proxy
    task-04 的 ANTHROPIC_AUTH_TOKEN 语义）：

    1. ``X-API-Key: <plaintext>`` → ``ApiKeyService.authenticate``；
    2. ``Authorization: Bearer <token>``：值带 ``shk_live_`` 前缀短路走
       ApiKeyService（子进程只发 Bearer 的场景），否则 JWT 解码 +
       DB 查用户（active / 未软删，校验口径与 get_current_user 一致）。

    返回 :class:`User`；无凭据 / 凭据无效 / 用户已失效一律返回 ``None``
    （调用方据此 close code=4001，reason 建议统一 "authentication
    required"）。归属不匹配**不在本 helper 判断**（4003 语义属调用方，
    daemon WS 与 llm-proxy 各自断言）。

    task-04 llm-proxy 复用契约：本 helper 仅做凭据 → User 解析，不含
    4001/4003 close 行为；拒绝码语义由各调用方落地（daemon WS：4001 无/
    坏凭据、4003 归属不匹配）。task-04 落地后分流公共实现已提取为
    :func:`_authenticate_bearer_headers`（WebSocket / Request ``headers``
    API 同构），本 helper 是其 WebSocket 薄封装。
    """
    return await _authenticate_bearer_headers(websocket.headers)


@router.websocket("/ws")
async def daemon_websocket(
    websocket: WebSocket,
    daemon_local_id: str = Query(
        ...,
        description="Daemon-local UUID (daemon_instances.id). Replaces the legacy runtime_id handshake (task-06 / D-006 / design §5.3).",
    ),
) -> None:
    """WebSocket endpoint for daemon entity real-time communication (task-06).

    Each daemon process connects **once** with its ``daemon_local_id`` (the
    locally-persisted uuid surfaced as ``daemon_instances.id``). The backend
    looks up that id, registers the connection keyed by ``daemon_id``, and
    routes all server→daemon messages over this single socket. Provider-level
    dispatch (which runtime/session a message targets) is carried inside each
    payload's ``runtime_id`` field (design §5.3).

    Breaking change (D-007): the legacy ``?runtime_id=...`` handshake is no
    longer accepted — old daemons are rejected with code=4001 and a hint to
    upgrade.

    task-01（FR-01 / D-001@v1）升级期鉴权：daemon 须带 ``X-API-Key: <shk_live_
    ...>``（或 ``Authorization: Bearer``）连接；在 accept 之前完成凭据解析
    （:func:`_authenticate_ws_upgrade`）并断言归属——无凭据 / 凭据无效
    close 4001，解析出的 user.id 与 ``DaemonInstance.user_id`` 不匹配 close
    4003。**query token 回退已移除**，未升级的旧 daemon 一律 4001。
    """
    # Validate daemon_local_id format before accepting.
    try:
        daemon_id = uuid.UUID(daemon_local_id)
    except (ValueError, AttributeError):
        log.warning("ws_invalid_daemon_local_id", daemon_local_id=daemon_local_id)
        await websocket.close(code=4001, reason="invalid daemon_local_id")
        return

    # Look up the daemon entity (must be registered first via POST /register).
    # Lazy import keeps the model import off the hot path and matches the
    # ws_hub singleton accessor pattern below.
    from app.core.db import get_session_factory

    try:
        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            instance = await ws_session.get(DaemonInstance, daemon_id)
    except Exception:
        log.exception(
            "ws_handshake_instance_lookup_failed",
            daemon_id=str(daemon_id),
        )
        await websocket.close(code=1011, reason="internal error")
        return

    if instance is None:
        # Unknown daemon_local_id → reject (not registered). Old daemons that
        # still send a runtime_id here arrive as a parse-failure above; a
        # daemon_local_id that parses but has no row means the daemon skipped
        # registration — both are handshake failures (D-007 breaking).
        log.warning(
            "ws_handshake_unknown_daemon",
            daemon_id=str(daemon_id),
            hint="daemon must POST /register before opening the WS",
        )
        await websocket.close(
            code=4001, reason="unknown daemon_local_id; upgrade daemon and register first"
        )
        return

    # task-01：accept 之前的升级期鉴权——凭据解析 + daemon 归属断言。
    # 无凭据 / 凭据无效 4001；归属不匹配 4003（不泄露 daemon 存在性之外的
    # 信息，reason 固定语义短语）。
    try:
        principal = await _authenticate_ws_upgrade(websocket)
    except Exception:
        log.exception("ws_upgrade_auth_failed", daemon_id=str(daemon_id))
        await websocket.close(code=1011, reason="internal error")
        return

    if principal is None:
        log.warning("ws_upgrade_auth_rejected", daemon_id=str(daemon_id))
        await websocket.close(code=4001, reason="authentication required")
        return

    if principal.id != instance.user_id:
        log.warning(
            "ws_upgrade_auth_ownership_mismatch",
            daemon_id=str(daemon_id),
            principal_user_id=str(principal.id),
            owner_user_id=str(instance.user_id),
        )
        await websocket.close(code=4003, reason="daemon instance ownership mismatch")
        return

    await websocket.accept()

    # Lazy import (matches placement.py / agent.service.py): the ws_hub
    # singleton accessor is patched per-test via ws_hub.get_daemon_ws_hub, and a
    # module-top `from ... import` would bind a stale/mock ref if this module
    # were first imported while such a patch was active.
    from app.modules.daemon.ws_hub import get_daemon_ws_hub

    hub = get_daemon_ws_hub()
    await hub.connect(daemon_id, websocket)

    try:
        while True:
            try:
                data = await websocket.receive_json()
            except ValueError:
                log.warning(
                    "ws_invalid_json",
                    daemon_id=str(daemon_id),
                )
                continue

            msg_type = data.get("type")

            if msg_type == DAEMON_MSG_HEARTBEAT:
                # design §10 risk control: the daemon may include a provider
                # runtime_id in the payload; validate it belongs to this daemon
                # entity and drop on mismatch (best-effort, never close WS).
                raw_payload = data.get("payload") or {}
                await _validate_payload_runtime_belongs(
                    daemon_id,
                    raw_payload,
                    "heartbeat",
                )
                log.debug("ws_heartbeat_received", daemon_id=str(daemon_id))
                await hub.send_heartbeat_ack(
                    daemon_id,
                    payload_runtime_id=await _payload_runtime_id(raw_payload, daemon_id),
                )
            elif msg_type == DAEMON_MSG_RPC_RESULT:
                # daemon → server RPC reply. Route to the pending future via the
                # hub correlation map; struct validation + error mapping lives in
                # the send_rpc call chain (list-dir endpoint), not here.
                payload = data.get("payload") or {}
                rpc_id = payload.get("rpc_id")
                if not rpc_id:
                    log.warning(
                        "ws_rpc_result_missing_id",
                        daemon_id=str(daemon_id),
                        msg=data,
                    )
                    continue
                await hub.resolve_rpc(rpc_id, payload)
            elif msg_type == DAEMON_MSG_PERMISSION_REQUEST:
                # task-08 / FR-07 / D-007@v1: daemon canUseTool uplink.
                # Validate the payload shape; on any validation error warn and
                # drop (never close the WS — task-03 NFR-05). The permission
                # service runs its own session/runtime/run/manual_approval
                # validation and either publishes SSE + arms the 5min timer or
                # logs a warning and returns.
                raw_payload = data.get("payload") or {}
                try:
                    payload = PermissionRequestPayload(**raw_payload)
                except Exception:
                    log.warning(
                        "ws_permission_request_invalid_payload",
                        daemon_id=str(daemon_id),
                        payload=raw_payload,
                    )
                    continue
                # design §10: the session referenced by the request must be
                # owned by the daemon that opened this connection. The
                # permission service repeats this check internally; we pass the
                # connection's daemon_id so the service can map session → daemon.
                # Open a short-lived DB session for the request (WS loop has no
                # request-scoped dependency). Best-effort; failures only warn.
                try:
                    session_factory = get_session_factory()
                    async with session_factory() as ws_session:
                        svc = DaemonService(ws_session)
                        perm = _router.DaemonPermissionService(svc, hub)
                        await perm.handle_permission_request(daemon_id, payload)
                except Exception:
                    log.exception(
                        "ws_permission_request_handler_failed",
                        daemon_id=str(daemon_id),
                        request_id=payload.request_id,
                    )
            else:
                log.warning(
                    "ws_unknown_message_type",
                    daemon_id=str(daemon_id),
                    msg_type=msg_type,
                )
    except WebSocketDisconnect as exc:
        # 记 close code/reason：区分 1000(主动关) / 1006(网络层断) / 1011 / 4000(replaced) 等，
        # 否则 daemon 端 WS 断开（尤其 import get_spec_bundle 期间）只能看到 "disconnected"，无法定位根因。
        log.info(
            "ws_client_disconnected",
            daemon_id=str(daemon_id),
            code=getattr(exc, "code", None),
            reason=getattr(exc, "reason", None) or "",
        )
    except Exception:
        log.exception("ws_unexpected_error", daemon_id=str(daemon_id))
    finally:
        await hub.disconnect(daemon_id)


async def _payload_runtime_id(
    raw_payload: dict,
    daemon_id: uuid.UUID,
) -> uuid.UUID:
    """Extract ``payload.runtime_id`` if present and well-formed, else daemon_id.

    Used to echo the provider runtime_id back in heartbeat_ack so the daemon
    can correlate the ack to a provider session (design §5.3).
    """
    raw = raw_payload.get("runtime_id")
    if not raw:
        return daemon_id
    try:
        return uuid.UUID(str(raw))
    except (ValueError, AttributeError):
        return daemon_id


async def _validate_payload_runtime_belongs(
    daemon_id: uuid.UUID,
    raw_payload: dict,
    label: str,
) -> None:
    """design §10 risk control: payload.runtime_id must belong to daemon_id.

    Validates that a ``runtime_id`` carried inside an inbound WS payload
    resolves to a ``daemon_runtimes`` row whose ``daemon_instance_id`` equals
    the connection's ``daemon_id``. On mismatch (dirty data / cross-daemon
    leak) the message is *not* rejected here — callers drop the message and
    this helper only emits a warning. Best-effort: DB lookup failures are
    logged and treated as valid (fail-open) so a transient DB hiccup cannot
    stall the WS receive loop.
    """
    raw_rid = raw_payload.get("runtime_id")
    if not raw_rid:
        return  # payload carries no runtime_id — nothing to validate.
    try:
        runtime_id = uuid.UUID(str(raw_rid))
    except (ValueError, AttributeError):
        log.warning(
            "ws_payload_invalid_runtime_id",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=raw_rid,
        )
        return

    try:
        from app.modules.daemon.model import DaemonRuntime

        session_factory = get_session_factory()
        async with session_factory() as ws_session:
            runtime = await ws_session.get(DaemonRuntime, runtime_id)
    except Exception:
        # Fail-open on DB errors — never stall the WS loop.
        log.exception(
            "ws_payload_runtime_validation_db_error",
            label=label,
            daemon_id=str(daemon_id),
            runtime_id=str(runtime_id),
        )
        return

    if runtime is None or runtime.daemon_instance_id != daemon_id:
        log.warning(
            "ws_payload_runtime_id_mismatch",
            label=label,
            daemon_id=str(daemon_id),
            payload_runtime_id=str(runtime_id),
            bound_daemon_id=str(runtime.daemon_instance_id) if runtime else None,
            hint="dropping message; payload.runtime_id not owned by this connection",
        )
