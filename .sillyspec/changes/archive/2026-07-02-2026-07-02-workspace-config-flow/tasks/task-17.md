---
id: task-17
title: frontend 测试 + 模块文档同步
author: qinyi
created_at: 2026-07-02 11:00:00
priority: P0
depends_on: [task-04, task-05, task-08, task-14]
blocks: []
allowed_paths:
  - frontend/src/components/__tests__/
  - frontend/src/app/(dashboard)/workspaces/[id]/__tests__/
---

## 目标
frontend 测试全覆盖 + 模块文档同步。

## 实现步骤
- 三态引导（task-08：未初始化/已初始化未扫描/已扫描）。
- 编辑入口（task-05：已绑定回填 + 保存）。
- switcher per-member（task-04：改 my-binding）。
- 同步按钮状态机（task-14：pending/done/failed 轮询）。
- 扫描门禁弹窗（task-02/08：非 owner 禁用 + owner 已扫弹确认）。
- jsdom 下 MarkdownText vi.mock（已知坑 frontend-markdown-text-jsdom-null）。
- 模块文档：scan 重生 module-card 时融入 init/sync 流程注意事项（不另加变更索引）。

## 验收标准
- vitest 全绿；typecheck/lint 无新增。

## 验证方式
`cd frontend && pnpm test && pnpm typecheck && pnpm lint`。

## 约束
- 测试 mock listDaemonRuntimes（见 workspace-access-guide.test 现有模式）。
- 复用 change-detail-file-tree-editor 的轮询参数（一致节奏）。
