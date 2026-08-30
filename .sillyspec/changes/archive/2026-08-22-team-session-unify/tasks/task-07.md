---
id: task-07
title: exclude-orchestrator-runs-from-mission-control-queries
title_zh: 治理门/workers/成本查询加 role 非 orchestrator 判别（control.py）
author: qinyi
created_at: 2026-08-22 03:35:53
priority: P1
depends_on: []
blocks: []
requirement_ids: [FR-01, FR-08]
decision_ids: [D-007@v2]
allowed_paths:
  - backend/app/modules/agent/control.py
  - backend/app/modules/agent/tests/test_control_orchestrator_exclusion.py
goal: >
  主控轮 run（role='orchestrator'）回填 mission_id 后不计入 MAX_WORKERS=5 并发额度、
  分身成本与 workers 列表（design §5 核心机制 D-009，审查 B3）——control.py 的 mission
  维度 run 查询收窄为仅分身 run，规则对存量 external mission 同步统一生效（R-08）。
implementation:
  - control.py worker_runs 查询条件从 mission_id 等值收窄为 mission_id 等值且 role 非 orchestrator——注意 AgentRun.role 可空（model.py role 为 nullable String(30)），须用 is_distinct_from 或 or_(role!='orchestrator', role IS NULL)，防 NULL role 的存量分身 run 被 SQL 三值逻辑误排除
  - 单点收窄即覆盖 running_worker_count（MAX_WORKERS 治理门）、cost_so_far/cost_from_runs（成本）、worker_runs（workers 列表）与 cancel 的 kill 对象（主控轮非分身，语义一致，design §7.5 叫停行为不变）
  - 不改 delegation.py MAX_WORKERS 常量与治理规则本身（design §3 非目标——规则复用仅加判别）
acceptance:
  - mission 下存在 role 为 orchestrator 的主控轮 run（含 running 态）时，can_dispatch_worker 仍按仅分身计数判定并发，不误报 max_workers_reached
  - cost_so_far 与 workers 列表仅累计/返回 role 非 orchestrator 的分身 run；存量 external mission 主控 run 规则同步统一（R-08）
  - NULL role 的普通分身 run 不受影响（治理门/成本/workers 均仍计入），既有 agent 模块测试全绿
verify:
  - cd backend && uv run pytest app/modules/agent -q --no-cov --deselect app/modules/agent/tests/test_dispatch_metadata.py::test_build_claim_payload_propagates_bundle_fields --deselect app/modules/agent/tests/test_execution_context.py::test_get_execution_context_task_run
constraints:
  - 仅改 control.py 查询判别；不动 dispatch 链路/worktree/scope 校验/预算扣减逻辑（design §3 非目标）
  - mcp_tools.py 的 list_workers 端点与 _get_main_run 锚点不在本任务范围（属 task-05/06 消费链路）
  - 主控轮双标记回填属 task-04，本任务只需保证判别条件就绪可先行合入
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
