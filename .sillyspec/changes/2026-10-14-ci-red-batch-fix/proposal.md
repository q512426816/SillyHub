---
author: flow-machine-draft
created_at: 2026-10-13T16:27:30.287Z
---
# 提案书（Proposal）— 2026-10-14-ci-red-batch-fix

## 动机

任务原话转写：动机：main 最新 push（4347239）后 backend-ci / daemon-ci / frontend-ci 三流水线共 5 处红——backend 3 测试（AgentSession 字段钉子漏同步 current_change_id + daemon 两测试 seed 仍用旧 run.change_id 锚构造单轮形态，未对齐 2026-10-13-multiturn-changeid-misjudge 的 session.change_id 新契约）、sillyhub-daemon api-types.ts 落后后端 OpenAPI、frontend agent-replay-body 一用例仅等 mock 调用未等渲染导致 CI 时序 flaky。
成功标准：
- backend 三个失败用例本地转绿（test_agent_sessions_model_fields_unchanged / test_gate_shape_single_turn_completed_marks_ended / test_close_interactive_run_terminal_flip_publishes_status_changed）
- sillyhub-daemon gen:types:check 本地通过（api-types.ts 与后端 OpenAPI 对齐）
- frontend agent-replay-body.test.tsx 全部 16 用例转绿
- 零生产代码改动：仅测试对齐既有契约 + 类型重生成 + 测试时序加固

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. backend 三个失败用例本地转绿（test_agent_sessions_model_fields_unchanged / test_gate_shape_single_turn_completed_marks_ended / test_close_interactive_run_terminal_flip_publishes_status_changed）
2. sillyhub-daemon gen:types:check 本地通过（api-types.ts 与后端 OpenAPI 对齐）
3. frontend agent-replay-body.test.tsx 全部 16 用例转绿
4. 零生产代码改动：仅测试对齐既有契约 + 类型重生成 + 测试时序加固

## 成功标准（可验证）

1. backend 三个失败用例本地转绿（test_agent_sessions_model_fields_unchanged / test_gate_shape_single_turn_completed_marks_ended / test_close_interactive_run_terminal_flip_publishes_status_changed）
2. sillyhub-daemon gen:types:check 本地通过（api-types.ts 与后端 OpenAPI 对齐）
3. frontend agent-replay-body.test.tsx 全部 16 用例转绿
4. 零生产代码改动：仅测试对齐既有契约 + 类型重生成 + 测试时序加固
