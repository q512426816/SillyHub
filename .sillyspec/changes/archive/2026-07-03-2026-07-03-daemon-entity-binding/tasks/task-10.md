---
id: task-10
title: workspace-daemon-switcher 下拉改选 daemon 实体 + provider 徽标
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P1
depends_on: [task-08, task-09]
blocks: [task-15]
allowed_paths:
  - frontend/src/components/workspace-daemon-switcher.tsx
  - frontend/src/components/__tests__/workspace-daemon-switcher.test.tsx
---
## goal
> 守护进程切换器下拉数据源从 daemon_runtimes 改为 daemon_instances（该 user 在线），显示 hostname/display_alias + 启用 provider 徽标，选中调 upsertMyBinding 传 daemon_id（FR-09）。

## implementation
- 改 `workspace-daemon-switcher.tsx`（:91-115 下拉区）：数据源从 runtimes 改 daemon_instances（过滤 status==online 且归属当前 user）。
- 每项主文显示 `display_alias ?? hostname`；副位徽标显示该 daemon 已启用 provider（查其下 daemon_runtimes 的 provider 列表，D-002 从属清单）。
- 选中项调 `upsertMyBinding({ daemon_id })`（workspace-binding.ts 的 MemberBindingUpsertRequest 已在 task-11 改 daemon_id 字段，本 task 对接该字段）。
- 高亮当前选中：以 `currentBinding.daemon_id` 匹配下拉项 id。
- 移除原「按 runtime/provider 选」的交互；provider 选择移交给详情页 default_agent 独立选择器（task-11）。
- 同步更新对应测试（mock daemon_instances 列表 + 验证 upsert 传 daemon_id）。

## acceptance
- 下拉仅列当前 user 在线的 daemon 实体，每项展示标识 + 启用 provider 徽标。
- 选中一项 → 触发 upsertMyBinding 携带 daemon_id（不传 runtime_id）。
- 当前绑定（currentBinding.daemon_id）对应项高亮。
- provider 维度不在切换器里选（职责移交 default_agent 选择器）。
- 测试覆盖：列表渲染、选中回调 payload、高亮判定。

## verify
- `cd frontend && pnpm test src/components/__tests__/workspace-daemon-switcher.test.tsx`
- `cd frontend && pnpm test`

## constraints
- 依赖 task-08（dispatch 已读 daemon_id）+ task-09（resolver/upsert 已落 daemon_id）落地，否则后端写回错乱。
- MemberBindingUpsertRequest 的 daemon_id 字段由 task-11 统一改，本 task 仅消费；如 task-11 未合入需临时对齐字段名。
- 空列表（无在线 daemon）展示空态文案 + 引导去启动守护进程（中文）。
- 仅本机探测决定 provider 启用，不在前端做启停操作（YAGNI，design §2 非目标）。
