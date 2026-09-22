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
最近确认：353eb11b0
理由：会话身份锚定——只给「本 run 所属 agent 会话及其子代理（zcode parent_id 链）」打 ctx；识别不出不打标（宁缺毋滥）
