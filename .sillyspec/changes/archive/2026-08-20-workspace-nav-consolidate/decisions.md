---
author: qinyi
created_at: 2026-08-20T23:35:00
---

# decisions.md — 2026-08-20-workspace-nav-consolidate 决策台账

## D-401: 删宫格入口唯一化
- type: boundary
- status: accepted
- source: user
- priority: P0
- question: 概览页快速入口宫格与顶部菜单重复如何处理?
- answer: 删宫格（QuickEntryGrid 退役），全部跳转由顶部菜单承担
- normalized_requirement: 概览页无重复跳转入口；quick-entry-grid.tsx 删除无残留引用
- impacts: [design §5-1/2, page.tsx]
- evidence: 用户反馈"跳转按钮重复了，帮我统一移动到顶部菜单中" + AskUserQuestion 确认

## D-402: 菜单 13 项平铺滑动不分组
- type: boundary
- status: accepted
- source: user
- priority: P0
- question: 菜单扩到 13 项超宽怎么处理?
- answer: 平铺+左右滑动（用户指定"太长的话支持左右滑动"），不做分组/下拉收纳
- normalized_requirement: nav 容器 flex-nowrap overflow-x-auto+滚动条隐藏；13 项一次可达
- impacts: [design §5-3/4, workspace-tabs.tsx]
- evidence: 用户原话"太长的话支持左右滑动"

## D-403: standalone 历史决策废止
- type: architecture
- status: accepted
- source: user
- priority: P0
- question: components/changes 两页 ql-20260707-004 脱离布局的历史决策保留吗?
- answer: 废止——删 isStandalone，两页恢复统一顶部菜单（原宽度理由已被 members 先例与用户"子页面要有顶部菜单"诉求取代）
- normalized_requirement: layout.tsx 无 standalone 分支；两页在 workspace layout 内渲染 WorkspaceTabs
- impacts: [design §5-5, layout.tsx, R-01]
- evidence: 用户反馈"跳转过去的子页面部分没有顶部菜单，要补充下" + AskUserQuestion 确认
