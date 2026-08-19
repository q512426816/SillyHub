---
id: task-16
title: verify-zero-regression-and-update-docs
title_zh: 零回归验证与文档更新
author: qinyi
created_at: 2026-08-19 10:50:00
priority: P0
depends_on: [task-08, task-09, task-10, task-11, task-12, task-15]
blocks: []
requirement_ids: [FR-04, FR-05]
decision_ids: [D-009@v1, D-010@v1]
allowed_paths:
  - backend/app/modules/agent/tests/test_integration_cross_workspace.py
  - backend/app/modules/agent/tests/test_mcp_tools_cross_workspace.py
  - sillyhub-daemon/tests/mcp-server.test.ts
  - frontend/src/app/(dashboard)/projects/[id]/missions/__tests__/missions-page.test.tsx
  - .sillyspec/docs/multi-agent-platform/modules/backend.md
  - .sillyspec/docs/multi-agent-platform/modules/frontend.md
  - .sillyspec/docs/multi-agent-platform/modules/sillyhub-daemon.md
  - .sillyspec/changes/2026-08-19-cross-workspace-team-mission/module-impact.md
provides:
  - contract: zero-regression-evidence
    fields: [single_ws_pass, cross_ws_pass, mcp_both_channels_pass]
expects_from:
  task-08:
    - contract: mcp_scope_validation
      needs: [target_workspace_id, scope_workspace_ids]
  task-09:
    - contract: mcp_gateway_target
      needs: [target_workspace_id, scope_validation]
  task-11:
    - contract: finalizer_merge_grouping
      needs: [target_workspace_id, workspace_grouping]
  task-12:
    - contract: cleanup-grouping
      needs: [group_by_target_workspace]
  task-15:
    - contract: project-mission-ui
      needs: [scope_selector, anchor_selector]
goal: >
  单 workspace mission 全链路零回归验证 + 跨工作区派发端到端冒烟测试 + 后端/前端/daemon 全量测试跑绿 + 模块文档更新，确保交付质量（design §10 验收 1-10）。
implementation:
  - 写单 ws mission 集成测试：创建/派发/收敛/MCP 工具全流程，断言 workspace_id = anchor 且 target_workspace_id 未传时行为不变
  - 写跨 ws mission 冒烟测试：创建跨两个工作区的 mission，断言 scope 校验 / dispatch_worker target ∈ scope 放行 / merge 分组成功 / cleanup 分组成功
  - 跑 backend 全量 pytest：uv run pytest，确认全绿（排除预存债）
  - 跑 daemon vitest：cd sillyhub-daemon && pnpm test，确认 mcp-server.ts schema 透传通过
  - 跑 frontend vitest：pnpm test，确认页面组件与类型无报错
  - 更新模块卡：backend.md / frontend.md / sillyhub-daemon.md 补充跨工作区团队执行能力描述
  - 更新 module-impact.md：记录本次变更对各模块的影响面（新增端点/改造字段/前端页面）
acceptance:
  - 单 ws mission 集成测试通过，所有既有行为保持不变（验收 1）
  - 跨 ws mission 冒烟测试通过，worker 派发到目标工作区且 merge/cleanup 分组正确（验收 3/5）
  - backend pytest 统计 passed ≥ X（基于当前基线，无新增失败）
  - daemon vitest 通过（dispatch_worker schema 新参透传）
  - frontend vitest + tsc 无报错
  - 模块卡文档已更新，含 project 维度会话与 scope 概念
verify:
  - cd backend && uv run pytest app/modules/agent/tests/test_integration_cross_workspace.py -v
  - cd backend && uv run pytest（全量）
  - cd sillyhub-daemon && pnpm test
  - cd frontend && pnpm test && pnpm exec tsc --noEmit
constraints:
  - 必须在所有实现 task 完成后执行，依赖完整链路
  - 集成测试可能需要 mock PPM 项目关联数据，或复用现有 fixture
  - 模块卡更新须与实际实现一致，不遗漏新增端点/字段
  - 如测试暴露本次改动无关的预存债，记录但不修复（避免范围蔓延），仅修本次引入的问题
---
