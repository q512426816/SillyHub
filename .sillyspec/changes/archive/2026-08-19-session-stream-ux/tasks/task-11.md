---
id: task-11
title: 历史路径接入装配器
title_zh: logsToTurns 内部改走 logsToSegments + 兼容投影
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P0
depends_on: [task-01]
blocks: [task-03, task-09]
requirement_ids: [FR-01, FR-05]
decision_ids: []
allowed_paths:
  - frontend/src/components/daemon/runtime-session-helpers.tsx
  - frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx
provides:
  - contract: logsToTurns
    fields: [segments, output, processItems, realRunId]
expects_from:
  task-01:
    - contract: AssembledTurn
      needs: [segments, output, processItems]
goal: >
  logsToTurns 内部改走装配器 logsToSegments 产出段序列，保留兼容投影（output 与 processItems 加 ts 映射）与 seenText 内容级去重，使历史恢复路径与实时 SSE 路径同源同模型。
implementation:
  - run 分组、user_input 提取 prompt、伪 runId 与 realRunId、status completed、token 置空等 turn 级胶水保留在 logsToTurns（design §7 Grill X-05 形状澄清）；AgentRunLogEntry 归一为 AssemblerLogInput 喂入 logsToSegments
  - 兼容投影——output 取文本段按序拼接；processItems 取平铺投影，tool 段 startedAt 与 thinking/stderr 段 ts 映射到 processItems 的 ts 字段（AskUser 穿插排序依赖，Grill X-08）
  - 保留现有 seenText 内容级去重（kind 加文本为键，喂入装配器前过滤），与 SSE 的 log_id 去重两路语义不合并（design §9.4）
  - 连续 thinking 合并、tool_use 状态取 JSON success、tool_result 位置配对与孤儿 deny 判定改由装配器核心承担，本函数不再手写
acceptance:
  - attach 历史恢复渲染与改造前等价（prompt/output/processItems/时间戳逐项一致）
  - 含归属字段的历史日志按 parent_tool_use_id 嵌套出子代理段；旧数据无归属字段平铺等价（design §9.1）
  - 重复内容条目只显示一次（seenText 去重保持）
  - runtime-session-helpers.test.tsx 既有断言全绿，受影响断言按段模型适配
verify:
  - cd frontend && pnpm test -- runtime-session-helpers
constraints:
  - 只改 logsToTurns 内部实现，导出签名与 SessionTurnView 产出形状不变；SessionHistoryView 等其余导出零改动
  - 历史数据本就干净（partial 已删、override 不落库），不加撤回逻辑（函数注释既有定论保留）
related_tests:
  - frontend/src/components/daemon/__tests__/runtime-session-helpers.test.tsx（适配受影响断言）
---
