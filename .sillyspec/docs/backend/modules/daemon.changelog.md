---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — 权限审批 owner 定向通知（变更 2026-08-29-approval-notify-push task-06）
- permission_service：handle_permission_request（canUseTool/dialog 双 kind，WS/HTTP 单点覆盖）在 _publish_session_event 成功后通知会话 owner（=AgentSession.user_id，非 runtime owner，D-010@v1）；_on_timeout 重查会话发 permission_timeout；respond 路径不通知（自操作豁免 D-008@v1）。用例 tests/test_permission_owner_notify.py。

## 2026-08-30 — 风险审查高置信缺陷修复批（quick ql-20260830-001-2e52）
- sweep（session_offline_sweep_once）补重派失败自愈链：每轮捞「failed worker + 末次 run=daemon_interrupted + 原 runtime 回在线 + 宽限窗内」重 fire（审计⑤，NoOnlineDaemonError 返回 None 后此前永不再被选中）；usage 端点 GET /sessions/{id}/usage 权限闸门对齐 TaskRunAgentUser + 软删 deleted_at 404（审计⑥）；SessionService 激活分支（_activate_tool_report_session）与 handle_plan_response 补归档禁写守卫（审计④-1/④-7，4d64cb28 声称的激活分支覆盖缺口收口）。

## 2026-08-30 — 剩余中置信缺陷修复批（quick ql-20260830-002-f0d2）
- R8 reopen_session 补归档禁写守卫（_ensure_session_workspace_writable，复活会话句柄同样 409）。
