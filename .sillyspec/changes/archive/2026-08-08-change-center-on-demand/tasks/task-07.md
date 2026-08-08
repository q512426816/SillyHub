---
id: task-07
title: advance_change_stage MCP tool
title_zh: advance_change_stage MCP 工具
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-06]
blocks: [task-11, task-15, task-16, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/mcp_gateway/tools.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/service.py
goal: >
  新增 advance_change_stage MCP tool：包装 ChangeService.transition_with_dispatch（:721）→ dispatch_next_step（:1626），team_mode=True 分流到 _dispatch_execute_team（:1130 建 team mission），single 分流到 AgentService.start_stage_dispatch。按需推进 change 阶层（FR-04/D-004）。
implementation:
  - 在 mcp_gateway/tools.py 注册 advance_change_stage tool
  - 入参：change_id, target_stage, provider?, model?, team_mode?
  - 调 ChangeService.transition_with_dispatch(change_id, target_stage, ...) 走 dispatch_next_step 分流
  - team_mode 下确认 _dispatch_execute_team 被 dispatch_next_step 触发（建 verify/archive team mission）
  - 返回 current_stage 推进结果 + 是否建 mission
acceptance:
  - tool 调用后 current_stage → target_stage，team 模式建对应 team mission
  - 不自动连轴（单步推进，只推进到 target_stage）
verify:
  - task-15 的 test_change_stage_tools.py 覆盖 advance_change_stage（single + team 分流）
  - 手测：调 tool 推进 execute→verify，确认 _dispatch_execute_team 建 team mission
constraints:
  - 只包装现有 service 方法，不新增 ChangeService 方法（design §6.1）
  - 不重新引入 auto_dispatch 语义（单步显式推进）
provides:
  - advance_change_stage MCP tool（按需推进 change 阶层，team 分流）
expects_from:
  task-06:
    - contract: transition_with_dispatch / dispatch_next_step / _dispatch_execute_team 保留可用，auto_dispatch_next_step 已删无残留
      needs: [ChangeService.transition_with_dispatch 签名, dispatch_next_step team 分流, _dispatch_execute_team 建 mission]
---

# task-07 实现笔记

FR-04/D-004。team 推进闭环关键节点（task-03 桥 + task-07 tool + task-16 测试）。tools.py 与 task-08/09/10 共文件，各注册不同 tool 函数。
