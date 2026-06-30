---
id: task-06
title: frontend /runtimes allowed_roots 编辑 UI
author: WhaleFall
created_at: 2026-06-29T10:25:55
priority: P1
depends_on: [task-02]
blocks: [task-07]
allowed_paths:
  - frontend/src/app/(dashboard)/runtimes/page.tsx
  - frontend/src/lib/daemon.ts
  - frontend/src/components/
change: 2026-06-29-runtime-allowed-roots-config
---

# task-06

> goal: `/runtimes` 页面 per-runtime allowed_roots 展示 + 多路径编辑（admin），调 PUT API。

## implementation
- runtimes 列表行/详情加 allowed_roots 展示（Tag 列表，显示路径）
- 编辑入口（Drawer/Modal，admin 可见）：多路径增删（Input + 添加/删除按钮），默认显示 ~/.sillyhub
- 保存调 `PUT /api/admin/daemon/runtimes/{id}/allowed-roots`（lib/daemon.ts client）
- 非 admin 隐藏编辑（只读）
- 样式对齐项目 PageContainer/SectionCard 模式

## acceptance
- /runtimes 显示每个 runtime allowed_roots
- admin 可编辑（多路径增删），保存持久化（调 PUT）
- 非 admin 只读
- 保存后列表刷新

## verify
- `cd frontend && pnpm typecheck && pnpm test`
- 手动：admin 编辑 + 保存 + 刷新确认

## constraints
- admin only 编辑（权限判断）
- 多路径 UI（增删，默认 ~/.sillyhub）
- 样式对齐 project-plans/admin 模式
