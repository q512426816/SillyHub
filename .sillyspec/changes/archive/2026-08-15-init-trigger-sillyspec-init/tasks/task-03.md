---
id: task-03
title: CLI 平台模式跳过项目内 .sillyspec 清理段
title_zh: doInstall 平台模式（platformOpts 非空）整体跳过项目内 .sillyspec/ 清理，保 local.yaml
author: qinyi
created_at: 2026-08-15 16:06:52
priority: P0
depends_on: [task-02]
blocks: [task-05]
requirement_ids: [FR-07]
decision_ids: [D-008@v2]
repo: sillyspec
base_commit: 26550bb765bb76b5b3734374a8e9642391b7979b
head_commit: 01c44daba2c5c2f8a39f8c72bcf156fa255af6a7
allowed_paths:
  - src/init.js
  - test/init-platform-keep-local-yaml.test.mjs
goal: >
  doInstall 外部 specDir 时对项目内 .sillyspec/ 的清理段（无资产 rmSync 整删 + cleanupRuntimeResidue）在平台模式（cmdInit 收到 platformOpts 非空）时整体跳过——平台成员项目内 .sillyspec/ 通常只有 local.yaml（平台 init lease 第 5 步写，含用户手调 mcp 段），任何清理都会丢失。本地用户（无 platformOpts）行为完全不变。
implementation:
  - cmdInit 把 platformOpts 非空信息传给 doInstall（与 task-01 的 noSkills 同通道）
  - doInstall 清理段（~:225-251）前置条件改为 `if (specDir && !isPlatformMode && existsSync(legacyDir))`
  - 跳过时 console.log 一行说明（平台模式不清理项目内 .sillyspec/）
acceptance:
  - 平台模式（--workspace-id + 外部 --spec-dir）下项目内 .sillyspec/local.yaml 在 init 前后内容不变（含手调 mcp 段）
  - 无真实资产的项目内 .sillyspec/ 在平台模式下不被整删
  - 本地模式（无平台 flag）清理行为与现状完全一致
verify:
  - cd ~/IdeaProjects/sillyspec && npm test（含 test/init-platform-keep-local-yaml.test.mjs：平台模式保留 local.yaml + 本地模式仍清理 两用例）
constraints:
  - 真实资产保护逻辑（拒绝整删分支）保留不动，本任务只是平台模式整体绕过清理段
  - 本地模式零回归
---
