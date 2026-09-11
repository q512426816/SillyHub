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
   ``from .server import mcp`` + ``@mcp.tool()`` 注册 12 个 tool（以 tools.py 实际为准）。

task-05 ``provides`` 契约 :data:`McpServerInstance`（``server`` + ``mount_path``）：
task-06/13 消费 :data:`mcp` 注册 tool，消费 :data:`mount_path` 知道对外 URL。
"""

from __future__ import annotations

from urllib.parse import urlparse

from fastapi import FastAPI, Request
from mcp.server.fastmcp import FastMCP
from mcp.server.transport_security import TransportSecuritySettings

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
#: 在此实例上注册 12 个 tool（design §7.1，以 tools.py 实际为准）。transport 是 streamable HTTP
#:（协议版本 ``2025-11-25``，spike 实测握手）。
mcp: FastMCP = FastMCP("sillyhub-public", streamable_http_path="/")


def _build_transport_security() -> TransportSecuritySettings:
    """按部署配置构建 SDK 的 DNS rebinding 防护白名单（2026-09-10 spike P0-1 坑 6）。

    FastMCP 构造时 ``host`` 落在 localhost 形态会**自动启用**
    ``TransportSecuritySettings``，白名单只有 ``127.0.0.1/localhost/[::1]``——
    经反代以公网域名访问时，过完 Bearer 鉴权的请求会被 SDK 的 Host 校验拦成
    ``421 Invalid Host header``（本地 localhost 联调不触发，远端必现）。

    白名单来源（并集）：

    1. localhost 三件套（本地 dev 零回归，含端口通配）；
    2. ``MCP_GATEWAY_PUBLIC_BASE_URL`` 的 host（钉死了对外 origin 的部署自动放行）；
    3. ``MCP_ALLOWED_HOSTS``（逗号分隔，任意多入口/别名场景，如
       ``crrcdt.ppdmq.top,10.0.0.5:8001``）。

    每个条目同时登记裸 host 与 ``host:*``（SDK 只对 ``:*`` 结尾模式做端口前缀
    匹配，无端口的 Host 头是精确匹配——443 默认端口的反代域名不带端口）。
    """
    from app.core.config import get_settings

    settings = get_settings()
    hosts: list[str] = ["127.0.0.1", "localhost", "[::1]"]
    origins: list[str] = [
        "http://127.0.0.1:*",
        "http://localhost:*",
        "http://[::1]:*",
    ]

    def _allow(entry: str) -> None:
        raw = entry.strip()
        if not raw:
            return
        if raw.endswith(":*"):
            # 已是端口通配形态：登记原样 + 裸 host（无端口 Host 头是精确匹配）。
            hosts.extend([raw, raw[:-2]])
        elif raw.count(":") == 1 and not raw.startswith("["):
            # 显式端口（如 10.0.0.5:8001）：只登记原样（精确匹配）。
            hosts.append(raw)
        else:
            # 裸 host：登记原样 + 端口通配（443 反代域名 Host 不带端口）。
            hosts.extend([raw, f"{raw}:*"])

    public = settings.mcp_gateway_public_base_url.strip()
    if public:
        parsed = urlparse(public if "://" in public else f"https://{public}")
        _allow((parsed.hostname or "").strip("[]"))
        origins.append(f"{parsed.scheme}://{parsed.netloc}:*")
    for extra in settings.mcp_allowed_hosts.split(","):
        _allow(extra)

    return TransportSecuritySettings(
        enable_dns_rebinding_protection=True,
        allowed_hosts=hosts,
        allowed_origins=origins,
    )


def mount_mcp(app: FastAPI) -> None:
    """把 MCP server 挂到父 FastAPI 的 :data:`mount_path` 上。

    装配步骤（spike-A 验证写法 + 2026-09-10 坑 6）：

    0. ``mcp.settings.transport_security = _build_transport_security()``——在
      ``streamable_http_app()`` 惰性创建 session manager（构造时读取该 settings）
      **之前**替换掉 SDK 对 localhost 形态自动生成的默认白名单（否则公网域名
      过鉴权后被 SDK Host 校验 421，坑 6）。
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
    mcp.settings.transport_security = _build_transport_security()
    mcp_app = mcp.streamable_http_app()
    mcp_app.add_middleware(McpAuthMiddleware)
    app.mount(mount_path, mcp_app)


def resolve_gateway_url(request: Request | None = None) -> str | None:
    """解析对外 MCP 接入 URL（规范端点 ``{origin}/mcp/``，带尾斜杠）。

    2026-09-10-mcp-gateway-dispatch-fixes（spike P0-2）：mcp-tokens 签发响应把
    ``gateway_url`` 与 token **成对**下发——url 指哪、token 就在哪生效，调用方
    （如 sillyspec connect 流程）把两者原样一起落盘即可，杜绝「url 指远端、token
    是本地签发」的三头分裂。

    ql-20260911-003-355a P2 修正：**只信显式配置**——``Settings.
    mcp_gateway_public_base_url``（env ``MCP_GATEWAY_PUBLIC_BASE_URL``）。
    未配置时返回 ``None``（响应 gateway_url 置 null），不再从 ``X-Forwarded-*`` /
    ``Host`` 头推导：这些头可被签发请求方影响（反代 ``$host`` 取自客户端 Host），
    token 按「成对落盘」约定会被发往头指定的任意主机（自伤/钓鱼面）。调用方见
    null 即知部署未配置，应参照部署文档显式配置后重签。

    Args:
        request: 签发请求（保留参数兼容既有调用方；未配置路径不消费）。

    Returns:
        形如 ``https://crrcdt.ppdmq.top/mcp/`` 的完整端点（尾斜杠必需，坑 3）；
        未显式配置 → ``None``。
    """
    from app.core.config import get_settings

    configured = get_settings().mcp_gateway_public_base_url.strip()
    if configured:
        return f"{configured.rstrip('/')}{mount_path}/"
    return None


# 装配副作用 import（task-06 协调）：import tools 触发 @mcp.tool() 注册 12 个 tool，
# 否则生产 /mcp tools/list 看不到它们。mcp 实例在本模块第 59 行已定义，
# tools.py 的 ``from .server import mcp`` 在此处可安全解析（无循环）。
# 下方 import 仅为副作用（注册 5 个 tool），名字不被引用，故行尾标 noqa: F401。
from app.modules.mcp_gateway import tools  # noqa: F401,E402

__all__ = ["mcp", "mount_mcp", "mount_path", "resolve_gateway_url"]
