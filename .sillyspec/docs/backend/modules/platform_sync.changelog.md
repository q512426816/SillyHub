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
- 2026-10-13-task-wakeup-remove | 后台子代理任务终态后 daemon 自动注入「[后台任务通知]」开新轮让主代理汇报——用户裁定该自动汇报轮没必要（tok
- 2026-10-13-editpatch-fullchain | agent-log 视图 Edit 卡与会话化对话视图（agent-log-card）的 Write/Edit 卡仍无行
- 2026-10-13-turn-live-visibility | 会话运行中用户感知不到 agent 真实状态：TaskOutput 阻塞等待后台任务时时间线只显示原始 JSON 且静默
- 2026-10-16-change-title-condense-backfill | 变更中心标题提炼与存量回填
- 2026-10-21-spec-manifest-incremental | spec-manifest 增量游标同步
- 2026-10-22-agent-profiles-page-restyle | 智能体档案列表页重设计
- 2026-10-27-knowledge-hits-flush-button | 知识遥测断流根因：sillyspec CLI 2026-10-18 把遥测文件迁至 .runtime…
- 2026-10-28-knowledge-hits-cli-direct | CLI 直报主通道的接收侧（用户拍板方案收尾）：CLI 侧只持有 shpsync_ 平台令牌（wor…
- 2026-10-28-change-detail-sessions-source-fix | 变更详情会话区数据源错挂与附件标题修复：概览「会话」区实际取工作区全量最近会话而非该变更关联会话，用…
