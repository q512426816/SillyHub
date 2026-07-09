---
id: task-03
title: listRoots 单元测试
wave: W1
depends_on:
  - task-01
allowed_paths:
  - sillyhub-daemon/tests/roots-rpc.test.ts
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  为 listRoots（task-01）写单元测试。FR-1 / NFR-1。
implementation: |
  - mock platform/existsSync：Win C/D 盘；Linux/macOS /；单盘抛错不中断；全空返 []。
acceptance: |
  - Win/Unix/单盘失败/全空 四类用例过；pnpm test 过。
verify: |
  - cd sillyhub-daemon && pnpm test
constraints: |
  - 测试即产出（伴于 task-01）。
---

# task-03 · listRoots 单元测试

> Wave W1 · daemon · FR-1 / NFR-1

## 验收标准
- [ ] Win/Unix/单盘失败/全空 四类用例断言通过
- [ ] `pnpm test` 通过

## TDD/验证步骤
- mock `platform()` / `fs.existsSync` 覆盖四类场景
- `cd sillyhub-daemon && pnpm test`
