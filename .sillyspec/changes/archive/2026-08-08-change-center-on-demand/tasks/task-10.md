---
id: task-10
title: get_change_stage MCP tool read-only
title_zh: get_change_stage MCP 工具只读
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P1
depends_on: [task-06]
blocks: [task-15, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/mcp_gateway/tools.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/service.py
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/projection.py
goal: >
  新增 get_change_stage MCP tool：只读组合 ChangeService.get + stages JSON + StageProjectionService.compute_pending_review，替代 sillyspec.db 自动同步（FR-02/D-002）。
implementation:
  - 在 mcp_gateway/tools.py 注册 get_change_stage tool，入参 change_id
  - 调 ChangeService.get(change_id) 取 change 主体 + stages JSON
  - 调 StageProjectionService.compute_pending_review 算 pending_review
  - 组装返回 {change, current_stage, stages, pending_review}，无副作用
acceptance:
  - tool 返回完整阶段视图 + pending_review，不改任何状态
  - 替代 sillyspec.db 自动 RPC 同步（按需查）
verify:
  - task-15 的 test_change_stage_tools.py 覆盖 get_change_stage（含 pending_review 计算）
constraints:
  - 只读，不推进、不落库
  - 不依赖 sillyspec.db RPC（已被本 tool 替代）
provides:
  - get_change_stage MCP tool（按需只读阶段视图，替代 sillyspec.db 同步）
expects_from:
  task-06:
    - contract: ChangeService.get + complete_stage/transition_with_dispatch 保留可用，auto_dispatch 残留已清
      needs: [ChangeService.get 签名, stages JSON 结构]
---

# task-10 实现笔记

FR-02/D-002。解 R-03（状态滞后）——推进前显式 refresh。projection.py 提供 compute_pending_review。
