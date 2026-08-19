---
schema_version: 1
doc_type: task
id: task-06
title: Refactor runtime router endpoints
title_zh: 改造 runtime router 端点
author: qinyi
created_at: 2026-08-19T06:45:00+00:00
change_name: 2026-08-19-runtime-live-daemon-read
wave: 6
allowed_paths:
  - backend/app/modules/runtime/router.py
goal: 5 个 runtime 端点改走 RuntimeLiveService
implementation: router 中实例化 RuntimeLiveService；5 个端点全部改调新 service；保留 Permission.RUNTIME_READ 鉴权
acceptance: 端点 URL/响应结构与原有兼容；错误按新 Runtime* 错误抛出
verify: test_router.py 全部改用 mock daemon RPC 后通过
constraints: 不改动 OpenAPI schema 字段名（可选新增 envelope 字段除外）
---

# task-06：改造 runtime router 端点
