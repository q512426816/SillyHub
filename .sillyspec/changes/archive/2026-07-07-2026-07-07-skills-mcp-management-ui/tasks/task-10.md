---
author: qinyi
created_at: 2026-07-07 23:24:00
goal: frontend workspace 详情 skills/mcp tab
implementation: 在 workspace 详情页（frontend/src/app/(dashboard)/workspaces/[id]/）加 skills tab + mcp tab；skills tab 调 GET /api/workspaces/{id}/skills 列 workspace specDir 自定义 skills（只读）；mcp tab 调 GET /api/workspaces/{id}/mcp-config 读 .mcp.json（只读，env 遮蔽）
acceptance: workspace 详情多 2 tab；skills tab 列 workspace skills；mcp tab 展示 .mcp.json（env 遮蔽）；只读无编辑按钮；membership 校验（非成员不可见）
verify: cd frontend && pnpm test workspace 详情 tab 组件 + pnpm typecheck
constraints: 只读（D-006）；env 遮蔽（NFR-02）；复用 workspace 详情 layout
depends_on: [task-06]
covers: [FR-11, D-006]
---

# task-10: frontend workspace 详情 skills/mcp tab

## 验收标准
A. workspace 详情页新增 skills + mcp 两个 tab。
B. skills tab 调 task-06 端点列 workspace 自定义 skills（只读）。
C. mcp tab 调 task-06 端点展示 .mcp.json（env 遮蔽，只读）。
D. 非 workspace 成员不可见 tab（membership gating）。
