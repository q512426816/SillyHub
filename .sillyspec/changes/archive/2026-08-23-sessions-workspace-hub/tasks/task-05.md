---
id: task-05
title: 'session-list-workspace-tree'
title_zh: 'SessionListPanel 工作区树重构'
author: qinyi
created_at: 2026-08-23 04:52:00
priority: P0
depends_on: [task-02]
blocks: []
requirement_ids: [FR-01, FR-02]
decision_ids: [D-103@v1, D-105@v1]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/
  - frontend/src/lib/daemon.ts
goal: >
  左侧列表重构为：两层筛选 tab（机器>智能体+全部）+ 工作区分组手风琴（组头＋新建/机器小节/owner chip/
  非工作区末尾组）+ 数据一次拉取 limit 500 客户端分组（D-103/D-107/D-105）。
implementation:
  - 数据层：全局 scope 一次拉取 limit=500（daemon.ts 参数收口）客户端按 workspace_id 分组；工作区列表经现有 workspaces API；scope=workspace/change 维持现有端点过滤（D-003@v2），change 独立页左侧维持现状 scope 列表不改树（design §3 边界）
  - 两层筛选 tab：第一层机器（含「全部」清空，选中后出第二层），第二层智能体（⚡Claude Code/◎Codex）；纯视图过滤不进数据层；筛选态隐藏机器小节标题；筛选变化重置展开态除当前组（R-05）
  - 分组手风琴：组头=📂名称+会话数+「＋」+展开箭头（原型 v2 对照）；组内机器小节（机器名+在线点，runtime→machine 映射）；「非工作区」固定末尾组同样有「＋」（D-105）；0 会话组仍显示（计数 0）
  - 条目：沿用紧凑两行+chips，新增创建人 chip（owner_name，null 显"—"）；组内超 50 截断+「显示全部」（R-03）
  - 保留能力（X-11）：状态筛选下拉（组内过滤）、批量删除（组头尾随多选态入口）、标题搜索；退役：引擎胶囊 tab、全局 useVirtualizer、机器多选 Select（:380-391，被机器 tab 取代）
  - 组头回调 onNewInGroup(workspaceId: string | null) 抛父层（上下文解析归 task-06）
acceptance:
  - 分组/小节/chips（含创建人 null→"—"）渲染正确；非工作区末尾组可新建回调
  - 两层筛选过滤生效、「全部」清空、筛选态隐藏小节标题
  - 状态筛选/批量删除/搜索保留可用；组内 50 截断+显示全部
  - scope=workspace/change 行为不回归（既有用例迁移后全绿）
verify:
  - pnpm exec vitest run src/components/sessions/__tests__/（session-list-panel 系列改写）
  - pnpm typecheck
constraints:
  - 列表仍走本人隔离端点（D-108@v2 不宣称多人区分）
  - 旧断言逐条迁移不删断言凑绿（R-06 前置）
---

# task-05 补充说明
无。
