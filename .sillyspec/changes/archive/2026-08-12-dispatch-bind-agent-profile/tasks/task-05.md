---
author: WhaleFall
created_at: 2026-08-12T13:20:00
task: task-05
title: 后端透传单测（W1 收尾）
---

# task-05: 后端透传单测（W1 收尾）

- **allowed_paths**: `backend/app/modules/change/tests/`、`backend/app/modules/agent/tests/`
- **改动**：
  - dispatch 透传链路测试：前端传 agent_profile_id → 落到 start_stage_dispatch 调用参数（mock 验证）。
  - None 路径零回归：不传 agent_profile_id → 行为与今天一致（`_resolve_dispatch_profile` 无 hint 返 None）。
  - lease.metadata 含档案字段（选了档案时）。
- **完成标准**：新增测试全过；既有 dispatch 测试不回归。
- **依赖**：task-04。
