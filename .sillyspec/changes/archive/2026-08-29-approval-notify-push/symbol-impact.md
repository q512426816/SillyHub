---
author: qinyi
created_at: 2026-08-29 21:13:30
---
# 符号影响面分析（Symbol Impact）— 2026-08-29-approval-notify-push

> 方法：对 13 个 task 涉及的新增/修改符号做全仓 grep，将调用点与 tasks/task-NN.md 的 allowed_paths 对照。结论：**全部 task 无签名级变更**（既有符号均为方法内部旁路挂钩，签名与返回结构不变；新符号全部为新建文件/新建函数，无既有调用点）。

- task-01: 新增符号（Notification ORM、迁移）——全新文件，无既有调用点；`backend/migrations/env.py` 为清单追加行（不改动既有登记项）。范围内 ✅
- task-02: 新增符号（NotificationService/NotificationChannel/InAppChannel/publish_notifications_new）——全新文件，无既有调用点。范围内 ✅
- task-03: 新增符号 `list_user_ids_with_permission`——全仓 grep 零占用（与既有 collect_permissions*/has_permission 不冲突）；既有 `has_permission`（rbac.py:107）签名不动。范围内 ✅
- task-04: 修改符号 `upsert_progress`（platform_sync/service.py:167）——调用点 `platform_sync/router.py`（及测试 test_pk_semantics/test_router）。变更=方法尾部旁路挂钩，签名/返回不变，调用点零改动；调用点不在本 task allowed_paths 但无需改动 ✅
- task-05: 修改符号 proposal_review(:2498)/plan_review(:2579)/human_test(:2683)/archive_confirm(:3030)/approve(:687)/reject(:702)（change/service.py）——调用点 `change/router.py`。变更=方法末尾追加消解+通知（best-effort），签名/返回不变，调用点零改动 ✅
- task-06: 修改符号 `handle_permission_request`(:292)/`_on_timeout`(:1145)（daemon/permission_service.py）——调用点 daemon/router.py（WS 上行 + HTTP 委托 :552 路径在 permission_service 自身）。变更=既有 `_publish_session_event` 成功后的旁路通知，签名不变，调用点零改动 ✅
- task-07: 新增符号（notification/router.py、schema.py DTO、main.py include_router 一行）——全新文件 + 注册行；`main.py` 既有 include_router 块不受影响。范围内 ✅
- task-08: 新增符号（SSE 端点函数，落 notification/router.py，与 task-07 异 Wave 串行）✅
- task-09: 生成产物（backend/openapi.json、frontend/src/lib/api-types.ts）——gen:types 重新生成，只增不改既有类型。范围内 ✅
- task-10: 新增符号（lib/notifications.ts fetch 函数/hooks + query-keys 通知 keys）——query-keys.ts 为追加工厂条目，不改动既有 key。范围内 ✅
- task-11: 修改符号 TopBar（frontend/src/components/top-bar.tsx）——渲染点 app-shell.tsx（:50/:427）仅 `<TopBar />` 引用，props 不变，调用点零改动；notification-bell.tsx 全新。top-bar.test.tsx 回归在 task-13 ✅
- task-12: 配置+测试（local.yaml modules 追加行、四模块 tests 修正）——无生产符号。范围内 ✅
- task-13: 测试（前端组件/lib 测试 + top-bar.test.tsx 既有用例 mock 补齐）——无生产符号。范围内 ✅
