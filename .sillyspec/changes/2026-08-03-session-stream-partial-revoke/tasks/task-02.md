---
id: task-02
title: service.py override 分支(:413 thinking / :445 assistant) 把 continue 改为 override envelope append 到 published_logs 跳 INSERT（segment_id=被撤回id、stale=True、content 保留 [*_OVERRIDE] 文本）复用现成 publish
title_zh: override 信号 publish 到 SSE 不落库
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: [task-01]
blocks: [task-03]
requirement_ids: [FR-02]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - backend/app/modules/daemon/run_sync/service.py
provides:
  - contract: override envelope（publish-only，不落库）
    fields: [log_id=None, channel=stdout, content, timestamp, segment_id, stale=True]
expects_from: []
goal: >
  override 撤回令箭从「截断不发」改为「publish 到 SSE 但不落库」，前端能收到信号按 segmentId 精确撤回已渲染半截，历史回显仍干净。
implementation:
  - thinking override 分支（service.py:413-434）：保留 completed_segments.add + flushed_partials.pop + expunge + published_logs 过滤 + await self._revoke_committed_partials(...) 全部不动（task-14 不回归）；把结尾的 `continue` 改为构造 override envelope 后跳过 INSERT（不进 log_entry 构造、不 session.add）。
  - assistant override 分支（service.py:445-464）：同上改法，content 前缀 [ASSISTANT_OVERRIDE]。
  - override envelope 直接 published_logs.append({...})，复用 submit_messages 返回 PublishIntent → router.py:1033 commit 后 publish_submitted_messages 的现成两路 publish（agent_run channel + session channel），无需抽 helper。
  - envelope 必须补全 session_payload(:168) 直取（非 .get()）的四个 key：log_id（None）/ channel（"stdout"）/ content（保留 "[THINKING_OVERRIDE] <segmentId>" 或 "[ASSISTANT_OVERRIDE] <segmentId>" 原样文本）/ timestamp（now.isoformat().replace("+00:00","Z")）。
  - 加 segment_id（=被撤回的 segmentId，即循环变量 segment_id，此处 override 行就是用 metadata.segmentId）/ stale（True）两个字段。parent_tool_use_id/subagent_type/depth/tool_kind 走 .get() 可缺省（override 行无需归属）。
acceptance:
  - override 信号到达后 published_logs 含一条 override envelope（content 前缀正确、segment_id=被撤回 id、stale=True、log_id=None）。
  - override 不落库：不构造 log_entry、不 session.add，agent_run_logs 无 override 行（task-03 断言）。
  - _revoke_committed_partials DELETE + flushed_partials.pop + expunge 顺序保持，task-14 跨调用去重不回归。
verify:
  - cd backend && pytest app/modules/daemon/tests/test_run_sync_assistant_override.py -v
  - cd backend && ruff check app/modules/daemon/run_sync/service.py
  - cd backend && mypy app/modules/daemon/run_sync/service.py
constraints:
  - "D-003：override envelope append 到 published_logs 跳 INSERT（INSERT 与 publish 已解耦：submit_messages 返回 PublishIntent，router.py:1033 commit 后调 publish_submitted_messages 执行真正 publish）。"
  - "P2（plan-review）：override envelope 必须补全 log_id（None）/ channel / content / timestamp 四个 key——session_payload(:168) 用 log_payload[\"log_id\"] 等直取（非 .get()），漏了会 KeyError。design §7.1 已写 log_id:None。parent_tool_use_id/subagent_type/depth/tool_kind 走 .get() 可缺省。"
  - task-14 不回归：_revoke_committed_partials 跨调用 DELETE + flushed_partials.pop + expunge 顺序不动（R-05）。
  - override 仍不落库（R-01），保留 task-14 override 不污染历史的设计。
---
