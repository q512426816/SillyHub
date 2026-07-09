---
id: task-08
title: RemoteFolderPicker 可复用组件
wave: W3
depends_on:
  - task-07
allowed_paths:
  - frontend/src/components/daemon/remote-folder-picker.tsx
author: WhaleFall
created_at: 2026-07-09 09:55:00
no_deps_verify: true
goal: |
  封装自治 RemoteFolderPicker 组件。FR-3 / D-003 / D-004 / NFR-3 / NFR-4。
implementation: |
  - Props { runtimeId, open, onClose, onPick, title?, confirmText? }。
  - open→listRoots 初始化根→Tree loadData 懒加载 listDir(只 dir)→手输跳转前探校验(D-003)→选中 onPick。
  - 错误降级红条不崩溃(D-004)；antd Modal/Tree + shadcn Input/Button(NFR-3)；中文(NFR-4)；destroyOnClose。
acceptance: |
  - 加载根/展开/手输校验/离线降级/onPick 均正常；lint+build 过。
verify: |
  - cd frontend && pnpm test
  - cd frontend && pnpm lint
  - cd frontend && pnpm build
constraints: |
  - 组件自治；依据 design §7.3 + 原型。
---

# task-08 · RemoteFolderPicker 组件

> Wave W3 · frontend · FR-3 / D-003 / D-004 / NFR-3 / NFR-4 · design §7.3 + 原型

## 验收标准
- [ ] 打开加载根（Win 盘符 / Unix `/`）
- [ ] 展开节点懒加载子目录
- [ ] 手输不存在路径 → 提示 + 禁用确认
- [ ] 离线 → 红条提示不崩溃
- [ ] 选中确认 → `onPick(path)` 触发
- [ ] `pnpm lint` + `pnpm build` 通过

## TDD/验证步骤
- 先写组件测试（task-09）：渲染/懒加载/手输校验/离线/onPick
- `cd frontend && pnpm test`
