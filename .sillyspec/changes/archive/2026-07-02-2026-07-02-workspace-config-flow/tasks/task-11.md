---
id: task-11
title: daemon 缓存日常保鲜（操作前查 spec_version，D-010）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P1
depends_on: [task-10]
blocks: [task-16]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/interactive/
  - sillyhub-daemon/tests/test_spec_version_refresh.ts
---

## 目标
daemon 每次 agent/scan 任务执行前比对 lease latest_spec_version 与本地 platform.json.spec_version，不一致 pullSpecBundle（D-010）。

## 实现步骤
- task-runner/interactive 执行任务前：读本地 `.sillyspec-platform.json.spec_version`，与 lease payload 的 latest_spec_version 比；不一致 → pullSpecBundle → 更新本地 spec_version。
- 一致 → 跳过 pull。

## 验收标准
- A 重扫后 spec_version 递增；B 下次任务前比对到落后 → 自动 pull。
- 版本一致不重复 pull。

## 验证方式
`cd sillyhub-daemon && pnpm exec vitest run tests/test_spec_version_refresh.ts`。

## 约束
- 比对仅 daemon 侧（本地 vs lease payload），不需额外 backend 请求。
