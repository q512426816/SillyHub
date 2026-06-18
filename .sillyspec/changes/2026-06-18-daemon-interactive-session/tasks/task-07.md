---
id: task-07
title: manual_approval 开关 + permission WS 消息两端接通
wave: W2
priority: P1
depends_on: [task-02]
covers: [FR-07, Q3]
created_at: 2026-06-18 14:11:24
author: qinyi
---

# Task-07｜manual_approval 开关 + permission_request/response WS 消息两端接通

> 设计依据：
> - `design.md` §5 **Wave 2 — 权限暂停往返**（manual_approval=true 时 control_request 暂停 → 推前端 → 远程决定 → 回写 stdin；默认 false 维持自动批准）。
> - `design.md` §7.1 **WS 控制消息接口定义**（`PERMISSION_REQUEST` daemon→server / `PERMISSION_RESPONSE` server→daemon + `PermissionRequestPayload` / `PermissionResponsePayload`）。
> - `design.md` §8.1 **agent_sessions.config JSON 字段**（`{ manual_approval, model, ... }`，task-01 建表时已落地）。
> - `design.md` §9 兼容策略（权限默认自动批准：manual_approval 默认 false，现有 writeControlResponse(allow) 行为不变）。
> - `design.md` §10 R-02（WS 控制消息乱序/重连丢消息：inject 到已结束 session 返回错误；本任务 permission 同样适用 pending map 校验）。
> - `plan.md` task-07 行（permission WS 消息两端接通）+ task-08 行（control_request 暂停往返，本任务通道，task-08 adapter 触发）。
> - `requirements.md` **FR-07 / Q3**（manual_approval 开关 + 权限暂停往返）。
> - 现状代码：`sillyhub-daemon/src/ws-client.ts`（MSG.RPC 独立分发分支，本任务 PERMISSION_REQUEST 复用同样模式 daemon→server）、`backend/app/modules/daemon/router.py:425` `daemon_websocket` WS 接收循环（现仅分派 HEARTBEAT / RPC_RESULT，本任务补 PERMISSION_REQUEST 分支）、`backend/app/modules/daemon/ws_hub.py:245` `send_rpc`（RPC correlation map 范式，本任务 send_permission_response 复用 send_to_runtime 推送）、`backend/app/modules/daemon/protocol.py`（task-02 已加 `DAEMON_MSG_PERMISSION_REQUEST/RESPONSE` 常量 + Pydantic payload 模型）、`sillyhub-daemon/src/protocol.ts`（task-02 已加 `MSG.PERMISSION_REQUEST/RESPONSE` + TS payload interface）。

## 1. 目标

把 Wave 2 权限暂停往返的 **WS 通道两端接通**——只打通「daemon 发 permission_request → backend 接收并推前端 → 前端决定 → backend 发 permission_response → daemon 收到」的消息往返链路，**不**改 stream-json / json-rpc adapter 的 control_request 处理逻辑（那属 task-08：在 adapter 层根据 manual_approval 决定是「直接 writeControlResponse(allow)」还是「暂停 + 发 PERMISSION_REQUEST 等待 RESPONSE」）。

具体落地（本任务边界）：

1. **AgentSession.config 支持 manual_approval 开关**：明确 `agent_sessions.config` JSON 字段中 `manual_approval: bool` 的读取与默认值（默认 false，与 task-01 建表时声明一致），并在 lease 下发 daemon 时把该开关**携带到 daemon 侧 ExecutionContext**（daemon 据此决定是否走暂停往返路径，task-08 落地实际触发）。
2. **daemon 侧 ws-client 发 permission_request**：新增 `sendPermissionRequest(payload)` 公开方法，封装 `{ type: MSG.PERMISSION_REQUEST, payload }` 出站，**供 task-08 的 adapter 调用**（本任务只提供发送 API + 单测，不接 adapter）。
3. **backend /ws 接收 permission_request**：WS 接收循环新增 `DAEMON_MSG_PERMISSION_REQUEST` 分支，落库为「pending permission」记录（内存 Map 或 agent_sessions 关联表），**推送给前端**（经 SSE session 级 channel `agent_session:{session_id}`，复用 task-05 双 publish 机制，或本任务用最简路径直接 publish 一条 permission_event）。
4. **前端决定 → backend 发 permission_response**：新增 REST 端点 `POST /api/daemon/sessions/{session_id}/permissions/{request_id}` 接收前端 `{ decision: 'allow'|'deny' }`，service 层 `respond_permission` 调用 `ws_hub.send_permission_response(runtime_id, payload)`，把 `daemon:permission_response` 推回目标 daemon。
5. **daemon 侧 ws-client 收 permission_response**：`_handleMessage` 新增 PERMISSION_RESPONSE 分支，路由到 **sessionStore 的 pending permission map**（按 request_id 配对），让 task-08 的 adapter await 的 Promise resolve（本任务只搭配对骨架，不接 adapter 的 await 调用点）。
6. **默认 manual_approval=false 维持自动批准不变**：未开启 manual_approval 的 session 完全不走本任务的通道（adapter task-08 仍走原 writeControlResponse(allow) 路径），保证零回归（design §9 兼容）。

覆盖：**FR-07**（manual_approval 开关 + 暂停往返）、**Q3**（默认自动批准 + 手动开关）。

## 2. 前置依赖

- **task-02（协议契约）**：本任务直接消费 task-02 已定义的常量与 payload：
  - daemon 侧 `sillyhub-daemon/src/protocol.ts`：`MSG.PERMISSION_REQUEST = 'daemon:permission_request'`、`MSG.PERMISSION_RESPONSE = 'daemon:permission_response'` + `PermissionRequestPayload` / `PermissionResponsePayload` 接口（落 `types.ts`）。
  - backend 侧 `backend/app/modules/daemon/protocol.py`：`DAEMON_MSG_PERMISSION_REQUEST = "daemon:permission_request"`、`DAEMON_MSG_PERMISSION_RESPONSE = "daemon:permission_response"` + 两个 Pydantic 模型。
  - **验收前确认 task-02 已合并**（task-02 蓝图 §5 明确契约单测覆盖字符串对齐）。任一端字符串/字段漂移 → task-02 契约单测失败 → 本任务分派分支找不到消息 type。

- **task-01（数据模型迁移）**：`agent_sessions.config: JSON nullable` 字段（task-01 §8.1 落地）必须存在，本任务读取 `config.get("manual_approval", False)` 依赖该列。**验收前确认 task-01 alembic 已 apply。**

- **task-03（daemon session 侧）的 sessionStore**：本任务的 daemon 收到 `permission_response` 后路由到 `sessionStore.pendingPermissions.get(request_id)`——**sessionStore 数据结构本身由 task-03 落地**，本任务在其上**追加** `pendingPermissions: Map<request_id, PendingPermission>` 字段及 resolve 方法（与 task-03 实现者协商接口；execute 阶段若 task-03 未就绪可先用内存占位 + 后续 task-08 接 adapter）。

- **task-04（backend session 侧）的 ws_hub.send_session_control + session 级 SSE channel**：本任务复用 task-04 引入的 `send_session_control`（task-04 蓝图 §3 明确新增该方法）；若 task-04 已提供 `send_session_control(runtime_id, msg_type, payload)` 通用封装，本任务的 `send_permission_response` 直接调用之，**不再新增**第二个 send 方法（避免 ws_hub 接口膨胀）。

- **task-05（session 级 SSE 聚合）**：本任务推送 permission_request 到前端的 SSE channel `agent_session:{session_id}` 由 task-05 落地；若 task-05 未就绪，本任务**降级**为只落库 pending permission + REST 轮询查询（最简路径，保证 daemon→backend→daemon 闭环先通）。

> **task-08 协作边界（关键）**：task-08 才是真正改 `stream-json.ts handleControlRequest` + `json-rpc.ts` 的 approval handler，在 `session.config.manual_approval === true` 时调本任务的 `sendPermissionRequest` 发请求 + await `sessionStore.pendingPermissions` 的 Promise。本任务**只提供通道与 API**，不写 adapter 触发逻辑——这点必须在 §9 接口边界明确，避免与 task-08 实现者冲突。

## 3. 涉及文件

| 操作 | 文件 | 改动概述 |
|---|---|---|
| 修改 | `backend/app/modules/daemon/router.py` | WS `/ws` 接收循环 `daemon_websocket` 新增 `DAEMON_MSG_PERMISSION_REQUEST` 分支：解析 payload → 调 service.persist_permission_request → publish SSE；新增 REST 端点 `POST /sessions/{session_id}/permissions/{request_id}`（前端批准/拒绝入口） |
| 修改 | `backend/app/modules/daemon/service.py` | 新增 `persist_permission_request(session_id, request_id, tool_name, input_)`（落 pending Map 或关联表）+ `respond_permission(session_id, request_id, decision, user_id)`（校验 pending 存在 + 调 ws_hub 推 response + 清 pending）；新增 domain error `DaemonPermissionRequestNotFound` / `DaemonPermissionAlreadyResolved` |
| 修改 | `backend/app/modules/daemon/ws_hub.py` | 新增 `send_permission_response(runtime_id, session_id, request_id, decision)` 方法，**优先复用** task-04 的 `send_session_control`（若已存在），否则直接调 `send_to_runtime`；不引入新锁/新连接池 |
| 修改 | `backend/app/modules/daemon/schema.py` | 新增 `PermissionResponseRequest { decision: Literal["allow","deny"] }` + `PermissionResponseResponse { accepted: bool }` 两个 Pydantic schema |
| 修改 | `backend/app/modules/agent/service.py` 或 `placement.py` | 在 `dispatch_to_daemon` / lease payload 构造时把 `agent_sessions.config.manual_approval` 注入 `ExecutionContextPayload`（daemon 侧读取该字段决定暂停路径；task-08 实际使用） |
| 修改 | `sillyhub-daemon/src/ws-client.ts` | 新增 `sendPermissionRequest(payload: PermissionRequestPayload): boolean` 公开方法（封装出站 `MSG.PERMISSION_REQUEST`）；`_handleMessage` 新增 `MSG.PERMISSION_RESPONSE` 分支，调 `callbacks.onPermissionResponse?.(payload)`（新增可选回调） |
| 修改 | `sillyhub-daemon/src/ws-client.ts`（callbacks 接口） | `WsClientCallbacks` 追加 `onPermissionResponse?: (payload: PermissionResponsePayload) => void` 可选回调，由 task-20 Daemon / sessionStore 注册消费 |
| 修改 | `sillyhub-daemon/src/session-store.ts`（task-03 落地后追加字段） | 追加 `pendingPermissions: Map<request_id, { resolve: (decision) => void, reject, timer }>`；新增 `awaitPermission(request_id, timeoutMs)` 方法（task-08 adapter 调用）+ `resolvePermission(request_id, decision)` 方法（onPermissionResponse 回调调用） |
| 修改 | `backend/app/modules/daemon/protocol.py` | 仅在 task-02 未覆盖到 backend 常量/payload 时补全（默认 task-02 已加，本 task 仅 import）；若 task-02 已落地则本行无改动 |

**不改动**（明确划界，避免越权到 task-08）：

- `sillyhub-daemon/src/adapters/stream-json.ts`（control_request 暂停逻辑属 task-08）。
- `sillyhub-daemon/src/adapters/json-rpc.ts`（codex approval handler 暂停逻辑属 task-08）。
- `frontend/src/app/(dashboard)/runtimes/page.tsx`（前端权限弹窗 UI 属 task-11）。

## 4. 覆盖来源（文档 → 代码）

- design **§5 Wave 2**：升级 handleControlRequest 的语义——manual_approval=true 时发 PERMISSION_REQUEST 暂停；本任务**只**做通道接通，不改 handleControlRequest 本身。
- design **§7.1**：`PERMISSION_REQUEST` daemon→server 方向 + payload `{ session_id, request_id, tool_name, input }`；`PERMISSION_RESPONSE` server→daemon 方向 + payload `{ session_id, request_id, decision }`。
- design **§8.1**：`agent_sessions.config: JSON nullable` 字段存 `{ manual_approval, model, ... }`。
- design **§9 兼容策略**：默认 manual_approval=false → 自动批准不变；批处理 lease 不受影响。
- design **§10 R-02**：pending permission map 按 request_id 校验，已 resolve / 已 expired 的 request_id 收到 RESPONSE 静默 warn 丢弃。
- decisions.md **D-002@v1**（1 session = 1 lease，permission 往返绑定 session_id + request_id 配对）。
- plan.md task-07 行：明确「本任务通道，task-08 adapter 触发」。
- requirements.md **FR-07 / Q3**。

## 5. 完成标准（Definition of Done）

- [ ] `backend/app/modules/daemon/protocol.py` 已含 task-02 落地的 `DAEMON_MSG_PERMISSION_REQUEST/RESPONSE` + `PermissionRequestPayload` / `PermissionResponsePayload`（本任务 import 引用，若 task-02 未合并则本任务无法推进，应阻塞）。
- [ ] `backend/app/modules/daemon/router.py` WS 接收循环新增 `DAEMON_MSG_PERMISSION_REQUEST` 分支：daemon 发来后能落 pending + publish SSE 事件（前端可见）；未知/异常 payload 不崩溃 WS 循环（延续 §9 兼容：try/except 内消化）。
- [ ] `backend/app/modules/daemon/router.py` 新增 `POST /sessions/{session_id}/permissions/{request_id}` REST 端点，接收 `{ decision }` → 调 service → ws_hub 推 PERMISSION_RESPONSE 到目标 daemon。
- [ ] `backend/app/modules/daemon/service.py` 新增 `persist_permission_request` + `respond_permission` 两个方法，含 pending Map（或表）读写 + 校验（NotFound / AlreadyResolved）。
- [ ] `backend/app/modules/daemon/ws_hub.py` 新增 `send_permission_response`（或直接复用 task-04 `send_session_control`），能把 `{ type: 'daemon:permission_response', payload }` 推到指定 runtime。
- [ ] `backend/app/modules/daemon/schema.py` 新增 `PermissionResponseRequest` + `PermissionResponseResponse`。
- [ ] lease 下发时 `agent_sessions.config.manual_approval` 已透传到 daemon 侧 ExecutionContext（task-08 据此决定路径）。
- [ ] `sillyhub-daemon/src/ws-client.ts` 新增 `sendPermissionRequest` 公开方法 + `_handleMessage` 新增 `PERMISSION_RESPONSE` 分支 + `WsClientCallbacks.onPermissionResponse` 可选回调。
- [ ] `sillyhub-daemon/src/session-store.ts`（task-03 落地后追加）含 `pendingPermissions` Map + `awaitPermission` / `resolvePermission` 方法。
- [ ] **默认 manual_approval=false 行为不变**：未开启的 session 不发 PERMISSION_REQUEST，adapter 仍走 writeControlResponse(allow)（task-08 守护，本任务提供开关读取路径但默认值不变）。
- [ ] `cd sillyhub-daemon && pnpm test` 通过（ws-client 新方法的单测，见 §7.1）。
- [ ] `cd backend && uv run pytest` 通过（service 新方法单测，见 §7.2）。
- [ ] **闭环契约**：模拟 daemon 发 permission_request → backend 落 pending → 模拟前端 POST decision → backend 推 permission_response → daemon 收到（端到端单测或集成测试覆盖）。
- [ ] **未知 request_id 静默丢弃**：daemon 收到不认识的 permission_response（如已 timeout 清理）→ warn 不崩溃（R-02 应对）。

## 6. 实现步骤（编号顺序）

> 总原则：**先 backend 后 daemon**（backend 是协议字符串权威源 + REST 入口先行，daemon 侧发送/接收 API 后行；与 task-02/04 顺序一致）。

1. **确认前置就绪**：execute 前先 Read 确认：
   - `backend/app/modules/daemon/protocol.py` 含 `DAEMON_MSG_PERMISSION_REQUEST/RESPONSE` + Pydantic payload（task-02 产出）。
   - `backend/app/modules/agent/model.py` 含 `AgentSession` 表 + `config: JSON` 字段（task-01 产出）。
   - `backend/app/modules/daemon/ws_hub.py` 含 `send_session_control`（task-04 产出，若已合并则本任务优先复用）。
   - `sillyhub-daemon/src/session-store.ts` 存在（task-03 产出，若未合并则本任务 §3 sessionStore 字段改动延后，但 ws-client + backend 端可独立先通）。
   若前置未就绪 → 阻塞推进对应前置 task，不在本任务内越权实现。

2. **backend schema 落地**（`backend/app/modules/daemon/schema.py`）：
   ```python
   from typing import Literal
   from pydantic import BaseModel

   class PermissionResponseRequest(BaseModel):
       decision: Literal["allow", "deny"]

   class PermissionResponseResponse(BaseModel):
       accepted: bool
       request_id: str
   ```

3. **backend service 落地**（`backend/app/modules/daemon/service.py`）：
   - 进程级 pending permission store（内存 Map，execute 阶段决定：进程内 `dict[tuple(session_id, request_id), dict]` 或新增表；**Wave 2 推荐内存 Map**，崩溃=会话结束标 failed，符合 design §3 R-03 非目标）。
   - `async def persist_permission_request(self, runtime_id, session_id, request_id, tool_name, input_) -> None`：写 Map + publish SSE（若 task-05 channel 就绪用 `agent_session:{session_id}`，否则降级 log）。
   - `async def respond_permission(self, session_id, request_id, decision, user_id) -> None`：校验 pending 存在 + ownership（session 属当前 user）+ 未已 resolve → 调 `ws_hub.send_permission_response` → 清 Map。
   - domain error：`DaemonPermissionRequestNotFound`（404）、`DaemonPermissionAlreadyResolved`（409）。

4. **backend ws_hub 落地**（`backend/app/modules/daemon/ws_hub.py`）：
   ```python
   async def send_permission_response(
       self,
       runtime_id: uuid.UUID,
       session_id: uuid.UUID,
       request_id: str,
       decision: str,  # "allow" | "deny"
   ) -> bool:
       """Server → Daemon：推送 permission_response（task-07）。
       优先复用 task-04 的 send_session_control（若已存在）；
       否则直接构造 DaemonMessage 调 send_to_runtime。"""
       from app.modules.daemon.protocol import DAEMON_MSG_PERMISSION_RESPONSE
       message = {
           "type": DAEMON_MSG_PERMISSION_RESPONSE,
           "payload": {
               "session_id": str(session_id),
               "request_id": request_id,
               "decision": decision,
           },
       }
       return await self.send_to_runtime(runtime_id, message)
   ```
   - **复用决策**：若 task-04 已提供通用 `send_session_control(runtime_id, msg_type, payload)`，则本方法**直接调它**（一行委托），不再新写构造逻辑。execute 时优先 grep 确认。

5. **backend router 落地**（`backend/app/modules/daemon/router.py`）：
   - WS `/ws` 接收循环新增分支（在现有 HEARTBEAT / RPC_RESULT 之后）：
     ```python
     elif msg_type == DAEMON_MSG_PERMISSION_REQUEST:
         payload = data.get("payload") or {}
         try:
             await svc.persist_permission_request(
                 runtime_id=rid,
                 session_id=uuid.UUID(payload["session_id"]),
                 request_id=payload["request_id"],
                 tool_name=payload["tool_name"],
                 input_=payload["input"],
             )
         except (KeyError, ValueError) as exc:
             log.warning("ws_permission_request_invalid", runtime_id=str(rid), err=str(exc))
             # 不 close WS，延续 §9 兼容（未知/异常 payload 静默丢弃）
     ```
   - 新增 REST 端点：
     ```python
     @router.post(
         "/sessions/{session_id}/permissions/{request_id}",
         response_model=PermissionResponseResponse,
     )
     async def respond_permission(
         session_id: uuid.UUID,
         request_id: str,
         data: PermissionResponseRequest,
         session: SessionDep,
         user: Annotated[User, Depends(get_current_principal)],
     ) -> PermissionResponseResponse:
         svc = DaemonService(session)
         await svc.respond_permission(session_id, request_id, data.decision, user.id)
         return PermissionResponseResponse(accepted=True, request_id=request_id)
     ```

6. **lease 下发携带 manual_approval**（`backend/app/modules/agent/service.py` 或 `placement.py`，视 task-04 实现位置）：
   - 在构造 `ExecutionContextPayload` / lease metadata 时，从 `agent_session.config.get("manual_approval", False)` 读取并注入，daemon 侧 task-08 读取该字段决定路径。
   - 默认 false → daemon 行为零变化（design §9）。

7. **daemon ws-client 发送 API 落地**（`sillyhub-daemon/src/ws-client.ts`）：
   ```typescript
   /** Daemon → Server：发权限批准请求（task-07 通道，task-08 adapter 触发）。FR-07 */
   sendPermissionRequest(payload: PermissionRequestPayload): boolean {
     return this.send({ type: MSG.PERMISSION_REQUEST, payload });
   }
   ```
   - payload 类型从 `types.ts` import（task-02 落地）。

8. **daemon ws-client 接收分支落地**（`sillyhub-daemon/src/ws-client.ts` `_handleMessage`）：
   - 在现有 `if (msg.type === MSG.RPC)` 之后新增：
     ```typescript
     if (msg.type === MSG.PERMISSION_RESPONSE) {
       this._callbacks.onPermissionResponse?.(
         msg.payload as PermissionResponsePayload,
       );
       return;
     }
     ```
   - `WsClientCallbacks` 追加 `onPermissionResponse?: (payload: PermissionResponsePayload) => void`。

9. **daemon sessionStore pending map 落地**（`sillyhub-daemon/src/session-store.ts`，task-03 文件存在后追加）：
   ```typescript
   interface PendingPermission {
     resolve: (decision: 'allow' | 'deny') => void;
     reject: (err: Error) => void;
     timer: NodeJS.Timeout;
   }
   // SessionState 追加字段：
   pendingPermissions = new Map<string, PendingPermission>();

   /** task-08 adapter 调用：发 permission_request + 等待 response 或超时。 */
   async awaitPermission(sessionId: string, requestId: string, timeoutMs = 30_000): Promise<'allow' | 'deny'> {
     return new Promise((resolve, reject) => {
       const timer = setTimeout(() => {
         this.pendingPermissions.delete(requestId);
         reject(new Error(`permission timeout: ${requestId}`));
       }, timeoutMs);
       this.pendingPermissions.set(requestId, { resolve, reject, timer });
       // 实际发送由调用方（task-08 adapter）通过 wsClient.sendPermissionRequest 完成
     });
   }

   /** ws-client onPermissionResponse 回调路由到此处。 */
   resolvePermission(sessionId: string, requestId: string, decision: 'allow' | 'deny'): void {
     const pending = this.pendingPermissions.get(requestId);
     if (!pending) {
       // R-02：已 timeout / 未知 request_id，静默 warn 不崩溃
       return;
     }
     clearTimeout(pending.timer);
     this.pendingPermissions.delete(requestId);
     pending.resolve(decision);
   }
   ```
   - **task-08 协作点**：task-08 的 stream-json handleControlRequest 在 manual_approval=true 时调 `awaitPermission` + `wsClient.sendPermissionRequest`；本任务只提供这两个 API，不接 adapter 调用。

10. **跑测试验证**：
    - `cd sillyhub-daemon && pnpm test -- ws-client`（新方法单测，见 §7.1）。
    - `cd sillyhub-daemon && pnpm typecheck`（新 payload 类型可 import）。
    - `cd backend && uv run pytest tests/modules/daemon/ -k permission`（service 单测，见 §7.2）。
    - 端到端：模拟 daemon 发 → backend 落 pending → 模拟前端 POST → backend 推 → daemon 收（§7.3 集成测试或手测）。

11. **对照 §5 完成标准逐项打勾**。

## 7. 测试要点

### 7.1 daemon 侧单测（ws-client）

**文件**：`sillyhub-daemon/tests/ws-client.test.ts`（或新增 `ws-client.permission.test.ts`）

```typescript
describe('WsClient — permission 通道（task-07）', () => {
  it('sendPermissionRequest 发出正确 type + payload', () => {
    const ws = new WsClient({ serverUrl: 'ws://x', runtimeId: 'r1' });
    // stub _ws.send 捕获出站 JSON
    const sent: string[] = [];
    (ws as any)._ws = { readyState: 1 /* OPEN */, send: (s: string) => sent.push(s) };
    ws.sendPermissionRequest({
      session_id: 's1', request_id: 'rq1', tool_name: 'Bash', input: { cmd: 'ls' },
    });
    const msg = JSON.parse(sent[0]);
    expect(msg.type).toBe('daemon:permission_request');
    expect(msg.payload).toMatchObject({ session_id: 's1', request_id: 'rq1', tool_name: 'Bash' });
  });

  it('_handleMessage 收到 PERMISSION_RESPONSE 触发 onPermissionResponse 回调', () => {
    let received: PermissionResponsePayload | undefined;
    const ws = new WsClient({
      serverUrl: 'ws://x', runtimeId: 'r1',
      callbacks: { onPermissionResponse: (p) => { received = p; } },
    });
    const raw = JSON.stringify({
      type: 'daemon:permission_response',
      payload: { session_id: 's1', request_id: 'rq1', decision: 'allow' },
    });
    (ws as any)._handleMessage(Buffer.from(raw));
    expect(received).toMatchObject({ session_id: 's1', request_id: 'rq1', decision: 'allow' });
  });

  it('未连接时 sendPermissionRequest 返回 false 不抛', () => {
    const ws = new WsClient({ serverUrl: 'ws://x', runtimeId: 'r1' });
    expect(ws.sendPermissionRequest({
      session_id: 's1', request_id: 'rq1', tool_name: 'Bash', input: {},
    })).toBe(false);
  });
});
```

**sessionStore pending map 单测**（若 task-03 已落地）：

```typescript
describe('SessionStore — pendingPermissions（task-07）', () => {
  it('awaitPermission resolve on resolvePermission', async () => {
    const store = new SessionStore();
    store.create('s1', /* ... */);
    const p = store.awaitPermission('s1', 'rq1', 1000);
    store.resolvePermission('s1', 'rq1', 'allow');
    await expect(p).resolves.toBe('allow');
  });

  it('awaitPermission rejects on timeout', async () => {
    const store = new SessionStore();
    store.create('s1', /* ... */);
    await expect(store.awaitPermission('s1', 'rq1', 50)).rejects.toThrow('timeout');
  });

  it('resolvePermission 未知 request_id 静默不抛（R-02）', () => {
    const store = new SessionStore();
    store.create('s1', /* ... */);
    expect(() => store.resolvePermission('s1', 'unknown', 'allow')).not.toThrow();
  });
});
```

### 7.2 backend 侧单测（service + router）

**文件**：`backend/tests/modules/daemon/test_permission_service.py`（新增）

```python
import pytest

@pytest.mark.asyncio
async def test_persist_and_respond_permission_roundtrip(db_session, mock_ws_hub):
    svc = DaemonService(db_session)
    # daemon 上报
    await svc.persist_permission_request(
        runtime_id=uuid.uuid4(), session_id=SESS_ID,
        request_id="rq1", tool_name="Bash", input_={"cmd": "ls"},
    )
    # 前端决定
    await svc.respond_permission(SESS_ID, "rq1", "allow", USER_ID)
    # 断言 ws_hub.send_permission_response 被调一次 + pending Map 已清
    mock_ws_hub.send_permission_response.assert_called_once()
    assert svc._pending_permissions.get((SESS_ID, "rq1")) is None


@pytest.mark.asyncio
async def test_respond_unknown_permission_raises_not_found(db_session):
    svc = DaemonService(db_session)
    with pytest.raises(DaemonPermissionRequestNotFound):
        await svc.respond_permission(uuid.uuid4(), "unknown", "allow", USER_ID)


@pytest.mark.asyncio
async def test_respond_already_resolved_raises_conflict(db_session, mock_ws_hub):
    svc = DaemonService(db_session)
    await svc.persist_permission_request(...)
    await svc.respond_permission(SESS_ID, "rq1", "allow", USER_ID)
    # 第二次 resolve：pending 已清 → NotFound（或单独 AlreadyResolved，二者择一）
    with pytest.raises((DaemonPermissionRequestNotFound, DaemonPermissionAlreadyResolved)):
        await svc.respond_permission(SESS_ID, "rq1", "deny", USER_ID)
```

### 7.3 端到端集成测试（可选但推荐）

模拟完整往返（FastAPI TestClient + fake WS）：
1. backend 起 WS `/ws?runtime_id=X`。
2. 测试代码模拟 daemon 发 `{ type: 'daemon:permission_request', payload: {...} }`。
3. 断言 SSE channel 收到 permission_event（或 pending Map 有记录）。
4. 测试代码 POST `/api/daemon/sessions/{id}/permissions/{rq1}` body `{ decision: 'deny' }`。
5. 断言 WS 收到 `{ type: 'daemon:permission_response', payload: { decision: 'deny' } }`。

### 7.4 不验证的内容（划界，属 task-08）

- **不**测 stream-json handleControlRequest 在 manual_approval=true 时调 sendPermissionRequest（task-08）。
- **不**测 json-rpc approval handler 升级（task-08）。
- **不**测前端权限弹窗 UI（task-11）。
- 本任务只锁**通道两端收发 + pending map 配对**。

## 8. 风险与注意事项

| 风险 | 等级 | 应对 |
|------|------|------|
| **与 task-08 边界混淆**：本任务通道，task-08 adapter 触发，容易越界写到 adapter | P0 | §3「不改动」+ §9 接口边界明确划界；本任务 sendPermissionRequest / awaitPermission / resolvePermission 是 API，task-08 才是调用方 |
| **pending permission 超时无清理**：daemon 侧 awaitPermission 超时后 backend 仍持有 pending Map 内存泄漏 | P1 | daemon 侧 awaitPermission 内部 setTimeout 清理（§6 步骤 9）；backend 侧 pending Map 加 TTL（execute 阶段用 `cachetools.TTLCache` 或定时清理），或文档注明崩溃=会话结束（design §3 R-03 非目标，Wave 2 接受） |
| **WS 重连丢消息**：daemon 断线重连期间 backend 推的 permission_response 丢失，daemon 侧 awaitPermission 永久 hang | P1 | daemon 侧 awaitPermission 强制 timeout（默认 30s，§6 步骤 9）；timeout 后 adapter task-08 决定降级（deny 或 retry）；backend 侧若 daemon 离线则 send_permission_response 返回 False，service 抛 DaemonRuntimeOffline → 前端 504 提示重试 |
| **request_id 配对漂移**：daemon 生成 request_id 与 backend 回填不一致 | P1 | request_id 由 daemon 生成（task-08 adapter 内 uuid4），backend 全程透传不重新生成；契约单测覆盖「同 request_id 往返」 |
| **manual_approval 默认值误开**：误把默认设为 true 导致所有会话都暂停 | P0 | 读取时 `config.get("manual_approval", False)` 显式默认 False；task-01 建表时 server_default 也为 False；单测覆盖「无 config 的 session 不触发暂停」（task-08 守护） |
| **ownership 校验缺失**：前端可批准他人 session 的 permission | P1 | service.respond_permission 内校验 `agent_sessions.user_id == current_user.id`，否则 403/404；§6 步骤 3 已纳入 |
| **task-04 send_session_control 接口未定**：本任务复用该接口，若 task-04 命名不同需调整 | P2 | execute 阶段优先 grep `send_session_control` 确认；若不存在则本任务直接用 send_to_runtime 构造（§6 步骤 4 已留双路径） |
| **Pydantic UUID 序列化**：PermissionRequestPayload.session_id 是 uuid.UUID，WS 收到的 JSON 是 string，解析需 UUID(str) | P1 | router 分支显式 `uuid.UUID(payload["session_id"])`；异常 try/except 静默丢弃（§6 步骤 5） |
| **多 daemon 并发同 session**：理论上 1 session=1 daemon（D-002），但 WS 重连期间可能短暂双连 | P2 | ws_hub.connect 已处理「旧连接 close 4000 replaced」（ws_hub.py:73）；permission_response 推到当前活跃连接即可，pending map 按 session_id 而非 runtime_id 索引 |

## 9. 与其他任务的接口边界

- **← task-02（协议契约）**：本任务直接消费 PERMISSION_REQUEST/RESPONSE 常量 + payload。task-02 字符串漂移 → 本任务分派分支找不到 type。**硬依赖**。
- **← task-01（数据模型）**：agent_sessions.config 字段存在性。**硬依赖**。
- **← task-03（daemon sessionStore）**：pendingPermissions Map 落在 sessionStore 上，task-03 提供该类骨架。**软依赖**（task-03 未就绪时本任务可先用独立 Map 占位，但建议等 task-03 合并以免返工）。
- **← task-04（backend ws_hub.send_session_control）**：send_permission_response 优先复用。**软依赖**（不存在则本任务直接调 send_to_runtime）。
- **← task-05（session 级 SSE）**：推前端用 `agent_session:{session_id}` channel。**软依赖**（未就绪则降级 log + REST 查询）。
- **→ task-08（adapter 触发）**：本任务提供 `sendPermissionRequest` / `awaitPermission` / `resolvePermission` API；task-08 在 stream-json handleControlRequest + json-rpc approval handler 调用之。**关键交接**：本任务完成后需通知 task-08 实现者 API 签名已锁定。
- **→ task-11（前端权限弹窗）**：本任务提供 `POST /sessions/{id}/permissions/{request_id}` REST 端点 + SSE permission_event；task-11 订阅 SSE + 调 REST。**关键交接**：端点路径 + schema 已在 §6 步骤 2/5 锁定。
- **→ task-06（Wave1 联调 + 空闲回收）**：session 结束（end_session）时应清理该 session 的所有 pendingPermissions（避免内存泄漏），本任务在 sessionStore.end 内追加清理钩子（与 task-03/06 实现者协商）。

## 10. 自检清单（对照 CLAUDE.md 流程）

- [x] 文档先行：本蓝图即文档，依据 design.md §5 Wave2 + §7.1 + plan.md task-07 行。
- [x] 读现有代码：已 Read `protocol.ts` / `protocol.py` / `ws-client.ts` / `ws_hub.py` / `router.py` / `agent/model.py` / `stream-json.ts handleControlRequest` 段 / task-02 + task-04 蓝图。
- [ ] 写测试：§7 已规划 daemon ws-client 单测 + backend service 单测 + 端到端集成（execute 阶段落地）。
- [ ] 写实现：§6 步骤已规划两端通道 + pending map + REST 端点（execute 阶段落地）。
- [ ] 跑测试：§5 列出 `pnpm test` + `uv run pytest` 命令。
- [ ] 对照文档验收：§5 完成标准逐项可勾。
