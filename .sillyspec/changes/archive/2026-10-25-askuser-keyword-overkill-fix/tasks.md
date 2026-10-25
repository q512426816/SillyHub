---
author: flow-machine-draft
created_at: 2026-10-25T06:05:53.766Z
---
# 任务注册表（Tasks）— 2026-10-25-askuser-keyword-overkill-fix

- [x] task-01: [ASSISTANT] 回复正文含「AskUserQuestion」字样的消息不再被丢弃，全文按 reply 段装配渲染（以 96b55567 收尾汇报真实形态做回归测试）
- [x] task-02: [THINKING] 正文含该词的思考行不再被误杀，正常产出 thinking 段
- [x] task-03: AskUserQuestion 工具调用行维持现状：tool_call JSON 行仍被丢弃（提问卡由 dialog 通道 DialogQaBlock 渲染，防双画），stdout 的 [TOOL_USE] AskUserQuestion 文本行仍被丢弃
- [x] task-04: 触及测试全绿 + 触及文件 lint 0 errors + typecheck 通过
