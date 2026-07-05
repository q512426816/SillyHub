---
id: task-11
title: workspace-binding 加 daemon_id + 详情页 default_agent 独立选择器
author: qinyi
created_at: 2026-07-03 11:30:00
priority: P1
depends_on: [task-09]
blocks: [task-15]
allowed_paths:
  - frontend/src/lib/workspace-binding.ts
  - frontend/src/app/(dashboard)/workspaces/[id]/page.tsx
  - frontend/src/app/(dashboard)/workspaces/[id]/page.test.tsx
covers: [FR-09]
---

## goal
> 前端 binding 类型对齐 daemon_id 维度，详情页「默认智能体」从守护进程绑定卡片中独立出来，按所选 daemon 已启用 provider 选项。

## implementation
- `workspace-binding.ts`：`MemberBindingView` 增 `daemon_id`，`MemberBindingUpsertRequest` 改传 `daemon_id`（不再传 runtime_id）；runtime_id 在 View 上保留可选兼容旧响应，Upsert 不写。
- `workspaces/[id]/page.tsx:465-479`：把「默认智能体」SectionCard 从守护进程绑定卡片剥离独立，下拉源 = 当前绑定 daemon 下 online 的 daemon_runtimes.provider，保存到 `workspaces.default_agent`（workspace 维度，与绑定解耦）。
- daemon 未绑或无在线 provider 时该选择器置空 + 占位提示「请先绑定守护进程」。
- 更新 page.test.tsx：默认智能体卡片与守护进程卡片分离、daemon_id 在 binding 上正确回显、有/无在线 provider 两态。

## acceptance
- `MemberBindingView.daemon_id` 与 `MemberBindingUpsertRequest.daemon_id` 类型齐备，TS 编译无错。
- 选择器只列该 daemon 已启用 provider，切换 daemon 时联动刷新；与绑定卡片视觉/数据独立。
- page.test.tsx 覆盖有在线 provider、daemon 未绑两种状态。

## verify
- `cd frontend && pnpm test -- workspaces/\[id\]/page.test.tsx`
- `cd frontend && pnpm tsc --noEmit && pnpm test`

## constraints
- default_agent 落 workspace 维度，不进 binding（与 D-005 一致）。
- 选择器数据依赖 task-10 的 daemon_instances 在线列表就绪。
- 中文 UI 文案（CLAUDE.md 规则11）。
