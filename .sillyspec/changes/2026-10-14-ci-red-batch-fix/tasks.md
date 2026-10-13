---
author: flow-machine-draft
created_at: 2026-10-13T16:27:30.288Z
---
# 任务注册表（Tasks）— 2026-10-14-ci-red-batch-fix

- [x] task-01: 字段钉子同步——`backend/app/modules/agent/tests/test_mission_session_id.py` expected 补 `current_change_id` + docstring 口径，`uv run pytest test_mission_session_id.py::test_agent_sessions_model_fields_unchanged` 转绿
- [x] task-02: gate seed 对齐会话级锚——`test_run_sync_session_gate_failover.py` `_seed_gate_shape` 在 change_id 非 None 时同落 `session.change_id`，`test_gate_shape_single_turn_completed_marks_ended` 转绿且同文件其余用例零回归
- [x] task-03: cross seed 增可选参——`test_session_events_cross.py` `_seed_interactive_run` 增 `session_change_id`（默认 None），`test_close_interactive_run_terminal_flip_publishes_status_changed` 传参对齐新契约，该用例转绿且多轮零发布用例零回归
- [x] task-04: daemon 类型对齐——`sillyhub-daemon` 跑 `pnpm gen:types` 重生成 `src/api-types.ts`，`pnpm gen:types:check` 退出码 0
- [x] task-05: frontend 渲染等待加固——`agent-replay-body.test.tsx` 首用例 mock 调用等待后补 `turn-timeline-scroll` 渲染锚 waitFor，该文件 16 用例全绿
