---
id: task-03
title: 'SubagentDetailPanel 新建 + SessionPanel 新可选 props（context 提供/根 flex 行/PanelResizer 宽度/handleJumpToSubagent 双路径）+ subagent-catalog activeId 高亮'
title_zh: 'SubagentDetailPanel 新建 + SessionPanel 新可选 props（context 提供/根 flex 行/PanelResizer 宽度/handleJumpToSubagent 双路径）+ subagent-catalog activeId 高亮'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 18:23:35
priority: P0
depends_on: ['task-01']
blocks: [task-04]
requirement_ids: [FR-03, FR-05]
decision_ids: [D-001@v1, D-002@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/daemon/subagent-detail-panel.tsx
  - frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx
  - frontend/src/components/daemon/session-panel/index.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/subagent-catalog.tsx
  - frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx
target_files:
  - NEW:frontend/src/components/daemon/subagent-detail-panel.tsx
  - NEW:frontend/src/components/daemon/__tests__/subagent-detail-panel.test.tsx
  - frontend/src/components/daemon/session-panel/index.tsx
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/sessions/subagent-catalog.tsx
  - frontend/src/components/daemon/__tests__/subagent-async-derive.test.tsx
expects_from:
  task-01:
    - contract: SubagentPanelContext
      needs: [openSubagent, closeSubagent, activeId]
provides:
  - contract: SessionPanelSubagentProps
    fields: [openSubagentId, onOpenSubagent, onSubagentPanelClose]
goal: >
  新建右栏子代理详情面板（内容与主会话格式一致、无输入框、实时刷新）并把
  SessionPanel 接上三张可选 props（page 模式挂 context + 根 flex 行 + 可拖宽右列），
  dialog 等旧消费方零回归（design §5.B/§5.E/§5.F / FR-03 / FR-05）。
implementation:
  - '新建 subagent-detail-panel.tsx SubagentDetailPanel({ segment, onClose })——①头部：✕（data-testid=subagent-panel-close，onClose）+ 🤖 + 名称 + subagentType 标签 + 状态徽标 + 时长（头部派生抽公共纯函数 subagentHeaderOf(segment)，从 task-01 改造后的 SubagentBlockView 头部逻辑提取，两处共用；时长推导同 task-13 元数据/startedAt 双路径）；②正文：segment.children.map((c) => <SegmentView key={c.id} segment={c} />)（与主会话进度视图完全同构：文本/思考/工具展开/文件卡/stderr），面板内部 overflow-y-auto 独立滚动；③无任何输入框/发送控件（FR-03 底线）；④组件不读 displayTurns——段由父级实时解析传入（活引用，SSE 更新即重渲）'
  - 'session-panel/index.tsx——SessionPanelProps 增三个可选 props：openSubagentId?: string | null、onOpenSubagent?: (segmentId: string) => void、onSubagentPanelClose?: () => void，透传 session-panel-page'
  - 'session-panel-page.tsx 接线——①openSubagentId ?? null 与 onOpenSubagent/onSubagentPanelClose 组装 contextValue = { openSubagent: onOpenSubagent ?? (() => {}), closeSubagent: onSubagentPanelClose ?? (() => {}), activeId: openSubagentId ?? null }，SubagentPanelContext.Provider 包住面板根（page 模式才挂，dialog 分支不传 props 自动 activeId=null 走 task-01 回退）；②段解析 useMemo——displayTurns DFS findSegmentById（turn-state.ts 既有）定位 openSubagentId 段；段不存在（重装配后失效）useEffect 调 onSubagentPanelClose 自动关闭（design §5.E）；③根布局——openSubagentId != null 且段命中时面板根变 flex 行：[原面板内容 flex-1 min-w-0] + PanelResizer(side="right", aria「调整子代理面板宽度」) + 右列 div（width=panelWidth, data-testid=subagent-panel-column）内挂 SubagentDetailPanel；panelWidth 用本组件 usePanelWidth(storageKey=SESSIONS_FILE_PREVIEW_WIDTH_LS_KEY 从 portal-file-panels.tsx 导入，默认 480/min 320/max 860——与文件预览同键单槽位记忆，design §5.B）；④嵌套子代理（depth>1）在面板 children 中经 SegmentView→SubagentBlockView 紧凑卡片渲染，点击 openSubagent(嵌套段 id) 切换面板内容（context 已在面板内生效，天然支持）；⑤handleJumpToSubagent（2473-2519 行）双路径——onOpenSubagent 存在时直接调它开右栏（不切视图不滚动）；否则保留现有 setViewMode("all") + 双 rAF DOM 定位旧逻辑（dialog 回退）'
  - 'subagent-catalog.tsx——props 增 activeId?: string | null，行命中时描边高亮（与 task-01 卡片高亮同款 ring）；session-panel-page 两处 <SubagentCatalog> 调用点（2576/3027/3229 行附近）传 activeId={openSubagentId ?? null}'
  - 'NEW subagent-detail-panel.test.tsx——用例：①头部渲染名称/类型/时长与 ✕，点 ✕ → onClose；②children 经 SegmentView 渲染（文本可见、工具行可见）；③无输入框（queryByRole textbox / placeholder 断言不存在）；④嵌套子代理 child（tool 带 children）渲染为紧凑卡片，点击触发 context openSubagent（Provider 注入 spy）；⑤段失效路径（segment 传 null 时父级卸载面板——本组件不处理 null，由 page effect 负责，测试归 sessions-portal/session-panel 集成，此处只锁组件契约）；⑥subagentHeaderOf 纯函数：tool 段 primary 优先/subagentType 回退/stub 回退、taskElapsedMs 终态时长、running 走秒锚点缺失回退'
  - 'subagent-async-derive.test.tsx——SubagentCatalog 加 activeId 高亮断言用例（行命中 ring/aria-current）；既有用例零回归（未传 activeId 不高亮）'
acceptance:
  - 'SubagentDetailPanel 渲染子代理完整 children 时间线（与主会话 SegmentView 同构），头部含 ✕/名称/类型/徽标/时长，无任何输入框'
  - 'session-panel-page：openSubagentId 命中段时根为 flex 行 + 右把手 + 右列（data-testid=subagent-panel-column，宽度可拖、LS 记忆与文件预览同键）；段失效自动 onSubagentPanelClose'
  - 'handleJumpToSubagent：page 模式（onOpenSubagent 存在）直接开右栏；dialog 模式保留旧定位逻辑'
  - 'SessionPanel 不传新 props（dialog/悬浮宿主）行为与现状完全一致（session-panel-dialog.test.tsx 零回归）'
  - '新增两测试文件用例全绿 + subagent-async-derive/session-panel-dialog 既有用例全绿'
verify:
  - 'pnpm -C frontend exec tsc --noEmit（对照基线 0 新增错误）'
  - 'pnpm -C frontend exec eslint src/components/daemon/subagent-detail-panel.tsx src/components/daemon/session-panel/index.tsx src/components/daemon/session-panel/session-panel-page.tsx src/components/sessions/subagent-catalog.tsx src/components/daemon/__tests__/subagent-detail-panel.test.tsx src/components/daemon/__tests__/subagent-async-derive.test.tsx（0 error 0 warning）'
  - 'pnpm -C frontend exec vitest run src/components/daemon/__tests__/subagent-detail-panel.test.tsx src/components/daemon/__tests__/subagent-async-derive.test.tsx src/components/daemon/__tests__/session-panel-dialog.test.tsx（全绿）'
constraints:
  - 'SubagentDetailPanel 不自带取数（段由父级传入活引用）；不做返回栈/面包屑（design §8 取舍）'
  - '不动 session-log-assembler / turn-state.ts；panelWidth 不新造 LS 键'
  - 'dialog 分支（mode=dialog 或未传新 props）必须零变化——context activeId 恒 null'
  - '样式对齐 portal-file-panels.tsx 壳风格（头部高度/边框圆角/✕ 按钮），brand-* 语义阶'
---
