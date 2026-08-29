---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — 审批动作结果通知与待办消解（变更 2026-08-29-approval-notify-push task-05）
- 四审核门（proposal_review/plan_review/human_test/archive_confirm）+ 旧版 approve/reject 末尾新增 `_notify_approval_result`（与 _maybe_notify_session 同层）：先 resolve_pending 消解同 ref 待办，再向 changes.owner_id 发 approval_result（owner None 跳过）。门中文名常量 _APPROVAL_GATE_LABELS 与前端变更中心口径一致。用例 tests/test_approval_result_notify.py。

## 2026-08-30 — 风险审查高置信缺陷修复批（quick ql-20260830-001-2e52）
- reparse 删除闭环两修（审计②③）：_detect_renames orphaned 候选排除 location='deleted' 墓碑行（防同日新建变更被 rename 错配→出生即隐藏+上行永久 409 无逆转）；删除环遇 manifest platform_deleted=True 锚点的 'active' 行降级置软删（stats.tombstoned）不物理删——防 delete_change 步骤①commit 与步骤⑤之间的半删窗口被 reparse 物理删 CASCADE 抹掉 change_events/documents/session_links（R-09 审计保护）。
