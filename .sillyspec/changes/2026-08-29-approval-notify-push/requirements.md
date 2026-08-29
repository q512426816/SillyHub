---
author: qinyi
created_at: 2026-08-29 14:53:05
---
# 需求规格（Requirements）

## 角色

| 角色 | 说明 |
|---|---|
| 审批人 | 工作区内持有 CHANGE_CREATE 权限的用户（含平台管理员），可在变更中心操作审核门 |
| 变更发起人 | change 的 owner（`changes.owner_id`），接收审批结果通知 |
| 会话 owner | daemon 会话的创建者（`AgentSession.user_id`），权限审批的唯一审批人 |
| agent/CLI | SillySpec 客户端，经 platform_sync 推送变更进度（待办产生的源头） |

## 功能需求

### FR-01: 通知数据模型与落库
覆盖决策：D-004@v1
Given `notifications` 表已建（按接收人展开行：workspace_id/recipient_user_id/type/title/body/link/ref_type/ref_id/dedupe_key/read_at/created_at + 三个普通索引，无唯一约束）且模型已登记 `migrations/env.py`
When `NotificationService` 落库一条通知
Then 每个接收人一行、read_at 为 NULL（未读），列表/未读数/消解查询均走 recipient/ref 索引

Given 迁移在 PG 与 SQLite 测试库执行
Then 建表与索引成功，downgrade 可回退

### FR-02: 通知服务与通道抽象
覆盖决策：D-003@v2, D-006@v1
Given `NotificationService`（广播/定向入口）与 `NotificationChannel` 通道抽象，默认通道列表 `[InAppChannel]`
When 触发点调用 `notify_broadcast` / `notify_user`
Then 落库（方法内独立事务 commit）成功后才逐通道投递；InAppChannel 向 Redis `notifications:new` publish 一条（广播多行合并 recipient 并集，payload 含通知摘要）

Given 落库或 Redis publish 任一环节抛异常
Then 仅 log.warning，不向触发点抛出，审批主流程不受影响、已提交的审批/进度不回滚

Given 广播收件人集为空
Then 返回 0，不落库不 publish

### FR-03: 广播收件人解析
覆盖决策：D-002@v1
Given 工作区 W 内用户角色各异（部分有 CHANGE_CREATE、部分无；另存在平台级授权用户与平台管理员）
When 调用 `list_user_ids_with_permission(W, CHANGE_CREATE)`
Then 返回 = 工作区 grant ∪ 平台级 grant（含 PLATFORM_ADMIN 角色）∪ `is_platform_admin` 用户（镜像 `has_permission` 三段解析），且仅含活跃账户

### FR-04: change 待办产生通知（触发点①）
覆盖决策：D-001@v1, D-011@v1, D-009@v2
Given agent 经 `upsert_progress` 推送进度且本次 in-hand `latest_progress` 判定 pending_review 非空（复用 `_project_current_stage` 提取 + `_map`，同一时刻至多一门）
When 钩子在 progress 提交成功后执行
Then 向 FR-03 收件人集广播 `approval_pending` 通知（ref=change_id，dedupe_key={change_id}:{review_kind} 仅审计）

Given 已存在同 (ref_type=change, ref_id, type=approval_pending) 且 read_at IS NULL 的通知（service 内唯一检查方）
Then 跳过广播返回 0（重复推送进度不重复通知）

Given 通知为空窗后重连/离线用户
Then 未在线不丢通知——落库保证下次打开页面可见

Given 钩子内判定或通知任何异常
Then 仅 log.warning，progress 落库结果不受影响

### FR-05: change 审批结果通知与待办消解（触发点②）
覆盖决策：D-007@v1
Given 审批人在四门（proposal_review/plan_review/human_test/archive_confirm）或旧版 approve/reject 完成一次审批动作且已提交
When 钩子执行
Then 先 `resolve_pending(change)` 把同 ref 未读待办通知置已读，再向 `changes.owner_id` 发 `approval_result` 通知（通过/驳回/回退文案区分，body 含审批人与原因上下文）

Given owner_id 为 None
Then 跳过结果通知（不报错）

Given 驳回/回退后 agent 重跑同阶段使待办再现
Then 因旧通知已消解，FR-04 幂等检查放行，再次广播（再通知路径闭合）

### FR-06: daemon 权限审批通知（触发点③）
覆盖决策：D-001@v1, D-008@v1, D-010@v1
Given daemon 会话产生权限请求（canUseTool 或 AskUserQuestion dialog，WS/HTTP 双通道汇于 `handle_permission_request`）
When 既有 `_publish_session_event` 成功后
Then 向会话 owner（**`AgentSession.user_id`**）定向发 `permission_request` 通知

Given 权限请求 5 分钟超时（`_on_timeout`）
Then 重查会话取 owner（新开短 session），发 `permission_timeout` 通知

Given owner 自己响应审批（respond_permission/_respond_dialog）
Then 不产生任何通知

### FR-07: SSE 实时推送端点
覆盖决策：D-003@v2
Given 用户已登录并打开前端
When 订阅 `GET /api/notifications/events`
Then 端点级短 session 鉴权后进入生成器（不注入请求级 DB session）；订阅 `notifications:new`，仅当 payload.recipient_user_ids 含当前用户才下发 `notification` 事件（服务端过滤，不信任前端）；keepalive 心跳防饥饿；断连 finally 清理

Given 另一用户的通知事件到达
Then 当前用户连接不下发（跨用户隔离）

Given 无 Last-Event-ID 回放
Then 断线期间漏发由前端重连成功后 invalidate 补拉兜底

### FR-08: REST 查询与已读端点
Given 用户存在落库通知
When 调用 `GET /api/notifications`（分页/unread_only）、`GET /api/notifications/unread-count`、`POST /api/notifications/{id}/read`、`POST /api/notifications/read-all`
Then 仅返回/操作本人通知；单条已读越权或不存在返回 404（中文文案）；read-all 返回更新行数

### FR-09: 前端铃铛与下拉面板（无轮询）
覆盖决策：D-005@v1
Given 顶栏（`top-bar.tsx`）挂载 `<NotificationBell />`
When 页面加载
Then React Query 首载最近 20 条 + 未读数（`refetchOnWindowFocus: true`，**无 refetchInterval**）

When SSE `notification` 事件到达或重连成功
Then `invalidateQueries` notifications 全部 key（徽标与列表即时刷新；重连补拉对齐 fireConnectedOnce 先例）

Given 用户点击通知条目
Then 标记已读 + 跳转 `link` 对应审批页；「全部已读」清空未读；401/403/404 永久性 SSE 错误停连（对齐 ql-20260829-005），网络中断/5xx 退避重连

Given 三主题（AI 紫/蓝/暗夜）
Then 铃铛与面板经 brand-* 语义阶/主题 token 正确渲染；后端 schema 改动经 `pnpm gen:types` 同步（api-types.ts + openapi.json 提交）

## 非功能需求

- **兼容性**：纯增量（新模块/新表/新端点），现有 API/表/SSE/轮询兜底零改动；存量待办不回溯补发；Windows/Linux/macOS 三平台兼容（无平台相关代码）。
- **可靠性（best-effort）**：通知全链路失败不阻塞审批主流程（D-006@v1）；Redis 不可用仅降级实时性（落库不丢）。
- **可回退**：迁移可 downgrade；前端铃铛组件可整体摘除不影响其余功能。
- **可测试**：幂等/消解/扇出/过滤/隔离均有独立断言（GWT 对应用例）；只跑相关测试（CLAUDE.md 规则 0）。
- **文案**：通知标题/正文与错误信息全部中文（L10n 守护测试惯例）。

## 决策覆盖矩阵

| 决策 ID | 覆盖的 FR | 说明 |
|---|---|---|
| D-001@v1 | FR-04, FR-06 | 范围=change 四门+daemon 权限；release 不做 |
| D-002@v1 | FR-03 | 广播收件人镜像 has_permission 三段语义 |
| D-003@v2 | FR-02, FR-07 | 方案A：直调+通道抽象+全局频道+服务端过滤（v1 方案B已 superseded） |
| D-004@v1 | FR-01 | 按接收人展开行落库 |
| D-005@v1 | FR-09 | 铃铛+下拉面板；无轮询 SSE 驱动 |
| D-006@v1 | FR-02 | best-effort 不阻塞主流程 |
| D-007@v1 | FR-05 | 审批动作消解待办+结果通知 owner |
| D-008@v1 | FR-06 | 请求/超时通知 owner；自响应豁免 |
| D-009@v2 | FR-04 | 幂等=service 内未消解存在性检查（v1 已 superseded 收口） |
| D-010@v1 | FR-06 | owner=AgentSession.user_id（Grill 裁定） |
| D-011@v1 | FR-04 | 待办判定=in-hand latest_progress（Grill 裁定） |

> 当前版本决策全部被 FR 覆盖，无剩余未覆盖决策。遗留开放项：S-02（link 深链格式，execute 定稿，见 design §13）。
