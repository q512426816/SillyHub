---
repo: sillyspec
id: task-04
base_commit: 6755789828f599cb85e1ec5304fd41fa242e95ac
head_commit: 6647e176e11e670c4c671bf7407141358a53b9e2
title: task-04
title_zh: CLI 本地文件扫描与哈希
goal: CLI 能 walk 本地 .sillyspec 树并计算每个文件的 sha256。
implementation: |
  1. 新增 sillyspec/src/spec-sync.js。
  2. 复用 daemon 排除常量（.runtime / runtime / worktrees / projects）。
  3. walkSpecTree 返回 {path, absPath, mtimeMs}，路径统一为 POSIX。
  4. hashFiles 用 crypto.createHash('sha256') 计算文件 hash。
acceptance: |
  - 正确排除非 spec 目录；
  - Windows 下输出路径为 POSIX。
verify: node test/platform-spec-sync-incremental.test.mjs
constraints: |
  - 来源常量参考 sillyhub-daemon/src/spec-sync.ts。
allowed_paths:
  - src/spec-sync.js
---

# task-04 CLI 本地文件扫描与哈希
