---
author: qinyi
created_at: 2026-08-29 14:36:40
scale: large
risk_level: integration-critical
---

# 设计文档（Design）— 审批流站内通知推送

> 变更名：`2026-08-29-approval-notify-push`
> 参考：multica `server/internal/integrations`（dingtalk/wecom/channel）的「收件箱为事实源、IM 推送为叠加层」分层模式（调研结论已并入本文）。
> UI 原型：`prototype-notification-bell.html`（三主题 + 模拟 SSE 推送交互）。

## 1. 背景

SillyHub 目前**没有任何站内通知基础设施**：无通知表、无铃铛、无通知中心。审批待办的感知完全依赖前端 React Query 轮询（变更审批 30s、权限审批 10s 兜底）+ 用户主动打开页面：

- **change 四审核门**（proposal_review / plan_review / human_test / archive_confirm）：agent 经 SillySpec CLI 跑完阶段回传进度后，待办（`pending_review` 投影从无到有）产生时**零事件发布**，审批人无法及时得知有待审内容；
- **daemon 会话权限审批**：`permission_request` 只发到 per-session Redis 频道，用户没开着审批页就收不到；5 分钟超时静默失效；
- 审批结果（通过/驳回）对 change 发起人（owner）也仅在其主动查看时可见。

用户要求：参考 multica 的钉钉/企微集成**设计 IM 推送方案，本次先落地站内通知，且不采用轮询形式**（SSE 实时推送）。

### 1.1 multica 参考结论（调研摘要）

multica 的集成分层：`channel/` 统一抽象（Channel 接口 + Registry 工厂 + Capability 位掩码）→ 各平台适配器（dingtalk REST `sampleMarkdown`；wecom aibot WebSocket markdown 卡片）→ **事件总线订阅者**（`EventInboxNew` → wecom 私推 markdown 卡片 `**[类型标签] 标题** + [查看详情](deep-link)`）。关键模式：**站内收件箱表（inbox_item）是通知事实源，IM 推送只是叠加层（overlay）**——任何一步 miss 即静默放弃，用户仍有站内收件箱兜底。本设计沿用该分层：本次实现「站内通道」（落库 + SSE 实时），未来钉钉/企微 = 通知服务内新增投递通道，审批触发点零改动。

### 1.2 本项目现状要点（代码依据）

- 唯一实时底座 = Redis Pub/Sub + SSE；**唯一按用户定向推送先例**：`GET /api/daemon/sessions/events`（端点 `backend/app/modules/daemon/router.py:2437`，生成器 `_stream_sessions_events`:2867——全局频道 `agent_sessions:changed` + payload 带 user_id + SSE 生成器服务端过滤 + keepalive + 短 session 防连接池占用）。
- Redis 发布助手先例：`backend/app/modules/daemon/session_events.py` `publish_sessions_changed`（best-effort，user_id 为 None 直接跳过，失败仅 log.warning）。
- 待办判定的**两条数据通道**（Grill X-06 裁定区分）：`StageProjectionService.compute_pending_review`（`change/projection.py:130`）读服务器 sillyspec.db 镜像文件（展示用，与进度推送不同步有时滞）；**权威源 = PG `platform_change_progress.latest_progress`**——既有先例 `change/service.py` `_resolve_pending_change_keys`(:1882)/`_project_current_stage`(:1915) 从 latest_progress 提取 `(current_stage, completed)` 经 `StageProjectionService._map`（单值返回：同一时刻至多一门 pending）判定待办。进度落库入口 `backend/app/modules/platform_sync/service.py:167` `upsert_progress`（→ `_apply`，并发双发自愈见其 docstring）。
- 审批动作汇聚点：`backend/app/modules/change/service.py` 四门方法（proposal_review:2498 / plan_review:2579 / human_test:2683 / archive_confirm:3030）+ 旧版 approve:687 / reject:702；`_maybe_notify_session`:2396 已有「审批后向绑定会话注入消息」best-effort 降级先例。
- daemon 权限审批 owner-only：`backend/app/modules/daemon/permission_service.py`（`_get_owned_session_for_update` / respond 鉴权同源 `session/service.py:825-852` 按 **`AgentSession.user_id`**；runtime owner ≠ session creator 是明文支持场景 `session/service.py:861-864`，故通知口径必须取会话 owner 而非 runtime owner——Grill X-10 裁定）；`handle_permission_request`:292（发布点 :420，HTTP 通道 :552 委托 WS 方法=单点覆盖双通道）、`respond_permission`:858、`_on_timeout`:1145。
- RBAC：`backend/app/modules/auth/rbac.py` `has_permission` 三段解析（`is_platform_admin` → 平台级 `user_roles` → 工作区 `user_workspace_roles`，含 PLATFORM_ADMIN 角色放行 :125/:130）；表 `roles` / `role_permissions` / `user_workspace_roles`（`auth/model.py`）。
- change 发起人：`changes.owner_id`（`change/model.py:156`，可能为 None）。
- 前端：React Query 5 + zustand；`frontend/src/lib/fetch-sse.ts`（fetch+ReadableStream，Authorization header，无自动重连由调用方自建）；SSE 退避重连先例 `frontend/src/components/permissions/session-permission-panel.tsx`（PERMANENT_SSE_ERROR_STATUSES={401,403,404} 与 scheduleReconnect 内联 :81/:246-257，ql-20260829-005；重连成功补拉先例 fireConnectedOnce :222-244）；顶栏实际组件 `frontend/src/components/top-bar.tsx`（头像 :155-159；`app-shell.tsx`:50/:427 仅渲染 `<TopBar>`）。

## 2. 设计目标

1. **实时**：审批待办产生/审批结果/权限审批请求/超时四类事件，经 Redis→SSE 秒级推到接收人浏览器（铃铛未读数即时增长），**无 refetchInterval 轮询**。
2. **可追溯**：通知落库（历史、未读数、已读状态），首载/断线重连/聚焦兜底均从库读。
3. **可演进**：通知服务内通道抽象，未来钉钉/企微 IM 推送 = 新增 Channel 实现，三处审批触发点零改动。
4. **不侵入**：通知全链路 best-effort，任何失败不阻塞审批主流程；只增不改现有 API。

## 3. 非目标（Non-Goals）

- **不做**钉钉/企微 IM 实际推送（本次仅预留通道抽象；IM 接入为后续独立变更）。
- **不做** release 审批投票通知（架构可容纳，未来加触发点即可，D-001@v1）。
- **不做**独立通知中心页（本次仅铃铛+下拉面板，D-005@v1）。
- **不做**通知偏好设置/静音/频道订阅管理（multica 有 isNotifMuted，本项目后续需要时再加）。
- **不做**存量待办回溯补发（上线时已存在的 pending_review 不补通知，见 §10 兼容策略）。
- **不做** WebSocket 通道（项目浏览器端不用 WS，遵循现有惯例）。
- 不改造现有 sessions/events、per-session SSE、审批轮询兜底逻辑（既有行为不变）。

## 4. 拆分判断

单变更完成（不做批量拆分）：三处触发点 + 一个新模块 + 前端铃铛是一个紧耦合闭环——通知表结构、事件 payload、前端消费三端契约需一体设计；拆开会导致中间态契约漂移。规模评估：**large**（新增 1 个后端模块 + 1 张表 + 4 个 REST 端点 + 1 个 SSE 端点 + 触达 4 个既有后端模块 + 前端新组件与数据层）。

## 5. 总体方案

```
┌─ 触发点（旁路钩子，不阻塞主流程） ─────────────────────────────────┐
│ ① platform_sync.upsert_progress 后：in-hand latest_progress 判 pending 无→有 │
│    └→ notify_broadcast(workspace, CHANGE_CREATE 用户, approval_pending) │
│ ② change 四门 + approve/reject 后：                                  │
│    └→ resolve_pending(同 ref 待办标已读) + notify_user(owner, approval_result) │
│ ③ daemon permission_service：handle_permission_request / _on_timeout │
│    └→ notify_user(会话 owner=AgentSession.user_id, permission_request/timeout) │
└──────────────┬──────────────────────────────────────────────────────┘
               ▼
   NotificationService（app/modules/notification/service.py）
     ├─ 落库：notifications 表（按接收人展开行，独立事务）
     └─ 投递：NotificationChannel 通道列表
              └─ InAppChannel（本次唯一通道）
                   └─ Redis publish 全局频道 notifications:new
                        payload={recipient_user_ids[], notification{...}}
               ▼
   GET /api/notifications/events（SSE，照抄 sessions/events 模式）
     服务端按「当前用户 ∈ recipient_user_ids」过滤下发 + keepalive
               ▼
   前端 fetch-sse 订阅 → invalidate 通知查询（列表/未读数）
   铃铛徽标即时增长；断线退避重连；401/403/404 停连（对齐 ql-20260829-005）
```

分六个部分：

**P1 数据模型与迁移**：`notifications` 表 + Alembic 迁移（§8）。
**P2 通知服务与通道抽象**：`NotificationService` 两个入口（广播/定向）+ `NotificationChannel` Protocol + `InAppChannel`；广播收件人经新增 RBAC 反查 `list_user_ids_with_permission`（镜像 `has_permission` 三段语义）；落库独立事务（触发点自身事务已提交后调用），Redis publish 在落库成功后 best-effort（§7）。
**P3 触发点接线**：三处钩子的精确落点与幂等/消解语义（§7.3、§9）。
**P4 SSE 端点与 REST**：5 个端点（§7.2）；schema 变更后 `pnpm gen:types` 同步前端类型。
**P5 前端铃铛+下拉面板**：`app-shell.tsx` 挂铃铛；`lib/notifications.ts` 数据层三件套；SSE hook 事件驱动 invalidate（§7.4）。
**P6 测试**：模块测试 + 三触发点回归（§11 测试策略见 tasks）。

## 6. 文件变更清单

| 操作 | 文件路径 | 说明 |
|---|---|---|
| 新增 | backend/app/modules/notification/__init__.py | 新模块包 |
| 新增 | backend/app/modules/notification/model.py | `Notification` 表模型（§8） |
| 新增 | backend/app/modules/notification/schema.py | `NotificationRead` / `NotificationListResponse` / `UnreadCountResponse` / `ReadResultResponse` DTO。数据流：producer=service.py 查询结果 → router 序列化 → openapi.json（gen:types）→ frontend/src/lib/api-types.ts → consumer=lib/notifications.ts |
| 新增 | backend/app/modules/notification/service.py | `NotificationService` + `NotificationChannel` Protocol + `InAppChannel`（§7.1） |
| 新增 | backend/app/modules/notification/events.py | `NOTIFICATIONS_CHANNEL="notifications:new"` + `publish_notifications_new(payload)`（best-effort，镜像 `daemon/session_events.py`）。数据流：producer=InAppChannel → Redis → consumer=router.py SSE 生成器 |
| 新增 | backend/app/modules/notification/router.py | 5 端点（§7.2），`main.py` 注册 |
| 新增 | backend/app/modules/notification/tests/__init__.py | 测试包 |
| 新增 | backend/app/modules/notification/tests/test_service.py | 扇出/幂等/消解/通道降级/未读数用例 |
| 新增 | backend/app/modules/notification/tests/test_router.py | 列表/已读/全部已读/未读数/SSE 过滤与 keepalive 用例 |
| 新增 | backend/migrations/versions/2026<时间戳>_add_notifications_table.py | 建表迁移（down_revision 接唯一 head，多 head 先 merge） |
| 修改 | backend/migrations/env.py | 新模块模型登记（env.py:28-29 "Add new modules here" 显式清单惯例；**漏登记 = autogenerate 不生成该表**，Grill X-16 裁定，S-03 关闭） |
| 修改 | backend/app/modules/auth/rbac.py | 新增 `list_user_ids_with_permission(session, *, workspace_id, permission)`：工作区 grant ∪ 平台级 grant ∪ `is_platform_admin` 用户（镜像 `has_permission` 三段解析，D-002@v1；过滤仅活跃用户——users 状态/删除列）。数据流：producer=Role/RolePermission/UserWorkspaceRole/UserRole/users 表 → 该函数 → consumer=NotificationService.notify_broadcast |
| 修改 | backend/app/modules/platform_sync/service.py | `upsert_progress` 落库成功后新增旁路钩子：计算 `pending_review` 投影，无→有且无未消解同门通知时广播（D-006@v1、D-009@v1）。数据流：producer=latest_progress 投影 → NotificationService → consumer=有 CHANGE_CREATE 权限用户的 SSE |
| 修改 | backend/app/modules/change/service.py | 四门方法 + approve/reject 末尾（`_maybe_notify_session` 同层）：`resolve_pending` 消解同 ref 待办 + 结果通知 owner（owner 为 None 跳过，镜像 `publish_sessions_changed` 的 None-skip；D-007@v1）。数据流：producer=审批动作 → NotificationService → consumer=owner SSE |
| 修改 | backend/app/modules/daemon/permission_service.py | `handle_permission_request`（含 canUseTool 与 AskUserQuestion dialog 两种 kind）成功发布后 → 定向通知会话 owner；`_on_timeout` → `permission_timeout` 通知 owner；`respond_permission` / `_respond_dialog` 不通知（owner 自操作，D-008@v1）。数据流：producer=权限请求/超时 → NotificationService → consumer=owner SSE |
| 修改 | backend/app/main.py | `include_router(notification_router, prefix="/api")` |
| 新增 | frontend/src/lib/notifications.ts | list/unread-count/read/read-all fetch 函数 + useQuery hooks + SSE 订阅 hook（事件→`queryClient.invalidateQueries`）。数据流：consumer=api-types.ts 生成类型 + fetch-sse.ts + query-keys.ts |
| 修改 | frontend/src/lib/query-keys.ts | 新增 notifications key 工厂（list/unreadCount） |
| 新增 | frontend/src/components/notifications/notification-bell.tsx | 铃铛+徽标+antd Popover 下拉面板（最近 20 条、点击已读+跳转、全部已读、空态、相对时间 zh-CN），样式走 brand-* 语义阶/主题 token |
| 修改 | frontend/src/components/top-bar.tsx | 顶栏挂载 `<NotificationBell />`（头像区 :155-159 旁；Grill X-17 裁定——真实顶栏组件是本文件，`app-shell.tsx`:50/:427 仅渲染 `<TopBar>`；TopBar 无 token prop，SSE hook 自取 useSession token） |
| 新增 | frontend/src/components/notifications/__tests__/notification-bell.test.tsx | 铃铛/面板/已读/SSE 事件驱动刷新用例 |
| 修改 | backend/openapi.json + frontend/src/lib/api-types.ts | `pnpm gen:types` 产物（禁止手写，CLAUDE.md 规则 21） |

> models 注册说明（Grill X-16 裁定，S-03 关闭）：alembic autogenerate 依赖 `backend/migrations/env.py` 的显式模型登记清单（:28-29 注释 "Add new modules here"），新增 notification model 必须在该清单加一行，否则迁移不生成该表（env.py 头注释有漏登记事故记载）。

## 7. 接口定义

### 7.1 后端核心签名（notification/service.py）

```python
NotificationType = Literal[
    "approval_pending",    # change 审核门待办产生（广播）
    "approval_result",     # change 审批动作结果（定向 owner）
    "permission_request",  # daemon 权限/对话审批请求（定向 owner）
    "permission_timeout",  # daemon 权限请求超时失效（定向 owner）
]

class NotificationChannel(Protocol):
    """投递通道抽象：落库后的旁路投递，全部 best-effort。"""
    async def deliver(self, rows: list[Notification]) -> None: ...

class InAppChannel:
    """站内通道：Redis publish 全局频道 notifications:new。"""
    async def deliver(self, rows: list[Notification]) -> None:
        # payload = {"recipient_user_ids": [...], "notification": {id,type,title,body,link,created_at}}
        # 广播多行同事件合并为一次 publish（recipient 并集）；失败 log.warning 不抛

class NotificationService:
    def __init__(self, session: AsyncSession, channels: list[NotificationChannel] | None = None) -> None:
        # channels 默认 [InAppChannel()]；未来 IM 通道 append 进列表即可（D-003@v2）

    async def notify_broadcast(
        self, *, workspace_id: uuid.UUID, permission: Permission, type: NotificationType,
        title: str, body: str | None, link: str | None,
        ref_type: str, ref_id: str, dedupe_key: str,
    ) -> int:
        """广播给工作区内持有 permission 的全员（list_user_ids_with_permission）。
        幂等（D-009@v2，service 为唯一检查方）：已存在「同 (ref_type, ref_id, type) 且
        read_at IS NULL」的行 → 跳过返回 0；dedupe_key 仅作审计/追溯列（不参与检查、
        无独立索引）。落库（独立事务，方法内 commit）成功后才走 channels 投递；
        收件人集为空返回 0。"""

    async def notify_user(
        self, *, workspace_id: uuid.UUID, recipient_user_id: uuid.UUID, type: NotificationType,
        title: str, body: str | None, link: str | None,
        ref_type: str | None = None, ref_id: str | None = None, dedupe_key: str | None = None,
    ) -> bool:
        """定向单用户；recipient 为 None 时调用方跳过（owner 缺失场景）。"""

    async def list_for_user(self, *, user_id: uuid.UUID, limit: int = 20, offset: int = 0,
                            unread_only: bool = False) -> tuple[list[Notification], int]: ...
    async def unread_count(self, *, user_id: uuid.UUID) -> int: ...
    async def mark_read(self, *, user_id: uuid.UUID, notification_id: uuid.UUID) -> Notification:
        # 非本人或不存在 → raise NotificationNotFound(AppError 子类，中文文案)
    async def mark_all_read(self, *, user_id: uuid.UUID) -> int: ...
    async def resolve_pending(self, *, ref_type: str, ref_id: str,
                              types: tuple[str, ...] = ("approval_pending",)) -> int:
        """待办消解（D-007@v1）：同 ref 的未读待办通知批量置 read_at=now，返回行数。"""
```

```python
# auth/rbac.py 新增（广播收件人反查，语义镜像 has_permission 三段解析）
async def list_user_ids_with_permission(
    session: AsyncSession, *, workspace_id: uuid.UUID, permission: Permission
) -> list[uuid.UUID]:
    """工作区 user_workspace_roles grant ∪ 平台级 user_roles grant（含 PLATFORM_ADMIN）∪ is_platform_admin 用户。
    仅返回活跃用户（过滤禁用/已删除账户——Grill X-04 建议）。"""
```

```python
# notification/events.py（镜像 daemon/session_events.py 的 best-effort 语义）
NOTIFICATIONS_CHANNEL = "notifications:new"
async def publish_notifications_new(payload: dict) -> None: ...  # 异常仅 log.warning
```

### 7.2 REST + SSE 端点（notification/router.py）

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/api/notifications` | `?limit=20&offset=0&unread_only=false` → `{items: NotificationRead[], total}`（仅本人，按 created_at DESC） |
| GET | `/api/notifications/unread-count` | → `{count}` |
| POST | `/api/notifications/{id}/read` | 单条已读 → `NotificationRead`；越权/不存在 404 |
| POST | `/api/notifications/read-all` | → `{updated}` |
| GET | `/api/notifications/events` | SSE。**完整照抄 `daemon/router.py:2867` `_stream_sessions_events` 模式**：端点级鉴权（短 session，当前用户），生成器不注入请求级 DB session；订阅 `notifications:new`，payload.recipient_user_ids 含当前用户才下发 `event: notification\ndata:{...}`；keepalive 心跳防饥饿；finally 清理 pubsub。无 Last-Event-ID 回放（对齐现有 SSE 端点；漏发由前端重连后列表查询兜底） |

### 7.3 触发点接线（精确落点）

**① change 待办产生**（`platform_sync/service.py::upsert_progress` 尾部旁路）：
- **数据源（D-011@v1，Grill X-06 裁定）**：用 **in-hand `latest_progress`（本次刚提交的 body）** 判定 pending——复用 `_project_current_stage`/`_extract_current_stage`/`_extract_completed_stages` + `StageProjectionService._map` 的既有先例（`change/service.py:1882-1943`，权威源 = PG `platform_change_progress`）。**不重读 `compute_pending_review`**（其读 sillyspec.db 镜像文件，与进度推送是两条通道、时点可能滞后 → 会漏发/迟发）。`_map` 单值返回：**同一时刻至多一门 pending**（Grill X-07），无需多门循环。
- 判定 pending 非空时：`notify_broadcast(permission=CHANGE_CREATE, type=approval_pending, ref_type="change", ref_id=str(change_id), dedupe_key=f"{change_id}:{review_kind}")`——幂等检查由 **service 内统一执行**（未消解存在性检查，D-009@v2），触发点不做检查；title 如 `变更「{change_name}」等待{门中文名}审核`，body 摘要阶段信息，link 指向变更页（深链格式 execute 时对照前端路由定，自审存疑 S-02）。
- 钩子整体 try/except 包裹：判定或通知任何异常仅 log.warning，不影响 progress 落库结果（best-effort，D-006@v1）。
- 回退重跑再触发：驳回/回退动作会 `resolve_pending` 置已读 → 同门待办再次产生时未消解检查不命中 → 正常再通知（无需轮次记账）。

**② change 审批动作**（`change/service.py` 四门 + approve/reject 末尾，`_maybe_notify_session` 同层同风格）：
- 动作成功提交后：先 `resolve_pending(ref_type="change", ref_id=str(change_id))` 消解待办；再 `notify_user(owner_id, type=approval_result)`——通过/驳回/回退三种结果都通知（title 区分，body 带审批人与驳回原因等上下文）；`owner_id` 为 None 跳过。

**③ daemon 权限审批**（`daemon/permission_service.py`）：
- `handle_permission_request` 在既有 `_publish_session_event`（:420）成功后：取会话 owner——**`AgentSession.user_id`（D-010@v1，Grill X-10 裁定关闭 S-01）**：respond 鉴权同源按 `AgentSession.user_id`（`session/service.py:825-852`），且 runtime owner ≠ session creator 是明文支持场景（`:861-864`），若按 runtime 口径会通知到无权响应的人 → `notify_user(owner, type=permission_request, ref_type="session_dialog"或"session_permission", ref_id=session_id)`；canUseTool 与 AskUserQuestion dialog 两种 kind 都覆盖（title/body 区分）。HTTP 上行通道（:552）委托 WS 方法，单点挂钩即覆盖双通道。
- `_on_timeout`（:1145）：超时失效时 `notify_user(owner, type=permission_timeout)`——该回调只收请求 id，需重查会话取 owner（新开短 session，不依赖调用方事务）。
- `respond_permission` / `_respond_dialog`：**不通知**（owner 自操作，D-008@v1）。

### 7.4 前端

- `lib/notifications.ts`：四个 REST fetch 函数 + `useNotifications`（首载 20 条，`refetchOnWindowFocus: true`，**无 refetchInterval**）+ `useUnreadCount` + `useNotificationsStream`（`fetch-sse` 订阅 `/api/notifications/events`，token 自取 useSession；`notification` 事件 → `invalidateQueries` notifications 全部 key；**重连成功（连接建立）后再 invalidate 一次**补拉断线期间漏发——对齐 `session-permission-panel.tsx:222-244` fireConnectedOnce 先例；退避重连与 `PERMANENT_SSE_ERROR_STATUSES={401,403,404}` 停连照 `session-permission-panel.tsx:81/:246-257` 内联先例实现，对齐 ql-20260829-005）。
- `components/notifications/notification-bell.tsx`：铃铛 + 未读徽标（>99 显示 99+）+ antd Popover 下拉面板；条目 = 类型标签（色块图标：待办橙/通过绿/驳回红/权限蓝/超时灰）+ 标题 + 摘要 + 相对时间；点击 = `markRead` + `router.push(link)`；「全部已读」；空态文案。样式：`brand-*` 语义阶 + 主题 token（三主题适配），对照 `FRONTEND_PAGE_STYLE.md` §0.5 与原型。
- `top-bar.tsx` 顶栏用户头像区挂载（Grill X-17：真实顶栏组件；`app-shell.tsx` 仅渲染 `<TopBar>`）。

## 8. 数据模型

```python
class Notification(BaseModel, table=True):   # backend/app/modules/notification/model.py
    __tablename__ = "notifications"
    id: uuid.UUID                       # PK, default_factory=uuid4
    workspace_id: uuid.UUID             # FK workspaces.id ON DELETE CASCADE
    recipient_user_id: uuid.UUID        # FK users.id ON DELETE CASCADE（按接收人展开，D-004@v1）
    type: str(40)                       # §7.1 四类
    title: str(200)
    body: str(500) | None
    link: str(300) | None               # 前端相对路由跳转路径
    ref_type: str(30) | None            # "change" | "session_permission" | "session_dialog"
    ref_id: str(64) | None              # change_id / session_id（str 存储统一类型）
    dedupe_key: str(120) | None         # 幂等/审计键（如 "{change_id}:{review_kind}"）
    read_at: datetime | None            # NULL=未读
    created_at: datetime                # default now(UTC)
    __table_args__ = (
        Index("ix_notifications_recipient_read_created", "recipient_user_id", "read_at", "created_at"),
        Index("ix_notifications_ref", "ref_type", "ref_id", "type"),   # 幂等存在性检查 + resolve_pending
        Index("ix_notifications_workspace", "workspace_id", "created_at"),
    )
```

- JSON 列不涉及；时间列 `DateTime(timezone=True)` 对齐项目惯例。
- **不设全局唯一约束**：幂等靠 service 内「未消解存在性检查」（§7.1，D-009@v2），因为驳回重跑后的同门再待办需要允许再次通知，唯一索引会误拦。`dedupe_key` 仅审计/追溯列，**不设独立索引**（幂等检查走 `ix_notifications_ref`，与初稿「唯一索引幂等」的修订记录见 D-009）。
- Alembic 迁移：新建表 + 三个索引；down_revision 接当前唯一 head（若多 head 先建 merge revision，已有 `merge_parallel_*` 先例）；**模型必须在 `migrations/env.py` 登记清单加行**（§6，Grill X-16）。

## 9. 生命周期契约表

（本变更**不改动** daemon 会话/lease/agent_run 既有生命周期契约——`claim/heartbeat/lease` 等事件不在本变更触达范围，仅在 `permission_service` 既有事件点旁路挂通知钩子。以下为**通知自身**的生命周期契约：）

| 事件 | 发起方 | 接收方 | 必需字段 | 状态变化 |
|---|---|---|---|---|
| 通知产生（四类） | 触发点①②③（platform_sync / change / permission_service） | NotificationService → InAppChannel → Redis `notifications:new` | workspace_id, recipient_user_ids, type, title, body, link, ref_type, ref_id, dedupe_key(广播必填，审计用) | 无行 → 未读（read_at IS NULL），独立事务提交 |
| 实时下发 | SSE `/api/notifications/events` 生成器 | 前端 useNotificationsStream（铃铛） | id, type, title, body, link, created_at + 服务端按当前用户过滤 | 状态不变（前端 invalidate 刷新列表/未读数） |
| 单条已读 | 前端面板点击 | `POST /api/notifications/{id}/read` | id + 当前用户（越权 404） | 未读 → 已读（read_at=now） |
| 全部已读 | 前端「全部已读」 | `POST /api/notifications/read-all` | 当前用户 | 该用户全部未读 → 已读 |
| 待办消解 | 审批动作②（四门/approve/reject） | NotificationService.resolve_pending | ref_type, ref_id, types | 同 ref 未读待办 → 已读（随后发 approval_result） |
| 权限请求超时 | permission_service `_on_timeout`（重查会话取 owner=`AgentSession.user_id`） | 会话 owner（`permission_timeout` 通知） | session_id, request_id, kind | 对应请求失效；新发超时通知（不消解历史 permission_request 通知——v1 取舍，见 R-09） |

表内事件 → 代码任务/测试任务的映射见 `tasks.md`（plan 阶段细化到 TaskCard）。

## 10. 兼容策略

- **纯增量**：新模块 + 新表 + 新端点；现有 API/表结构零改动。未产生审批事件时铃铛为空态，行为与现状一致。
- **存量待办不回溯**：上线时已存在的 `pending_review` 不补发通知；从上线后首个新事件起生效（未消解存在性检查天然兼容：存量待办在下次 progress 推送时才会被评估，此时发通知是期望行为）。
- **降级链**：Redis 不可用 → publish 失败仅 warning，落库不受影响，实时性降级为「下次打开页面/窗口聚焦首载」可见；DB 落库失败 → 仅 warning，审批主流程不受影响（best-effort，D-006@v1）。
- **事务边界**：`NotificationService` 方法内独立 commit（触发点自身事务已提交后调用），通知失败不回滚审批/进度。
- **不改变的现有行为**：sessions/events、per-session SSE、审批页 10s/30s 轮询兜底、`_maybe_notify_session` 会话注入全部保持原样。

## 11. 风险登记（Risk Register）

| 编号 | 风险 | 等级 | 应对策略 |
|---|---|---|---|
| R-01 | SSE 长连接占用连接池 | P2 | 严格照抄 sessions/events 短 session 模式（生成器内不自建长期 DB session，仅 Redis pubsub + keepalive） |
| R-02 | CLI 并发双发 progress（`_apply` docstring 场景）在存在性检查窗口内双写 → 重复广播 | P2 | 幂等检查统一在 service 内（D-009@v2），检查与插入同事务串行化窗口收窄；窗口极小且后果无害（重复通知一条）；接受残余风险 |
| R-03 | 广播扇出放大行数（工作区用户多；平台管理员也会收到非成员工作区待办——与「可审批人」口径一致） | P2 | 团队规模（<100）可接受，multica 同款模式；list_user_ids_with_permission 过滤非活跃账户（Grill X-04）；>500 用户时再评估（Non-Goal） |
| R-04 | 触发点遗漏或错发（三处落点判断错误） | P1 | 每处触发点单独测试锚定；Design Grill 交叉审查触发点清单与 owner 口径（S-01） |
| R-05 | Redis 抖动导致实时性降级 | P2 | best-effort publish + 前端退避重连 + 聚焦兜底（§10） |
| R-06 | SSE 鉴权漏洞（越权收到他人通知） | P1 | 服务端过滤以「当前用户 ∈ recipient_user_ids」为准（不信任前端）；端点级鉴权先于流启动；测试覆盖跨用户隔离用例 |
| R-07 | 通知文案漂移/非中文 | P2 | 文案常量集中在 service（对齐 multica `inboxTypeLabels` 模式）；后端 L10n 中文守护测试惯例覆盖 |
| R-08 | 前端类型漂移 | P2 | schema 改动同变更内跑 `pnpm gen:types` 并提交 openapi.json + api-types.ts（CLAUDE.md 规则 21） |
| R-09 | 权限请求超时不消解历史 permission_request 通知 → 铃铛残留已失效待办条目（ref_id 粒度=session_id，无 request_id 无法精确消解，Grill X-13） | P2 | v1 取舍接受（超时通知本身已告知失效）；后续精确消解需 ref_id 细化到 request_id，留待通知中心页需求时一并处理 |

## 12. 决策追踪（Decisions）

> 台账全文见 `decisions.md`。当前版本决策与设计章节映射：

| 决策 | 内容 | 覆盖章节 |
|---|---|---|
| D-001@v1 | 通知范围 = change 四门 + daemon 权限审批；release 投票不做（架构预留） | §3 非目标、§7.3 |
| D-002@v1 | 接收人 = change 门广播给持有 CHANGE_CREATE 权限全员（镜像 has_permission 三段语义）；daemon 权限 = 会话 owner 定向 | §7.1、§7.3 |
| D-003@v1→v2 | 架构：v1 曾选「事件总线+per-user 频道」（方案B），用户复看后改定 v2「方案A：直调 + 全局频道 + SSE 服务端过滤」，supersedes v1 | §5 总体方案 |
| D-004@v1 | 落库模型 = notifications 按接收人展开行（multica inbox 同款） | §8 |
| D-005@v1 | 前端 = 铃铛+下拉面板；不轮询（无 refetchInterval，SSE 驱动 + 首载/聚焦兜底） | §3、§7.4 |
| D-006@v1 | 全链路 best-effort：通知失败不阻塞审批主流程，独立事务 | §7.1、§10 |
| D-007@v1 | 待办消解：审批动作 resolve_pending 置已读 + 结果通知 owner | §7.3②、§9 |
| D-008@v1 | daemon 权限：请求产生/超时通知 owner；owner 自响应不通知 | §7.3③ |
| D-009@v1→v2 | 幂等：v1「未消解存在性检查」方向保留，v2 统一为 **service 内唯一检查方**、键固定 (ref_type, ref_id, type)，dedupe_key 降为审计列（无独立索引）——修正 v1 触发点/service 双处检查与键粒度不一致（Grill X-08） | §7.1、§7.3①、§8 |
| D-010@v1 | daemon 权限通知 owner = `AgentSession.user_id`（respond 鉴权同源；runtime owner≠session creator 是支持场景——Grill X-10，关闭 S-01） | §7.3③、§9 |
| D-011@v1 | 待办检测数据源 = in-hand `latest_progress`（PG 权威，复用 `_project_current_stage`/`_map` 先例），不重读 `compute_pending_review` 镜像（时滞会漏发——Grill X-06） | §7.3① |

未解决的剩余风险：S-02（link 深链格式，execute 时对照前端路由定稿）。S-01/S-03 已由 Design Grill 裁定关闭（D-010@v1 / §6 env.py 登记）。

### 12.1 Design Grill 修订记录（2026-08-29，独立审查代理）

verdict：specVerdict=pass / qualityVerdict=pass（16 项 checklist：12 pass / 4 gap / 0 fail，无 P0/P1 blocker）。按审查结论修订：X-06（数据源改 in-hand body，D-011@v1）、X-07（单门措辞修正）、X-08（幂等键统一，D-009@v2）、X-10（owner=AgentSession.user_id，D-010@v1，关闭 S-01）、X-16（env.py 登记入清单，关闭 S-03）、X-17（挂载点改 top-bar.tsx、前端引用修正 session-permission-panel.tsx）、X-04（反查过滤活跃用户）、X-13（R-09 登记）、X-18（重连后 invalidate 补拉）。review.json：`.sillyspec/.runtime/stage-reviews/brainstorm-review-2026-08-29-143826/review.json`。

## 13. 自审（Self-Review）

**章节完整性**：背景/目标/非目标/拆分判断/总体方案/文件变更清单（含数据流标注）/接口定义/生命周期契约表/数据模型/兼容策略/风险登记/决策追踪/自审 —— 全部在位。

**生命周期关键词自查**：本文含 session/daemon 等关键词 → 已含「生命周期契约表」章节（§9，通知自身生命周期；daemon 会话契约不改动已在表前声明）。

**契约自查**：
- 完成契约 `brainstorm.design.lifecycle-table`：§9 命中 ✔
- 完成契约 `file-change-list`：§6 字面命中 ✔；含对外 DTO/事件 payload → 已标 producer→consumer 数据流 ✔
- 完成契约 `risk-register`：§11 命中 ✔
- 完成契约 `self-review`：本节命中 ✔
- 原型：`prototype-notification-bell.html` 已生成（组件级变化按分级规则生成）✔

**一致性自查**：用户确认的 4 项需求决策（范围/接收人/架构/前端形态）与 §3/§5/§7 一致；方案 A 与现有代码先例（sessions/events、publish_sessions_changed、_maybe_notify_session）逐一对得上落点；decisions.md 九字段齐全。

**⚠️ 自审存疑（Grill 后状态）**：
- S-01：**已关闭**（Grill X-10 裁定 → D-010@v1：owner=`AgentSession.user_id`）。
- S-02：**仍开放**——`link` 深链格式（changes 页/approvals 页路由参数），execute 时对照前端实际路由定稿。
- S-03：**已关闭**（Grill X-16 裁定：必须登记 `migrations/env.py` 模型清单，已入 §6 文件清单）。
