---
id: task-05
title: sillyhub-daemon ensureAllowedRoot 自动放行 + 两路径调用 + 单测
author: WhaleFall
created_at: 2026-06-26T13:07:31
priority: P0
depends_on: []
blocks: [task-06]
allowed_paths:
  - sillyhub-daemon/src/workspace.ts
  - sillyhub-daemon/src/task-runner.ts
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/path-guard.ts
change: 2026-06-26-daemon-root-path-translation
---

# task-05

> goal: daemon 收到 backend 下发的宿主机 root_path 后，动态加入运行时 allowed_roots，无需用户改 config。

## implementation
- 新增 `ensureAllowedRoot(rootPath)`（建议 `path-guard.ts` 或 `workspace.ts`）：把 rootPath 加入进程内运行时白名单，覆盖 config 静态 allowed_roots；幂等
- `task-runner.ts:323` prepareWorkspace 前调用（batch）
- `daemon.ts:2114` interactive cwd 赋值前调用
- vitest 单测：动态追加 / config 静态不变 / 重复调用幂等

## acceptance
- 执行期运行时 allowed_roots 含本次 root_path
- config.json 静态 allowed_roots 不变
- 重复调用同一 root_path 幂等

## verify
- `cd sillyhub-daemon && pnpm test`
- 手动：daemon 执行 lease 时 F:/ 项目路径不被 allowed_roots 拦

## constraints
- config 静态 allowed_roots 不动作兜底（D-002）
- 运行时白名单仅进程内、不落盘（R-09 不泄漏）
- root_path 来源 backend 鉴权下发，视为可信
- D-003：batch + interactive 两路径都调用
