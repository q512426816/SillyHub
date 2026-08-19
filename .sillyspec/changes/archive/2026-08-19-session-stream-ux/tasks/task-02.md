---
id: task-02
title: 装配器 override 撤回与去重
title_zh: 装配器 override 撤回、跨段撤回、双路去重与 stub 合并完备
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P0
depends_on: [task-01]
blocks: [task-03, task-06, task-09, task-10]
requirement_ids: [FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
provides:
  - contract: AssembledTurn
    fields: [segments, output, processItems, turnStartedAt, seenLogIds]
expects_from:
  task-01:
    - contract: TurnSegment
      needs: [kind, id]
    - contract: AssembledTurn
      needs: [segments]
goal: >
  在装配器内落地 override 撤回（前缀路由 + 跨段撤回）、text 段 streaming 置位/清除、双路去重与 stub 合并迁入，把 AssembledTurn 扩充为完整契约，替代 partialSegmentsRef 撤回语义。
implementation:
  - override 按 segmentId 前缀路由到目标段，支持 main 与 tool_use_id 两种前缀的三段格式（前缀:消息id:序号，Grill X-06）；文本截断与思考项移除规则平移自 applyLogToTurn 的 partialSegmentsRef 逻辑（page.tsx:1078-1192）
  - 跨段撤回——同一 segmentId 的 partial 文本被工具段打断分裂成多段后 override 到达，各分裂段一并撤回（R-06，与现有单串截断语义不同）
  - text 段 streaming 置位 = 收到带 segment_id 的 partial 追加；清除 = 该 segmentId 收到 override 或 turn 终态（design §5 Phase3）
  - 双路去重——SSE 实时路径平移 seenLogIds 的 log_id 去重；历史批量路径支持 seenText 内容级去重（kind 加文本为键）；两路语义不合并（Grill X-08）
  - subagent_stub 合并迁入——后续 tool 段到达且 id 匹配 stub 的 parent_tool_use_id 时 children 合并迁入并移除 stub（design §9.5）
acceptance:
  - override 撤回正确——两前缀三段格式 × 文本/思考两 variant（无此 id 静默 no-op），跨段分裂多段一并撤回，output 投影同步
  - partial 追加期间 text 段 streaming 为 true，override 或 turn 终态后清除
  - 重复 log_id 不产生重复段；历史模式重复内容只保留一次
  - 先子后父时序下 stub 建立、tool 段到达后合并迁入、stub 移除
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 撤回与配对规则平移现有实现不发明新语义；纯函数不引入 React 依赖；单测统一放 task-03 本任务只实现
related_tests:
  - frontend/src/components/daemon/__tests__/session-log-assembler.test.ts（task-03 编写，覆盖 R-06 跨段撤回与双路去重用例）
---
