---
repo: sillyspec
id: task-06
base_commit: 6755789828f599cb85e1ec5304fd41fa242e95ac
head_commit: 6647e176e11e670c4c671bf7407141358a53b9e2
title: task-06
title_zh: CLI syncSpecTree 组装与错误降级
goal: CLI 能组装完整同步流程，并在失败/冲突时正确降级。
implementation: |
  1. 在 sillyspec/src/spec-sync.js 实现 syncSpecTree(cwd, changeName)。
  2. 读 local.yaml → GET 服务器清单 → walk/hash → diff。
  3. 无差异则短路，不发 POST。
  4. 有差异则 POST /api/changes/-/spec-sync。
  5. conflict → console.warn 提示；404/网络/未连接 → 静默返回。
acceptance: |
  - 无差异时不发 POST；
  - conflict 时函数返回且主流程不抛错；
  - 404 时静默返回。
verify: node test/platform-spec-sync-incremental.test.mjs
constraints: |
  - 文档同步失败不得影响进度同步主流程。
allowed_paths:
  - src/spec-sync.js
---

# task-06 CLI syncSpecTree 组装与错误降级
