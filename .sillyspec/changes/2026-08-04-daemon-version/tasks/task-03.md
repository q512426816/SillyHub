---
id: task-03
title: "package.json 加 prebuild + postinstall 跑 gen-build-id.mjs"
title_zh: "package.json 加 prebuild + postinstall 跑 gen-build-id.mjs"
author: WhaleFall
created_at: 2026-08-04 11:14:15
priority: P0
depends_on:
  - task-01
blocks:
  - task-06
  - task-10
requirement_ids:
  - FR-03
decision_ids:
  - D-003@v1
allowed_paths:
  - sillyhub-daemon/package.json
expects_from:
  task-01: "scripts/gen-build-id.mjs 已落地（node ESM，写 src/build-id.ts，非 git fallback unknown-<ts>）"
goal: >
  在 sillyhub-daemon/package.json 的 scripts 中加 prebuild 与 postinstall 两个 hook，
  都调用 scripts/gen-build-id.mjs，使 pnpm build（tsc）前自动重生成 BUILD_ID，
  clone/CI install 后立即产出默认 build-id.ts 避免 tsc 缺文件。
implementation: |
  - 在 scripts 块新增 `"prebuild": "node scripts/gen-build-id.mjs"`（pnpm build 前自动跑）。
  - 在 scripts 块新增 `"postinstall": "node scripts/gen-build-id.mjs"`（install 后生成默认 build-id.ts）。
  - `"build": "tsc"` 保持不变（pnpm 自动前置 prebuild，无需显式串联）。
  - 不改 dev/typecheck/test/bundle/gen:types 等其它脚本。
  - 不动 dependencies / devDependencies / pnpm.overrides / engines。
acceptance:
  - package.json scripts 含 prebuild 与 postinstall 两个键，均指向 node scripts/gen-build-id.mjs。
  - build 脚本仍为 tsc（不显式调 gen，由 prebuild 隐式前置）。
  - dev 脚本仍为 tsc --watch（pnpm dev 不触发 prebuild，watch 模式 BUILD_ID 不更新属预期）。
  - 其余既有脚本（dev/typecheck/test/test:watch/start/bundle/gen:types/gen:types:check）原样保留。
  - JSON 结构合法（键值对、逗号、引号），pnpm 能正常解析。
verify:
  - 在 sillyhub-daemon 目录执行 `pnpm install` 后，确认 src/build-id.ts 被生成（postinstall 生效）。
  - 执行 `pnpm build` 后，确认 BUILD_ID 时间戳刷新（prebuild 生效）。
  - 执行 `pnpm dev` 不应触发 gen（仅承诺 pnpm build 更新）。
  - `node -e "require('./package.json').scripts"` 不抛错，结构完整。
constraints:
  - 本次仅承诺 pnpm build 触发 BUILD_ID 更新，pnpm dev（tsc --watch）不触发 prebuild。
  - 不改语义版本号 0.1.0，不改 pnpm.overrides，不改 engines。
  - postinstall 是双保险生成默认值，与 task-02（build-id.ts 移出版控）配合，避免旧 clone tsc 缺文件。
---

# task-03 — package.json 加 prebuild + postinstall

依据：design.md §5.A.3、§6 文件清单、§11 D-003@v1；plan.md Wave 2 task-03 行。

## 现状（package.json scripts）
- dev: tsc --watch
- build: tsc
- bundle: bash scripts/build-bundle.sh
- （typecheck / test / test:watch / start / gen:types / gen:types:check 均保留）

## 改动
- 新增 `"prebuild": "node scripts/gen-build-id.mjs"`
- 新增 `"postinstall": "node scripts/gen-build-id.mjs"`
- build 保持 `tsc`（prebuild 自动前置）

## 不改
- dev / typecheck / test / bundle / gen:types 等其余脚本。
- dependencies / devDependencies / pnpm.overrides / engines / packageManager。
