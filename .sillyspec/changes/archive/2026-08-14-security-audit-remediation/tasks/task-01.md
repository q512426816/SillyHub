---
id: task-01
title: "daemon WS 升级期鉴权"
title_zh: "daemon WS 升级期鉴权（4001/4003）"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-01]
decision_ids: [D-001@v1]
allowed_paths:
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/tests/test_ws_auth.py
  - backend/app/modules/daemon/tests/test_ws_handshake_daemon_id.py
provides:
  - contract: ws_upgrade_auth_helper
    fields: [authenticate_ws_upgrade]
expects_from: {}
goal: >
  WS 端点在 accept 之前完成凭据解析与 daemon 归属断言，无凭据 4001、归属不匹配 4003、本人放行。
implementation:
  - 新建 backend/app/modules/daemon/tests/test_ws_auth.py，先写三个失败用例（无 header 期望 4001、他人 apiKey 期望 4003、本人 apiKey 通过并完成注册握手）
  - 在 daemon/router.py 的 daemon_websocket 内新增 _authenticate_ws_upgrade helper（WS 端点不能走标准 Depends 鉴权，须在 handler 内显式调用并直接操作 Request/WebSocket headers）
  - 凭据解析顺序为先看 X-API-Key header，再看 Authorization Bearer；Bearer 值先按 shk_live_ 前缀短路走 ApiKeyService.authenticate，否则走 JWT 解析（复用 get_current_principal 的解析逻辑）
  - 解析出 principal 后断言 user.id 与查到的 DaemonInstance.user_id 一致，不匹配 close 4003 并附 reason 说明归属不匹配
  - 无凭据或凭据无效 close 4001
  - 断言放在 instance 查找之后、accept 之前；instance 不存在的既有 4001 路径保持不变
  - 更新 test_ws_handshake_daemon_id.py 中 4 处无凭据 websocket_connect fixtures，补 X-API-Key header（预置改造勿等跑红）
  - 更新 daemon_websocket docstring，删除已失效的 token query param 说明
acceptance:
  - 无凭据连接被 close code 4001
  - 他人有效 apiKey 连接他人 daemon_local_id 被 close code 4003
  - 本人 apiKey 连接成功完成握手并注册进 ws hub
  - 既有 test_ws_handshake_daemon_id.py 全部用例改造后通过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_ws_auth.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_ws_handshake_daemon_id.py -q --no-cov
constraints:
  - daemon/router.py 同 Wave 多 task 触及（task-03/task-04 也改本文件），execute 须串行提交
  - 本 task 只做鉴权，不动 claim/pending-leases/heartbeat（归 task-03）与 llm-proxy（归 task-04）
  - 与 task-02 同一提交窗口落地，否则所有 daemon 断连（plan 依赖关系）
  - 不引入 query token 回退（段 5 会删 query 回退，勿新增依赖）
related_tests:
  - path: backend/app/modules/daemon/tests/test_ws_handshake_daemon_id.py
    reason: 4 处 websocket_connect（:107/:135/:148/:161）均无凭据 header，加鉴权后 4001 挂掉，需补本人凭据 fixtures
---
