---
id: task-01
title: 'SubagentPanelContext 新建 + SubagentBlockView 紧凑卡片模式（有 context 无内联 children/点击上抛 toggle/无 context 旧内联回退）'
title_zh: 'SubagentPanelContext 新建 + SubagentBlockView 紧凑卡片模式（有 context 无内联 children/点击上抛 toggle/无 context 旧内联回退）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 18:23:35
priority: P0
depends_on: []
blocks: [task-03]
requirement_ids: [FR-02, FR-05]
decision_ids: [D-001@v1, D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/subagent-panel-context.ts
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/subagent-panel-context.ts
  - frontend/src/components/daemon/turn-segment-views.tsx
  - frontend/src/components/daemon/__tests__/turn-segment-views.test.tsx
provides:
  - contract: SubagentPanelContext
    fields: [openSubagent, closeSubagent, activeId]
goal: >
  新建 SubagentPanelContext 并把 SubagentBlockView 改造为双模式：消费到 context 时
  渲染中栏紧凑卡片（仅状态点/名称/类型/徽标/时长，无内联 children，点击上抛
  openSubagent/toggle 关闭）；无 context 时保持现状内联展开零回归——让中栏子代理
  只显运行状态与时长（design §5.C / FR-02），为 task-03 右栏面板提供联动契约。
implementation:
  - '新建 frontend/src/components/daemon/subagent-panel-context.ts——createContext<{ openSubagent: (segmentId: string) => void; closeSubagent: () => void; activeId: string | null }>，默认值 null（消费方 useSubagentPanel() 返回 null = 无右栏能力回退内联）；导出 Provider 别名与 hook useSubagentPanel'
  - 'turn-segment-views.tsx SubagentBlockView（590-760 行）改造——组件开头 const panel = useSubagentPanel()：①panel 非空走紧凑分支：复用现有头部 JSX（状态点/🤖/名称/类型标签/徽标/时长/running seg-sweep 全保留），容器去掉折叠语义（无 aria-expanded/aria 无 body），根 div 加 data-segment-id={segment.id}；onClick → panel.activeId === segment.id ? panel.closeSubagent() : panel.openSubagent(segment.id)（toggle，D-002@v1 ④）；hasActiveTextSelection 守卫保留；activeId 命中时加描边高亮（ring-1 ring-brand-300）；②panel 为空走原 return 分支——现有内联展开逻辑（open state/折叠 body/progressLine）一行不动（FR-05 dialog 回退）'
  - '时长/状态推导零新造——metaStatus/taskElapsedMs 走秒逻辑（task-13 既有）两分支共用，紧凑分支同样渲染 durationText'
  - 'turn-segment-views.test.tsx 新增 describe「SubagentBlockView 紧凑卡片模式（subagent-three-pane）」——用例：①无 Provider（现状回归）子代理块默认展开 children 可见、点击头部折叠展开仍可用；②有 Provider 值 {activeId: null} 时 children 不渲染（queryByTestId/文本断言子代理内部文本不存在）、头部渲染名称+类型+时长；③点击头部 → openSubagent 收到 segment.id；④Provider activeId 等于该段 id → 高亮态（data-active 或 ring class 断言）且再点 → closeSubagent 调用；⑤stub 段（subagent_stub）同走紧凑分支（名称回退 subagentType）'
acceptance:
  - '有 context：SubagentBlockView 仅渲染头部行（状态点/🤖/名称/类型标签/徽标/时长），无 children 内联、无折叠 body；点击上抛 openSubagent(segment.id)，activeId 命中再点 closeSubagent()（toggle）'
  - '无 context（默认 null）：SubagentBlockView 与现状完全一致——运行中默认展开、完成折叠、running→终态自动收敛、children 递归渲染、[TASK_*] progressLine（既有用例零回归）'
  - '根容器带 data-segment-id={segment.id} 锚点'
  - '新增 describe ≥5 用例 + 既有 turn-segment-views 用例全绿'
verify:
  - 'pnpm -C frontend exec tsc --noEmit（对照基线 0 新增错误）'
  - 'pnpm -C frontend exec eslint src/components/daemon/subagent-panel-context.ts src/components/daemon/turn-segment-views.tsx src/components/daemon/__tests__/turn-segment-views.test.tsx（0 error 0 warning）'
  - 'pnpm -C frontend exec vitest run src/components/daemon/__tests__/turn-segment-views.test.tsx（新增 + 既有全绿，不跑全量）'
constraints:
  - '不改 SegmentView 分发器签名与其它段组件（context 穿透递归自动生效）；不改 session-log-assembler'
  - '紧凑分支头部视觉元素（状态点/徽标/时长推导）复用现有代码不复制粘贴新逻辑；样式走 brand-* 语义阶'
  - 'dialog 弹窗/悬浮宿主等旧消费方零变化（它们不挂 Provider）'
---
