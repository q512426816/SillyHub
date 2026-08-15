---
id: task-11
title: 前端 SessionListPanel：筛选+虚拟滚动+紧凑两行（覆盖 FR-02, D-003@v1, D-006@v1）
title_zh: 会话列表面板组件
author: WhaleFall
created_at: 2026-08-15 09:55:21
priority: P0
depends_on: [task-06, task-16]
blocks: [task-10]
requirement_ids: [FR-02]
decision_ids: [D-003@v1, D-006@v1]
allowed_paths:
  - frontend/src/components/sessions/session-list-panel.tsx
  - frontend/src/components/sessions/__tests__/session-list-panel.test.tsx
  - frontend/package.json
provides:
  - contract: SessionListPanel
    fields: [filters, virtualList, onSelect]
expects_from:
  task-16:
    - contract: DaemonSessionClient
      needs: [listAgentSessions]
goal: >
  左栏会话列表：所有会话（含已结束/失败）、引擎/状态/机器/搜索四维筛选、@tanstack/react-virtual 虚拟滚动、紧凑两行条目 chips 读快照。
implementation:
  - frontend/package.json 加 @tanstack/react-virtual 依赖
  - 筛选区：引擎胶囊 tab（全部/Claude/Codex）单选即查、状态下拉、机器多选胶囊（含在线点）、标题搜索回车触发
  - 列表用 useVirtualizer 渲染，数据经 listAgentSessions 后端分页+过滤
  - 条目两行：状态点+标题截断+相对时间；机器/引擎/档案/供应商/轮数 chips 读 config_snapshot（含离线机器划线置灰）
  - 点击条目回调 onSelect；选中态高亮
acceptance:
  - 四维筛选组合生效（走后端过滤参数）
  - 大列表虚拟滚动只渲染可视区
  - chips 实时反映会话当前配置快照
verify:
  - cd frontend && pnpm exec vitest run src/components/sessions
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 组件自治（页面组装归 task-10）
  - 查询触发规则对齐样式规范（选择型即查、文本回车查）
related_tests: []
---
