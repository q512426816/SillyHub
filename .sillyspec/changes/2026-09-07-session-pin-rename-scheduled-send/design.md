---
author: qinyi
created_at: 2026-09-07 23:03:25
scale: large
---

# 设计文档（Design）— 2026-09-07-session-pin-rename-scheduled-send

## 背景

会话门户（sessions portal）的左侧会话树目前只有「最近活跃」一种排序，用户高频使用的会话会随时间沉底；会话标题只能由服务端从首条 user_input 自动派生（前 30 字），一旦派生不理想没有修正入口。同时，会话聊天中用户常有「过一段时间再让它继续」「明早再跑某个指令」的需求，现状只能守着页面到点手动发送。

本变更补齐三块能力：

1. **会话树置顶**：置顶的会话排在其所属工作区分组最前（D-002@v1）。
2. **会话重命名**：用户显式命名会话，覆盖自动派生标题。
3. **会话定时发送**：为会话设定一条未来的定时消息（一次性，分钟级，D-002@v1），到点由后端常驻协程自动派发，复用既有 inject 全链路（忙轮自动进既有消息队列）。

## 设计目标

- 置顶/取消置顶/重命名三个操作在多端（多浏览器标签）间经 SSE 秒级同步（对齐 archive 的 `publish_sessions_changed` 先例）。
- 定时消息在页面关闭、后端重启后仍然生效（持久化落库，sweeper 到点派发）。
- 定时发送到点时：会话空闲 → 直接发出；会话正忙 → 进入既有消息队列排队（用户可重排/取消）；会话已终态（ended/failed/deleted）→ 定时条目置 failed 并记录原因，不盲发。
- 前端零布局变化：置顶/重命名走既有 hover 按钮模式；定时入口是输入栏一个图标按钮 + 弹窗；定时列表挂在消息队列展示条同区域。

## 非目标

- 不做周期性/重复定时（每天/每周）——一次性定时足够覆盖主场景，重复规则留作后续独立变更（D-002@v1）。
- 不做全局置顶（跨工作区抽到树顶）——只做分组内置顶（D-002@v1）。
- 不做定时消息的编辑（改内容/改时间）——只支持取消后重建（对齐 YAGNI；队列条目编辑是既有功能不重复建）。
- 不做群聊（group chat）行的置顶/重命名——本变更只覆盖普通 chat 会话行（`SessionRow`）；群行操作留待后续按需扩展。
- 不改 daemon（sillyhub-daemon）——定时派发走 backend→daemon 既有 SESSION_INJECT 通道，daemon 零改动。

## 拆分判断

两个功能（置顶/重命名、定时发送）共用「会话域」的模型与列表链路，且前端落点都在会话门户/会话面板一处，合并为一个变更交付；不满足「3+ 可独立交付模块」的拆分条件，不走批量模式（无重复模式任务）。

## 总体方案

### Wave 1（后端）：置顶 + 重命名

1. `AgentSession` 加 `pinned_at` 列（`DateTime(timezone=True) nullable`，NULL=未置顶，照 `archived_at` 列形态）+ 索引 `ix_agent_sessions_pinned_at`（对齐 `ix_agent_sessions_archived_at` 声明惯例）；alembic 迁移同步建列建索引。
2. `SessionService.list_agent_sessions` 排序键改为：`pinned_at IS NULL` 升序（置顶行在前；**多置顶之间按既有最近活跃序排**——排序键即 `(pinned_at IS NULL) ASC, coalesce(last_active_at, created_at) DESC, id DESC`，对齐 D-002@v1「多个置顶按最近活跃排」）→ 未置顶行维持既有 `coalesce(last_active_at, created_at) DESC` → `id DESC`。由于前端分组是「服务端返回序 × 工作区分组桶」保序插入（`session-list-panel.tsx` 的 `byWs` 桶按服务端序 push、无客户端重排），置顶会话自然落在其分组内最前（分组内置顶语义，D-002@v1）。
3. `AgentSessionRead` 加 `pinned_at` 字段（`from_attributes` 直接映射，默认 None 守护旧行）。
4. 三个新端点（照 archive/unarchive 模式，`TaskRunAgentUser` 鉴权 + 204）：
   - `PATCH /api/daemon/sessions/{session_id}/pin` — 置顶（写 `pinned_at=now`，幂等：已置顶早退）。
   - `PATCH /api/daemon/sessions/{session_id}/unpin` — 取消置顶（清 `pinned_at`，幂等）。
   - `PATCH /api/daemon/sessions/{session_id}/title` — 重命名（body `{"title": str}`，strip 后非空、≤255 字符；写 `title` 列）。列表标题派生逻辑（router 层 title 优先、回退首条 user_input）零改动——重命名天然优先生效。
5. 三个方法实现照 `archive_session`/`unarchive_session`：`_get_owned_session_for_update` 同款行锁 + 归属校验（404 不泄露存在性）→ 幂等早退（rollback 释放锁）→ 写列 → commit → `publish_sessions_changed("status_changed", ...)`（SSE 多端同步）。

### Wave 2（后端）：定时发送

1. 新表 `agent_session_scheduled_messages`（模型 `AgentSessionScheduledMessage`，放 `agent/model.py` 与 `AgentSessionQueuedMessage` 相邻；列定义见 §数据模型）。
2. 三个 CRUD 端点（挂 daemon router，`TaskRunAgentUser` 鉴权）：
   - `POST /api/daemon/sessions/{session_id}/scheduled` — 创建：body `{prompt, dispatch_at, attachment_ids?, agent_profile_id?, llm_provider_id?}`；校验 prompt 非空（附件非空豁免，对齐 inject 口径）、`dispatch_at` 为未来时间（≥ now+60s，防「刚建即过期」竞态）、会话归属 + 会话非终态；快照字段原样落库，status=pending。
   - `GET /api/daemon/sessions/{session_id}/scheduled` — 列表（全部状态，按 dispatch_at 升序）。
   - `DELETE /api/daemon/sessions/{session_id}/scheduled/{message_id}` — 取消：仅 pending 可取消（置 cancelled + `cancelled_at`；非 pending 409）。
3. **派发 sweeper**（新文件 `backend/app/modules/daemon/scheduled_send.py`，照 `sweep.py` 的 `session_reconnect_sweeper` 模式）：
   - `scheduled_send_sweep_once(db_session)` 单趟：`SELECT ... WHERE status='pending' AND dispatch_at <= now()`（一次最多取 50 条防长事务）。逐条：行锁取条目复核 pending → 复核所属会话状态：终态（ended/failed）或 `deleted_at` 非空 → 置 failed 记 `error_code='session_inactive'`；否则调 `SessionService.inject_session_as_service(session_id, prompt=..., queue_when_busy=True, attachment_ids=..., agent_profile_id=..., llm_provider_id=...)`——空闲直接发出（建 run + SESSION_INJECT），忙轮自动落 `AgentSessionQueuedMessage`（既有五操作全兼容）。inject 成功返回 → 置 dispatched + `dispatched_at`。inject 抛 `AppError` → 置 failed + `error_code`/`error_message`；单条失败不中断同轮其它条目（失败隔离）。时间比较在 Python 侧算好绑定参数（aiosqlite/PG 双方言，对齐 sweep.py NFR 惯例）。
   - `scheduled_send_sweeper(interval=30)` 常驻循环：每轮独立短 session、单轮异常 `log.exception` 吞掉不崩循环、`asyncio.sleep` 处 `CancelledError` 透传（shutdown 干净落地）。
   - `main.py` lifespan 注册：占位 None → `create_task(scheduled_send_sweeper(), name="scheduled-send-sweeper")` → finally cancel + gather（对齐 `session_reconnect_sweeper` 三段契约）。
4. 归属语义：定时条目带 `sender_user_id`（创建者），派发时 `queue_sender_user_id=sender_user_id`（忙轮入队记账与即时发送一致）。

### Wave 3（前端）：

1. `lib/daemon.ts` 新增六个 API 函数：`pinAgentSession` / `unpinAgentSession` / `renameAgentSession`（PATCH title）/ `createScheduledMessage` / `listScheduledMessages` / `cancelScheduledMessage`（照 `archiveAgentSession` 模板）。
2. `pnpm gen:types` 同步 `api-types.ts`（`pinned_at` 字段 + scheduled 三个 DTO）+ 提交 `backend/openapi.json`。
3. **会话树**（`session-list-panel.tsx`）：`SessionRow` hover 按钮区在归档按钮左侧加「置顶/取消置顶」按钮（按 `session.pinned_at` 二选一显隐，对齐归档按钮模式）+「重命名」按钮（Pencil 图标）；重命名交互 = 行内标题位变输入框（预填当前标题，Enter 提交 / Esc 取消 / blur 提交，strip 非空 ≤255）；置顶行标题前加 Pin 小图标（brand 阶）。回调 `onPinSessions` / `onUnpinSessions` / `onRenameSession` 经 props 注入，`sessions-portal.tsx` 接线（调 API → `qc.invalidateQueries(["agentSessions"])` → toast，对齐 archive 接线模式）。
4. **定时发送 UI**（`session-panel.tsx` + 新组件 `scheduled-messages-bar.tsx`）：
   - 输入栏（`session-input-bar.tsx`）发送按钮左侧加 ⏰ 定时按钮（仅已有 sessionId 的会话显示）；点击弹 Modal（antd）：内容预览（当前输入框草稿）+ 日期时间选择（分钟级）+ 快捷项（30 分钟后 / 1 小时后 / 明早 9 点）+ 确认创建（成功后清草稿 + 聊天流插一条系统提示「已创建定时消息：{时间} 发送「{摘要}」」）。
   - `scheduled-messages-bar.tsx`：挂在 `MessageQueueBar` 相邻位置（输入栏上方工具区；**双挂载点**：session-panel 的 page 模式与 dialog 模式两处 MessageQueueBar 邻位都要挂，Grill B-05），列出定时条目（派发时间 + 内容摘要 + 状态 tag + pending 可取消）；数据经新 hook `use-scheduled-messages.ts`（react-query，queryKey `["agentSessions","scheduled",sessionId]`，30s 轮询 + invalidate）。
   - 样式全走语义阶（brand-*/muted/destructive，双主题铁律）；图标 lucide（Clock/X）。

## 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 修改 | backend/app/modules/agent/model.py | `AgentSession` 加 `pinned_at` 列 + 索引声明；新增 `AgentSessionScheduledMessage` 表模型（与 `AgentSessionQueuedMessage` 相邻） |
| 新增 | backend/migrations/versions/20260907231000_add_session_pin_title_scheduled.py | 迁移：`agent_sessions.pinned_at` 列 + `ix_agent_sessions_pinned_at` 索引；新表 `agent_session_scheduled_messages` |
| 修改 | backend/app/modules/daemon/schema.py | `AgentSessionRead` 加 `pinned_at`（producer=ORM 列 → consumer=前端会话树行按钮显隐/排序徽标）；新增 `SessionTitleUpdateRequest` / `ScheduledMessageCreateRequest` / `ScheduledMessageRead`（producer=router 构造 → consumer=api-types.ts 生成 → 前端消费） |
| 修改 | backend/app/modules/daemon/router.py | pin/unpin/title 三 PATCH 端点（204）；scheduled 三端点（POST 201 / GET list / DELETE 204）；`list_sessions` 无改动（pinned_at 经 from_attributes 自动下发） |
| 修改 | backend/app/modules/daemon/service.py | 门面加 `pin_session` / `unpin_session` / `rename_session` / `list_scheduled_messages` / `create_scheduled_message` / `cancel_scheduled_message` 委托 |
| 修改 | backend/app/modules/daemon/session/service.py | `SessionService` 实现 pin/unpin/rename（照 archive 模板：行锁+幂等+SSE）；`list_agent_sessions` 排序键加 pinned 优先；scheduled CRUD 实现方法 |
| 新增 | backend/app/modules/daemon/scheduled_send.py | `scheduled_send_sweep_once` + `scheduled_send_sweeper`（照 sweep.py 模式，调 `inject_session_as_service`） |
| 修改 | backend/app/main.py | lifespan 注册 `scheduled_send_sweeper`（占位 None → create_task → finally cancel+gather） |
| 修改 | frontend/src/lib/api-types.ts | `pnpm gen:types` 生成（pinned_at + scheduled DTO），禁止手写 |
| 修改 | backend/openapi.json | gen:types 联动导出 |
| 修改 | frontend/src/lib/daemon.ts | 六个 API 函数（pin/unpin/rename/createScheduled/listScheduled/cancelScheduled） |
| 修改 | frontend/src/components/sessions/session-list-panel.tsx | `SessionRow` hover 按钮区加置顶/重命名按钮 + 置顶徽标 + 行内重命名编辑态；`SessionListPanel` 处理函数与 props 透传 |
| 修改 | frontend/src/components/sessions/sessions-portal.tsx | 接线三回调（调 API → invalidate agentSessions → toast） |
| 修改 | frontend/src/components/daemon/session-panel.tsx | 输入栏定时按钮接线 + 定时系统提示行 + 挂载 ScheduledMessagesBar |
| 修改 | frontend/src/components/daemon/session-input-bar.tsx | 发送按钮左侧加 ⏰ 定时按钮（props 注入 onSchedule） |
| 新增 | frontend/src/components/daemon/scheduled-messages-bar.tsx | 定时消息列表条（状态 tag + 取消，挂 MessageQueueBar 邻位） |
| 新增 | frontend/src/hooks/use-scheduled-messages.ts | 定时消息 react-query hook（30s 轮询 + invalidate） |
| 修改 | backend/app/modules/daemon/tests/（新增测试文件） | 见 §接口定义下方测试清单 |

字段数据流（新增对外字段）：`pinned_at`：agent/model.py ORM 列 → migration → `AgentSessionRead`（from_attributes）→ openapi/api-types.ts → session-list-panel.tsx 按钮显隐与徽标 → pin/unpin API 写回。`ScheduledMessageRead`：scheduled_send CRUD 构造 → router 响应 → api-types.ts → use-scheduled-messages.ts → scheduled-messages-bar.tsx。

## 接口定义

```python
# backend/app/modules/daemon/schema.py
class SessionTitleUpdateRequest(BaseModel):
    title: str  # strip 后非空、≤255；router/service 层校验

class ScheduledMessageCreateRequest(BaseModel):
    prompt: str                                   # 非空（或 attachment_ids 非空豁免）
    dispatch_at: datetime                         # 必须 ≥ now+60s
    attachment_ids: list[uuid.UUID] | None = None # 附件快照（转 str 落库）
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None

class ScheduledMessageRead(BaseModel):
    id: uuid.UUID
    agent_session_id: uuid.UUID
    prompt: str
    dispatch_at: datetime
    status: str            # pending / dispatched / cancelled / failed
    attachment_ids: list[str] | None = None
    agent_profile_id: str | None = None
    llm_provider_id: str | None = None
    error_code: str | None = None
    error_message: str | None = None
    created_at: datetime
    dispatched_at: datetime | None = None
    cancelled_at: datetime | None = None
    model_config = {"from_attributes": True}
```

```python
# backend/app/modules/daemon/session/service.py（签名）
async def pin_session(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None: ...
async def unpin_session(self, session_id: uuid.UUID, user_id: uuid.UUID) -> None: ...
async def rename_session(self, session_id: uuid.UUID, user_id: uuid.UUID, title: str) -> None: ...
async def list_scheduled_messages(self, session_id: uuid.UUID, user_id: uuid.UUID) -> list[AgentSessionScheduledMessage]: ...
async def create_scheduled_message(self, session_id: uuid.UUID, user_id: uuid.UUID, data: ScheduledMessageCreateRequest) -> AgentSessionScheduledMessage: ...
async def cancel_scheduled_message(self, session_id: uuid.UUID, message_id: uuid.UUID, user_id: uuid.UUID) -> None: ...

# backend/app/modules/daemon/scheduled_send.py（签名）
async def scheduled_send_sweep_once(db_session: AsyncSession) -> int: ...  # 返回本轮派发/收敛条数
async def scheduled_send_sweeper(interval: float = SCHEDULED_SEND_SWEEP_INTERVAL_SEC) -> None: ...
```

前端类型（api-types 生成）：`AgentSessionRead` 增 `pinned_at: string | null`；`ScheduledMessageRead` / `ScheduledMessageCreateRequest` 同上（camel/snake 由后端 snake_case 序列化，gen:types 如实生成）。

**测试清单**（backend，pytest 新增文件）：
- `test_session_pin_rename.py`：pin/unpin 幂等 + 404 归属 + 排序（置顶行在组内最前）+ rename 校验（空/超长 422）+ SSE publish 断言。
- `test_scheduled_messages_crud.py`：创建校验（过去时间 422 / 非归属 404 / 终态会话 409）、列表序、取消（非 pending 409）。
- `test_scheduled_send_sweeper.py`：`sweep_once` 四分支（空闲→dispatched；忙轮→queued 后 dispatched；终态→failed session_inactive；忙轮且队列满 5→failed queue_full，Grill B-02/R-07）+ 单条失败不连坐 + 幂等（dispatched 不重发）。

前端测试：`session-list-panel` 既有 `__tests__/` 补置顶/重命名用例；新增 `scheduled-messages-bar.test.tsx` 与 `use-scheduled-messages` 用例。

## 生命周期契约表

本变更新增的生命周期事件（既有 inject/queue 事件不变，此处只列新增契约）：

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| create scheduled message | frontend | backend | session_id, prompt, dispatch_at, sender_user_id | scheduled 行 created（status=pending） |
| cancel scheduled message | frontend | backend | session_id, message_id | pending → cancelled（写 cancelled_at） |
| dispatch due message | backend sweeper | backend inject 管线 | session_id, prompt, attachment_ids, agent_profile_id, llm_provider_id, queue_sender_user_id | pending → dispatched（inject 成功；忙轮时消息另落 queued_messages pending） |
| skip inactive session | backend sweeper | —（仅落库） | session_id, error_code=session_inactive | pending → failed |
| sessions changed (pin/unpin/rename) | backend | frontend SSE | event=status_changed, session_id, user_id | pinned_at/title 列变更 → 列表刷新 |

对应任务覆盖：CRUD 端点任务覆盖事件 1/2；sweeper 任务覆盖事件 3/4；SSE publish 断言测试覆盖事件 5。`ScheduledMessageCreateRequest`/`ScheduledMessageRead` 字段与上表必需字段一一对应。既有生命周期（claim/heartbeat/turn result 等）零改动。

## 数据模型

```python
class AgentSessionScheduledMessage(BaseModel, table=True):
    __tablename__ = "agent_session_scheduled_messages"
    __table_args__ = (
        Index("ix_agent_ssm_session_status_dispatch", "agent_session_id", "status", "dispatch_at"),
    )
    id: uuid.UUID                      # PK
    agent_session_id: uuid.UUID        # FK agent_sessions.id ON DELETE CASCADE
    sender_user_id: uuid.UUID          # FK users.id ON DELETE CASCADE（创建者）
    prompt: str                        # Text，非空
    attachment_ids: list | None        # JSON，str 列表快照
    agent_profile_id: str | None       # String(64)
    llm_provider_id: str | None        # String(64)
    dispatch_at: datetime              # tz-aware，计划派发时间
    status: str = "pending"            # pending / dispatched / cancelled / failed（String(16)）
    error_code: str | None             # String(64)，failed 时归类（session_inactive / inject_failed）
    error_message: str | None          # Text，失败详情
    created_at / dispatched_at / cancelled_at: datetime | None  # tz-aware 审计时间线
```

`agent_sessions` 增列：`pinned_at DateTime(timezone=True) NULL` + 独立索引 `ix_agent_sessions_pinned_at`。

会话删除（软删 `deleted_at`）不级联定时条目（FK CASCADE 只在硬删时生效）；到点 sweep 复核 `deleted_at`/终态置 failed，即「软删会话的余留定时条目自动收敛」，不需要删除钩子。

## 兼容策略（brownfield 必填）

- 未置顶/未重命名/无定时消息时：`pinned_at` 恒 NULL、排序退化为既有 `coalesce(last_active_at, created_at) DESC`（`pinned_at IS NULL` 全真不影响序）；新表无行、sweeper 每轮空扫（一次索引查询零命中即返回）；行为与现状完全一致。
- 旧客户端（未升级前端）忽略 `pinned_at` 字段即可，端点新增不改既有路径。
- sweeper 依赖注入 `get_session_factory()`，与既有 sweeper 同款；backend 重启后 pending 条目仍在库中，重启后 ≤30s 内补发（dispatch_at 已过的条目立即捞走）。
- 不改变的 API/表：既有 sessions 列表参数、archive/delete/inject/queue 全链路零改动。

## 风险登记

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | sweeper 与用户操作竞态（取消瞬间被 sweep 派发） | P1 | sweep 派发前在行锁内复核 status=pending（条目行 `with_for_update`），取消同样行锁内翻转——串行化收敛，后到者幂等跳过 |
| R-02 | inject_session_as_service 内部 commit 与 sweeper 的 DB session 边界 | P1 | 每条目独立短 session（对齐 dispatch_next_queued_message 的独立 session 工厂模式），条目状态翻转与 inject 分两个事务：先 inject 成功再单独事务写 dispatched——inject 后崩溃最多重复发送一次（at-least-once），可接受并记入注释 |
| R-03 | 排序改动影响既有列表测试（快照断言顺序） | P2 | 排序键为前置谓词（pinned 优先），未置顶数据序不变；跑既有 daemon 模块测试回归确认 |
| R-04 | 定时消息到点时会话属主权限变化（如工作区归档） | P2 | inject 链路既有 `_ensure_session_workspace_writable` 守卫直接生效（409 → failed 落库），无需新增逻辑 |
| R-05 | 前端 node_modules 半坏导致 gen:types 假报错 | P2 | 按已知坑先 `pnpm exec tsc --version` 验康，坏则 `pnpm install --force` |
| R-06 | 用户未确认的设计决策（方案 B/一次性/分组内置顶均自主模式代答） | P1 | decisions.md D-001/D-002 已标注 source: ai 可否决；用户可 `--reopen` 修订或验收时提出返工 |
| R-07 | 定时到点时会话忙且既有队列已满（SESSION_QUEUE_MAX_PENDING=5）→ inject 抛 DaemonSessionQueueFull | P2 | sweeper 捕获该 AppError → 条目置 failed、error_code=`queue_full`（不盲发不丢弃，用户可看失败原因后重建）；测试清单第四分支覆盖。不选「满员自动延后重试」——重试风暴与「用户以为已排队」的语义欺骗更差（Grill B-02 定案） |

## 决策追踪

| 决策 | 覆盖点 | 状态 |
|---|---|---|
| D-001@v1（方案 B：独立定时表 + sweeper） | §总体方案 Wave 2、§数据模型、§生命周期契约表；FR-04（定时 CRUD）、FR-05（到点派发） | 已覆盖 |
| D-002@v1（一次性定时 + 分组内置顶） | §非目标、§总体方案 Wave 1 排序语义（Grill B-01 修订：多置顶按最近活跃排，对齐本决策）；FR-01（分组内置顶）、FR-04（仅一次性） | 已覆盖 |
| D-003@v1（队列满员→failed queue_full） | §风险登记 R-07、§接口定义测试清单第四分支；FR-05 | 已覆盖 |

## 自审

- [x] 章节齐全（背景/设计目标/非目标/总体方案/文件变更清单/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审）
- [x] frontmatter 字段齐全（author/created_at/scale=large）
- [x] 引用所有当前版本 D-xxx@vN（D-001@v1、D-002@v1 均入决策追踪表）
- [x] 涉及生命周期关键词（session/state transition）→ 已含「生命周期契约表」
- [x] UI 原型已生成（prototype-session-pin-rename-scheduled-send.html，双主题）
- [x] ⚠️ 自审存疑点：R-02 的 at-least-once 语义（inject 后崩溃极端场景可能重复发送）已显式记录为可接受权衡，验收时可复议
