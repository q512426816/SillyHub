---
id: task-15
title: change-stage MCP tool tests
title_zh: change 阶层 4 tool 测试
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-07, task-08, task-09, task-10]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py
goal: >
  新建 test_change_stage_tools.py，覆盖 4 个 change 阶层 MCP tool（advance_change_stage / submit_stage_review / run_verify_gate / get_change_stage）的主路径与分支（FR-04）。
implementation:
  - advance_change_stage：single 分流 + team 分流（_dispatch_execute_team 建 mission）+ 单步不连轴
  - submit_stage_review：proposal/plan/human_test/archive_confirm 四分支 approve/reject
  - run_verify_gate：source=gate_result / gate_cmd / unavailable 三分支 + 不阻塞
  - get_change_stage：返回 change + stages + pending_review，无副作用
  - mock ChangeService / StageProjectionService / HostFsDelegate 边界
acceptance:
  - 4 tool 主路径 + 关键分支全覆盖，全部通过
  - team 分流用例确认 _dispatch_execute_team 被触发
verify:
  - pytest backend/app/modules/mcp_gateway/tests/test_change_stage_tools.py
constraints:
  - 不调真实 sillyspec gate 子命令（mock HostFsDelegate）
  - 与 task-16 的 team 重写测试不重复（本 task 只测 tool 层）
provides:
  - 4 change 阶层 tool 的测试覆盖
expects_from:
  task-07:
    - contract: advance_change_stage tool 已实现（single + team 分流）
      needs: [tool 入参/返回契约]
  task-08:
    - contract: submit_stage_review tool 已实现（四 stage）
      needs: [tool 入参/返回契约]
  task-09:
    - contract: run_verify_gate tool 已实现（三 source）
      needs: [tool 入参/返回契约]
  task-10:
    - contract: get_change_stage tool 已实现（只读）
      needs: [tool 入参/返回契约]
---

# task-15 实现笔记

FR-04。新文件 test_change_stage_tools.py。team 推进闭环的 tool 层验证，与 task-16（daemon 侧 team 桥）互补。
