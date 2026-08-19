---
author: WhaleFall
created_at: 2026-08-19 19:02:15
---

# 符号影响面报告（Symbol Impact）— 2026-08-19-session-stream-ux

> 扫描方法：逐 task 对照 allowed_paths，识别接口/类型/签名级变更，rg 搜索调用点与 plan allowed_paths 对账。

- task-01: 无签名级变更（新增模块 session-log-assembler.ts：新导出 applyLogToSegments/logsToSegments + 类型 TurnSegment/AssembledTurn/AssemblerLogInput，纯增量）；session-log-sanitize.ts 仅将 classifySessionLog 等**迁移实现为装配器内部依赖 + 原位保留导出垫片**，导出签名零变化——现有调用方（sessions/page.tsx:49、interactive-session-panel.tsx:64、runtime-session-helpers、既有单测）import 路径与签名不变，均在后续 task-09/10 allowed_paths 内或有零改动保证。
- task-02: 无签名级变更（session-log-assembler.ts 内部扩展 task-01 定义的同文件 API 行为：撤回/去重/stub 合并；AssembledTurn.seenLogIds 字段在 task-01 定义时已含）。
- task-03: 无签名级变更（纯新增测试文件；allowed_paths 含 assembler.ts 仅为追加测试辅助导出，不改既有导出签名）。
- task-04: 接口扩展（SessionStreamEnvelope 增 4 个**可选可空**字段 parent_tool_use_id/subagent_type/depth/tool_kind）。调用点搜索：envelope 构造仅 lib/daemon.ts streamSession 内部；字段读取方为 task-09/10（本变更范围内）。可选字段对既有消费零破坏，无范围外调用点。
- task-05: 无签名级变更（新文件 turn-segment-views.tsx，新导出组件族 + SegmentViewProps 类型）。
- task-07: 无签名级变更（新文件 turn-status-bar.tsx，新导出 deriveTurnActivity/TurnStatusBar + TurnActivitySummary 类型）。
- task-11: 函数内部实现变更（logsToTurns 签名不变：AgentRunLogEntry[] → SessionTurnView[]；返回对象将携带 segments/turnStartedAt **可选**字段——该 interface 扩展由 task-06 在 turn-timeline.tsx 同步声明）。调用点：sessions/page.tsx:265、interactive-session-panel.tsx:65、runtime-session-dialog——前两者在 task-09/10 allowed_paths 内；runtime-session-dialog 仅读既有字段（prompt/output/processItems/status），可选扩展零影响（rg 确认无 segments/turnStartedAt 读取）。
- task-06: interface 扩展（SessionTurnView 增可选 segments?/turnStartedAt?；TurnTimelineProps 与 SessionViewMode 取值不变）+ 模块内私有函数（TurnDetailsList/ToolEventCard/SessionCollapsible/parseToolRaw）迁移至 turn-segment-views 或改写——均为非导出符号，rg 确认无模块外引用。SessionTurnView 构造方三处（logsToTurns=task-11、page.tsx 占位/orphan turn=task-09、panel=task-10）全部在本变更范围。
- task-08: 无签名级变更（新文件 subagent-catalog.tsx）。
- task-09: 页内私有函数删除/改写（applyLogToTurn/upsertTurn 的 apply 回调内联逻辑→装配器调用；partialSegmentsRef 移除）——均非导出符号；viewMode UI 文案「全部→进度」为字符串字面量，断言影响已列 related_tests（page.test.tsx 实测无该文案断言，SSE handler 断言适配）。
- task-10: 同 task-09 性质（panel 私有 onLog 副本替换）；「全部」文案断言 16 处在 interactive-session-panel.test.tsx（allowed_paths 内）。
- task-12: 无签名级变更（新测试文件）。

## 结论

唯一接口级变更两处（SessionStreamEnvelope 可选字段扩展 / SessionTurnView 可选字段扩展）均为向后兼容增量，全部受影响调用点在本变更 12 个 task 的 allowed_paths 联合范围内。无范围外调用点，无阻断项。
