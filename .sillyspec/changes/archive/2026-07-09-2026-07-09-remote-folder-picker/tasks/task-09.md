---
id: task-09
title: RemoteFolderPicker 组件测试
wave: W3
depends_on:
  - task-08
allowed_paths:
  - frontend/src/components/daemon/__tests__/remote-folder-picker.test.tsx
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  为 RemoteFolderPicker（task-08）写组件测试。FR-3。
implementation: |
  - mock listRoots/listDir：打开加载根；展开渲染子目录；手输不存在提示+禁用；reject 离线红条；选中确认 onPick。
acceptance: |
  - 五类用例过；pnpm test 过。
verify: |
  - cd frontend && pnpm test
constraints: |
  - 测试即产出。
---

# task-09 · RemoteFolderPicker 组件测试

> Wave W3 · frontend · FR-3

## 验收标准
- [ ] 五类用例（加载根/展开/手输校验/离线降级/onPick）断言通过
- [ ] `pnpm test` 通过

## TDD/验证步骤
- mock `listRoots` / `listDir` 覆盖五类场景
- `cd frontend && pnpm test`
