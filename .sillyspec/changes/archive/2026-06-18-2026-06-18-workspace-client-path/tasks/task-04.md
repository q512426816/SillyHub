---
id: task-04
title: daemon WS RPC 通道 + POST /runtimes/{id}/list-dir 端点（backend）
priority: P0
estimated_hours: 4
depends_on: [task-01]
blocks: [task-10, task-11]
created_at: 2026-06-18 11:44:49
author: qinyi
requirement_ids: [FR-03, FR-04]
decision_ids: [D-005@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/ws_hub.py
  - backend/app/modules/daemon/protocol.py
  - backend/app/modules/daemon/service.py
  - backend/app/modules/daemon/schema.py（仅 list-dir 相关请求/响应 schema 与新增 RPC 错误类，按需）
  - backend/tests/modules/daemon/test_ws_rpc.py（新建）
---

# task-04: daemon WS RPC 通道 + POST /runtimes/{id}/list-dir 端点（backend）

## 修改文件（必填）

grep / Read 定位结论：

- `backend/app/modules/daemon/protocol.py` — 现有消息常量仅含 `DAEMON_MSG_TASK_AVAILABLE` / `DAEMON_MSG_HEARTBEAT(_ACK)` / `DAEMON_MSG_LEASE_*`（10-22 行）。**无 RPC / RPC_RESULT 常量**。本任务在此新增。
- `backend/app/modules/daemon/ws_hub.py` — 现有 `DaemonWsHub`（27-237 行）维护 `_connections: dict[UUID, WebSocket]`，对外暴露 `send_to_runtime(runtime_id, message)->bool`（83-118 行，内置 10s send 超时 + 慢连接驱逐）、`is_connected`（224 行）、`connected_runtime_ids`。**无 rpc_id → pending future 的 correlation map**。本任务在此新增。
- `backend/app/modules/daemon/router.py` — 现有 WS 端点 `/api/daemon/ws`（347-401 行）收消息循环只识别 `DAEMON_MSG_HEARTBEAT`（387 行），未知 type 走 `ws_unknown_message_type` 警告。HTTP 端点有 register/heartbeat/runtimes CRUD/leases 全集，**无 list-dir 端点**。本任务在此新增端点 + WS 入口对 RPC_RESULT 的分支。
- `backend/app/modules/daemon/service.py` — `DaemonService` 提供 `_get_owned_runtime`（265-276 行，runtime 不属于 user 时抛 `DaemonRuntimeNotFound`/404）、`get_runtime`、`cleanup_stale_runtimes`。`DaemonRuntime.status` 字段 `"online"|"offline"|"disabled"`（service.py:118/141/169/249）。`DaemonRuntimeNotFound` 已定义（34-36 行）。本任务新增 RPC 错误类（504/403）。
- `backend/app/core/errors.py` — `AppError` 基类（28-60 行，含 `code` / `http_status` 类属性 + 构造可选覆盖），现有 `WorkspacePermissionDenied` 等子类范例（62-167 行）。新增的 504/403 RPC 错误类按相同风格定义，放 `service.py` 模块内（与现有 Daemon 错误族一致，§修改文件第 3 列）。

> 仅 backend 侧的 RPC 通道与 list-dir 转发端点。daemon 侧的 `list_dir` handler 与 `allowed_roots` 校验属 task-05，不在本任务范围。

## 覆盖来源

- **design.md**：§5 Phase 2（daemon 文件 RPC 通道，46 行）、§6 文件变更清单第 5/6 行（router.py WS 入口处理 RPC_RESULT；ws_hub RPC correlation）、§7.1 WS RPC 协议（89-96 行：消息 schema）、§7.2 REST 端点（99-104 行：POST list-dir 签名与 403/504 状态）、§10 R-01（WS RPC 超时 → 504 应对）。
- **decisions.md**：**D-005@v1**（55-64 行：daemon 新增 list_dir RPC，WS RPC 通道 + backend 转发端点 + 前端树形浏览）。
- **requirements.md**：**FR-03**（47-54 行：前端调 `POST /api/daemon/runtimes/{id}/list-dir {path}` 渲染 `{name,type}[]`；离线/超时 → 504）、**FR-04**（56-63 行：daemon 校验 allowed_roots、越界 error.code=forbidden → 前端 403；本任务仅做 backend 对 forbidden 的 403 转译，daemon 校验属 task-05）。
- **plan.md**：task-04 行（plan.md:19 / 39），Wave 2 P0，depends task-01、blocks task-10/task-11。

## 实现要求

### 1. protocol.py — 新增 WS RPC 消息常量与 payload 结构

在 `# Server → Daemon` 区追加 RPC 请求常量；在 `# Daemon → Server` 区追加 RPC_RESULT 响应常量。命名沿用现有 `daemon:*` 前缀风格（与 `DAEMON_MSG_TASK_AVAILABLE` 一致）：

```python
# Server → Daemon
DAEMON_MSG_RPC = "daemon:rpc"               # 带 rpc_id 的 RPC 请求
# Daemon → Server
DAEMON_MSG_RPC_RESULT = "daemon:rpc_result"  # RPC 响应（成功 result 或失败 error）
```

新增 payload Pydantic 模型（与现有 `TaskAvailablePayload` 等并列）：

```python
class RpcRequestPayload(BaseModel):
    """RPC 请求负载（server → daemon），内嵌在 DaemonMessage.payload。"""
    rpc_id: str
    method: str            # 当前仅 "list_dir"
    params: dict           # method=list_dir 时 {"path": str}

class RpcResultPayload(BaseModel):
    """RPC 响应负载（daemon → server），result 与 error 二选一。"""
    rpc_id: str
    result: dict | None = None      # 成功：method=list_dir 时 {"entries":[{"name","type"}]}
    error: dict | None = None       # 失败：{"code":"forbidden"|"not_found"|..., "message": str}
```

### 2. ws_hub.py — RPC correlation map + send_rpc

在 `DaemonWsHub.__init__` 追加：

```python
self._pending_rpcs: dict[str, asyncio.Future[Any]] = {}
```

（future 内的值即 `RpcResultPayload` 对应的 dict；`self._lock` 已有，覆盖此 map 读写以避免并发竞态。）

新增核心方法：

```python
RPC_DEFAULT_TIMEOUT = 10.0  # 秒，R-01 应对；与现有 _SEND_TIMEOUT 解耦

async def send_rpc(
    self,
    runtime_id: uuid.UUID,
    method: str,
    params: dict[str, Any],
    *,
    timeout: float = RPC_DEFAULT_TIMEOUT,
) -> dict[str, Any]:
    """向目标 runtime 发起一次 WS RPC，await 直到 daemon 回 RPC_RESULT 或超时。

    返回 daemon 的 result dict（成功）；
    失败：daemon 返回 error → 抛 DaemonRpcRemoteError（携带 error.code/message）；
    超时 / daemon 离线 / 发送失败 → 抛 DaemonRpcTimeout / DaemonRuntimeOffline。
    """
```

correlation 伪代码：

```
1. rid_str = str(runtime_id)
2. rpc_id = str(uuid.uuid4())
3. future = loop.create_future()
4. async with self._lock:
       if rpc_id in self._pending_rpcs:   # 极小概率 UUID 冲突
           raise DaemonRpcConflict(rpc_id)
       if not self.is_connected(runtime_id):
           raise DaemonRuntimeOffline(runtime_id)   # 调用方转 504
       self._pending_rpcs[rpc_id] = future
5. message = {"type": DAEMON_MSG_RPC,
              "payload": {"rpc_id": rpc_id, "method": method, "params": params}}
6. sent = await self.send_to_runtime(runtime_id, message)   # 复用既有发送（含 send 超时 + 慢连接驱逐）
7. if not sent:
       await self._cancel_rpc(rpc_id)            # 清理 map
       raise DaemonRuntimeOffline(runtime_id)    # 发送失败等同离线
8. try:
       result_payload = await asyncio.wait_for(future, timeout=timeout)
   except TimeoutError:
       await self._cancel_rpc(rpc_id)
       raise DaemonRpcTimeout(runtime_id, rpc_id, timeout)   # 调用方转 504
9. # result_payload = {"rpc_id":..., "result":...|"error":...}
   if result_payload.get("error"):
       raise DaemonRpcRemoteError(result_payload["error"])  # 调用方按 code 转 403/4xx
   return result_payload["result"]
```

辅助方法：

- `_cancel_rpc(rpc_id)`：`async with self._lock` 取出 future，若未 done 则 `future.cancel()`，再 `pop(rpc_id, None)`。供超时、发送失败、以及 daemon 离线清理调用。
- `resolve_rpc(rpc_id, payload_dict)`：daemon→backend 方向调用。`async with self._lock` 取出 future；map 中不存在则记 `ws_rpc_unknown_id` warning 并丢弃（防 daemon 回包到达时 future 已因超时被清理的竞态）；存在且未 done 则 `future.set_result(payload_dict)`，从 map 移除。
- `cancel_all_pending(runtime_id)`：daemon 断开时由 `disconnect(runtime_id)` 触发——枚举当前 map 中所有 pending rpc 的 future（rpc_id 不与 runtime_id 强绑定，故全部 cancel 并记 warning `ws_rpc_cancelled_on_disconnect`）。`disconnect` 末尾调用之，确保 daemon 中途离线时所有 await send_rpc 的协程能尽快拿到异常而非干等到 10s 超时。

> **future 写入的是原始 dict**，而非 `RpcResultPayload` 实例——daemon 通过 WS 收到的本来就是 dict，resolver 直接透传，避免重复解析。`send_rpc` 返回前再做一次 `error/result` 取值。

### 3. router.py — WS 入口处理 RPC_RESULT + 新增 list-dir HTTP 端点

**3.1 WS 消息循环新增分支**（347-401 行 `daemon_websocket`）：

现有循环在 387 行只识别 `DAEMON_MSG_HEARTBEAT`。新增：

```python
elif msg_type == DAEMON_MSG_RPC_RESULT:
    payload = data.get("payload") or {}
    rpc_id = payload.get("rpc_id")
    if not rpc_id:
        log.warning("ws_rpc_result_missing_id", runtime_id=str(rid), msg=data)
        continue
    await hub.resolve_rpc(rpc_id, payload)
```

> 不在此处校验 result/error 结构——结构解析与异常转译集中在 `send_rpc` 调用链（list-dir 端点），WS 入口只做 correlation 路由。

**3.2 新增 HTTP 端点**（与 runtimes CRUD 区相邻放置，紧邻 `list_runtime_leases` 之后）：

```python
@router.post(
    "/runtimes/{runtime_id}/list-dir",
    response_model=ListDirResponse,
)
async def list_dir(
    runtime_id: uuid.UUID,
    data: ListDirRequest,
    session: SessionDep,
    user: Annotated[User, Depends(get_current_principal)],
) -> ListDirResponse:
    """经 WS RPC 转发 list_dir 请求到绑定 daemon，返回目录条目。"""
    svc = DaemonService(session)
    # 1. 归属校验：runtime 不属于当前 user → DaemonRuntimeNotFound (404)
    await svc._get_owned_runtime(runtime_id, user.id)
    # 2. 经 WS hub 发起 RPC
    hub = get_daemon_ws_hub()
    try:
        result = await hub.send_rpc(runtime_id, "list_dir", {"path": data.path})
    except DaemonRuntimeOffline:
        raise DaemonRpcGatewayError(...)         # 504，message: "daemon 离线"
    except DaemonRpcTimeout as e:
        raise DaemonRpcGatewayError(...)         # 504，message 含 rpc_id/超时秒数
    except DaemonRpcRemoteError as e:            # daemon 业务错误
        if e.code == "forbidden":
            raise DaemonRpcForbiddenError(...)   # 403，allowed_roots 越界（FR-04）
        # 其余 code（not_found/internal 等）→ 502 或 500，按 e.code 映射
        raise DaemonRpcRemoteGatewayError(...)
    return ListDirResponse(entries=result.get("entries", []))
```

### 4. service.py / schema.py — 新增错误类与请求/响应 schema

**service.py** 末尾追加 RPC 错误族（沿用现有 `DaemonRuntimeNotFound` 风格，`code` + `http_status` 类属性）：

```python
class DaemonRuntimeOffline(AppError):
    code = "HTTP_504_DAEMON_RUNTIME_OFFLINE"
    http_status = 504

class DaemonRpcTimeout(AppError):
    code = "HTTP_504_DAEMON_RPC_TIMEOUT"
    http_status = 504

class DaemonRpcConflict(AppError):
    code = "HTTP_409_DAEMON_RPC_ID_CONFLICT"
    http_status = 409

class DaemonRpcGatewayError(AppError):       # WS 通道层错误（离线/超时/发送失败）统一对外 504
    code = "HTTP_504_DAEMON_RPC_GATEWAY"
    http_status = 504

class DaemonRpcForbiddenError(AppError):     # daemon 返回 forbidden → 403（FR-04）
    code = "HTTP_403_DAEMON_RPC_FORBIDDEN"
    http_status = 403

class DaemonRpcRemoteGatewayError(AppError): # daemon 其他业务错误（非 forbidden）
    code = "HTTP_502_DAEMON_RPC_REMOTE"
    http_status = 502

class DaemonRpcRemoteError(Exception):       # 内部异常：承载 daemon error dict，不直接对外
    def __init__(self, error: dict):
        self.code = error.get("code", "unknown")
        self.message = error.get("message", "")
        super().__init__(f"daemon rpc error: {self.code}: {self.message}")
```

> `DaemonRpcRemoteError` 故意不继承 `AppError`：它是 ws_hub → 端点调用链的内部信号，由端点重新映射成 `DaemonRpcForbiddenError`（403）/`DaemonRpcRemoteGatewayError`（502）。避免 daemon 错误码直透 HTTP。

**schema.py** 新增（与现有 Daemon schema 同文件）：

```python
class DirEntry(BaseModel):
    name: str
    type: Literal["dir", "file"]

class ListDirRequest(BaseModel):
    path: str = Field(min_length=1, description="daemon 客户端机器上的绝对路径")

class ListDirResponse(BaseModel):
    entries: list[DirEntry]
```

### 5. 测试

新建 `backend/tests/modules/daemon/test_ws_rpc.py`，覆盖：

- `send_rpc` 成功路径：构造 fake `WebSocket`（实现 `send_json` 写入队列 + 不实际 await），手动 `connect`，随后在另一 task 内 `await hub.resolve_rpc(rpc_id, {"rpc_id":rpc_id,"result":{"entries":[...]}})`，断言 `send_rpc` 返回 entries。
- daemon 离线：runtime 未 connect，`send_rpc` 直接抛 `DaemonRuntimeOffline`。
- 超时：`send_rpc(..., timeout=0.05)` 且不回包，断言抛 `DaemonRpcTimeout` 且 map 已清理。
- daemon 业务 error：`resolve_rpc` 写入 `{"rpc_id":..., "error":{"code":"forbidden","message":"..."}}`，`send_rpc` 抛 `DaemonRpcRemoteError(code="forbidden")`，端点测试断言转 403。
- rpc_id 冲突防护（mock uuid.uuid4 返回固定值）。
- `disconnect` 触发 `cancel_all_pending`，pending future 被取消、对应 await 抛 `DaemonRuntimeOffline`/CancelledError 上抛（具体形态以实现为准，断言异常已抛出即可）。
- 端点级：用 HTTP fixture（现有 daemon router 测试风格）+ 注入 mock hub，验证 `/runtimes/{id}/list-dir` 的 200/404（runtime 不属于 user）/504（离线）/403（forbidden）/504（超时）分支。

> 复用 `backend/conftest.py` 的 `db_session`/HTTP client fixture；不引入新 fixture 体系。Mock hub 可用 monkeypatch 替换 `get_daemon_ws_hub` 返回值，或直接构造 `DaemonWsHub` + fake WebSocket。

## 接口定义

### WS 消息 schema（design §7.1 落地）

backend → daemon：
```json
{ "type": "daemon:rpc",
  "payload": { "rpc_id": "<uuid4 str>", "method": "list_dir",
               "params": { "path": "/Users/qinyi/IdeaProjects" } } }
```

daemon → backend（成功）：
```json
{ "type": "daemon:rpc_result",
  "payload": { "rpc_id": "<uuid4 str>",
               "result": { "entries": [ { "name": "multi-agent-platform", "type": "dir" } ] } } }
```

daemon → backend（失败）：
```json
{ "type": "daemon:rpc_result",
  "payload": { "rpc_id": "<uuid4 str>",
               "error": { "code": "forbidden", "message": "path outside allowed_roots" } } }
```

> rpc_id 顶层位置：**payload 内**（与现有 `task_available` 把 runtime_id/task_id/lease_id 放 payload 一致，387-389 行 WS 循环已用 `data.get("type")` + 后续取 payload 的模式）。`result` 与 `error` 互斥。

### send_rpc 签名

```python
async def send_rpc(
    self,
    runtime_id: uuid.UUID,
    method: str,                          # 当前仅 "list_dir"
    params: dict[str, Any],               # list_dir: {"path": str}
    *,
    timeout: float = RPC_DEFAULT_TIMEOUT, # 默认 10.0s
) -> dict[str, Any]                        # 成功：daemon 的 result dict（不含 rpc_id/error 键）
```

抛出：`DaemonRuntimeOffline` / `DaemonRpcTimeout` / `DaemonRpcConflict` / `DaemonRpcRemoteError`（承载 daemon error）。

### HTTP 端点签名

```
POST /api/daemon/runtimes/{runtime_id}/list-dir
  auth: Bearer (get_current_principal)
  body:  { "path": str }                      # min_length=1
  200:    { "entries": [ { "name": str, "type": "dir"|"file" } ] }
  400:    body 校验失败（path 空）
  403:    daemon 返回 error.code=forbidden（allowed_roots 越界，FR-04）
  404:    runtime 不属于当前 user（DaemonRuntimeNotFound）
  502:    daemon 返回其他业务 error（非 forbidden）
  504:    daemon 离线 / RPC 超时 / WS 发送失败（R-01）
```

### correlation 伪代码

见 §实现要求第 2 节 `send_rpc` 内嵌的 9 步伪代码（map 注册 → 复用 send_to_runtime 推送 → await future 含超时 → resolve_rpc 在 WS 循环里回填 → 异常分层映射）。关键不变量：

- 每个 rpc_id 严格成对（请求 → 恰一个 result|error 响应）；resolve_rpc 收到已不存在 / 已 done 的 rpc_id 一律丢弃并记 warning，不抛。
- map 读写全程在 `async with self._lock` 内，与现有 `_connections` 操作共用同一把锁。
- future 取消路径有三：超时（wait_for 触发）/ 发送失败（send_rpc 主动 `_cancel_rpc`）/ daemon 断开（disconnect → cancel_all_pending）。

## 边界处理（≥5 条）

1. **daemon 离线**：`send_rpc` 在注册 future 前先 `is_connected` 判定（持有 `_lock`），离线直接抛 `DaemonRuntimeOffline`；端点统一转 `DaemonRpcGatewayError` → **HTTP 504**（FR-03 要求）。注意与现有 `send_to_runtime` 的「发送失败也 disconnect」语义叠加——send_to_runtime 返回 False 时 send_rpc 已清理 future 并抛 504，不重复 disconnect。
2. **RPC 超时（R-01）**：`asyncio.wait_for(future, timeout=10.0)` 超时 → `_cancel_rpc` 清理 map → 抛 `DaemonRpcTimeout` → 端点 504，响应 message 含 rpc_id 与超时秒数便于排障。超时是 daemon 卡死 / 任务积压 / 网络抖动的兜底，**不重试**（前端自行提示重试，FR-03）。
3. **rpc_id 冲突**：UUID4 实战不可冲突，但 map 注册前仍 `if rpc_id in self._pending_rpcs` 检查，命中则抛 `DaemonRpcConflict`（409），避免覆盖既有 future 造成永久悬挂；视为代码缺陷的早期信号。
4. **并发 RPC**：同一 runtime 可并发发多个 list_dir（前端树形组件并行展开多个节点）。`_pending_rpcs` 用 rpc_id（非 runtime_id）作 key，互不影响；`send_to_runtime` 自身是并发安全的（单连接的 send_json 顺序由 asyncio 序列化）。多个 future 各自独立 wait_for 超时。
5. **runtime 不属于当前 user**：端点先 `svc._get_owned_runtime(runtime_id, user.id)`，命中既有 `DaemonRuntimeNotFound`（404）。**不可**仅靠 ws_hub 是否有连接判定——即便 WS 已建立，runtime 仍可能归属其他用户；归属校验必须在 DB 侧完成（service.py:265-276 现成实现）。
6. **daemon 中途断开**：`disconnect(runtime_id)` 末尾调 `cancel_all_pending`，所有 pending rpc 的 future 被取消；`send_rpc` 中 `await future` 将抛 CancelledError/异常，包裹成 `DaemonRuntimeOffline` 上抛 → 504。避免调用方空等 10s。
7. **超时 vs 回包竞态**：daemon 在 10s 超时后才回包，`resolve_rpc` 发现 rpc_id 已不在 map（被 `_cancel_rpc` 清理）→ 记 `ws_rpc_late_result` warning 并丢弃，不抛、不影响后续 RPC。
8. **forbidden → 403 严格映射（FR-04）**：仅 daemon 返回 `error.code == "forbidden"` 走 403；其余 daemon 业务错误（not_found/internal 等）走 502。绝不允许把 forbidden 透传成 500/502——前端按 403 触发「提示配置 allowed_roots」引导（design §10 R-04）。
9. **path 校验下沉 daemon**：backend 不做路径合法性校验（min_length=1 除外），allowed_roots / 越界 / 符号链接判定全部由 daemon task-05 完成。backend 仅做 RPC 透传与状态码转译。
10. **WS 入口未知 rpc_id 不崩**：daemon 回包 rpc_id 缺失或 map 中不存在时，WS 循环仅记 warning 继续，不断连接（与现有 `ws_unknown_message_type` 处置一致）。

## 非目标

- **daemon 侧 `list_dir` handler 与 `allowed_roots` 白名单校验属 task-05**（depends task-02 config）。本任务只在 backend 侧约定方法名 `"list_dir"` 与 params/result/error 的 schema 契约，不实现 daemon 读取文件系统。
- 不实现除 list_dir 以外的 RPC method（read_file/stat 等暂不做，YAGNI；method 字段保留扩展位但当前仅 list_dir 一支）。
- 不在 backend 侧做路径合法性 / 越界 / 符号链接校验（D-002 明确由 daemon allowed_roots 把关）。
- 不实现 RPC 消息的 Pydantic 严格反序列化校验（WS 入口直接按 dict 取 rpc_id/result/error，结构错误仅 warning 丢弃，避免恶意/异常 daemon 拖垮 WS 循环）。
- 不改 daemon 注册/心跳/lease 任何既有消息路径。
- 不实现前端调用（task-10/task-11）。

## TDD 步骤

1. **protocol.py 先加常量与 payload 模型**（红：ws_hub/router 引用报未定义）。
2. **写 `test_ws_rpc.py` 第一批用例**：成功路径 + 离线 + 超时。先红（DaemonWsHub 无 send_rpc）。
3. **实现 ws_hub.send_rpc / resolve_rpc / _cancel_rpc / cancel_all_pending**，跑绿成功/离线/超时。
4. **补端点测试**（HTTP fixture + mock hub 或真实 hub+fake ws）：404/403/504/502 分支；先红（router 无 list-dir 端点、service 无错误类）。
5. **实现 service 错误类 + schema + router 端点 + WS 循环 RPC_RESULT 分支**，跑绿。
6. **补边界用例**：rpc_id 冲突、late result 丢弃、disconnect 触发 cancel。
7. **回归**：`uv run pytest backend/tests/modules/daemon backend/app/modules/daemon/tests -q` + `uv run ruff check backend/app/modules/daemon`。

## 验收标准

| 编号 | 验收项 | 验证方式 | 期望 |
|---|---|---|---|
| AC-1 | protocol 常量与 payload 模型 | `grep DAEMON_MSG_RPC DAEMON_MSG_RPC_RESULT backend/app/modules/daemon/protocol.py` | 命中 2 项；RpcRequestPayload/RpcResultPayload 类存在 |
| AC-2 | send_rpc 成功返回 entries | `uv run pytest backend/tests/modules/daemon/test_ws_rpc.py -k success -q` | passed；返回 `{"entries":[...]}`，map 已清理 |
| AC-3 | daemon 离线 → 504 | 端点测试：runtime 未 connect 调 `/list-dir` | HTTP 504，code=HTTP_504_DAEMON_RPC_GATEWAY |
| AC-4 | RPC 超时 → 504（R-01） | `send_rpc(timeout=0.05)` 不回包 + 端点级断言 | ws_hub 抛 DaemonRpcTimeout；端点 HTTP 504；map 已清理（无 future 泄漏） |
| AC-5 | daemon forbidden → 403（FR-04） | 端点测试：mock hub send_rpc 抛 DaemonRpcRemoteError(code=forbidden) | HTTP 403，code=HTTP_403_DAEMON_RPC_FORBIDDEN |
| AC-6 | daemon 其他业务错误 → 502 | 端点测试：mock hub 抛 DaemonRpcRemoteError(code=internal) | HTTP 502，code=HTTP_502_DAEMON_RPC_REMOTE |
| AC-7 | runtime 不属于 user → 404 | 端点测试：另一 user 的 runtime | HTTP 404，code=HTTP_404_DAEMON_RUNTIME_NOT_FOUND |
| AC-8 | WS 循环处理 RPC_RESULT | 端到端：fake ws connect → POST list-dir → fake ws 在另一协程 receive RPC 后回 RPC_RESULT → 端点返回 200 | entries 正确回填；未知 rpc_id 不崩连接 |
| AC-9 | disconnect 取消 pending RPC | 单测：connect → send_rpc（不回包，另一 task） → disconnect → 断言 await send_rpc 抛 DaemonRuntimeOffline | 不空等 10s 超时；map 为空 |
| AC-10 | daemon 模块回归无破坏 | `uv run pytest backend/tests/modules/daemon backend/app/modules/daemon/tests -q` | 全部 passed；ruff check 通过 |
