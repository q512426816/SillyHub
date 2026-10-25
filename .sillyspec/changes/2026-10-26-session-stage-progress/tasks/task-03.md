---
id: task-03
title: 'frontend 数据层与接线（sse 信封+stream 分发+turn-state 终态清理+双面板+timeline 透传+测试+gen:types）'
title_zh: 'frontend 数据层与接线（sse 信封+stream 分发+turn-state 终态清理+双面板+timeline 透传+测试+gen:types）'
author: 'qinyi'
generated_by: sillyspec-taskcard
created_at: 2026-10-26 03:49:35
priority: P0
depends_on: ['task-01', 'task-04']
blocks: [task-05]
requirement_ids: [FR-04, FR-06]
decision_ids: [D-008@v1, D-010@v1, D-012@v1, D-013@v1]
allowed_paths:
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/lib/daemon/session-stream.ts
  - frontend/src/components/daemon/session-panel/turn-state.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/lib/api-types.ts
  - frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
target_files:
  - frontend/src/lib/daemon/session-sse.ts
  - frontend/src/lib/daemon/session-stream.ts
  - frontend/src/components/daemon/session-panel/turn-state.ts
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx
  - frontend/src/components/daemon/session-panel/session-panel-dialog.tsx
  - frontend/src/components/daemon/turn-timeline.tsx
  - frontend/src/lib/api-types.ts
  - NEW:frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts
expects_from:
  task-01:
    - sse 载荷契约
  task-04:
    - currentPhase prop 契约
goal: >
  frontend 数据层与接线：turn_phase 事件从 SSE 信封到轮状态到 TurnStatusBar prop 的全链路，
  含 run_id 白名单防御丢弃与轮终态清理（D-013）。
provides:
  - currentPhase 类型: "turn-state.ts 导出 TurnPhaseState={phase: string; at: number}；轮对象可选字段 currentPhase"
  - 轮状态接线: "onTurnPhase handler 写入/更新轮 currentPhase；turn_completed/failed/killed 终态清空；timeline 渲染点透传给 TurnStatusBar"
implementation:
  - frontend/src/lib/daemon/session-sse.ts：SessionEventKind 加 "turn_phase"；SessionStreamEnvelope 加可选 phase?: string、detail?: string | null（timestamp 复用既有字段名——三键与 payload 逐字对齐 D-012）
  - frontend/src/lib/daemon/session-stream.ts：run_id 必填白名单（约 288-301 行）加 "turn_phase"（缺失即丢弃=D-013 防御丢弃实现点）；switch 加 case "turn_phase" → handlers.onTurnPhase?.(envelope)；handlers 接口加可选 onTurnPhase
  - frontend/src/components/daemon/session-panel/turn-state.ts：导出 TurnPhaseState 类型；轮状态加 currentPhase 字段；upsertTurn/replacePlaceholderTurn 路径透传；新增 applyTurnPhase(turns, runId, phase) helper（at=Date.now() 到达时刻）与终态清理（turn_completed/failed/killed 分支清空 currentPhase，D-013③）
  - frontend/src/components/daemon/session-panel/session-panel-page.tsx 与 session-panel-dialog.tsx：注册 onTurnPhase handler → applyTurnPhase 写轮状态（双消费方同款接线）
  - frontend/src/components/daemon/turn-timeline.tsx：TurnStatusBar 渲染点（约 2370 行）透传 currentPhase={turn.currentPhase ?? null}
  - 新增 frontend/src/lib/daemon/__tests__/session-stream-turn-phase.test.ts：①turn_phase 事件消费→currentPhase 写入（phase/at 断言）②缺失 run_id 事件被白名单丢弃③乱序到达 last-write-wins④turn_completed/failed/killed 终态清空 currentPhase⑤跨 run 事件不污染他轮（run_id 归属路由）
  - cd frontend && pnpm gen:types 重生成 frontend/src/lib/api-types.ts（含 task-01 DTO；若暴露无关旧测试债按仓库规则 21 顺手补字段修好）
acceptance:
  - turn_phase 事件→轮状态 currentPhase 写入（at=本地 Date.now()）；缺失/null run_id 事件被丢弃不建轮
  - 三种轮终态均清空 currentPhase（防断线假超时警示，R-01 兑现）
  - 未知 phase 值（词表外）透传原始字符串不被丢弃（兜底展示由 task-04 PHASE_LABEL 缺省分支承接）
  - frontend/src/lib/api-types.ts 与 backend/openapi.json 同步（gen:types diff 仅含新增）
verify:
  - cd frontend && pnpm vitest run src/lib/daemon/__tests__/session-stream-turn-phase.test.ts（输出落盘只看尾部）
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - lastLogTs 游标仅 log 事件推进（既有逻辑零改动）；keepalive 帧不触发 handler
  - currentPhase 挂轮状态（turn 对象）非组件局部 state——面板重挂载不丢失（Review Focus #3）
  - 双消费方（page/dialog）接线同款，勿只接一处
---

<!-- 骨架由 sillyspec taskcard 生成（LF 行尾 + frontmatter 已闭合 + 硬校验 9 字段齐全）。
     用 Edit tool 填充上方占位符（allowed_paths/goal/implementation/acceptance/verify/constraints 等），
     勿用 Write 整文件重写——会引入 CRLF 行尾/漏闭合 ---/漏字段回归。
     ⚠️ plan --done 硬校验会拦截未替换的占位符（FR-XX / D-XXX / src/example/file.ts /
     一句话说明这个 task / 具体步骤 1 / 可验证的验收条件 1 / 边界约束 1）——占位符视同缺字段。
     target_files 格式（可选，对账用精确文件级意图声明，与 allowed_paths 语义不同）：
                    精确文件路径（仓根相对、正斜杠），当前不存在、将由本 task 新建的文件加
                    NEW: 前缀（如 NEW:src/foo.js）；禁 glob（src/**）、禁目录前缀（src/dir/）、
                    禁绝对路径；无明确文件级意图时保留 [] 占位行不动。
     implementation/acceptance 里的源码位置同样写仓根相对全路径+行号（src/foo.js:123）——
                    裸文件名在 docs-check 层1 靠 basename 全仓扫描找候选，找不到候选或关键词
                    窗口不匹配即失效，到 pre-push 才拦（2026-09-19 实证 64 处返工）。
     可选字段按需插进上方 frontmatter（规则见 taskcard-rules）：
     repo:          仅跨仓 task 填（local.yaml repos: 注册的仓 key；缺省=main。allowed_paths 相对该仓根写，
                    禁止带仓库名前缀/绝对路径——review 对账按仓根相对路径匹配，带前缀永不命中）
     provides:      仅当本 task 给其他 task 提供接口/DTO/响应时填
     expects_from:  仅当本 task 消费其他 task 的契约时填
     related_tests: 仅当本 task 改动导致既有测试断言失效时填（测试路径须同时进 allowed_paths） -->
