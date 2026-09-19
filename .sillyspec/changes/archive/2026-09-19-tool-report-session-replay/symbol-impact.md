# 符号影响面报告

> tasks.md 内容指纹（生成时）: a83e927f98824c83——重入本步时若与当前 tasks.md 指纹一致且结论已填全，直接沿用不重做扫描。
> 骨架由 CLI 生成（`sillyspec symbol-impact --change <变更名>`，gate 失败时也会自动落一份）。

- task-01: 签名级变更=接口扩展（可选字段，零破坏）。NormalizedLogMessage（sillyhub-daemon/src/agent-log/parse-zcode-model-io.ts:66）增可选 sender/turn_id/model/duration_ms/usage；AgentLogMessagesResult（sillyhub-daemon/src/agent-log/registry.ts:46）增可选 totalUsage。受影响消费点：parse-zcode-model-io.ts 内部构造点、read-zcode-sqlite.ts 返回构造、host-fs-handler.ts readAgentLogMessages 返回——均在 task-02/03/06 范围内；TypeScript 可选字段不改运行时签名，跨文件调用零强制更新。
- task-02: 签名级变更=无（函数签名不变）。parseZcodeModelIoLog 内部实现：extractModelIoLine（parse-zcode-model-io.ts:263）读顶层 turnId/model/durationMs/response.usage 并经 makeSegment（:405）附着；userSegments（:291）加 system_event 判定（前缀常量沿用 SYSTEM_REMINDER_BLOCK_RE 附近新增）。受影响调用点：registry PARSERS 引用不变；tests/agent-log/parse-zcode-model-io.test.ts 断言更新在任务内。
- task-03: 签名级变更=无。readZcodeSqliteMessages（read-zcode-sqlite.ts）内部双层遍历（message×part）补 usage/turn_id 提取（JSON 键存在性 best-effort）；返回类型继承 task-01 扩展。调用点 host-fs-handler.ts:2063 不变。spike-01 只读核对结论落 verify-facts.json。
- task-04: 新文件 parse-claude-code-jsonl.ts——导出新函数 parseClaudeCodeJsonlLog（签名对齐 registry.ts AgentLogParser：content + options{beforeSeq} → AgentLogMessagesResult）。受影响调用点：仅 task-06 registry 注册（范围内）；无既有符号改动。
- task-05: 新文件 parse-cursor-agent-transcript.ts——导出新函数 parseCursorAgentTranscriptLog（同 AgentLogParser 签名）。受影响调用点：仅 task-06 registry 注册（范围内）；无既有符号改动。
- task-06: 签名级变更=无。registry.ts PARSERS Map 增两键（数据成员，非签名）；host-fs-handler.ts readAgentLogMessages 返回值原样透传（task-01 可选字段自动随行，无代码改动——若无字段则确认透传无需显式展开）。调用点 daemon.ts RPC 注册不变。
- task-07: 新测试文件 agent-log-matrix.test.ts——无生产符号改动；消费 task-01 契约类型与 task-02/04/05 导出函数。
- task-08: 签名级变更=Pydantic schema 字段扩展（可选）。AgentLogMessagesResponse（backend/app/modules/platform_sync/schema.py）内层消息增可选 sender/turn_id/model/duration_ms/usage + 外层 total_usage；router.py messages 端点转换映射增字段。受影响调用点：openapi.json/api-types.ts 重生成（命令产物）；前端 agent-logs.ts 类型引用自动获得新可选字段（零破坏）。
- task-09: 新文件 agent-log-turns.ts——导出 buildReplayTurns(messages): SessionTurnView[]（纯函数）。消费 task-08 生成类型 + SessionTurnView/SessionProcessItem（turn-timeline.tsx:220/:190，类型引用不改其签名）。无既有符号改动。
- task-10: 类型级变更=联合扩展。SessionProcessItem（frontend/src/components/daemon/turn-timeline.tsx:190）增 { kind:"system_event"; text:string; ts?:number } 成员 + 渲染分支。TypeScript 联合窄化：既有 switch/exhaustive 检查点若有 default 兜底零影响（执行时核对「全部」视图渲染分支）；实时会话数据路径不产生该 kind。
- task-11: 新文件 agent-replay-body.tsx——导出 AgentReplayBody({sessionId, focusEntryId?})。消费 buildReplayTurns（task-09）、TurnTimeline（既有 props 不改签名）、agent-logs.ts 既有 API 函数、query-keys 既有键。无既有符号改动。
- task-12: 符号删除=AgentLogSessionBody（agent-log-card.tsx:1016 导出组件）。受影响调用点：session-panel-page.tsx:3520（换挂 AgentReplayBody，任务内）与 agent-log-card.test.tsx 专属 describe（任务内删除）；page-helpers.tsx:69 仅注释提及不改代码（边界外确认无 import）。agent-logs.ts 仅注释。
- task-13: 无签名级变更。agent-log-card.tsx 409 回落文案字符串更新（fallbackNoteForError ApiError 分支展示 err.message，实际改动点为该文案的消费展示或后端 409 message 原样透传的展示行——执行时以最小改动落文案）；新增 docs/sillyspec 文档。
