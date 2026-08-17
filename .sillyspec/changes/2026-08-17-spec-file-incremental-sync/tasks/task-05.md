---
repo: sillyspec
id: task-05
base_commit: 6755789828f599cb85e1ec5304fd41fa242e95ac
head_commit: 6647e176e11e670c4c671bf7407141358a53b9e2
title: task-05
title_zh: CLI 差异 ops 生成
goal: CLI 能根据服务器清单和本地文件状态生成 add/update/delete/rename ops。
implementation: |
  1. 在 sillyspec/src/spec-sync.js 实现 computeSpecOps(serverManifest, localFiles)。
  2. 服务器无、本地有 → add（base_version=0）。
  3. 同路径 hash 不同 → update（base_version=服务器 version）。
  4. 服务器有、本地无 → delete（base_version=服务器 version）。
  5. 旧路径无、新路径有、hash 相同 → rename（base_version=旧路径服务器 version）。
acceptance: |
  - 四种 op 映射正确；
  - ops 为空时返回空数组；
  - base_version 取自服务器清单。
verify: node test/platform-spec-sync-incremental.test.mjs
constraints: |
  - rename 仅当 hash 相同才生成。
allowed_paths:
  - src/spec-sync.js
---

# task-05 CLI 差异 ops 生成
