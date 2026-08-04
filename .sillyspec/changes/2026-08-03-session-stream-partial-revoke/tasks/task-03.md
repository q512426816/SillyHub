---
id: task-03
title: backend 测试 test_run_sync_assistant_override.py 加 override publish 到 SSE + 不落库（断言 agent_run_logs 无 override 行）+ segment_id 透传 + task-14 原有 12 单测 + 7 次 DELETE 基线全绿
title_zh: backend override publish 测试
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
no_deps_verify: true
depends_on: [task-01, task-02]
blocks: []
requirement_ids: [FR-02, FR-07]
decision_ids: []
allowed_paths:
  - backend/app/modules/daemon/tests/test_run_sync_assistant_override.py
provides: []
expects_from:
  - contract: SessionStreamEnvelope(SSE) / published_logs entry
    fields: [segment_id, stale]
  - contract: override envelope（publish-only，不落库）
    fields: [log_id=None, channel=stdout, content, timestamp, segment_id, stale=True]
goal: >
  用测试锁定 task-01/02 的行为：override publish 到 SSE 且不落库、segment_id 透传正确、task-14 落库去重机制零回归。
implementation:
  - 复用 test_run_sync_assistant_override.py 现有测试结构（fixture / submit_messages 调用模式），新增用例：构造 partial → override 消息序列，断言 SubmittedMessages.published_logs 含 override envelope（content 前缀、segment_id、stale=True、log_id=None）。
  - 不落库断言：override 后查 agent_run_logs，确认无 content 以 [ASSISTANT_OVERRIDE]/[THINKING_OVERRIDE] 开头的行（即 override 未落库）。
  - segment_id 透传断言：partial 行 published_logs entry 含 segment_id 非空（"main:msg_xxx:N" 格式）；complete 行 segment_id 为 None。
  - 复跑 task-14 现有 12 单测全绿；实跑场景确认 override 触发的 _revoke_committed_partials DELETE 仍执行（7 次 DELETE 基线，R-05）。
  - assistant + thinking 两种 override 各覆盖一组用例（对齐 :413 / :445 两条分支）。
acceptance:
  - 新增 override publish 用例绿：published_logs 含 override envelope，agent_run_logs 无 override 行。
  - segment_id 透传用例绿：partial 非空、complete 为 None。
  - task-14 原有 12 单测全绿，7 次 DELETE 基线保持。
verify:
  - cd backend && pytest app/modules/daemon/tests/test_run_sync_assistant_override.py -v
  - cd backend && ruff check app/modules/daemon/tests/test_run_sync_assistant_override.py
  - cd backend && mypy app/modules/daemon/tests/test_run_sync_assistant_override.py
constraints:
  - 测试逻辑本身有误时禁止改实现迁就（CLAUDE.md 规则9）；若 mock 缺字段暴露旧债，按惯例补字段而非躲报错。
  - 不改测试同文件的 service.py 实现来「凑通过」——实现问题回 task-01/02 修。
  - 用例覆盖 R-01（不落库）+ R-05（task-14 不回归）两条 P0 风险。
---
