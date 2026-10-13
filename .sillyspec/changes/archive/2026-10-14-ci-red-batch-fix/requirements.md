---
author: flow-machine-draft
created_at: 2026-10-13T16:27:30.287Z
---
# 需求规格（Requirements）— 2026-10-14-ci-red-batch-fix

## 功能需求

### FR-01: backend 字段钉子与 daemon 测试 seed 对齐既有契约后，三个 CI 失败用例必须本地全部转绿

- `test_agent_sessions_model_fields_unchanged` 的 agent_sessions 字段钉子必须包含 `current_change_id`（口径同 11c4a5d51 已同步的姊妹守卫——2026-10-12-run-level-change-attribution 有意新增列）；
- `test_gate_shape_single_turn_completed_marks_ended` 与 `test_close_interactive_run_terminal_flip_publishes_status_changed` 的 seed 形态必须对齐 2fe772561（2026-10-13-multiturn-changeid-misjudge）确立的会话级判定锚：单轮任务形态必须把 change_id 落在 `AgentSession.change_id`（会话本身为 change 而建），不得再依赖已作废的 run 级锚语义；
- 实现文件 `_apply_session_terminal_status` 禁止改动（其行为是生产事故驱动的正确契约）。

#### 场景：字段钉子同步

- Given：AgentSession 模型字段集含 `current_change_id`（2026-10-12-run-level-change-attribution task-01）
- When：运行守卫用例 `test_agent_sessions_model_fields_unchanged`
- Then：expected 集合与 `AgentSession.model_fields` 完全相等，用例 PASS

#### 场景：单轮任务形态按新契约收口

- Given：seed 构造的会话 `session.change_id` 非空（会话级绑定 change 的单轮任务）且 run `spec_strategy="interactive"`
- When：`close_interactive_run(status="success")` 收口首 run
- Then：session 翻转为 `ended`（ended_at 落值）且 commit 后发布一条 `status_changed`；同文件多轮用例（change_id 缺省 None）行为保持不变

### FR-02: sillyhub-daemon 的 api-types.ts 必须与后端 OpenAPI 重新对齐

- 必须运行 `pnpm gen:types` 重生成 `sillyhub-daemon/src/api-types.ts`（补齐 daemon 机器日志/配置查看等已合入后端的端点类型）；
- 重生成后 `pnpm gen:types:check` 必须本地通过（生成幂等 + `git diff --exit-code`）。

#### 场景：类型重生成后检查门通过

- Given：后端 OpenAPI 已含 2026-10-13-daemon-log-config-view 端点而 api-types.ts 未更新
- When：运行 `pnpm gen:types` 后再运行 `pnpm gen:types:check`
- Then：check 门零 diff 退出码 0

### FR-03: frontend agent-replay-body 首用例必须等异步数据渲染完成后断言

- 失败用例（`主日志为正文：…`）在等待 mock 调用之后必须追加渲染完成锚等待（`turn-timeline-scroll` 挂载即 messages 数据渲染完成），禁止在 loading 态同步断言异步渲染内容；
- 该测试文件全部 16 用例必须本地转绿。

#### 场景：CI 慢机时序下断言不早于渲染

- Given：`readAgentLogMessages` mock 已 resolve 但 React 尚未提交渲染（CI 并行慢机形态）
- When：用例执行至累计用量/气泡断言
- Then：断言前已通过渲染锚 waitFor 等到 TurnTimeline 挂载，用例稳定 PASS

### FR-04: 本变更禁止改动任何生产代码

- 禁止触碰 `backend/app/`（含 `_apply_session_terminal_status` 等实现）、`frontend/src/` 非测试文件、`sillyhub-daemon/src/` 非生成物文件；
- 允许面仅限：测试文件对齐、`api-types.ts` 生成物重生成、SillySpec 治理工件。

#### 场景：交付面审查

- Given：flow done 冻结面采集 baseline..HEAD
- When：审查 diff 文件清单
- Then：清单仅含测试文件、api-types.ts 生成物与 .sillyspec 治理工件，零生产源文件

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/agent/tests/test_mission_session_id.py「test_agent_sessions_model_fields_unchanged」
FR-01: backend/app/modules/daemon/tests/test_run_sync_session_gate_failover.py「test_gate_shape_single_turn_completed_marks_ended」
FR-01: backend/app/modules/daemon/tests/test_session_events_cross.py「test_close_interactive_run_terminal_flip_publishes_status_changed」
FR-02: 不适用：独立一致性门——验证面为 sillyhub-daemon `pnpm gen:types:check`（gen-api-types.mjs 幂等重生成 + git diff --exit-code 自校验），无独立测试用例
FR-03: frontend/src/components/daemon/__tests__/agent-replay-body.test.tsx「主日志为正文：说明行 + 真人用户气泡 + 回复正文 + 视图切换；系统事件中性行仅「全部」视图可见」
FR-04: 不适用：负向约束面——由冻结面 diff 文件清单审查保证，非测试可判定
