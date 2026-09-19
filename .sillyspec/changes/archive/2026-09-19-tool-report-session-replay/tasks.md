---
author: qinyi
created_at: 2026-09-19 20:55:00
---
# 任务清单（Tasks）

- [x] task-01: daemon 契约扩展——NormalizedLogMessage 增可选 usage/turn_id/model/duration_ms/sender + AgentLogMessagesResult 增 totalUsage
- [x] task-02: zcode 文件解析器补字段（顶层 turnId/model/durationMs + response.usage 附着 + task-notification/system-reminder → system_event）+ totalUsage 累计；连带更新 tests/agent-log 既有形状断言 (depends_on: task-01)
- [x] task-03: zcode sqlite 读取器补字段（spike-01 fixture 核对 db.sqlite JSON 含 usage 与否，结论记 verify-facts） (depends_on: task-01)
- [x] task-04: 新增 parse-claude-code-jsonl 解析器（行过滤/isMeta+注入前缀→system_event/tool_result 载体→工具段配对/usage 透传） (depends_on: task-01)
- [x] task-05: 新增 parse-cursor-agent-transcript 解析器（{role,message} + turn_ended 切轮；spike-02 fixture 核对 tool_result 落盘形态） (depends_on: task-01)
- [x] task-06: registry 注册两 format + host-fs-handler 透传新字段与 totalUsage (depends_on: task-02, task-04, task-05)
- [x] task-07: daemon 解析器矩阵单测（真实日志脱敏 fixture 三 harness + 字段断言） (depends_on: task-02, task-03, task-04, task-05, task-06)
- [x] task-08: 平台 messages schema 可选新字段 + 端点透传 + openapi.json/gen:types 重生成 (depends_on: task-01)
- [x] task-09: 前端适配器 buildReplayTurns 纯函数 + 单测 (depends_on: task-08)
- [x] task-10: turn-timeline 最小扩展（SessionProcessItem 增 system_event kind + 中性行渲染）
- [x] task-11: AgentReplayBody 组件（主/子分类、加载更早、TurnTimeline 挂载 11 props 取值、工作会话折叠条、不可用三态、total_usage）+ 组件测试 (depends_on: task-09, task-10)
- [x] task-12: session-panel-page 挂载切换 + AgentLogSessionBody 退役删除（连带清理 agent-log-card.test.tsx 专属 describe）+ agent-logs.ts 类型注释 (depends_on: task-11)
- [x] task-13: cursor IDE 409 死胡同提示改善 + docs/sillyspec 跨仓跟进记录
