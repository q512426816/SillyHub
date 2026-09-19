---
id: task-10
title: 'turn-timeline 最小扩展（SessionProcessItem 增 system_event kind + 中性行渲染）'
title_zh: 'turn-timeline 最小扩展（SessionProcessItem 增 system_event kind + 中性行渲染）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-19 21:03:54
priority: P0
depends_on: []
blocks: [task-11]
requirement_ids: [FR-01, FR-02]
decision_ids: [D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/turn-timeline.tsx
target_files:
  - frontend/src/components/daemon/turn-timeline.tsx
provides:
  - contract: SessionProcessItem
    fields: [system_event]
goal: >
  回放链路需把系统注入类伪用户消息归一为系统事件中性行，而 TurnRow 无既有承载分支
  （design Phase 3.1 Grill 交叉点 1 / D-003）——给 SessionProcessItem 增 system_event kind 并渲染居中虚线中性行，改动收敛单文件。
implementation:
  - SessionProcessItem 联合（frontend/src/components/daemon/turn-timeline.tsx:190）新增变体 kind=system_event，字段 text 必填、ts 可选，与既有 thinking 变体同构
  - TurnDetailsList 分组循环（frontend/src/components/daemon/turn-timeline.tsx:1478）对 system_event 直通独立成项，不参与连续 thinking 合并，保留真实时序
  - TurnDetailsList 渲染分支（frontend/src/components/daemon/turn-timeline.tsx:1510）新增居中虚线边框中性行（原型 .sysrow 形态），样式用 border-border / bg-card / text-muted-foreground 双主题语义类，禁硬编码 hex
  - 类型处注释标明该 kind 仅回放适配器产物产生，实时会话数据路径零产生
acceptance:
  - SessionProcessItem 既有构造点（session-log-assembler.ts / dialog-helpers.ts）零类型报错，实时链路零产生 system_event
  - system_event 仅在「全部」视图 TurnDetailsList 渲染为居中虚线中性行，「对话」视图 processItems 过滤行为不变
  - thinking 连续合并 / tool 卡 / stderr / file 卡 / askUser 既有渲染分支逐字不变，相关既有测试全绿
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm exec vitest run src/components/daemon/__tests__/turn-timeline-scroll.test.tsx src/components/daemon/__tests__/turn-timeline-conversation-file-card.test.tsx
constraints:
  - 实时会话数据路径零产生 system_event（仅回放适配器产生），本卡不新增任何产生点
  - 不改 thinking / tool / stderr / file / askUser 既有渲染行为与 SessionTurnView 其余字段
  - 中性行不复用用户气泡样式、不复用「执行中」假运行语义，样式禁硬编码 hex（plan 全局硬约束 + CLAUDE.md 规则 20/21）
  - 改动收敛 turn-timeline.tsx 单文件；本卡不加新测试（渲染断言由 task-11 组件测试覆盖）
---
