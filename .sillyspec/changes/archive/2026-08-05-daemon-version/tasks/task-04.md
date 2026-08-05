---
id: task-04
title: "Switch build-bundle.sh to gen-build-id.mjs (single source for BUILD_ID)"
title_zh: "build-bundle.sh 改用 gen-build-id.mjs（替换 :29-39 printf，源头单一）"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on: [task-01]
blocks: [task-06, task-11]
requirement_ids: [FR-02]
decision_ids: [D-002@v1]
allowed_paths:
  - sillyhub-daemon/scripts/build-bundle.sh
expects_from:
  task-01:
    - scripts/gen-build-id.mjs 已落地（node ESM，写 src/build-id.ts，签名 export const BUILD_ID: string = "<id>";）
goal: >
  把 build-bundle.sh :29-39 现有的 GIT_SHA + date + printf 写 src/build-id.ts 的 bash 逻辑，
  替换为调用 node scripts/gen-build-id.mjs，使 pnpm bundle 与 pnpm build 共用同一生成脚本
  （D-002@v1 源头单一）。后续 tsc + ncc 内联进 bundle 的步骤不变。
implementation:
  - 删除 :26-39 的 [0/3] 注入 BUILD_ID 整段（GIT_SHA / BUILD_ID / BUILD_ID_FILE / DESIRED 变量及 if-else printf 重写分支）
  - 在原位置插入一行调用 node scripts/gen-build-id.mjs，等价产出 src/build-id.ts；可保留 echo "==> [0/3] Generating BUILD_ID via gen-build-id.mjs" 进度提示
  - 不再在 shell 内做内容比对跳过（gen 脚本自身负责幂等写），保留 set -euo pipefail 下 gen 退出码非零即构建失败
  - pnpm build（tsc）与 pnpm exec ncc build 两步原样保留，ncc 仍内联 dist/cli.js → build/bundle/index.js
  - 重命名 index.js → sillyhub-daemon.js、独立打包 mcp-server.js 两段（:52-64）原样不动
acceptance:
  - build-bundle.sh 中不再出现 git rev-parse、date +%Y%m%d%H%M%S、printf 写 build-id.ts 字样
  - bash scripts/build-bundle.sh 执行后 src/build-id.ts 内容与单独跑 node scripts/gen-build-id.mjs 一致（同源）
  - bundle 产物 build/bundle/sillyhub-daemon.js 内 BUILD_ID 字面量非占位值（4c238ebe-20260729112052 旧硬编码不再出现于新 bundle）
  - node build/bundle/sillyhub-daemon.js --version 正常退出
verify:
  - 跑 bash scripts/build-bundle.sh，grep src/build-id.ts 确认格式为 export const BUILD_ID: string = "..."; 由 gen 产出
  - diff bundle 前后 BUILD_ID 字面量变化，确认 dev rebuild 版本号会变（FR-02 dev 见效路径）
  - task-05/11 的 backend 正则 BUILD_ID\s*=\s*["'] 从新 bundle 仍能提取（守护 self-update R-04，本任务不写测试，仅保证不破坏）
constraints:
  - 不改 package.json scripts（接线归 task-03）
  - 不改 gen-build-id.mjs 本体（归 task-01）
  - 不改 src/build-id.ts 版控归属（归 task-02）
  - latest.json 的 version 字段实为 backend 运行时从 bundle JS 正则提取（_compute_daemon_version router.py:110-125），非本脚本直接产；本任务只需保证 gen 输出格式被该正则匹配，design R-04 已说明
  - 保持跨平台：build-bundle.sh 本身仅 Linux/macOS/CI 跑（bash），gen 脚本跨平台责任在 task-01
---
