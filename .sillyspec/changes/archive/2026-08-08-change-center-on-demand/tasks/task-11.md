---
id: task-11
title: change-stage HTTP endpoints
title_zh: change 阶层 HTTP 端点
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P1
depends_on: [task-07, task-09]
blocks: [task-12, task-18]
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/backend/app/modules/change/router.py
goal: >
  补 change 阶层 HTTP 端点：POST /changes/{id}/advance-stage + POST /changes/{id}/run-verify-gate，与 task-07/09 的 MCP tool 共用同一 service 方法，前端走 HTTP（FR-06/D-005）。
implementation:
  - 在 change/router.py 加 POST /changes/{id}/advance-stage（body: target_stage, provider?, model?, team_mode?）→ 调 transition_with_dispatch（同 task-07 tool）
  - 加 POST /changes/{id}/run-verify-gate → 调 task-09 同款 gate_result/gate cmd 软调用逻辑
  - 复用 task-07/09 已暴露的 service 调用路径（不重复实现）
  - 鉴权/校验沿用既有 change router 中间件
acceptance:
  - 两端点可被前端 HTTP 调用，行为与对应 MCP tool 一致
  - advance-stage 单步推进、run-verify-gate 不阻塞
verify:
  - pytest backend/app/modules/change/tests/test_router.py（补两端点用例）
  - 手测：前端调 advance-stage 推进、run-verify-gate 返回 source
constraints:
  - 与 MCP tool 共 service 方法，不另起实现（design §6.3）
  - review gate 既有端点保留
provides:
  - POST /changes/{id}/advance-stage + /run-verify-gate 端点
expects_from:
  task-07:
    - contract: advance_change_stage 走 transition_with_dispatch 路径已就绪，HTTP 端点可复用同一 service 调用
      needs: [transition_with_dispatch 调用契约]
  task-09:
    - contract: run_verify_gate 的 gate_result/gate cmd 软调用逻辑已就绪，HTTP 端点可复用
      needs: [gate 软调用读取路径]
---

# task-11 实现笔记

FR-06/D-005。前端 D-005 选 HTTP（非直连 MCP），本端点是前端唯一入口。
