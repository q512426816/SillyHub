---
id: task-07
title: daemon pnpm bundle 重建（credential-injector.ts + 新 helper 改了 src/，dist 需重打；随后 backend 镜像 rebuild 才能让 daemon bundle 进生产）
title_zh: daemon bundle 重建
priority: P1
depends_on: [task-05, task-06]
blocks: []
requirement_ids: [NFR-04]
decision_ids: []
created_at: 2026-07-27 09:47:54
author: qinyi
allowed_paths:
  - sillyhub-daemon/dist/
  - sillyhub-daemon/package.json
goal: >
  重打 daemon dist bundle，让 task-05/06 的 src 改动进生产镜像
implementation: |
  - bundle 前必先确认 task-05（credential-injector.ts toEnv 合并 settings_config.env）与 task-06（新建 claude-settings.ts helper + 挂 task-runner.ts:548 / daemon.ts:2906）src 已落地
  - `cd sillyhub-daemon && pnpm typecheck` 先过（tsc --noEmit），再 `cd sillyhub-daemon && pnpm bundle`（= bash scripts/build-bundle.sh，ncc 单文件打包）
  - 确认 dist 产物含新代码（credential-injector toEnv 合并逻辑 + 新 claude-settings helper）
  - 部署侧联动：backend 镜像需 rebuild，daemon bundle 随 backend 镜像分发（不走 daemon self-update 直传）
acceptance: |
  - pnpm typecheck 零错误（tsc --noEmit）
  - pnpm bundle 成功无 tsc 错误、无 ncc 报错
  - dist 产物含 credential-injector + claude-settings 新代码（grep dist 验关键符号）
  - backend 镜像 rebuild 计入部署清单（漏 rebuild → 生产 daemon 跑旧 bundle，AC-05 假阴性）
verify: |
  - `cd sillyhub-daemon && pnpm typecheck`
  - `cd sillyhub-daemon && pnpm bundle`
constraints: |
  - bundle 前必先 task-05/06 落地 + typecheck 过
  - 若 pnpm bundle 报 Cannot find module → `pnpm install --force` 重下（memory: daemon-bundle-tsc-module-not-found，.pnpm 真实包目录空）
  - 漏 backend rebuild → 生产 daemon 跑旧 bundle 致 AC-05 假阴性（settings_config 不生效）
  - daemon 按 backend manifest 对齐 bundle（升降级都需重启，memory: daemon-self-update-downgrades-manual-bundle）
