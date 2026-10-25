---
author: flow-machine-draft
created_at: 2026-10-25T06:05:53.766Z
---
# 提案书（Proposal）— 2026-10-25-askuser-keyword-overkill-fix

## 动机

任务原话转写：动机：会话 96b55567 排查实证——前端 session-log-assembler.ts classifySessionLog 第 318 行 trimmed.includes("AskUserQuestion") 全子串丢弃规则，把回复正文提到该词的合法消息整条静默吞掉（该会话收尾汇报 1860 字丢失，正文含「AskUserQuestion 工具卡片」字样）；生产库形态分布实证该规则唯一合理目标（AskUserQuestion 工具调用行）已被既有规则覆盖，其余全是误杀。
成功标准：
- [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）
- [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段
- AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃
- 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）
2. [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段
3. AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃
4. 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过

## 成功标准（可验证）

1. [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）
2. [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段
3. AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃
4. 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过
