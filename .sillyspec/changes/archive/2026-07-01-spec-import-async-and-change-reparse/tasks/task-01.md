---
id: task-01
title: daemon 撤 ql-003 的 get_spec_bundle excludeNames changes（覆盖：FR-02, D-002）
author: WhaleFall
created_at: 2026-07-01 13:04:17
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-02]
decision_ids: [D-002]
allowed_paths:
  - sillyhub-daemon/src/daemon.ts
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/spec-sync.test.ts
---

# task-01：daemon 撤 ql-003 的 get_spec_bundle excludeNames changes

## goal
撤销 ql-20260701-003 的 get_spec_bundle excludeNames:['changes'] 误判，恢复 changes 导入（含 archive），仅保留 .runtime 排除（D-002）。

## implementation
- daemon.ts `_registerGetSpecBundleRpcHandler`（约 1840 行）：把 `packSpecDir(specDir, { excludeRuntime: true, excludeNames: ['changes'] })` 改为 `packSpecDir(specDir, { excludeRuntime: true })`，删掉 excludeNames changes；更新上方注释说明 D-002（撤 ql-003：changes 是变更中心依赖数据，reparse 入 Change 表，不再排除）。
- spec-sync.ts `packSpecDir`（293-326）的 `excludeNames` 选项本身不动（通用能力，保留 walkDir 剪枝逻辑 + ql-002/003 注释保留描述通用语义）；仅 get_spec_bundle 调用方不再传 changes。
- spec-sync.test.ts：保留现有 `excludeNames:['changes']` 测试（验证通用能力仍可用，124-137 行）；新增一条测试 `packSpecDir 仅 excludeRuntime:true（get_spec_bundle 等价路径）含 changes 子树`：构造 docs/ + changes/sub/ + .runtime/，断言含 changes 文件、不含 .runtime。

## acceptance
- get_spec_bundle 等价打包（packSpecDir 仅传 excludeRuntime:true）返回 tar 含 changes/ 子树（含子目录与 archive）。
- .runtime 仍被排除（ql-002 行为不回归，walkDir 剪枝生效）。
- packSpecDir excludeNames 选项仍可用（不删通用能力，保留对应测试）。

## verify
- cd sillyhub-daemon && pnpm vitest run tests/spec-sync.test.ts
- cd sillyhub-daemon && pnpm build（tsc 类型检查）

## constraints
- 不改 postSpecSync（保持含 .runtime 回灌，design §5.2 D-003 push 路径）。
- excludeRuntime 必须保留（.runtime 含 worktrees 2.1G，ql-002）。
- daemon 改动需用户重启本机 daemon（preflight 自更新 bundle）才生效。
