---
id: task-10
title: runtimes/page.tsx 接入组件 + 删内联树形逻辑
wave: W3
depends_on:
  - task-08
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  Runtime 配置页「浏览」按钮改为打开 RemoteFolderPicker；删除全部内联树形逻辑与旧 state。FR-4 / FR-5。
implementation: |
  - 引入 pickerRowIdx: number|null 替代 browseRuntimeId + browseTargetRef。
  - 「浏览」按钮 onClick setPickerRowIdx(idx)；渲染 RemoteFolderPicker(onPick 填对应行)。
  - 删内联 handler(:641-726) + state/ref(:346-353 含 browseTargetRef) + browseFolder import + UI 按钮。
  - 更新既有页面测试。
acceptance: |
  - 浏览按钮打开组件选中回填；内联 handler/state/ref 全删；无残留；test+build 过。
verify: |
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
  - cd frontend && pnpm build
constraints: |
  - pickerRowIdx 替代旧双 state（Grill X1）；依据 design §6/§7.3。
---

# task-10 · runtimes/page.tsx 接入 + 删内联

> Wave W3 · frontend · FR-4 / FR-5 · design §6/§7.3

## 验收标准
- [ ] 「浏览」按钮打开 RemoteFolderPicker，选中回填对应行
- [ ] 内联 handler / state / ref 全部移除
- [ ] `browseFolder` / `browseRuntimeId` / `browseTargetRef` 无残留引用
- [ ] `pnpm test` + `pnpm build` 通过

## TDD/验证步骤
- 更新既有 `page.test.tsx`（mock RemoteFolderPicker）
- `cd frontend && pnpm test` + `pnpm lint` + `pnpm build`
