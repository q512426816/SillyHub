---
author: qinyi
created_at: 2026-08-29 14:54:20
---
# 任务清单（Tasks）

- [x] task-01: notifications 表模型 + Alembic 迁移（含 migrations/env.py 登记与建表/回退用例）
- [x] task-03: rbac 广播收件人反查 list_user_ids_with_permission（三段语义+活跃过滤；用例放 tests/modules/auth——backend/app/modules/auth 无 tests/ 目录，随本任务建）
- [x] task-02: NotificationService + NotificationChannel 通道抽象（InAppChannel + events.py 发布助手，幂等/消解/独立事务）(depends_on: task-01,03)
- [x] task-04: 触发点① platform_sync.upsert_progress 待办产生钩子（in-hand latest_progress 判定，best-effort）(depends_on: task-02)
- [x] task-05: 触发点② change 四门+approve/reject 结果通知 owner 与待办消解 (depends_on: task-02)
- [x] task-06: 触发点③ daemon 权限请求/超时 owner 定向通知（owner=AgentSession.user_id，自响应豁免）(depends_on: task-02)
- [x] task-07: REST 四端点 + schema DTO + main.py 路由注册 (depends_on: task-02)
- [x] task-08: SSE 端点 GET /api/notifications/events（服务端过滤+keepalive+清理）(depends_on: task-02)
- [x] task-09: pnpm gen:types 类型同步（openapi.json + api-types.ts）(depends_on: task-07,08)
- [x] task-12: 后端整合回归 + local.yaml modules 补 notification 映射 + ruff/mypy 收口 (depends_on: task-04,05,06)
- [x] task-10: 前端数据层 lib/notifications.ts + query-keys + SSE 订阅 hook（无 refetchInterval）(depends_on: task-09)
- [x] task-11: 前端铃铛组件 notification-bell.tsx + top-bar.tsx 挂载（三主题）(depends_on: task-10)
- [x] task-13: 前端测试（铃铛/SSE 事件驱动 + components/__tests__/top-bar.test.tsx 既有用例回归——挂载铃铛后 mock 需补）+ tsc 零错收口 (depends_on: task-10,11)
