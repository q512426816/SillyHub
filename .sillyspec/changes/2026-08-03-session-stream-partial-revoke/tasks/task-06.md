---
id: task-06
title: interactive-session-panel.tsx onLog(:302-373) 撤回——turn 维护 partialSegments Map，partial 记起点+append，override 按 segmentId 截断 output（reply slice）/移除 processItems 项（thinking），turn 边界清空 Map，多 segment 隔离
title_zh: onLog 按 segmentId 撤回半截
author: WhaleFall
created_at: 2026-08-03 10:23:11
priority: P0
depends_on: [task-04, task-05]
blocks: [task-08]
requirement_ids: [FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/interactive-session-panel.tsx
provides:
  - contract: onLog 撤回行为（实时 SSE 路径）
    behavior: "partial(reply/thinking, env.segment_id 非空) 记起点+append；override 按 segmentId 截断 turn.output(reply)/移除 processItems 项(thinking)"
expects_from:
  - contract: classifySessionLog override kind { segmentId, variant }（task-05）
  - contract: SessionStreamEnvelope.segment_id / stale（task-04）
goal: >
  onLog 收到 override 撤回令箭时按 segmentId 精确撤回已渲染的半截（reply 截断 output / thinking 移除 processItems 项），最终只显示 complete 全文，消除「半截+全文」重复。
implementation:
  - 在组件内加 partialSegmentsRef = useRef<Map<string, { outputStart: number } | { itemIndex: number }>>(new Map())，key=segmentId。Map 挂 ref（非 state）——撤回只改 turn 内容（经 setView/upsertTurn 触发渲染），Map 本身不驱动渲染。
  - onLog（:302-373）在分类得到 seg 后，于现有 reply/thinking 分支内追加 partial 记录：
    - seg.kind==="reply" 且 env.segment_id 非空 → 先 partialSegmentsRef.current.set(env.segment_id, { outputStart: turn.output.length })，再 turn.output += seg.text（outputStart 记录半截起点，截断时 slice(0, outputStart)）。
    - seg.kind==="thinking" 且 env.segment_id 非空 → 先记 { itemIndex: turn.processItems.length }（即将 append 的 thinking 项索引），再走现有 processItems append 分支。
  - 新增 seg.kind==="override" 分支（在 reply/thinking/tool_* 之外，早 return turn 不增 seenLogIds）：
    - variant==="assistant"（reply 撤回）：从 Map 取 { outputStart } → 返回 { ...turn, output: turn.output.slice(0, outputStart) }；Map.delete(seg.segmentId)。
    - variant==="thinking"：从 Map 取 { itemIndex } → processItems = turn.processItems.filter((_, i) => i !== itemIndex)；返回 { ...turn, processItems }；Map.delete(seg.segmentId)。
    - Map 无该 segmentId（迟到 override / complete 已替换）→ 静默 no-op return turn。
  - override 分支不写 seenLogIds（override envelope log_id=None，task-02 design §7.1；写进去会污染去重集合且 key 为 null）。
  - turn 边界清空：onTurnCompleted（:376）收敛终态后、clearCurrentRun 触发处，partialSegmentsRef.current.clear()（防跨 turn 串扰，R-02）。在 upsertTurn 的 apply 回调外层（setView 之外）调，避免清空依赖渲染时机。
  - 多 segment 隔离：segmentId 前缀 main:（主 agent）vs <tool_use_id>:（子代理）天然不同 key，Map 按 segmentId 隔离不串扰，无需额外命名空间。
acceptance:
  - 半截 reply（env.segment_id="main:m:1", content="[ASSISTANT] 半") → turn.output 含「半」且 Map 记 {outputStart}；override([ASSISTANT_OVERRIDE] main:m:1) 到达 → turn.output 被截断到半截前（slice(0, outputStart)）。
  - 半截 thinking 同理：override([THINKING_OVERRIDE] tu:2) → 对应 processItems 项被移除。
  - complete（env.segment_id=null）正常 concat/追加，不被记入 Map。
  - 多 segment：主 agent segment_id="main:..." 与子代理 segment_id="tu_xyz:..." 各自独立撤回，互不影响（AC-05 多 segment 不串扰）。
  - turn_completed / clearCurrentRun 后 Map 清空（下一 turn 不残留旧 segmentId）。
verify:
  - cd frontend && pnpm exec tsc --noEmit
  - cd frontend && pnpm test src/components/daemon/__tests__/interactive-session-panel.test.tsx
  - cd frontend && pnpm exec eslint src/components/daemon/interactive-session-panel.tsx
constraints:
  - 撤回必须不可变：turn.output = turn.output.slice(0, outputStart) 返回新对象，走 upsertTurn 函数式 setState（prev => apply），禁止直接 mutate turn（React 不重渲染 + P1-3 终态幂等依赖不可变更新）。
  - override 分支不增 seenLogIds（override log_id=None，写 null key 会污染去重集合，且 override 是信号非日志）。
  - Map 挂 useRef 不挂 useState：撤回的渲染由 setView/upsertTurn 驱动，Map 仅作 segmentId→起点 查表，自身变化不需触发渲染。
  - turn 边界必须清空 Map（onTurnCompleted/clearCurrentRun），防跨 turn segmentId 复用导致误撤回（R-02）。
  - 多 segment 天然隔离：segmentId 前缀 main: vs <tool_use_id>: 不同，不靠额外命名空间（design §5 Phase2.3）。
  - 仅实时 SSE 路径（onLog）做撤回；logsToTurns 历史路径数据本就干净（task-02 override 不落库 + task-14 partial 已 DELETE），不加撤回（task-07 / design §2.4）。
---
