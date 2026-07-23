---
id: task-07
title: 新增 SessionListLayout + SessionListEntry 类型
title_zh: 抽公共会话列表组件 SessionListLayout
author: qinyi
created_at: 2026-07-12 00:30:00
priority: P0
depends_on: [task-05]
blocks: [task-09, task-10, task-11]
requirement_ids: [FR-01]
decision_ids: [D-001, D-005]
allowed_paths:
  - frontend/src/components/daemon/session-list-layout.tsx
provides:
  - component: SessionListLayout
  - type: SessionListEntry
goal: >
  新增公共会话列表组件 SessionListLayout 与标准化列表项类型 SessionListEntry，供 runtimes 弹窗与变更会话两处复用（D-001）。
implementation:
  - 新建 frontend/src/components/daemon/session-list-layout.tsx
  - 定义 SessionListEntry：{ id: string; title: string | null; statusBadge: string; secondaryText: string; lastActiveAt: string | null }（design §7）
  - 定义 SessionListLayoutProps：{ items; loading; error; selectedId; onSelect; onNewSession; onRetry; onDelete?; headerTitle?; newButtonLabel? }
  - 渲染：<aside class="rounded-md border bg-slate-50"> + header（headerTitle 默认"会话历史" + 刷新/重试按钮）+ 顶部「新建会话」虚线按钮（newButtonLabel 默认"新建会话"，selectedId===null 时高亮蓝）+ <ul> 列表项
  - 列表项：title ?? shortId(id) + status Badge + secondaryText + lastActiveAt（MM-DD HH:mm）+ 选中 border-l-[3px] border-blue-600 bg-blue-50 + 传 onDelete 时每行右侧渲染删除按钮（D-005：secondaryText 由调用方拼，组件不强统一）
  - 空态：「暂无会话，新建一个开始提问」；error 态：错误文案 + 重试按钮
acceptance:
  - SessionListLayout 组件存在，Props 与 design §7 接口定义一致
  - 渲染圆角卡片（rounded-md border bg-slate-50）+ header + 顶部新建按钮 + 列表项（title ?? shortId + Badge + secondaryText + 时间 + 选中蓝色边框）
  - 传 onDelete 时每行渲染删除按钮，不传则无
  - 空态/error 态文案正确
verify:
  - cd frontend && pnpm tsc --noEmit
constraints:
  - secondaryText 两边语义不同（runtimes=提供方·轮数，变更会话=作者·提供方），由调用方拼，组件不强统一（design §9 C-5 / §4.5 D-005）
  - 不传 onDelete 时不渲染删除列（变更会话场景）
  - 中文 UI（规则 11）
---

## 验收标准
- SessionListLayout 组件存在，Props 与 design §7 接口定义一致
- 渲染圆角卡片 + header + 顶部新建按钮 + 列表项（title ?? shortId + Badge + secondaryText + 时间 + 选中蓝色边框）
- 传 onDelete 时每行渲染删除按钮，不传则无
- 空态/error 态文案正确

## 验证步骤
- cd frontend && pnpm tsc --noEmit
