---
id: task-03
title: "claim/pending-leases/heartbeat 归属 + compare_digest"
title_zh: "claim/pending-leases/heartbeat 归属校验 + claim_token 常量时间比较"
author: qinyi
created_at: 2026-08-15 01:12:00
priority: P0
depends_on: []
blocks: []
requirement_ids: [FR-02, FR-12]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - backend/app/modules/daemon/lease/service.py
  - backend/app/modules/daemon/router.py
  - backend/app/modules/daemon/runtime/service.py
  - backend/app/modules/daemon/tests/test_lease_ownership.py
  - backend/app/modules/daemon/tests/test_ws_handshake_daemon_id.py
provides: {}
expects_from: {}
goal: >
  claim_lease/pending-leases/heartbeat 三个端点补归属校验（他人 404），claim_token 比较改 secrets.compare_digest。
implementation:
  - 新建 tests/test_lease_ownership.py，先写失败用例（他人 claim 404、他人 pending-leases 404、他人 heartbeat 404、本人三路径回归）
  - lease/service.py claim_lease 增加必填参数 actor_user_id，校验链为 runtime 归属 daemon_instance 且 instance.user_id 等于 actor_user_id，不匹配抛 DaemonRuntimeNotFound（404，沿 287eed60 owner-only 资源隐藏约定）
  - router.py claim_lease 端点（:992 附近）从既有 user 参数取 user.id 传入 service
  - pending-leases 端点（:2444 附近）在查询前校验 runtime 归属 daemon_instance 且 instance.user_id 等于 user.id，不匹配 404
  - runtime/service.py heartbeat_daemon（:322 附近）增加归属校验（instance.user_id 与传入 actor_user_id 比对），router.py heartbeat 端点传 user.id
  - lease/service.py claim_token 比较（约 :993 附近 start_lease 内的字符串不等判断）改 secrets.compare_digest
  - test_ws_handshake_daemon_id.py 若 task-01 尚未合入凭据 fixtures，此处一并补齐（两 task 共享该文件的 WS 连接 fixtures）
acceptance:
  - 他人对不属于自己的 lease/runtime 发起 claim/pending-leases/heartbeat 均返回 404（不泄露存在性）
  - 本人三条路径行为回归不变（pending 状态流转与 heartbeat 刷新如旧）
  - claim_token 错误值与正确值返回一致（compare_digest 生效，无时序捷径）
  - 既有 lease 相关测试全量通过
verify:
  - cd backend && uv run pytest app/modules/daemon/tests/test_lease_ownership.py -q --no-cov
  - cd backend && uv run pytest app/modules/daemon/tests/test_lease_service.py app/modules/daemon/tests/test_register_heartbeat_daemon.py app/modules/daemon/tests/test_ws_handshake_daemon_id.py -q --no-cov
constraints:
  - daemon/router.py 同 Wave 多 task 触及（task-01/task-04 也改本文件），execute 须串行提交
  - 归属链按 design 用 runtime 隶属 daemon_instance 的 user_id 口径，不另建 join workspace member（design 段 1.2 的 runtime→user 校验即 instance.user_id）
  - 404 而非 403（D-001@v1 owner-only 约定，与 sessions 端点一致）
  - 不动 WS 端点本体（task-01）与 llm-proxy（task-04）
related_tests:
  - path: backend/app/modules/daemon/tests/test_ws_handshake_daemon_id.py
    reason: 既有 WS 测试无凭据，task-01 加鉴权后 4001；本 task 的 claim 测试复用同一套 fixtures 需协同改造
  - path: backend/app/modules/daemon/tests/test_lease_claim_transport.py
    reason: claim_lease 签名变化后若该测试直调 service 需同步补 actor_user_id 实参（预置改造）
---
