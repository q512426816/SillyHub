---
id: task-08
title: submit_stage_review MCP tool
title_zh: submit_stage_review MCP 工具
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P0
depends_on: [task-06]
blocks: [task-15, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/mcp_gateway/tools.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/service.py
goal: >
  新增 submit_stage_review MCP tool：包装 review 四方法（change/service.py:1309+ proposal_review/plan_review/human_test/archive_confirm），按 stage 分发，decision 通过则调 rerun_stage/transition_with_dispatch 推进，打回则回退（FR-04/D-004）。
implementation:
  - 在 mcp_gateway/tools.py 注册 submit_stage_review tool
  - 入参：change_id, stage（proposal/plan/human_test/archive_confirm）, decision, comment?
  - 按 stage 路由到 service.py:1309+ 对应 review 方法
  - decision=approve → 调 transition_with_dispatch / rerun_stage 推进；decision=reject → 打回
  - 返回推进结果 + pending_review 状态
acceptance:
  - 四种 stage review 均可经 tool 提交并正确推进/打回
  - 不重新引入 auto_dispatch（单步审核）
verify:
  - task-15 的 test_change_stage_tools.py 覆盖 submit_stage_review 四分支
constraints:
  - 只包装现有 review 方法，不新增 service 方法
  - 与旧 approval_status 链路边界由 task-13 收敛
provides:
  - submit_stage_review MCP tool（四阶段审核统一入口）
expects_from:
  task-06:
    - contract: review 四方法（service.py:1309+）+ rerun_stage/transition_with_dispatch 保留可用
      needs: [proposal_review/plan_review/human_test/archive_confirm 签名]
---

# task-08 实现笔记

FR-04/D-004。收敛审核入口，配合 task-13 前端退役旧 approval_status 链路。
