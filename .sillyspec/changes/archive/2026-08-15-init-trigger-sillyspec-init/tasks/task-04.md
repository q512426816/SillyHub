---
id: task-04
title: daemon runSillyspecInit（版本门控+spawn+超时杀树）
title_zh: spec-sync.ts 新增 runSillyspecInit：MIN_SILLYSPEC_VERSION_FOR_INIT 门控 + spawn sillyspec init + 60s 超时杀树 + 退出码映射
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: [task-01, task-02, task-03]
blocks: [task-05, task-08]
requirement_ids: [FR-01, FR-02, FR-03]
decision_ids: [D-001@v1, D-004@v1, D-006@v1, D-009@v1]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/run-sillyspec-init.test.ts
goal: >
  spec-sync.ts 新增导出函数 runSillyspecInit(params)：步骤0 版本门控（spawn 'sillyspec --version' shell:true，3s 超时，semver 比较 < MIN_SILLYSPEC_VERSION_FOR_INIT 常量 → { ok:false, error:'sillyspec_init_cli_too_old: ...中文升级指引' }）；步骤1 spawn init（shell:true + 60s 超时杀树范式对齐 preflight runWithTreeKill，Windows 兼容），flag：--dir rootPath --spec-dir specCacheRoot --workspace-id wsId --no-skills --tool tools.join(',')；退出码 0 → ok:true，非0/超时/spawn 失败 → ok:false + error 前缀 sillyspec_init_failed:。
implementation:
  - spec-sync.ts 顶部 export const MIN_SILLYSPEC_VERSION_FOR_INIT = 'x.y.z'（占位，task-10 集成时定 Wave1 发版实际版本号）
  - semver 比较：split('.') 数字段比较，容忍 'v' 前缀与尾缀（如 3.26.7）；解析失败按门控不过处理（fail-safe）
  - spawn 超时杀树：AbortController + 超时后 Windows taskkill /PID /T /F、POSIX 进程组 kill(-pid)（preflight.ts:352-400 范式在 spec-sync 侧实现，不 import 未导出的私有函数）
  - stdout/stderr 收集截断进 error 信息（便于排查）
  - tools 数组为空 → 兜底 ['claude']（D-005）
  - 纯函数 + 依赖注入：spawn 实现经参数可选注入（默认用 node:child_process），供 task-08 单测 mock
acceptance:
  - 版本过低 → ok:false 且 error 含 sillyspec_init_cli_too_old 与升级指引
  - 退出码 0 → ok:true；非 0 → error 前缀 sillyspec_init_failed:
  - 超时（>60s）→ 杀树且 ok:false
  - spawn 参数组装含全部 5 类 flag（--dir/--spec-dir/--workspace-id/--no-skills/--tool 逗号连接）
verify:
  - cd sillyhub-daemon && pnpm typecheck
  - cd sillyhub-daemon && pnpm exec vitest run tests/run-sillyspec-init.test.ts
constraints:
  - shell:true spawn（bare name 在 Windows 必 ENOENT，X-06）
  - 不 import sillyspec 内部模块（D-001@v1）；不走 gate verify 白名单机制（不放开通用命令执行）
---
