# 决策知识 — sillyspec

> decision-distill 从变更 decisions.md 幂等提炼（「最近确认」= 归档时 HEAD）。条目字段行为 docs-check 机械解析契约，勿手改。

## D-006@v1
状态：implemented
变更：2026-09-19-tool-report-session-replay
锚点：sillyhub-daemon/src/agent-log/registry.ts:57（PARSERS 单项注册表——扩展点）
最近确认：53c67e02a
理由：claude-code-jsonl 新增解析器并注册（对话化 + usage 一起落地，含 D-003 归一化）；cursor-agent CLI transcript 新增扫描上报（~/.cursor/projects/*/agent-transcripts/，现 96 份零上报）+ 新增解析器（结构干净 {role,message} JSONL + turn_ended，非 Claude Code 同构）；cursor IDE store.db（cursor-chat-sqlite）维持不做对话化（blob 库、无 token），但其 409 死胡同需给出像样说明；zcode 既有解析器补 D-004/D-005 字段

## D-001@v1
状态：implemented
变更：2026-09-11-agent-log-attribution-refactor
锚点：sillyspec 仓 src/agent-session-log.js（detectZcode/detectAgentLogEntries/recordAgentLogInvocation）
文件：.sillyspec/changes/roadmap-retire/tasks.md, .sillyspec/changes/roadmap-retire/design.md, .sillyspec/changes/roadmap-retire/proposal.md, .sillyspec/changes/roadmap-retire/requirements.md
最近确认：353eb11b0
理由：会话身份锚定——只给「本 run 所属 agent 会话及其子代理（zcode parent_id 链）」打 ctx；识别不出不打标（宁缺毋滥）

## D-001@v1 派生粒度=工具调用聚合为单任务
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：以「一轮（turn）内的活动」聚合为单条任务：turn_start 建/复running行（task_id=pi-run-<runId> 稳定键，task_name 取首轮用户消息或'执行任务'），tool_execution_start 刷新 last_tool_name/tool_uses 累计/summary（'正在调用 X'），tool_execution_end 保持 running（工具成败不等于任务成败），turn_end 按 stopReason 映射终态（error→failed 其余→completed）置 message/finished_at。子代理粒度（claude Task 工具那种）pi 原始流无对应概念，不做

## D-002@v1 派生位置选归一化器（方案 A）——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：选 A。PiEventNormalizer 增实例级 turnTask 聚合状态产出 status/agent_task_status——贴 claude-events 同位置派生信号的既有架构，session-manager/_dispatchStatusEvent→cli 上报链路零改动，纯函数测试范式可延续；代价是归一化器从逐行纯函数升级为实例级状态机（turn 边界做状态推进点，normalizeRpcLine 单行解析仍独立）

## D-003@v1 设计整体确认——⚠️ 自主决策待用户复核
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：按 D-001/D-002 定稿确认。原型跳过理由：纯数据链路补齐，前端任务执行面板零改动（pi 会话从空态变有数据，无界面变化，原型分级「纯后端无界面变化」档）

## D-004@v1 design-grill 修正——stopReason 枚举实证与测试路径
状态：implemented
变更：2026-09-07-pi-task-events
锚点：未记录
最近确认：35f3d6528
理由：修正三处：①fixture 全量实证 stopReason 仅 stop/error 两值，aborted 是 ame.error 的 reason（流层中止）非 stopReason——删除 aborted→stopped 映射，被打断的轮按 completed 收行；②测试路径实存 tests/interactive/pi-events.test.ts，新增集成用例定名 tests/interactive/pi-task-dispatch.test.ts；③R-01 应对改写：既有用例 expected 数组需追加派生事件（预期适配非破坏）

## D-001@v1 维持 R-01 接受不修代码，文档登记观察项（方案 A）
状态：implemented
变更：2026-09-16-background-task-grace-timeout
锚点：未记录
最近确认：83b402f6b
理由：D（不改代码），文档载体方案 A。维持 2026-09-15-background-task-permission-lockout R-01 已接受的 P1 风险；本变更收窄为 known-issues.md 观察条目（四要素：暴露差/缓解链/重估触发/未来修复首选）+ 本变更 design.md 否定决策存档
故障面：若未来线上实证注册表泄漏（守卫放行但无对应存活任务），无界宽限暴露面超出设计先例——观察项记录的重估触发条件命中时按「未来修复首选：双窗兜底（条目存活=静默<60min 对齐先例 且 总时长<4h 绝对上限）」重开变更
退役判据：SDK 提供 per-task 权限上下文（canUseTool 带 task 归属）或 task_notification 可靠送达保证时，本观察项与 R-01 一并退役
