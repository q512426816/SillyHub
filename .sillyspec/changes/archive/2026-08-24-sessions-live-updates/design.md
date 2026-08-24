---
author: qinyi
created_at: 2026-08-24 07:24:36
change: 2026-08-24-sessions-live-updates
scale: large
tier: independent
risk_level: unit-sufficient
---

# 设计（Design）：会话列表 SSE 变更信号 + 轮询兜底

## 背景与目标

**背景**：会话页左侧树靠条件轮询刷新（ql-20260824-004：进行中 10s / 静默 30s），
用户实测反馈不及时——轮询是「定时问」，新上报会话、远端结束的会话最坏要等一个
周期；缩间隔治标且空转翻倍。

**目标**：会话列表变化（created / status_changed / deleted）**秒级**反映到打开的
会话页；推送失效时不得劣于现状（轮询兜底保留）。

**问题边界**：不推 turn_count/last_active 增量（onTurnCompleted 已即时刷新）、
不推机器在线状态、不回放断线历史、移动端不覆盖（详见 proposal Non-Goals）。

## 0. 决策总览

| # | 决策 | 选择 | 依据 |
|---|---|---|---|
| D-001 | 推送模式 | lazy refresh（信号→重拉） | 写入点分散 8+ 处，行级推送要前端合并状态机；漏发可容忍（轮询兜底） |
| D-002 | 事件范围 | created / status_changed / deleted 三类低频事件 | turn 增量已有 onTurnCompleted 即时刷新（ql-20260824-004），不重复推 |
| D-003 | 传输 | SSE（fetch 版，`fetchSse`） | 浏览器侧推送先例全 SSE（5 处）；fetchSse 已解决 EventSource 无法带 Bearer 头 + 重连退避 |
| D-004 | 扇出 | Redis pub/sub 新全局频道 `agent_sessions:changed` | 既有 `agent_session:{id}` 同款基建；单进程 uvicorn 下进程内总线也够，但 Redis 贴合现状且不锁死扩缩容 |
| D-005 | 用户隔离 | 发布带 user_id，SSE 生成器过滤后下发 | 免为每用户建频道；会话页连接数 = 打开的标签页数，量小 |
| D-006 | 断线语义 | 不回放历史；重连成功补一次 invalidate | 轮询兜底收敛；Last-Event-ID 游标回放复杂度不值（Non-Goal） |
| D-007 | 轮询 | 10s/30s 原样保留 | SSE 是增强不是替代；联动降档引入连接状态与轮询参数耦合，留后续 |

## 1. 后端设计

### 1.1 发布辅助（新文件 `backend/app/modules/daemon/session_events.py`）

```python
SESSIONS_CHANGED_CHANNEL = "agent_sessions:changed"

async def publish_sessions_changed(
    event: Literal["created", "status_changed", "deleted"],
    session_id: uuid.UUID,
    user_id: uuid.UUID | None,
) -> None:
    """publish {"event", "session_id", "user_id", "at"} 到全局列表信号频道。

    失败 log.warning 不抛（对齐 _publish_session_event 容错语义——Redis 抖动
    不能打断业务写；前端有轮询兜底，漏发可容忍）。
    """
```

- `user_id` 取会话属主（`AgentSession.user_id`）；None 时跳过发布（无主数据不进
  列表视图，推了也没人看）。
- 独立小模块而非塞进 SessionService：埋点跨 7 个模块（session/run_sync/sweep/
  lease_service/platform_sync/agent service/agent placement），避免循环 import。

### 1.2 埋点清单（写入点 × 事件）

见 §3 生命周期契约表（同一张表即实现映射清单）。

### 1.3 SSE 端点（`daemon/router.py` 新路由）

```python
@router.get("/sessions/events")
async def stream_sessions_changed(...) -> StreamingResponse:  # text/event-stream
```

- 鉴权：与 list_sessions 同款登录依赖。
- 生成器骨架照抄 `AgentService.stream_session_logs`（agent/service.py:1190，
  connected/keepalive/get_message 循环）：
  `yield ": connected\n\n"` → `pubsub.subscribe(SESSIONS_CHANGED_CHANNEL)` →
  `get_message` 循环，静默 30s 发 `: keepalive\n\n"`；收到消息解析 JSON，
  `payload["user_id"] == current_user.id` 才 `yield f"data: {raw}\n\n"`。
- **无 DB 访问**（信号自带 user_id），不占连接池——比先例更简单。
- finally：`pubsub.unsubscribe/close`；客户端断开（GeneratorExit/CancelledError）
  由 StreamingResponse 常规收口。

## 2. 前端设计

### 2.1 订阅客户端（`frontend/src/lib/daemon.ts` 追加）

```ts
export function subscribeAgentSessionsEvents(opts: {
  onEvent: () => void;          // 收到任一信号（用户过滤已在后端完成）
  onReconnected?: () => void;   // 断线后重连成功（补 invalidate）
}): { close: () => void }
```

- 复用 `fetchSse` + `RECONNECT_BACKOFF_MS` 退避骨架（抄 streamSession 的
  wireConnection/scheduleReconnect 收敛版）。注意 fetchSse 本身**不含**自动重连
  与 Last-Event-ID 重放（fetch-sse.ts:14-20）——退避重连在本函数内自实现
  （对齐 streamSession daemon.ts:909/1045-1071 先例）；token 每次重连现取。
  onmessage → `onEvent()`；error → 退避重连，重连成功触发 `onReconnected`
  （仅断开过才调）。
- URL：`/api/daemon/sessions/events`。

### 2.2 门户接线（`sessions-portal.tsx`）

```ts
useEffect(() => {
  const sub = subscribeAgentSessionsEvents({
    onEvent: () => void qc.invalidateQueries({ queryKey: ["agentSessions"] }),
    onReconnected: () => void qc.invalidateQueries({ queryKey: ["agentSessions"] }),
  });
  return () => sub.close();
}, [qc]);
```

- 前缀失效天然覆盖三入口（scope 键在前缀之下）。`useDaemonMachines` 的
  sessions 旁路**不在该前缀之下**（queryKey 为 ["daemonMachines","list",…]，
  query-keys.ts:27-31）——其自带 15s 无条件轮询（use-daemon-machines.ts:38），
  机器/会话旁路刷新维持现状，不在本变更范围（对齐 Non-Goals）。
- 三入口共用 SessionsPortal → 自动全量生效，无 per-入口接线。

## 3. 生命周期契约表（session 状态迁移事件 × 发起方 × 接收方）

> 本表同时是 FR-01 埋点实现清单。「接收方」均为：Redis 频道
> `agent_sessions:changed` → SSE `/api/daemon/sessions/events` → 前端
> invalidate ["agentSessions"]。必需字段：event / session_id / user_id / at。

| 写入点（文件:函数） | 事件 | 状态变化 | 备注 |
|---|---|---|---|
| session/service.py:create_session（INSERT + 派发激活两步） | created + status_changed | →pending →active | 激活步与 INSERT 同函数内，合并发 status_changed 一次即可（created 已表达出现） |
| session/service.py:_converge_failed_dispatch | status_changed | →failed | 派发失败收敛 |
| session/service.py:_activate_tool_report_session | status_changed | →active | CLI 会话懒激活 |
| session/service.py:inject 系列（_inject_into_session） | —（不发布） | turn+1/last_active | Non-Goal：onTurnCompleted 已覆盖 |
| session/service.py:end_session | status_changed | →ended | |
| session/service.py:reopen_session | status_changed | →reconnecting | |
| session/service.py:recover_session_after_daemon_restart | status_changed | →reconnecting | daemon 回调 |
| session/service.py:confirm_session_reconnected | status_changed | →active | |
| session/service.py:mark_session_recovery_failed | status_changed | →failed | |
| session/service.py:delete_agent_session | deleted | 软删 | |
| run_sync/service.py:close_interactive_run（终态回写分支） | status_changed | →ended/failed | **active→终态主收口**；非终态 last_active 分支不发布 |
| lease_service.py:cancel_lease（interactive 分支） | status_changed | →ended | 幂等收口，仅实际变更时发 |
| sweep.py:session_reconnect_sweep_once | status_changed | →failed | 批量 UPDATE 后按行发 |
| sweep.py:session_offline_sweep_once | status_changed | →failed | 同上（已有 session_ended per-session 发布点可参考） |
| agent/service.py:start_scan_dispatch（INSERT+激活） | created | →pending→active | |
| agent/placement.py INSERT INTO agent_sessions | created | →pending | raw SQL 处，取 user_id 后发 |
| platform_sync/service.py tool_report upsert | created（仅插入分支）/ status_changed（仅 last_active 刷新分支不发布） | →pending | 命中已有会话仅刷 last_active → 不发布 |

## 4. 文件变更清单（File Changes）

| 操作 | 路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/daemon/session_events.py | 频道常量 + publish_sessions_changed |
| 修改 | backend/app/modules/daemon/session/service.py | SessionService 埋点（9 写入点） |
| 修改 | backend/app/modules/daemon/run_sync/service.py | close_interactive_run 终态埋点 |
| 修改 | backend/app/modules/daemon/sweep.py | 两档巡检埋点 |
| 修改 | backend/app/modules/daemon/lease_service.py | cancel_lease 埋点 |
| 修改 | backend/app/modules/daemon/router.py | 新 SSE 端点 /sessions/events |
| 修改 | backend/app/modules/agent/service.py | 扫描派发创建埋点 |
| 修改 | backend/app/modules/agent/placement.py | placement INSERT 埋点 |
| 修改 | backend/app/modules/platform_sync/service.py | tool_report 插入分支埋点 |
| 新增 | backend/app/modules/daemon/tests/test_session_events.py | 发布辅助 + SessionService 埋点断言 |
| 新增 | backend/app/modules/daemon/tests/test_session_events_cross.py | 跨模块埋点断言 |
| 新增 | backend/app/modules/daemon/tests/test_sessions_events_stream.py | SSE 端点测试 |
| 修改 | frontend/src/lib/daemon.ts | subscribeAgentSessionsEvents + 常量提升导出 |
| 新增 | frontend/src/lib/daemon.test.ts | 订阅客户端测试（若既有文件名不同以实际为准，卡片有说明） |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 门户接线 |
| 修改 | frontend/src/components/sessions/__tests__/sessions-portal.test.tsx | 接线测试 |

**不改动**：openapi.json / api-types.ts（SSE 端点无 JSON schema 契约，信号负载为
内部协议，前端手写类型注释声明——先例：streamSession 的 envelope 类型）。

## 5. 风险登记（Risk）

| 风险 | 等级 | 缓解 |
|---|---|---|
| 埋点遗漏某写入点 → 该变化不推 | 中 | 轮询 30s 兜底收敛；§3 表即审计清单，review 逐行核对 |
| Redis 抖动 → 发布/订阅双双失效 | 低 | publish 静默容错（先例同款）；SSE 断线前端退避重连 + 补失效；轮询兜底 |
| 反向代理空闲超时掐连接 | 低 | 30s keepalive 注释（先例 stream_session_logs 同款，生产已验证） |
| 高频 status_changed 风暴（sweeper 批量失败） | 低 | 单进程下每信号一帧，量级=失败会话数；前端 invalidate 有 react-query 去抖（同一失效窗口合并重拉一次） |
| 多标签页重复连接/失效 | 低 | 每标签一条连接为既定语义；失效幂等（react-query 按查询合并） |
| placement raw SQL 拿不到 user_id | 中 | INSERT 参数里有 user_id 列，落库前值可直接用；缺则跳过发布（无主数据不进列表） |

## 6. 自审（Self-Review）

- 及时性：事件级（写入→publish→pub/sub→SSE 帧→invalidate→重拉，亚秒级网络
  往返），满足「比轮询更及时」的原始诉求。
- 可靠性：三层兜底（推送 → 重连补失效 → 10s/30s 轮询），最坏退化 = 现状。
- 复杂度收敛：后端抄既有 pub/sub+SSE 骨架，前端抄既有 fetchSse+退避骨架，无新
  依赖、无 schema 变更、无新状态机。
- 用户隔离：信号按 user_id 过滤，不泄漏他人会话存在性（列表本身仅本人可见，
  语义一致）。
- 已知取舍：断线窗口内事件不回放（D-006）；机器在线状态不推（Non-Goal）。
