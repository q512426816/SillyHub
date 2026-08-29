---
author: qinyi
created_at: 2026-08-29 14:54:20
---
# 任务清单（Tasks）

- [ ] task-01: notifications 表模型 + Alembic 迁移（含 migrations/env.py 模型登记）
- [ ] task-02: NotificationService + NotificationChannel 通道抽象（InAppChannel + events.py Redis 发布助手）
- [ ] task-03: rbac 广播收件人反查 list_user_ids_with_permission
- [ ] task-04: 触发点① platform_sync.upsert_progress 待办产生钩子（in-hand body 判定 + service 幂等广播）
- [ ] task-05: 触发点② change 四门 + approve/reject 结果通知 owner 与待办消解
- [ ] task-06: 触发点③ daemon 权限请求/超时 owner 定向通知（owner=AgentSession.user_id）
- [ ] task-07: REST 四端点（列表/未读数/单条已读/全部已读）+ schema DTO + main.py 路由注册
- [ ] task-08: SSE 端点 GET /api/notifications/events（服务端按当前用户过滤 + keepalive + 清理）
- [ ] task-09: pnpm gen:types 类型同步（openapi.json + api-types.ts）
- [ ] task-10: 前端数据层 lib/notifications.ts + query-keys 工厂 + SSE 订阅 hook（无 refetchInterval）
- [ ] task-11: 前端铃铛组件 notification-bell.tsx + top-bar.tsx 挂载（三主题）
- [ ] task-12: 后端测试（notification 模块用例 + 三触发点回归）
- [ ] task-13: 前端测试（铃铛/面板/SSE 事件驱动）+ tsc 零错验证
