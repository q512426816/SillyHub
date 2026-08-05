---
id: task-14
title: 文档同步（CONCERNS.md / protocol 双端消息表 / QUICKLOG）（覆盖 FR-08）
title_zh: 文档同步更新
author: qinyi
created_at: 2026-08-05 19:24:02
priority: P2
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13, task-15]
blocks: []
requirement_ids: [FR-08]
decision_ids: []
allowed_paths:
  - .sillyspec/docs/multi-agent-platform/scan/CONCERNS.md
  - .sillyspec/docs/multi-agent-platform/scan/INTEGRATIONS.md
  - .sillyspec/quicklog/QUICKLOG-qinyi.md
goal: >
  同步 scan CONCERNS.md（标原 P0 已修 + 本次新机制）、protocol 双端消息表、QUICKLOG。
implementation:
  - 更新 CONCERNS.md 标原 P0-1 和 P0-2 已修（引用 commit d06d9a32 等）加本次新机制说明
  - 更新 protocol 双端消息表新增 LEASE_CANCEL 加 SESSION_INTERRUPT 收窄加 SESSION_END 扩大
  - 更新 QUICKLOG 记录本次 change 关键修复点
acceptance:
  - CONCERNS.md 不再把已修 P0 描述为活隐患
  - protocol 消息表含 LEASE_CANCEL
  - QUICKLOG 含本次修复条目
verify:
  - 人工审阅文档与代码一致
constraints:
  - 只改文档不改代码
  - 引用真实 commit 和 file line
---
