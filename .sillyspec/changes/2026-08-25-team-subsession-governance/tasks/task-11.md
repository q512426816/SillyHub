---
id: task-11
title: 'control 治理口径（cancel 名单扩子会话 + can_dispatch_worker 混跑口径 + cost_from_runs union）'
title_zh: 'control 治理口径（cancel 名单扩子会话 + can_dispatch_worker 混跑口径 + cost_from_runs union）'
author: 'qinyi'
created_at: 2026-08-25 20:57:40
priority: P0
depends_on: ['task-08']
blocks: []
requirement_ids: [FR-07]
decision_ids: [D-002@v1, D-004@v1]
allowed_paths:
  - backend/app/modules/agent/control.py
  - backend/app/modules/agent/tests/test_worker_subsession_control.py
  - backend/app/modules/agent/tests/test_control_orchestrator_exclusion.py
expects_from:
  - 'task-08 is_worker_complete(session) 单一真相源——完成=worker_done_at 非空且无活跃 turn、终结=会话终态 failed/ended、存量 batch run=run 终态；can_dispatch_worker 并发计数与 cancel 名单的子会话维度判据统一走它，禁 control.py 另写判定'
  - 'task-01 mission_worker_sessions(mission_id) 一层枚举分身子会话——cancel kill 名单与成本 union 的子会话来源'
provides:
  - 'can_dispatch_worker 混跑并发口径——计数=存量 running 分身 run 数 + 未完成子会话数（is_worker_complete=False 且会话非终态）合计对 MAX_WORKERS，供 mcp_tools 治理门与 orchestrator 信号消费'
  - 'cost_from_runs union 口径——cost_so_far 输入扩为 mission 分身 run ∪ 分身子会话轮次 run（agent_session_id ∈ mission_worker_sessions），治理门预算拦截覆盖追问轮成本'
related_tests:
  - backend/app/modules/agent/tests/test_control_orchestrator_exclusion.py
goal: >
  MissionControlService 治理三口径换子会话新形态——cancel kill 名单扩分身子会话
  （统一走 cancel_lease 含 SESSION_END 的 P0-2 链，不重造）、can_dispatch_worker
  并发计数改「存量 running run + 未完成子会话」混跑口径、cost_so_far/cost_from_runs
  输入 union 分身子会话轮次 run（预算治理门覆盖追问轮成本）（FR-07 / design §5.C.6 / §5.D）。
implementation:
  - 'cancel——kill 名单=non_orchestrator_runs 活跃 run（既有）∪ mission_worker_sessions 活跃子会话；子会话按其活跃轮 run（无活跃轮取首 run，agent_session_id 已挂子会话）调 lease_svc.cancel_lease，命中 P0-2 修好的 _lookup_interactive_lease_by_run 回捞链（run.agent_session_id → AgentSession.lease_id）发 SESSION_END，存量 batch run 路径不变'
  - 'running_worker_count 扩混跑计数——存量 running 分身 run + is_worker_complete(子会话)=False 且会话非终态的子会话数合计；can_dispatch_worker 的 max_workers 判定吃新计数（mission_cancelled / budget_exceeded 判定不动）；active_worker_count 同步扩（pending 子会话也计入，防 cancel 漏杀）'
  - 'cost_so_far 输入 union——non_orchestrator_runs 结果 ∪ 分身子会话轮次 run（按 agent_session_id ∈ mission_worker_sessions 查 AgentRun）；cost_from_runs 静态求和公式不动（口径=传入 runs 本身），union 组装在 cost_so_far 内完成'
  - '新增 test_worker_subsession_control.py——混跑计数（run+子会话并存）、union 成本（追问轮 run 计入 budget_exceeded 拦截）、cancel 名单含子会话且走 cancel_lease（SESSION_END 下发、lease cancelled、子会话 ended）、无子会话回落现行为'
  - 'test_control_orchestrator_exclusion.py 随新口径失效的断言在本卡更新（计数口径相关）；其余既有断言（主控轮排除/存量回落）必须全绿，更大范围回归归 task-15'
acceptance:
  - '混跑 mission 并发与预算正确——追问轮 run 成本计入预算拦截、未完成子会话占并发额度'
  - 'cancel 后分身 run killed + 子会话 ended + lease cancelled + SESSION_END 下发，daemon 无僵尸'
  - '存量 mission（无子会话）三口径逐字节不变——test_control_orchestrator_exclusion 存量断言全绿'
  - '主控轮（role=orchestrator）仍不占并发额度、不计分身成本、不进 kill 名单'
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_worker_subsession_control.py app/modules/agent/tests/test_control_orchestrator_exclusion.py -q --no-cov
  - cd backend && uv run pytest app/modules/agent -q --no-cov -n auto
  - cd backend && uv run ruff check app/modules/agent/control.py && uv run mypy app/modules/agent/control.py
constraints:
  - 'cancel 复用 P0-2 cancel_lease SESSION_END 链，禁止重造 kill 逻辑或直接翻会话/lease 状态'
  - '子会话完成判定唯一入口 is_worker_complete（task-08），枚举唯一入口 mission_worker_sessions（task-01），禁 control.py 自写判据'
  - '存量 batch 分身双判据零回归——无子会话 mission 所有口径回落现行为（FR-09）'
  - 'test_control_orchestrator_exclusion 断言更新限于新口径直接失效项并在本卡完成（该路径已进 allowed_paths），其余既有测试回归归 task-15——禁两边都不管'
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
