---
id: task-07
title: 全量验证 后端 pytest + ruff/mypy + 前端 lint + 手测
title_zh: 全量回归与验收验证
author: qinyi
created_at: 2026-08-09 13:18:35
priority: P0
depends_on: [task-01, task-02, task-03, task-04, task-05, task-06]
blocks: [task-08]
requirement_ids: [FR-01, FR-02, FR-03, FR-04, FR-05, FR-06, FR-07]
decision_ids: []
allowed_paths:
  - backend/app/core/config.py
goal: >
  汇总验证 task-01~06 的全部改动，跑三端测试与 lint，手测 fail-fast 与 localStorage 无密码。
implementation:
  - 后端 跑 auth 模块 pytest 含新增 task-04 单测
  - 后端 ruff check + ruff format check + mypy
  - 前端 eslint + tsc --noEmit（登录页改动无新增 error）
  - 全仓 rg --no-ignore --hidden admin123 仅剩 archive 与占位
  - 手测 .env 设 admin123 启动应 ValidationError + 登录后 DevTools 查 localStorage 无 password
acceptance:
  - 后端 auth 测试全过含新增弱口令单测 现有测试零回归（AC-05）
  - 后端 ruff/mypy 全过 前端 lint 无新增 error（AC-06）
  - rg --no-ignore --hidden admin123 仅剩 archive 与占位（AC-04）
  - 未配 bootstrap password 时行为不变（AC-07）
verify:
  - cd backend && uv run pytest app/modules/auth tests/modules/auth -q --no-cov
  - cd backend && uv run ruff check . && uv run ruff format --check . && uv run mypy app
  - cd frontend && pnpm lint
  - rg --no-ignore --hidden admin123
constraints:
  - 不改源码（验证 task 若发现失败 回对应 task 修 不在本 task 改）
  - 不跑 backend 全量 pytest（local.yaml test_strategy=module 按 git diff 命中模块跑）
  - 手测项记录到 verify 阶段证据
related_tests: []
---

# task-07 全量验证

详见 frontmatter。对照 plan 全局验收标准 AC-01~AC-07。
