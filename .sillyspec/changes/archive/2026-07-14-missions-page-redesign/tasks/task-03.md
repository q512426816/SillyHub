---
id: task-03
title: Collapse history into top dropdown button
title_zh: 历史 Mission 收进顶部下拉按钮
author: qinyi
created_at: 2026-07-14 10:34:25
priority: P2
depends_on: [task-02]
blocks: []
requirement_ids: [FR-4]
decision_ids: [D-007@v1]
allowed_paths:
  - frontend/src/components/mission-console.tsx
goal: |
  将历史 Mission 列表从默认展开的 details 改为顶部「历史(N)▾」下拉按钮，默认收起，点击展开 Dropdown/Popover 浮层，释放创建表单焦点空间。
implementation:
  - 将现有历史 `<details open>`（mission-console.tsx:703-738）改为默认 close 的触发按钮 + 浮层。
  - 顶部触发按钮文案「历史(N)▾」（N = history.length），位于创建表单上方。
  - 点击按钮展开历史列表浮层（用 Dropdown / Popover，或 details 默认 close + summary 文案改「历史(N)▾」）。
  - 历史条目渲染逻辑保持不变（点击切换 mission、写 URL、状态 Badge），仅容器从 details open 改为下拉。
  - 浮层列表保留 max-h 滚动（现 max-h-72 overflow-y-auto）。
acceptance:
  - 历史区块默认收起，不抢占创建表单焦点。
  - 顶部存在「历史(N)▾」按钮（N 反映真实历史条目数）。
  - 点击按钮可展开历史列表，点击历史条目可切换 mission 详情。
  - history.length === 0 时不渲染历史按钮（或渲染为不可点占位）。
verify:
  - cd frontend && pnpm typecheck
  - cd frontend && pnpm test
constraints:
  - 后端零改动（listMissions 调用契约不变）。
  - 历史条目点击切换 mission 的行为不变（setMission + writeMissionIdToUrl）。
  - 文案中文，按钮不出现 "history"/"Mission" 英文黑话。
  - 不破坏现有 history 加载逻辑（refreshHistory / useEffect 触发）。
---
