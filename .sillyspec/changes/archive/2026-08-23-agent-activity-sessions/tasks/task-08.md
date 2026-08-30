---
id: task-08
title: 'regression-e2e'
title_zh: '三仓回归 + 部署 + 端到端实证'
author: qinyi
created_at: 2026-08-23 14:13:00
priority: P0
depends_on: [task-01, task-02, task-07]
blocks: []
repo: main
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07, FR-08, FR-09]
decision_ids: []
allowed_paths:
  - .sillyspec/changes/2026-08-23-agent-activity-sessions/runtime-evidence.md
goal: >
  三仓全量回归 + Docker 部署（backend/frontend 镜像重建 + daemon 侧由部署链路更新）
  + 真实链路端到端六项实证（plan 全局验收标准 2），留档 runtime-evidence.md。
implementation:
  - sillyspec 仓 node --test 全量；daemon 仓 pnpm test/typecheck；本仓 backend pytest 全量 + ruff/mypy、frontend vitest/tsc/lint、gen:types 幂等
  - 迁移打部署库 → 镜像重建 up -d → 实证六项（带 --change 直跑/无 ctx 直跑/daemon 会话内关联/变更不串台/旧条目消失/内容查看两态）
  - 浏览器或 API 层逐项留证（截图或 JSON 输出）
acceptance:
  - 三仓全绿零回归；六项实证全过留证
verify:
  - 按各仓命令 + curl/浏览器验证记录
constraints:
  - 敏感值不入提交产物；并行会话文件不碰（显式 pathspec）
---

# task-08 补充说明
无。
