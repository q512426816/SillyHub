---
author: flow-machine-draft
created_at: 2026-10-16T01:42:05.703Z
---
# 需求规格（Requirements）— 2026-10-16-session-run-status-realtime

## 功能需求

### FR-01: 列表端点每会话注入 current_run_status（活跃 run 最新一条的状态：pending/running/pending_approval；无活跃 run 为 null），照 owner_name IN 批查先例零 N+1

- GET /api/daemon/sessions 列表项必须携带 current_run_status（每会话 created_at 最新一条活跃 run 的状态，窗口函数取最新防 NULLS FIRST 挑错行；无活跃 run 为 null），注入必须走 IN 批查（一次 SQL，禁止 N+1）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-02: 前端判定优先级：终态红/绿不变；run=pending_approval 优先显示琥珀在等你；run=pending/running 优先转圈；其后活性 working/blocked 兜底（本地会话）；再 reconnecting 转圈；idle+完成标记绿点；其余留白

- sessionStatusIndicator 必须按优先级判定：failed/ended 终态红/绿最优先；其后 run=pending_approval → 琥珀「在等你」、run=pending/running → 转圈「正在执行」（run 权威压过活性 working）；再活性 working/blocked 兜底；再 reconnecting 转圈；idle+完成标记绿点；其余禁止渲染任何标识。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-03: 完成通知新增 run 完成触发源：current_run_status 从活跃变 null 且会话非终态且不在该会话上 → 标记完成（与活性转移、终态两来源共键）

- 面板必须检测 current_run_status 由活跃（非 null）变 null 且会话非终态且当前不选中该会话 → 写完成通知标记；run 来源与活性转移、终态来源共用同一键同一角标；正选中该会话时必须跳过（suppress 口径）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-04: schema 变更同步再生前端与 daemon 两处 api-types 并提交 openapi.json

- AgentSessionRead 增加 current_run_status 后必须在同一变更内再生 frontend/src/lib/api-types.ts 与 sillyhub-daemon/src/api-types.ts 并提交 backend/openapi.json（规则 21 daemon 同款义务）。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

### FR-05: 后端列表注入测试 + 前端判定测试全过，lint/tsc 零告警

- 改动涉及的测试必须全部通过（后端 6 用例 + 前端面板 118 + 关联 136），改动文件 ESLint/tsc 零告警。

#### 场景：主路径

（按需保留或改写：Given 前提 / When 触发 / Then 可判定预期——每边界情形一个场景块，归档索引用场景名作摘要）

## 测试绑定（每条 FR 至少一行——`FR-NN: test/路径「用例名」`；空行/待填在 flow done 拒收）

FR-01: backend/app/modules/daemon/tests/test_sessions_list_run_status.py「active_run_status_injected」「latest_active_run_wins_when_multiple」「terminal_run_yields_null」「no_run_at_all_yields_null」
FR-02: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run=running → 转圈」「run=pending → 转圈」「run=pending_approval → 琥珀点——run 权威压过活性 working」「run 活跃时留白规则不变」
FR-03: frontend/src/components/sessions/__tests__/session-list-panel.test.tsx「run 活跃→null（run 终态收敛…）→ 完成角标出现」「run 活跃→null 但正选中该会话 → 不标记」
FR-04: backend/app/modules/daemon/tests/test_sessions_list_run_status.py「openapi_exposes_current_run_status」+ 两处 api-types.ts 生成物 diff
FR-05: pytest test_sessions_list_run_status.py（6 passed）+ vitest session-list-panel（118）+ portal/page/liveness（136）+ ruff/tsc/next lint 全绿
