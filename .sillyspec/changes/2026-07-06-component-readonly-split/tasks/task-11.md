---
id: task-11
title: frontend typecheck + vitest 零回归
author: qinyi
created_at: 2026-07-06 11:29:29
priority: P0
depends_on: [task-08, task-09, task-10]
blocks: []
requirement_ids: []
decision_ids: []
allowed_paths: []
goal: >
  W2 收尾验证：frontend 全量 typecheck 零错误 + vitest 零回归，确认 lib/page 切换无遗留类型破损或测试失败。
implementation:
  - 跑 `pnpm exec tsc --noEmit`，逐条修复 task-08/09/10 引入的类型错误
  - 跑 `pnpm vitest run`，更新 components/topology/create-change 相关测试用例（去除 relations/reparse 断言，新增 Component 只读断言）
  - 关注 markdown-text jsdom 渲染坑（memory frontend-markdown-text-jsdom-null）若涉及 components 页
acceptance:
  - `pnpm exec tsc --noEmit` 退出码 0
  - `pnpm vitest run` 全绿，无新增失败
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm vitest run
constraints:
  - 本任务不改产品代码逻辑，仅修测试与类型声明（验证任务）
  - 不为通过而删有价值的测试，改测试要对应需求变化（CLAUDE.md 规则8）
  - 若发现 task-08/09/10 遗漏，回退到对应 task 修，不在此堆补丁
---

