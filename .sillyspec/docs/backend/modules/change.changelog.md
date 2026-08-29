---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — 审批动作结果通知与待办消解（变更 2026-08-29-approval-notify-push task-05）
- 四审核门（proposal_review/plan_review/human_test/archive_confirm）+ 旧版 approve/reject 末尾新增 `_notify_approval_result`（与 _maybe_notify_session 同层）：先 resolve_pending 消解同 ref 待办，再向 changes.owner_id 发 approval_result（owner None 跳过）。门中文名常量 _APPROVAL_GATE_LABELS 与前端变更中心口径一致。用例 tests/test_approval_result_notify.py。
