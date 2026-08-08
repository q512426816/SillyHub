---
id: task-18
title: sync module docs
title_zh: 模块文档同步
author: qinyi
created_at: 2026-08-08 22:20:00
priority: P1
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06, task-07, task-08, task-09, task-10, task-11, task-12, task-13]
blocks: []
allowed_paths:
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/docs/backend/
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/docs/multi-agent-platform/
  - C:/Users/qinyi/IdeaProjects/multi-agent-platform/.sillyspec/docs/frontend/
goal: >
  同步 change / daemon / mcp_gateway 模块文档（_module-map + 卡片）与前端 change 模块文档：记录砍 auto_dispatch、6 调用点改造、4 change 阶层 tool、team 推进重写、HTTP 端点、前端按需触发的新行为。
implementation:
  - 更新 backend/_module-map：change（删 auto_dispatch_next_step，补 4 tool + 2 HTTP 端点）/ daemon（6 调用点新语义）/ mcp_gateway（4 change 阶层 tool）
  - 更新 multi-agent-platform 跨模块文档：stage 完成由 auto_dispatch 改为按需触发（MCP/HTTP），gate 软调用，sillyspec.db 同步废弃
  - 更新 frontend change 模块文档：handleDispatch 接 HTTP、审核链路收敛
  - 标注 D-001~008 决策落点与 R-01~07 应对
acceptance:
  - 三模块 _module-map + 卡片反映新行为，无残留 auto_dispatch 自动连轴描述
  - 文档与 task-01~13 实现一致
verify:
  - 人工对照 task-01~13 验收点核对文档
  - grep -rn "auto_dispatch" .sillyspec/docs/（仅历史/废弃说明，无“当前自动连轴”描述）
constraints:
  - 只改 .sillyspec/docs/，不改 plan.md/design.md（本次不改规格）
  - UI/文档中文（CLAUDE.md 第 12 条）
provides:
  - change/daemon/mcp_gateway/前端 change 模块文档同步
expects_from: {}
---

# task-18 实现笔记

文档收尾，依赖全部实现 task（01~13），不依赖测试 task（14~17）——文档描述实现行为，不随测试变动。
