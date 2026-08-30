---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — upsert_progress 待办产生钩子（变更 2026-08-29-approval-notify-push task-04）
- 尾部旁路 `_broadcast_pending_approval`：in-hand latest_progress 判定 pending（等价内联 _extract_* + 复用 StageProjectionService._map，禁用 compute_pending_review——镜像 db 有时滞 D-011@v1）→ NotificationService.notify_broadcast 广播 approval_pending。best-effort，失败仅 warning 不影响进度落库。用例 tests/test_pending_approval_broadcast.py。

## 2026-08-30 — 待审通知标题去日期前缀 + body 句式（quick 样式优化）

- `_broadcast_pending_approval`：变更显示名在 title 为空**或等于 change_key**（占位行回退复制）时用 `_DISPLAY_KEY_RE` 去「YYYY-MM-DD-」前缀的 key；title 新句式「变更「短名」等待提案审核」，body「{stage} 阶段完成，等待{门}」。
