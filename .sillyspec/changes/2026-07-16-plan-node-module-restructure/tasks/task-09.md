---
id: task-09
title: "前端测试 + 部署 — vitest + tsc + pnpm lint 过；rebuild frontend+backend Docker；浏览器验收；前置归档 plan-node-subtable-style"
title_zh: 前端测试与部署：跑测试、重建 Docker、浏览器验收、前置归档上游变更
author: WhaleFall
created_at: 2026-07-16 12:25:00
priority: P1
depends_on: [task-06, task-07, task-08]
blocks: []
requirement_ids: [FR-005, FR-006]
decision_ids: []
allowed_paths:
  - frontend/src/app/(dashboard)/ppm/plan-nodes/page.tsx
goal: >
  跑前端测试/lint/tsc 通过，rebuild 前后端 Docker 部署，浏览器验收二层/三层/antd 表单/归属校验且 milestone-details 不回归。
implementation:
  - 前置：先归档 2026-07-16-plan-node-subtable-style（R-05，避免两变更都改 plan-nodes/page.tsx 冲突）。
  - 跑 vitest（如有 plan-nodes 相关测试）+ tsc --noEmit + pnpm lint。
  - rebuild frontend + backend Docker 镜像并部署。
  - 浏览器验收：无模块二层、有模块三层、明细行内编辑保存、antd 表单、module_id 归属违例被拒。
  - 回归验收：milestone-details 页模块 CRUD 行为不变。
acceptance:
  - vitest / tsc --noEmit / pnpm lint 全过。
  - Docker 部署成功，前后端可访问。
  - 浏览器验收清单全部通过。
  - milestone-details 零回归。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm lint
  - cd frontend && pnpm test（若存在）
  - docker compose build --no-cache frontend backend && docker compose up -d
constraints:
  - 必须先归档 plan-node-subtable-style（R-05），否则 page.tsx 冲突。
  - 部署遵循跨平台（Windows/Linux/macOS，CLAUDE.md 规则 13）。
  - 不跳过任何失败的测试/lint。
expects_from:
  - task-07: 页面重写
  - task-08: Drawer antd 化
  - plan-node-subtable-style（前置归档）
---

plan.md task-09：见 design §10 R-05、§9（兼容/回退）。本 task 为 W2 收尾验收与部署。
