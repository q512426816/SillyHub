---
schema_version: 1
doc_type: module-card
module_id: notification
author: qinyi
created_at: 2026-08-29 22:55:10
---

# 站内通知（notification）

## 定位
审批流站内通知的落库事实源 + 实时投递底座（变更 2026-08-29-approval-notify-push）。
`notifications` 表按接收人展开行（一行=一接收人一条通知），支撑历史/未读数/已读状态；
投递走 `NotificationChannel` 通道抽象——首个通道 `InAppChannel`（Redis 全局频道
`notifications:new` 合并 publish），未来钉钉/企微 IM = 新增 Channel 实现注册进
`channels` 列表，审批触发点零改动（multica「收件箱为事实源、IM 为叠加层」模式）。

## 契约摘要
- REST（仅本人）：`GET /api/notifications`（limit/offset/unread_only → items+total）、
  `GET /api/notifications/unread-count`、`POST /api/notifications/{id}/read`
  （越权/不存在 404 `NotificationNotFound`）、`POST /api/notifications/read-all`。
- SSE：`GET /api/notifications/events`——端点级短 session 鉴权，生成器零 DB；
  订阅 `notifications:new`，仅当 payload.recipient_user_ids 含当前用户才下发
  命名事件 `notification`（不透传全量收件人列表）；25s keepalive；无 Last-Event-ID。
- 服务入口：`NotificationService.notify_broadcast`（收件人=rbac
  `list_user_ids_with_permission` 反查；幂等=同 ref_type+ref_id+type 存在未消解行
  即跳过，service 是唯一检查方）/ `notify_user`（定向）/ `resolve_pending`
  （审批动作消解同 ref 待办）/ `mark_read` / `mark_all_read` / `list_for_user` /
  `unread_count`。全部方法内独立 commit，投递 best-effort（失败仅 warning）。
- 通知类型：`approval_pending`（change 门待办，广播）/ `approval_result`（审批结果，
  定向 owner）/ `permission_request` / `permission_timeout`（daemon 权限，定向会话
  owner=AgentSession.user_id）。

## 触发点（旁路钩子，best-effort 不阻塞主流程）
- platform_sync `upsert_progress` 尾部：in-hand latest_progress 判定 pending（禁用
  compute_pending_review 镜像读取，有时滞）→ 广播。
- change 四审核门 + approve/reject 末尾：resolve_pending + 结果通知 owner。
- daemon permission_service：handle_permission_request / _on_timeout → owner 定向。

## 注意事项
- 幂等无唯一约束：驳回重跑后同门待办须允许再通知（旧通知已被消解放行），
  dedupe_key 仅审计列。
- 前端消费：`lib/notifications.ts`（无 refetchInterval，SSE 事件+重连双 invalidate；
  401/403/404 永久停连）+ `notification-bell.tsx` 铃铛挂 top-bar。
- 测试：模块四文件（model/service/router/integration）；local.yaml modules 块有
  notification 子模块映射。
