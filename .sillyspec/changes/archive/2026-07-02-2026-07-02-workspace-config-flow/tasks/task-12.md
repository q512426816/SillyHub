---
id: task-12
title: daemon pullSpecBundle 前回灌本地改动（D-008）
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P1
depends_on: []
blocks: [task-16]
allowed_paths:
  - sillyhub-daemon/src/spec-sync.ts
  - sillyhub-daemon/tests/test_pull_before_push.ts
---

## 目标
pullSpecBundle 前检查本地未回灌改动，有则先 postSpecSync；失败 abort pull（D-008）。

## 实现步骤
- `pullSpecBundle` 前检查：`.runtime/pending_push` 标记存在 / 本地 spec 树 mtime 新于 platform.json.synced_at → 先 `postSpecSync` 回灌。
- postSpecSync 失败 → abort pull + lease failed（不强行覆盖本地）。

## 验收标准
- 本地有未回灌改动时 pull 前先 push（单测 mock 未回灌标记）。
- 回灌失败不覆盖本地（保留本地改动）。

## 验证方式
`cd sillyhub-daemon && pnpm exec vitest run tests/test_pull_before_push.ts`（mock pending_push 标记 + postSpecSync 失败两用例）。

## 约束
- 服务器 apply_sync 的 sha256+mtime 去重 + ScanDocConflictService 冲突归档保留（不动）。
- 整树覆写语义不变（daemon-client-spec-sync-strategy D-006）。
