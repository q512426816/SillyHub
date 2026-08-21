---
id: task-06
title: 'converge semantics redefine——busy guidance + standalone converged_at + latest orchestrator-run anchor'
title_zh: 'converge 语义重定义——busy 引导 + converged_at 独立置位 + _get_main_run/finalizer 锚点取最新 orchestrator run'
author: 'qinyi'
created_at: 2026-08-22 03:35:53
priority: P0
depends_on: [task-04, task-05]
blocks: [task-08, task-14]
requirement_ids: [FR-04]
decision_ids: [D-010@v1]
allowed_paths:
  - backend/app/modules/agent/mcp_tools.py
  - backend/app/modules/agent/finalizer.py
  - backend/app/modules/agent/tests/test_mcp_tools.py
expects_from:
  task-05: [{contract: SESSION_SCOPED_MISSION_RESOLUTION, needs: [X-Session-Id 解析活跃 mission]}]
provides:
  - contract: CONVERGE_SEMANTICS
    fields: [converge 终态置位入口]
    note: converge_mission 全终态置位入口（converged_at 抢占 UPDATE + finalize 链路）——task-08 patrol awaiting_input 超时自动收敛复用此入口；busy/conflict/needs_manual 响应语义随附
goal: >
  converge_mission 语义重定义（D-010）——按 X-Session-Id 解析 mission；分身未全终态返 busy 引导等待；全终态
  独立置位 converged_at（不依赖主控 run 状态）；finalize/_get_main_run 锚点改取该 mission 最新 role='orchestrator' run（design §5/§7.5）。
implementation:
  - _get_main_run（mcp_tools.py:363-374）order_by 改 created_at desc——取该 mission 最新 role='orchestrator' run，存量 external mission 单主控 run 同规则命中零回归
  - converge_mission（mcp_tools.py:588-705）接入会话解析；分身 run（role!='orchestrator'）未全终态 → 返 status=busy+引导文案，mission 状态不变、不触发 finalize/merge
  - 分身全终态 → 原子置位 converged_at（保留 UPDATE WHERE IS NULL 抢占语义，不依赖主控 run 状态）→ converge_mission_for_completed_run 收敛，锚点=最新 orchestrator run
  - ConvergeResponse.status 取值收敛为 converged/busy/conflict/needs_manual（design §7），既有 merged/failed_manual 分别并入 converged/needs_manual；conflict 可重入状态机（attempt 计数/超限）语义保留
  - finalizer.py 锚点适配——_carrier_run（:112-120）与 converge_mission_for_completed_run（:545-578）main_run 锚点统一改取最新 orchestrator run（兼容存量）
  - 适配 test_mcp_tools.py TestConvergeMission 既有断言并补 busy/置位/锚点新用例
acceptance:
  - 分身未全终态 converge 返回 status=busy 且 mission 状态不变（不置 converged_at）
  - 分身全终态置位 converged_at，不依赖主控 run 状态
  - _get_main_run/finalizer 锚点取该 mission 最新 role='orchestrator' run，存量 external mission 同规则命中
  - 响应 status 取值含 converged/busy/conflict/needs_manual
  - test_mcp_tools.py 既有 converge 用例断言适配后全绿
related_tests:
  - backend/app/modules/agent/tests/test_mcp_tools.py（test_converge_running_when_worker_pending 断言 status=running 需改 busy；test_converge_all_completed 断言 status=done/converged 需随新响应语义适配）
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 与 task-05 同文件分 Wave——在 task-05 完成后动 converge/_get_main_run/响应 schema 段
  - bootstrap/execute 双路径 artifact 回灌与 conflict 可重入语义不回退；complete_lease 自动收敛（存量 external）不回归
  - derive_status 矩阵归 task-02、patrol awaiting_input 超时收敛归 task-08，本卡不越界
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
