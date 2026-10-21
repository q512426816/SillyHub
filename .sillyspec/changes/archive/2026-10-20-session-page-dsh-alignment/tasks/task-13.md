---
id: task-13
title: 'Daemon release and version-gating acceptance (explicit release step)'
title_zh: 'daemon 发版与版本门控验收（显式发布步）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-21 14:49:18
priority: P0
depends_on: [task-09, task-10]
blocks: []
requirement_ids: [FR-13, FR-14, FR-15]
decision_ids: [D-023@v1]
allowed_paths:
  - sillyhub-daemon/package.json
  - sillyhub-daemon/src/interactive/
  - sillyhub-daemon/src/daemon-version.ts
  - sillyhub-daemon/tests/version.test.ts
target_files:
  - sillyhub-daemon/package.json
goal: >
  daemon 的两个新能力（1b 工作区快照、TTFT/attempt）必须一起发版才可用，且必须能被平台判版本：本卡是**显式的发布步**——
  升版本号、写发布说明、跑构建与产物校验，并实测「老 daemon 不上报 → 前端降级」这条兼容链。没有本卡，1b 只是躺在源码里。
implementation:
  - '升版：`sillyhub-daemon/package.json` version 0.1.1 → 0.2.0（新增能力属 minor）；版本号是 `sillyhub-daemon/src/daemon-version.ts` 唯一来源（DAEMON_VERSION 读 package.json），故不另设常量'
  - '发布说明：在本变更目录写 `daemon-release-0.2.0.md`（中文）：新增「每轮工作区快照」与「TTFT/attempt 采样」、默认关闭/开启口径、性能红线（≤3 子进程 / 1500ms 超时→partial / 单工作区串行）、降级行为（老平台忽略新字段；老 daemon → 平台显示「仅工具编辑」）'
  - '构建与产物校验：`cd sillyhub-daemon && pnpm build` 通过；`node scripts/gen-build-id.mjs` 产出 BUILD_ID；`node dist/cli.js --version` 输出 0.2.0；`pnpm typecheck` 零错'
  - '版本门控实测（两条链）：①把上报 payload 里的快照字段删掉（模拟老 daemon）跑一次真实/夹具会话 → 平台读模型 `fileChanges=null` + `capability="tool_only"`，前端卡片显示「仅工具编辑」；②把 timing 字段删掉 → 模型泳道回到单色近似并标「近似」'
  - '把「平台侧最低可用 daemon 版本」写进本卡 acceptance 与发布说明（能与旧版并存：低于该版本只是降级，不阻断会话）'
acceptance:
  - '`sillyhub-daemon/package.json` version=0.2.0；`node dist/cli.js --version` 输出 0.2.0'
  - '`pnpm build` / `pnpm typecheck` / `vitest run tests/interactive/` 全绿；BUILD_ID 文件重新生成'
  - '版本门控两链实测留痕（命令 + 输出摘要）写回 tasks.md 本任务证据行：缺快照 → `tool_only` + 卡片「仅工具编辑」；缺 timing → 「近似」单色'
  - '发布说明文件存在且含降级口径与性能红线'
verify:
  - cd sillyhub-daemon && pnpm build && node dist/cli.js --version
  - cd sillyhub-daemon && node node_modules/vitest/vitest.mjs run tests/interactive/
constraints:
  - 只升 daemon 版本，不改前端/backend 版本；不引新依赖
  - 版本门控只看 capability/字段存在性，不靠版本号做硬拦截（老 daemon 必须仍可连）
  - 发布说明与 CHANGELOG 类文档写中文，落本变更目录（仓内 daemon 无 CHANGELOG 文件，不新造惯例）
related_tests:
  - path: sillyhub-daemon/tests/version.test.ts
    reason: 版本解析工具与 DAEMON_VERSION 语义相关，升版后该文件必须仍绿
---
