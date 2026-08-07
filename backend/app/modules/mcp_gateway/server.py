"""MCP gateway 的 FastMCP 服务实例 + ``/mcp`` mount 装配。

本模块是对外暴露 MCP（Model Context Protocol）server 的入口：
``FastMCP`` 实例 :data:`mcp` 以 streamable HTTP transport（2025 官方推荐，
取代老 SSE）挂到父 FastAPI 的 ``/mcp`` 路径下，供第三方 MCP client 接入。

按 task-04 spike-A 实跑验证通过写法落地（spike 报告
``spikes/mcp-fastmcp-mount-spike.md``，**PASS**）。注意：design §5.2 P1 / §6
原写的 ``mcp.http_app()`` 在官方 mcp SDK v1（``mcp>=1.29,<2``）**不存在**，
v1 实际方法是 :meth:`FastMCP.streamable_http_app`（坑 1）。本模块严格按
spike 验证版本写，不照 design 原文。

spike 锁定的 5 个坑（写法约束）：

1. **P0 方法名**：``streamable_http_app()``（非 ``http_app()``，后者属第三方
   ``fastmcp`` PrefectHQ 线，别把两套 SDK 文档混着看）。
2. **P0 lifespan 合并**：父 FastAPI 的 lifespan 必须手动驱动
   ``async with mcp.session_manager.run(): yield``，否则 Starlette ``Mount``
   不会自动跑子 app lifespan → session manager 不启动 → client ``initialize``
   挂死。合并发生在 ``app/main.py``（那里本来就有 lifespan）。
3. **P1 端点尾斜杠**：``FastMCP(streamable_http_path="/")`` + ``app.mount("/mcp", ...)``
   → 实际端点 ``/mcp/``（带尾斜杠）。若用默认 ``streamable_http_path="/mcp"``，
   Starlette ``Mount`` 会 307 重定向到 ``/mcp/``，而 MCP client 的 POST
   不跟随 307 → 报 ``HTTPStatusError: Redirect response '307'``。
   task-07 给第三方的接入 URL 记成 ``https://<host>/mcp/``（带尾斜杠）。
4. **P1 middleware 挂子 app**：``mcp_app.add_middleware(McpAuthMiddleware)``
   挂在 streamable_http_app() 返回的子 app 上（CC-06：与 ``/api`` 的
   ``get_current_principal`` 物理隔离，子 app middleware 只对 ``/mcp/*`` 生效）。
5. **P2 mcp 实例导出**：``mcp`` 放本模块导出，task-06 ``tools.py`` 经
   ``from .server import mcp`` + ``@mcp.tool()`` 注册 8 个 tool。

task-05 ``provides`` 契约 :data:`McpServerInstance`（``server`` + ``mount_path``）：
task-06/13 消费 :data:`mcp` 注册 tool，消费 :data:`mount_path` 知道对外 URL。
"""

from __future__ import annotations

from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

from app.modules.mcp_gateway.auth import McpAuthMiddleware

#: MCP server 对外挂载路径。streamable_http_path="/" 让内层 Route 落在 "/"，
#: mount "/mcp" 后实际端点正好是 ``/mcp/``（带尾斜杠，坑 3）。
#:
#: task-07 给第三方 client 的接入 URL 记成 ``https://<host>/mcp/``。
mount_path: str = "/mcp"

#: FastMCP 服务实例（task-05 ``provides.McpServerInstance.server``）。
#:
#: - ``name="sillyhub-public"``：对外展示的 server 名（MCP 协议 initialize
#:   响应里返回给 client）。
#: - ``streamable_http_path="/"``：坑 3 —— 内层 Route 落 "/"，mount "/mcp"
#:   后端点 ``/mcp/``（尾斜杠），避开 Starlette Mount 的 307 重定向。
#:
#: task-06 ``tools.py`` 经 ``from .server import mcp`` + ``@mcp.tool()``
#: 在此实例上注册 8 个 tool（design §7.1）。transport 是 streamable HTTP
#:（协议版本 ``2025-11-25``，spike 实测握手）。
mcp: FastMCP = FastMCP("sillyhub-public", streamable_http_path="/")


def mount_mcp(app: FastAPI) -> None:
    """把 MCP server 挂到父 FastAPI 的 :data:`mount_path` 上。

    三步装配（spike-A 验证写法）：

    1. ``mcp.streamable_http_app()`` 拿 Starlette 子 app（坑 1：非 ``http_app()``）。
    2. ``add_middleware(McpAuthMiddleware)`` 把 task-03 鉴权中间件挂到**子 app**
      （坑 4 / CC-06：物理隔离 ``/api`` 的鉴权通道，子 app middleware 只对
       ``/mcp/*`` 生效）。``McpAuthMiddleware`` 解析 ``Authorization: Bearer
       <McpToken>``，命中即把 :class:`~app.modules.mcp_gateway.auth.McpAuthContext`
       挂到 ``request.state.mcp_auth``，task-06 tool handler 经
       ``ctx.request_context.request.state.mcp_auth`` 读。
    3. ``app.mount(mount_path, mcp_app)`` 挂载（端点实际 ``/mcp/``，坑 3）。

    父 app lifespan 须另行合并 ``async with mcp.session_manager.run(): yield``
    （坑 2，在 ``app/main.py`` 处理），否则 ``initialize`` 挂死。本函数只负责
    mount，不含 lifespan（main.py 的 lifespan 已存在，不能被覆盖）。

    Args:
        app: 父 FastAPI 实例（``create_app()`` 里新建的那个）。
    """
    mcp_app = mcp.streamable_http_app()
    mcp_app.add_middleware(McpAuthMiddleware)
    app.mount(mount_path, mcp_app)


# 装配副作用 import（task-06 协调）：import tools 触发 @mcp.tool() 注册 5 个 tool，
# 否则生产 /mcp tools/list 看不到它们。mcp 实例在本模块第 59 行已定义，
# tools.py 的 ``from .server import mcp`` 在此处可安全解析（无循环）。
# noqa: F401（有意保留 import 副作用）。
from app.modules.mcp_gateway import tools  # noqa: F401,E402

__all__ = ["mcp", "mount_mcp", "mount_path"]
