---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — 权限审批 owner 定向通知（变更 2026-08-29-approval-notify-push task-06）
- permission_service：handle_permission_request（canUseTool/dialog 双 kind，WS/HTTP 单点覆盖）在 _publish_session_event 成功后通知会话 owner（=AgentSession.user_id，非 runtime owner，D-010@v1）；_on_timeout 重查会话发 permission_timeout；respond 路径不通知（自操作豁免 D-008@v1）。用例 tests/test_permission_owner_notify.py。
