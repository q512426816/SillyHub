# spike-A（task-04）：FastMCP mount 到 FastAPI + 鉴权 middleware 注入验证

> spike，非生产代码。结论决定 task-05/06（mcp_gateway 落地）与 task-03（middleware 挂载写法）方案。
> 实跑脚本同目录 `mcp-fastmcp-mount-spike.py`（uvicorn 后台线程 + mcp streamable_http client 三步协议实测）。

## 结论：**PASS** ✅

FastMCP（官方 mcp Python SDK v1 线）能 mount 到现有 FastAPI，task-03 的鉴权 middleware 注入的
`request.state` 能被 tool handler 经 `ctx.request_context.request.state` 读到。mount 边界、lifespan、
路径前缀三个坑均有确定写法。**task-05/06 可按 D-007（官方 mcp SDK FastMCP mount）方案推进，不需退回 B/C 备选。**

## 锁定版本（backend/pyproject.toml `mcp>=1.29,<2`）

| 包 | 版本 | 说明 |
|---|---|---|
| **mcp** | **1.29.0** | 官方 Python SDK v1 线（FastMCP + streamable_http_app） |
| fastapi | 0.136.3 | 原 `>=0.115`，加 mcp 后 resolver 升到 0.136.3（在约束内） |
| starlette | 1.1.0 | mcp 依赖 starlette，resolver 升到 1.1.0 |
| pydantic | 2.13.4 | 已有 |
| httpx | 0.28.1 | mcp 自动带 |
| sse-starlette | 3.4.8 | mcp 自动带（streamable HTTP 底层） |
| anyio | 4.13.0 | mcp 自动带 |
| Python | 3.12.10 | 满足 R-04（SDK 要求 >=3.10） |

协议版本（实测握手）：`2025-11-25`（streamable HTTP，非老 SSE）。

### 为什么锁 `<2`（不是最新 stable 2.0.0）

mcp 2.0.0（2026-07-28）是 **breaking 大改**：移除 `FastMCP` 类、改用 `MCPServer`（`from mcp.server import MCPServer`），
`http_app()/streamable_http_app()` API 整个换掉。design D-007 / task-05/06 / 本 task 全部按 v1 `FastMCP + http_app`
写。1.29.0 与 2.0.0 同日发布，v1.x 线仍持续收 critical bugfix / security patch（GitHub `v1.x` 分支）。
**故锁 `mcp>=1.29,<2`**：取最新 FastMCP 线，屏蔽 v2 breaking。后续若要升 v2 是独立 change（需重写 mcp_gateway）。

## 验证结果（mcp client 三步协议实测）

```
[1] initialize OK: server=spike-server protocol=2025-11-25
[2] tools/list OK: ['echo']
[3] tools/call echo OK (isError=False):
{
  "echo": "hello-spike",
  "_debug_rc_type": "RequestContext",
  "_debug_request_type": "Request",     ← ctx.request_context.request 就是 Starlette Request
  "mcp_auth_visible": true,             ← subapp middleware 注入的鉴权上下文被 tool 读到（关键）
  "mcp_auth": {
    "workspace_id": "ws-spike-123",
    "scope": ["read", "dispatch"],
    "token_id": "tok-abc-001",
    "token_prefix": "spike-bear"         ← middleware 读到了 Authorization Bearer 头
  },
  "parent_marker_visible": true,         ← 父 FastAPI middleware 的 state 也跨 mount 边界可见（见坑 4）
  "parent_marker": "set-by-PARENT-middleware"
}
```

| 验收项 | 结果 |
|---|---|
| A. mount 成功（/mcp 响应 initialize） | PASS |
| B. tools/list 返回 echo | PASS |
| C. tools/call echo 返回结果（isError=False） | PASS |
| **D. subapp middleware 注入 mcp_auth 被 tool 读到**（task-03 注入机制前提） | **PASS** |
| E. 父 app middleware 跨 mount 边界可见 | 可见（Starlette 1.1.0 scope["state"] 经 Mount 共享，实测通） |

R-04（Python 3.12 兼容）：app.main 全链 import 通（仅在 `Settings()` 缺 `database_url`/`secret_key` env 时停，
是 env 问题不是依赖冲突）。现有 `/api/*` 路由零回归（spike 只 mount 新 `/mcp`，不动现有路由）。

## 关键机制：middleware 注入的确切写法（给 task-03/05/06 直接抄）

### 1. server 装配（`mcp_gateway/server.py`）

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from mcp.server.fastmcp import FastMCP

# ★ 坑 1：方法是 streamable_http_app()，不是 design 里写的 http_app()
# ★ 坑 3：streamable_http_path="/" 让内层 Route 落 "/"，mount "/mcp" 后端点正好 /mcp/
mcp = FastMCP("sillyhub-mcp", streamable_http_path="/")

@mcp.tool()
async def echo(message: str, ctx: Context) -> dict:
    # ★ 坑 4：Starlette Request 在 ctx.request_context.request，不是 ctx.request_context.state
    req = ctx.request_context.request
    auth = req.state.mcp_auth           # task-03 middleware 注入的 McpAuthContext
    ...

def mount_mcp(api: FastAPI) -> None:
    mcp_app = mcp.streamable_http_app()           # Starlette 子 app
    mcp_app.add_middleware(McpAuthMiddleware)     # ★ 坑 4/5：middleware 加在子 app 上（CC-06 物理隔离）
    api.mount("/mcp", mcp_app)
```

### 2. lifespan 合并（坑 2，**最关键**，漏了 initialize 会挂死）

```python
# app/main.py 的 FastAPI lifespan 必须手动驱动 mcp session_manager，
# 否则 mount 的子 app lifespan 不跑 → streamable HTTP session 不初始化 → initialize 挂死。
@asynccontextmanager
async def lifespan(app):
    async with mcp.session_manager.run():   # 进入 MCP session manager 上下文
        yield

api = FastAPI(lifespan=lifespan)
mount_mcp(api)
```

### 3. 鉴权 middleware（task-03 `mcp_gateway/auth.py`）

```python
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request

class McpAuthMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        auth = request.headers.get("authorization", "")
        token = auth[len("Bearer "):] if auth.startswith("Bearer ") else ""
        # 真实逻辑：复用 task-02 McpTokenService.verify（Redis 缓存命中优先）
        ctx = await mcp_token_service.verify(token)   # 无效/吊销 → 401，scope 不足 → 403
        request.state.mcp_auth = ctx                  # 字段 workspace_id/scope/token_id（task-03 contract）
        return await call_next(request)
```

tool handler 读法：`ctx.request_context.request.state.mcp_auth`（**不是** `ctx.request_context.state`）。

## 踩到的坑（按严重度）

### 坑 1（P0，API 名对齐）：方法是 `streamable_http_app()`，不是 `http_app()`
design.md §5.2 P1 / §6 写的 `mcp.http_app()` 在官方 mcp SDK v1 **不存在**（`hasattr(FastMCP,'http_app')==False`）。
v1 实际方法：`streamable_http_app()`（返 `Starlette`）、`sse_app()`（老 SSE，不用）。
第三方 `fastmcp`（PrefectHQ，gofastmcp.com 文档）才有 `http_app()` —— 别把两套 SDK 的文档混着看。
**task-05 落地用 `streamable_http_app()`。**

### 坑 2（P0，会让 initialize 挂死）：lifespan 必须手动合并
`streamable_http_app()` 返的 Starlette 子 app 带 `lifespan=lambda app: self.session_manager.run()`，
但 **Starlette 的 `Mount` 不会自动跑子 app 的 lifespan**（实测确认 `Router.lifespan` 只跑父 app 的）。
若不合并，session manager 不启动，client `initialize` 永远挂（直到 timeout）。
**解法**：父 FastAPI 的 lifespan 里 `async with mcp.session_manager.run(): yield`（见上）。
spike 首跑就栽在这，日志见 `StreamableHTTP session manager started` 后协议才通 —— 就是 lifespan 合并生效的证据。

### 坑 3（P1，端点 URL）：mount 后实际端点是 `/mcp/`（带尾斜杠）
`streamable_http_path` 默认 `/mcp`。若直接 `app.mount("/mcp", mcp_app)` + 内层 Route `/mcp`，
请求 `/mcp` 会被 Starlette `Mount` 的 `redirect_slashes` **307 重定向到 `/mcp/`**，
而 mcp client 的 POST **不跟随 307**，直接报 `HTTPStatusError: Redirect response '307'`（spike 第二跑栽这）。
**解法（已验证）**：`FastMCP(streamable_http_path="/")` + `app.mount("/mcp", mcp_app)` → 端点 `/mcp/`。
task-07 文档给第三方配置的 URL 记成 `https://<host>/mcp/`（**带尾斜杠**），或考虑 mount 在 `/mcp` 并文档强调尾斜杠。
（社区 issue #1367 mount 边界的典型表现之一。）

### 坑 4（P1，tool 读 context 的路径）：Starlette Request 在 `ctx.request_context.request`
`ctx.request_context` 是 MCP 自己的 `RequestContext`（`mcp.shared.context`），**没有 `.state`**。
Starlette `Request` 在其 `.request` 字段（`RequestContext.request: RequestT | None`）。
spike 第三跑 tool 报 `'RequestContext' object has no attribute 'state'` —— 就是栽这。
**正确读法**：`ctx.request_context.request.state.mcp_auth`。
（底层：transport 在 `streamable_http.py:405` `request = Request(scope, receive)` 构造 Starlette Request，
经 `ServerMessageMetadata(request_context=request)` 跨 task 传进来 —— 这是 SDK 设计好的跨 task 桥。）

### 坑 5（P2，middleware 挂哪）：子 app 还是父 app？
实测 **两种都通**（Starlette 1.1.0 的 `Mount` 把同一个 `scope` 传给子 app，`scope["state"]` 经 mount 边界共享，
BaseHTTPMiddleware 的 `request.state` 读写的就是 `scope["state"]`，所以父 app middleware 写的 state 子 app 也能读）。
但 **推荐挂子 app**（`mcp_app.add_middleware(McpAuthMiddleware)`）：
- 满足 CC-06「走 /mcp mount 的独立 middleware，与 /api 的 `get_current_principal` 物理隔离」—— 子 app middleware 只对 `/mcp/*` 生效，`/api/*` 根本不经过；
- 行为只依赖子 app 自身 scope，不依赖 Starlette mount 边界 scope 共享行为（未来 Starlette 版本变了好歹自洽）。
父 app middleware 能用但不推荐（跨边界依赖 scope 共享，且会与 /api 的鉴权 middleware 混在一个栈里，违反 CC-06）。

### 坑 6（P2，开发机代理）：httpx 默认 `trust_env=True` 会吃环境代理
本机 env 带 SOCKS 代理，mcp client 的 httpx 默认信任 env → 连 127.0.0.1 走代理 → `ImportError: socksio`。
spike 里 client 用自定义 `httpx_client_factory` 传 `trust_env=False` 绕过。**这是 spike client 侧的事，生产 server 不受影响**（第三方 client 自带代理处理）。

## 给 task-05/06 的建议

1. **mcp_gateway/server.py**：`FastMCP(streamable_http_path="/")` + `streamable_http_app()` + `add_middleware(McpAuthMiddleware)` + `app.mount("/mcp", ...)`。8 个 tool 按设计 §7.1 落，第一个参数 `workspace_id` 改成从 `ctx.request_context.request.state.mcp_auth` 取（不让客户端传，或传了必须与 token 绑定一致）。
2. **app/main.py lifespan**：合并 `mcp.session_manager.run()`（坑 2）。`include_router(mcp_router)` + `mount_mcp(app)`。
3. **task-03 auth.py**：middleware 挂子 app（坑 5），注入 `request.state.mcp_auth = McpAuthContext(workspace_id, scope, token_id)`。tool handler 读 `ctx.request_context.request.state.mcp_auth`。
4. **task-07 文档**：第三方接入 URL 写 `https://<host>/mcp/`（带尾斜杠，坑 3）。
5. **gen:types / uv.lock**：加 mcp 把 starlette 升到 1.1.0、fastapi 升到 0.136.3，uv.lock 变了；task-05 落地后跑一遍现有 backend 测试确认零回归（spike 已确认 import 链通，但没跑全量 pytest）。

## 不需要退回备选方案

- **方案 B（手写 streamable HTTP）**：不需要。官方 SDK 的 mount + middleware 注入实测通。
- **方案 C（fastapi-mcp 第三方）**：不需要。官方 SDK 已够，少一个第三方依赖更稳。
