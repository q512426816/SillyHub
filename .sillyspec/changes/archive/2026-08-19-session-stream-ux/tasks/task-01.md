---
id: task-01
title: implement-session-log-assembler-core
title_zh: 共享装配器核心（session-log-assembler.ts）
author: WhaleFall
created_at: 2026-08-19 18:43:32
priority: P0
depends_on: []
blocks: [task-02, task-03, task-05, task-06, task-07, task-09, task-10, task-11]
requirement_ids: [FR-01, FR-03, FR-05]
decision_ids: [D-002@v1]
allowed_paths:
  - frontend/src/components/daemon/session-log-assembler.ts
  - frontend/src/components/daemon/session-log-sanitize.ts
provides:
  - contract: TurnSegment
    fields: [kind, id, status, startedAt, endedAt, children]
  - contract: AssembledTurn
    fields: [segments, output, processItems, turnStartedAt, seenLogIds]
  - contract: AssemblerLogInput
    fields: [logId, channel, content, timestamp, segmentId, parentToolUseId, subagentType, depth]
  - contract: applyLogToSegments
    fields: [AssembledTurn, AssemblerLogInput]
expects_from:
goal: >
  按 design §5 Phase1 与 §7 新建纯函数装配模块，把归一后的日志分类并装配为 TurnSegment 分段模型，含子代理归属路由与兜底段。
implementation:
  - 新建 session-log-assembler.ts，按 §7 定义 AssemblerLogInput、TurnSegment 五变体（text/thinking/tool/subagent_stub/stderr）、AssembledTurn（含 output/processItems 兼容投影与 turnStartedAt），导出 applyLogToSegments 与 logsToSegments（后者只产出每轮 TurnSegment 数组，turn 级胶水仍归 logsToTurns）
  - 分类接入——classifySessionLog/OVERRIDE_RE 等自 session-log-sanitize.ts 迁移为装配器内部依赖，原文件保留同名导出垫片（panel/helpers/page 与既有单测等三方引用零改动）
  - 归属路由——parentToolUseId 非空路由到匹配 tool 段的 children；匹配不到创建 subagent_stub 兜底段（记录 subagentType），后续 tool 段到达且 id 匹配则 children 合并迁入并移除兜底段
  - 分段装配——reply 文本遇非文本段后开新段否则续接当前段、thinking 连续合并、tool 段 id 从 tool_call JSON 解析 tool_use_id、tool_result 在同一归属桶内按最后一个未配对 tool 项位置配对、stderr 生成 stderr 段
acceptance:
  - 纯函数模块无 React 依赖、无副作用，时间一律取自输入 timestamp
  - 旧日志无归属字段时按主 agent 平铺（depth 视 0），装配投影与现状等价，sanitize 垫片对外导出与分类语义不变、既有引用零改动可编译
verify:
  - cd frontend && pnpm exec tsc --noEmit
constraints:
  - 分类与解析规则平移不重造（classifySessionLog/isToolResultDenied/statusFromToolUseRaw 语义不变）
  - override 撤回、segmentId 前缀路由、streaming 置位清除、log_id 去重不在本卡（task-02）
  - 不改 turn-timeline.tsx 与两处 applyLogToTurn 消费方副本（task-06/09/10）
related_tests: []
---
