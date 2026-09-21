## FR-lib-react-query-001 通知数据模型与落库
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-004@v1
场景正文：
- 场景：默认场景 — Given `notifications` 表已建（按接收人展开行：workspace_id/recipient_user_id/type/title/body/link/；When `NotificationService` 落库一条通知；Then 每个接收人一行、read_at 为 NULL（未读），列表/未读数/消解查询均走 recipient/ref 索引 建表与索引成功，downgrade 可回退
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-01
最近确认：8b2383a2a

## FR-lib-react-query-002 通知服务与通道抽象
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-003@v2、D-006@v1
场景正文：
- 场景：默认场景 — Given `NotificationService`（广播/定向入口）与 `NotificationChannel` 通道抽象，默认通道列表 `[InAppChannel；When 触发点调用 `notify_broadcast` / `notify_user`；Then 落库（方法内独立事务 commit）成功后才逐通道投递；InAppChannel 向 Redis `notifications:new` publish 一条（
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-02
最近确认：8b2383a2a

## FR-lib-react-query-003 广播收件人解析
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-002@v1
场景正文：
- 场景：默认场景 — Given 工作区 W 内用户角色各异（部分有 CHANGE_CREATE、部分无；另存在平台级授权用户与平台管理员）；When 调用 `list_user_ids_with_permission(W, CHANGE_CREATE)`；Then 返回 = 工作区 grant ∪ 平台级 grant（含 PLATFORM_ADMIN 角色）∪ `is_platform_admin` 用户（镜像 `has_
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-03
最近确认：8b2383a2a

## FR-lib-react-query-004 change 待办产生通知（触发点①）
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-001@v1、D-009@v2、D-011@v1
场景正文：
- 场景：默认场景 — Given agent 经 `upsert_progress` 推送进度且本次 in-hand `latest_progress` 判定 pending_review 非空；When 钩子在 progress 提交成功后执行；Then 向 FR-03 收件人集广播 `approval_pending` 通知（ref=change_id，dedupe_key={change_id}:{revie
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-04
最近确认：8b2383a2a

## FR-lib-react-query-005 change 审批结果通知与待办消解（触发点②）
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-007@v1
场景正文：
- 场景：默认场景 — Given 审批人在四门（proposal_review/plan_review/human_test/archive_confirm）或旧版 approve/reject；When 钩子执行；Then 先 `resolve_pending(change)` 把同 ref 未读待办通知置已读，再向 `changes.owner_id` 发 `approval_r
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-05
最近确认：8b2383a2a

## FR-lib-react-query-006 daemon 权限审批通知（触发点③）
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-001@v1、D-008@v1、D-010@v1
场景正文：
- 场景：默认场景 — Given daemon 会话产生权限请求（canUseTool 或 AskUserQuestion dialog，WS/HTTP 双通道汇于 `handle_permis；When 既有 `_publish_session_event` 成功后；Then 向会话 owner（**`AgentSession.user_id`**）定向发 `permission_request` 通知 重查会话取 owner（新开短
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-06
最近确认：8b2383a2a

## FR-lib-react-query-007 SSE 实时推送端点
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-003@v2
场景正文：
- 场景：默认场景 — Given 用户已登录并打开前端 另一用户的通知事件到达 无 Last-Event-ID 回放；When 订阅 `GET /api/notifications/events`；Then 端点级短 session 鉴权后进入生成器（不注入请求级 DB session）；订阅 `notifications:new`，仅当 payload.recip
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-07
最近确认：8b2383a2a

## FR-lib-react-query-008 REST 查询与已读端点
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
场景正文：
- 场景：默认场景 — Given 用户存在落库通知；When 调用 `GET /api/notifications`（分页/unread_only）、`GET /api/notifications/unread-count；Then 仅返回/操作本人通知；单条已读越权或不存在返回 404（中文文案）；read-all 返回更新行数
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-08
最近确认：8b2383a2a

## FR-lib-react-query-009 前端铃铛与下拉面板（无轮询）
变更：2026-08-29-approval-notify-push
状态：active
摘要：默认场景
依据决策：D-005@v1
场景正文：
- 场景：默认场景 — Given 顶栏（`top-bar.tsx`）挂载 `<NotificationBell />` 用户点击通知条目 三主题（AI 紫/蓝/暗夜）；When 页面加载 SSE `notification` 事件到达或重连成功
全文：.sillyspec/changes/archive/2026-08-29-approval-notify-push/requirements.md#FR-09
最近确认：8b2383a2a
