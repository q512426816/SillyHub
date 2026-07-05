---
id: task-08
title: backend PUT allowed-roots 端点触发 WS push
author: WhaleFall
created_at: 2026-07-02T15:12:00
priority: P0
depends_on: [task-06, task-07]
blocks: [task-22]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/
change: 2026-07-02-daemon-filesystem-policy
goal: "(见 body)"
implementation: "(见 body)"
acceptance: "(见 body)"
verify: "(见 body)"
constraints: "(见 body)"
---

# task-08

> goal: PUT /runtimes/{rid}/allowed-roots 改完 DB 后主动 ws_hub push（D-004，sub-second）。

## implementation
- `router.py:340` PUT 端点 `svc.update_allowed_roots(...)` 成功后调 `ws_hub.send_policy_update(rid, new_roots, version)`
- version 从 DB 或递增计数器取（保证单调）
- 失败不阻断 PUT 响应（best-effort push，心跳兜底）

## 验收标准
- 前端改 allowed_roots → backend DB 更新 → WS push 到在线 daemon
- daemon 收到立即更新 PolicyCache（sub-second）
- push 失败不影响 PUT 响应

## 验证
- `cd backend && uv run pytest app/modules/daemon/ -k allowed_roots`

## constraints
- 现有端点是 PUT（非 PATCH，design §5.3 措辞修正）
- 心跳 15s 兜底防 WS 断线丢消息（R-07）
- version 去重：daemon 收旧 version 忽略
