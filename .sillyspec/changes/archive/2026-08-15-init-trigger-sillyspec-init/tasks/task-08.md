---
id: task-08
title: daemon test_init_lease.test.ts 改写+新用例
title_zh: 适配全局 spawn mock 击穿问题（runSillyspecInit 依赖注入）+ 新增成功/失败/门控/顺序用例
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P1
depends_on: [task-04, task-05, task-06]
blocks: [task-10]
requirement_ids: [FR-01, FR-02, FR-03, FR-04]
decision_ids: [D-002@v2, D-003@v1]
allowed_paths:
  - sillyhub-daemon/tests/test_init_lease.test.ts
goal: >
  既有 test_init_lease.test.ts 全局 vi.mock('node:child_process') spawn 返 null，插入 init 步骤后既有成功用例必红（Grill X-14）。改写：init 步骤的 spawn 行为经 runSillyspecInit 的注入点 mock（成功退出码 0），保持既有用例语义不变；新增用例覆盖 init 成功 / init 失败 abort（post 与 localYaml 不调用）/ 版本门控 fail-fast / 6 步顺序 / tools 透传与兜底。
implementation:
  - 既有用例：注入 mock spawn runner 使 init 步骤恒成功（不影响其它步骤断言）
  - 新增用例组 A（失败语义）：init 退出码非 0 → handleInitLease ok:false 且 postSpecSync/writeLocalYaml 未调用；stats.init_error 前缀 sillyspec_init_failed
  - 新增用例组 B（门控）：版本 < MIN → error sillyspec_init_cli_too_old，spawn init 未发起
  - 新增用例组 C（顺序）：writeDaemonState → pull → init → post → localYaml 调用序断言
  - 新增用例组 D（tools）：注入 ['claude','codex'] 透传；undefined 兜底 claude
acceptance:
  - 全文件绿；既有 local.yaml / 状态文件行为断言不删不改语义
  - 新用例覆盖 4 组场景
verify:
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts
constraints:
  - 不为过测试改产品逻辑；mock 只作用于注入点（runSillyspecInit 参数），不全局替换 spawn
---
