---
repo: sillyspec
id: task-07
base_commit: 6755789828f599cb85e1ec5304fd41fa242e95ac
head_commit: 6647e176e11e670c4c671bf7407141358a53b9e2
title: task-07
title_zh: CLI sync.js 接入 syncSpecTree
goal: 在 sync() 成功路径末尾调用 syncSpecTree，让每步 done 自动增量同步文件树。
implementation: |
  1. 修改 sillyspec/src/sync.js。
  2. 在 sync() 成功路径、四件套直推之后追加：
     try { await this.syncSpecTree(changeName); } catch (err) { debugLog(...); }
  3. 前置：确认 src/sync.js 已基于 2026-08-16-auto-sync-from-repo 合并后的 main。
acceptance: |
  - 运行 sillyspec run quick --done 后 CLI 不报错；
  - mock 后端收到 /api/changes/-/spec-sync 请求。
verify: node test/platform-spec-sync-incremental.test.mjs
constraints: |
  - 若 baseline 未对齐导致 hunk 冲突，先处理冲突再继续。
allowed_paths:
  - src/sync.js
---

# task-07 CLI sync.js 接入 syncSpecTree
