---
id: task-04
title: 'sessions-portal.tsx 槽位互斥接线（subagentView 状态/点文件清子代理/点子代理清文件/会话切换清零/SessionPanel props 装配）+ sessions-portal.test.tsx 新用例'
title_zh: 'sessions-portal.tsx 槽位互斥接线（subagentView 状态/点文件清子代理/点子代理清文件/会话切换清零/SessionPanel props 装配）+ sessions-portal.test.tsx 新用例'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-09-15 18:23:35
priority: P0
depends_on: ['task-03']
blocks: []
requirement_ids: [FR-01, FR-05]
decision_ids: [D-001@v1, D-003@v1]
allowed_paths:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
target_files:
  - frontend/src/components/sessions/sessions-portal.tsx
  - frontend/src/components/sessions/__tests__/sessions-portal.test.tsx
expects_from:
  task-03:
    - contract: SessionPanelSubagentProps
      needs: [openSubagentId, onOpenSubagent, onSubagentPanelClose]
goal: >
  在 sessions-portal.tsx 落地右栏单槽位互斥——subagentView 状态、点文件清子代理/
  点子代理清文件的双向覆盖、会话切换清零，并把三张 props 装配进真会话分支的
  SessionPanel（design §5.A / FR-01 / D-003@v1 互斥由 portal 双向清零实现）。
implementation:
  - 'sessions-portal.tsx 新增 state subagentView: { segmentId: string } | null（与 filePreview 并列，195 行附近）'
  - '互斥写入——①handleOpenSubagent = useCallback((segmentId) => { setFilePreview(null); setSubagentView({ segmentId }); })；②onSelectFile（659-663 行）改为 setSubagentView(null) 后落 setFilePreview（最后触发覆盖：文件胜）；✕ 关闭预览（1002 行）不变'
  - '会话切换清零——selectedSessionId 变化（含清 null）时 setSubagentView(null)：用 useEffect 监听 selectedSessionId（段 id 属旧会话，跨会话无意义，design §5.A）；群选中（selectedGroupId）/进预会话同理经同一 effect 或在对应分支清（切群/预会话时 SessionPanel 卸载，面板随 key 重挂载天然消失，subagentView 残值会在切回会话时误开——统一在 effect 里按 selectedSessionId 变化清零即可覆盖）'
  - 'SessionPanel 装配——真会话分支（888-895 行）传 openSubagentId={subagentView?.segmentId ?? null} onOpenSubagent={handleOpenSubagent} onSubagentPanelClose={() => setSubagentView(null)}；预会话分支（897-905 行）不传（无历史子代理）；key 重挂载契约不变'
  - 'sessions-portal.test.tsx 新增 describe「子代理右栏槽位互斥（subagent-three-pane）」——mock SessionPanel 捕获 props（沿用既有 mock 惯例）：①初始 subagentView=null（SessionPanel 收 openSubagentId=null）；②onOpenSubagent 触发后 SessionPanel 收到新 segmentId；③onOpenSubagent 后 onSelectFile（文件树选文件）→ openSubagentId 回 null 且预览列挂载（文件覆盖子代理）；④onSubagentPanelClose → openSubagentId 回 null；⑤会话切换（重新 onSelect 另一会话）→ openSubagentId 清零；⑥群/预会话分支不受影响（SessionPanel 卸载断言既有用例覆盖）'
acceptance:
  - '点子代理 → 文件预览关闭、SessionPanel openSubagentId 收到 segmentId；点文件 → 子代理面板关闭、预览列挂载；严格最后触发覆盖（FR-01）'
  - '会话切换后 openSubagentId 清零，不残留旧会话子代理面板（FR-01）'
  - '右栏视觉一次只出现一种（文件预览列在 portal 渲染 / 子代理列在 SessionPanel 内渲染，互斥由状态清零保证——两列不同时存在）'
  - '新增 describe ≥5 用例 + sessions-portal 既有用例全绿'
verify:
  - 'pnpm -C frontend exec tsc --noEmit（对照基线 0 新增错误）'
  - 'pnpm -C frontend exec eslint src/components/sessions/sessions-portal.tsx src/components/sessions/__tests__/sessions-portal.test.tsx（0 error 0 warning）'
  - 'pnpm -C frontend exec vitest run src/components/sessions/__tests__/sessions-portal.test.tsx（新增 + 既有全绿）'
  - '浏览器手验（verify 阶段）：对话视图点子代理卡片开右栏 → 左栏文件树点文件覆盖右栏 → 再点子代理卡片切回——覆盖链路可视验证'
constraints:
  - '不动 filePreview 既有语义（预览列渲染/宽度/关闭零变化）；不动群/预会话/空门户三分支'
  - 'portal 不渲染子代理面板本体（归属 SessionPanel，design §5.B）；portal 只管槽位状态与双向清零'
  - '不新造 LS 键；subagentView 不入 URL 参数'
---
