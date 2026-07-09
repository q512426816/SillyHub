---
id: task-07
title: lib/daemon.ts 新增 listRoots + 删 browseFolder
wave: W3
depends_on:
  - task-04
allowed_paths:
  - frontend/src/lib/daemon.ts
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  前端 API client 新增 listRoots()；删除 browseFolder()。FR-2 / FR-5。
implementation: |
  - 紧邻 listDir:244 新增 listRoots(rid) POST .../list-roots 空 body，返 {roots}；导出 ListRootsResponse。
  - 删 browseFolder()(:259)。
acceptance: |
  - listRoots 返 {roots}；browseFolder 已删无残留；lint+build 过。
verify: |
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
constraints: |
  - 依据 design §7.3。
---

# task-07 · lib/daemon.ts listRoots + 删 browseFolder

> Wave W3 · frontend · FR-2 / FR-5 · design §7.3

## 验收标准
- [ ] `listRoots(rid)` 返 `{roots}`
- [ ] `browseFolder` 已删除，无残留引用
- [ ] `pnpm lint` + `pnpm build` 通过

## TDD/验证步骤
- 先写 `listRoots` 调用测试（mock fetch）
- `cd frontend && pnpm test` + `pnpm lint`
