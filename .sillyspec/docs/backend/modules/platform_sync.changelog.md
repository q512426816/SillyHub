---
author: qinyi
created_at: 2026-08-29 22:56:30
---

# 模块变更索引（changelog sidecar）

## 2026-08-29 — upsert_progress 待办产生钩子（变更 2026-08-29-approval-notify-push task-04）
- 尾部旁路 `_broadcast_pending_approval`：in-hand latest_progress 判定 pending（等价内联 _extract_* + 复用 StageProjectionService._map，禁用 compute_pending_review——镜像 db 有时滞 D-011@v1）→ NotificationService.notify_broadcast 广播 approval_pending。best-effort，失败仅 warning 不影响进度落库。用例 tests/test_pending_approval_broadcast.py。

## 2026-08-30 — 待审通知标题去日期前缀 + body 句式（quick 样式优化）

- `_broadcast_pending_approval`：变更显示名在 title 为空**或等于 change_key**（占位行回退复制）时用 `_DISPLAY_KEY_RE` 去「YYYY-MM-DD-」前缀的 key；title 新句式「变更「短名」等待提案审核」，body「{stage} 阶段完成，等待{门}」。

## 2026-09-24 — 事件通道写入路径两修：并发撞键收敛 + ts 值域上界（quick ql-20260924-001）

- append_events INSERT+修剪+commit 包 IntegrityError 重试收敛（并发同 dedup_key 撞 uq_platform_change_events_dedup 时 rollback 重查剔除重插，不再整批 500）；确定性测试 test_concurrent_duplicate_key_converges_not_500（patch 首次预取盲看模拟竞态）。
- ChangeEventPush.ts 补 le 上界（datetime.max 毫秒 253402300799999）+ 非有限值 before 校验器转 None（防 422 详情回显 inf 被 starlette allow_nan=False 渲染炸 500）；测试超域 1e15 与 Infinity 字面量（原始 body）均 422。
