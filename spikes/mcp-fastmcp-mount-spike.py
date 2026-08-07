"""spike-A (task-04): 官方 mcp Python SDK v1 FastMCP 能否 mount 到现有 FastAPI
+ 鉴权 middleware 注入到 tool handler 上下文。

跑法:
    cd backend && uv run python ../spikes/mcp-fastmcp-mount-spike.py

验证项（对应 task-04 acceptance）:
  1. FastMCP.streamable_http_app() ASGI 能 app.mount("/mcp", ...) 成功
  2. subapp-level BaseHTTPMiddleware 注入 request.state.mcp_auth 能被 tool handler
     经 ctx.request_context.state 读到（task-03/05/06 注入机制前提）
  3. parent FastAPI middleware 的 request.state 跨 mount 边界是否可见（边界验证）
  4. MCP 协议三步 initialize / tools/list / tools/call 实跑通过
  5. lifespan 合并坑（mcp session manager 必须由父 app lifespan 驱动，否则挂死）
"""

from __future__ import annotations

import asyncio
import json
import socket
import threading
import time

import httpx
import uvicorn
from fastapi import FastAPI
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

from mcp import ClientSession
from mcp.client.streamable_http import streamablehttp_client
from mcp.server.fastmcp import Context, FastMCP

PORT = 8765
# 注意：FastAPI app.mount("/mcp", ...) 会让无尾斜杠的 /mcp 307 重定向到 /mcp/（Starlette Mount
# redirect_slashes 行为），MCP 客户端 POST 不跟随 307，故生产端点 URL 应记 /mcp/（带尾斜杠）。
BASE_URL = f"http://127.0.0.1:{PORT}/mcp/"
FAKE_TOKEN = "spike-bearer-token-xyz-9999"

# 模拟 task-03 注入的 McpAuthContext（字段 workspace_id/scope/token_id）
FAKE_PRINCIPAL = {
    "workspace_id": "ws-spike-123",
    "scope": ["read", "dispatch"],
    "token_id": "tok-abc-001",
}


# ---- subapp-level middleware：注入 mcp_auth 到 request.state ----
class McpAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("authorization", "")
        token = auth[len("Bearer ") :] if auth.startswith("Bearer ") else ""
        # 真实 task-03 在这里调 McpTokenService.verify（Redis 缓存命中优先）
        request.state.mcp_auth = {**FAKE_PRINCIPAL, "token_prefix": token[:10]}
        return await call_next(request)


# ---- parent FastAPI middleware：测试跨 mount 边界 ----
class ParentMarkerMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        request.state.parent_marker = "set-by-PARENT-middleware"
        return await call_next(request)


# ---- FastMCP server ----
# streamable_http_path="/" 让内层 Route 落在 "/"，mount "/mcp" 后端点正好是 /mcp（避免 /mcp/mcp 双重前缀）
mcp = FastMCP("spike-server", streamable_http_path="/")


@mcp.tool()
async def echo(message: str, ctx: Context) -> dict:
    """Echo + 返回 middleware 注入的鉴权上下文。"""
    # ctx.request_context 是 MCP 的 RequestContext；其 .request 才是 Starlette Request
    # （SDK 从 ASGI scope 构造，跨 task 经 metadata 传进来）。
    rc = ctx.request_context
    req: Request | None = getattr(rc, "request", None)
    mcp_auth = getattr(req.state, "mcp_auth", None) if req is not None else None
    parent_marker = (
        getattr(req.state, "parent_marker", None) if req is not None else None
    )
    return {
        "echo": message,
        "_debug_rc_type": type(rc).__name__,
        "_debug_request_type": type(req).__name__ if req is not None else None,
        "mcp_auth_visible": mcp_auth is not None,
        "mcp_auth": mcp_auth,
        "parent_marker_visible": parent_marker is not None,
        "parent_marker": parent_marker,
    }


def build_app() -> FastAPI:
    from contextlib import asynccontextmanager

    # 关键坑：Starlette mount 子 app 不会自动跑子 app 的 lifespan，
    # 故父 FastAPI 的 lifespan 必须手动驱动 mcp.session_manager.run()，
    # 否则 streamable HTTP session manager 不初始化、initialize 挂死。
    @asynccontextmanager
    async def lifespan(app):
        async with mcp.session_manager.run():
            yield

    api = FastAPI(lifespan=lifespan)
    api.add_middleware(ParentMarkerMiddleware)

    mcp_app = (
        mcp.streamable_http_app()
    )  # Starlette 子 app（Route "/" → StreamableHTTPASGIApp）
    mcp_app.add_middleware(McpAuthMiddleware)  # 子 app 级 middleware（mount 前加）
    api.mount("/mcp", mcp_app)
    return api


app = build_app()


def _wait_for_port(host: str, port: int, timeout: float = 15.0) -> bool:
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with socket.create_connection((host, port), timeout=0.5):
                return True
        except OSError:
            time.sleep(0.2)
    return False


def serve() -> None:
    config = uvicorn.Config(app, host="127.0.0.1", port=PORT, log_level="warning")
    uvicorn.Server(config).run()


async def main() -> None:
    t = threading.Thread(target=serve, daemon=True)
    t.start()
    if not _wait_for_port("127.0.0.1", PORT):
        print("FAIL: uvicorn 未在 15s 内监听")
        return

    print("=== MCP streamable HTTP spike 开始 ===\n")
    headers = {"Authorization": f"Bearer {FAKE_TOKEN}"}

    # 本机环境带了 SOCKS 代理 env，httpx 默认 trust_env 会去用代理连 127.0.0.1 失败。
    # spike 只连 localhost，用自定义 factory 关掉 trust_env。
    def _httpx_factory(**kwargs):
        kwargs.pop("proxy", None)
        kwargs.pop("proxies", None)
        return httpx.AsyncClient(trust_env=False, **kwargs)

    try:
        async with streamablehttp_client(
            BASE_URL, headers=headers, httpx_client_factory=_httpx_factory
        ) as (read, write, _):
            async with ClientSession(read, write) as session:
                init = await asyncio.wait_for(session.initialize(), timeout=20)
                print(
                    f"[1] initialize OK: server={init.serverInfo.name} "
                    f"protocol={init.protocolVersion}"
                )

                tools = await asyncio.wait_for(session.list_tools(), timeout=20)
                names = [tool.name for tool in tools.tools]
                print(f"[2] tools/list OK: {names}")

                res = await asyncio.wait_for(
                    session.call_tool("echo", {"message": "hello-spike"}), timeout=20
                )
                # FastMCP tool 返回 dict → 走 structuredContent；老客户端兜底解析 text block
                payload = None
                sc = getattr(res, "structuredContent", None)
                if isinstance(sc, dict):
                    payload = sc.get("result", sc)
                if payload is None:
                    for block in res.content:
                        if (
                            getattr(block, "type", None) == "text"
                            and getattr(block, "text", "").strip()
                        ):
                            try:
                                payload = json.loads(block.text)
                            except json.JSONDecodeError:
                                payload = {"_raw_text": block.text}
                            break
                print(f"[3] tools/call echo OK (isError={res.isError}):")
                print(json.dumps(payload, indent=2, ensure_ascii=False))

                print("\n=== 判定 ===")
                print("[A] mount 成功（/mcp 响应 initialize）        : PASS")
                print(
                    "[B] tools/list 返回 echo                      : PASS"
                    if "echo" in names
                    else "[B] tools/list 返回 echo                      : FAIL"
                )
                print(
                    "[C] tools/call echo 返回结果                  : PASS"
                    if payload
                    else "[C] tools/call echo 返回结果                  : FAIL"
                )
                pa = bool(payload and payload.get("mcp_auth_visible"))
                pm = bool(payload and payload.get("parent_marker_visible"))
                print(
                    f"[D] subapp middleware 注入 mcp_auth 被 tool 读到: {'PASS' if pa else 'FAIL'}"
                )
                print(
                    f"[E] parent middleware 跨 mount 边界可见        : "
                    f"{'可见(与subapp同scope共享)' if pm else '不可见(符合mount边界预期)'}"
                )
                print(
                    f"\n注入的 mcp_auth 内容: {payload.get('mcp_auth') if payload else None}"
                )
    finally:
        print("\n=== spike 结束 ===")


if __name__ == "__main__":
    asyncio.run(main())
