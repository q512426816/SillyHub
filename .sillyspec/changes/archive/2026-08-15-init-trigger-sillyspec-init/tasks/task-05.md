---
id: task-05
title: daemon handleInitLease 插入 init 步骤
title_zh: 编序改 6 步：writeDaemonState → pull → runSillyspecInit（硬失败）→ postSpecSync → writeLocalYaml；HandleInitLeaseParams 增 tools
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: [task-04]
blocks: [task-06, task-08]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-002@v2, D-003@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/test_init_lease.test.ts
  - sillyhub-daemon/tests/run-sillyspec-init.test.ts
goal: >
  handleInitLease 在 pullSpecBundle 成功之后、postSpecSync 之前调 runSillyspecInit（task-04 产物），失败（ok:false）→ 返回 { ok:false, error, daemonState, specDir } 不执行 postSpecSync/writeLocalYaml（对齐既有逐步 catch 范式）。HandleInitLeaseParams 增可选 tools?: string[]。文档注释同步更新（5 步→6 步描述）。
implementation:
  - HandleInitLeaseParams 加 `tools?: string[]`（注释：agent-detector 映射后 VALID_TOOLS 子集，缺省 runSillyspecInit 内兜底 ['claude']）
  - handleInitLease pull 成功分支后、postSpecSync 前插 runSillyspecInit 调用；失败 return 与 pull 失败同构（error 前缀透传）
  - init 结果（ok/版本号若有）console.info 记录
  - 步骤序号注释与函数 docstring 全面更新（6 步）
acceptance:
  - init 失败 → ok:false，postSpecSync 与 writeLocalYaml 不执行（单测断言调用序）
  - init 成功 → 后续步骤照常；最终 ok:true
  - tools 缺省（旧调用方/mock）→ 不抛错，runSillyspecInit 兜底
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/test_init_lease.test.ts
  - ⚠️ 时序说明：本 task 完成时该文件既有用例可能因全局 spawn mock 击穿 init 步骤而红（X-14 已知）——本 task 只需做最小适配（注入点 mock init 恒成功）让既有语义断言可跑，全面改写+新用例在 task-08。typecheck 必须本 task 全绿。
constraints:
  - 编序严格 pull→init→post→localYaml（D-002@v2：pull 整删重建，init 必须后置）
  - 对外返回结构（HandleInitLeaseResult）不变，仅 error 值域新增两前缀
---
