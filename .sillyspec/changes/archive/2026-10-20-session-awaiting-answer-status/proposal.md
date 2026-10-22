---
author: flow-machine-draft
created_at: 2026-10-22T15:59:16.975Z
---
# 提案书（Proposal）— 2026-10-20-session-awaiting-answer-status

## 动机

任务原话转写：左侧会话状态补充等待回答问号

用户要求：会话页左侧列表的状态补充一个类型——会话中若 agent 调用 AskUserQuestion 等用户回答问题（等待回答），状态要显示问号。现状：左侧 sessionStatusIndicator 只有 failed/ended/run 状态（pending_approval 琥珀「在等你」/running 转圈）与活性 blocked 琥珀点；等待用户回答时 run 仍是 running，列表显示转圈「正在执行」，用户看不出在等自己。数据面已查明：SessionDialogRequest 表按 status='pending' 持久化所有用户对话题（dialog_kind=AskUserQuestion/plan_approval/codex_request_user_input/mcp_elicitation/pi_extension_ui），左栏当前未消费。

成功标准：
- 列表端点批量注入等待回答标记（照 current_run_status 的 IN 批查先例，零 N+1），存在 pending 对话请求的会话下发该标记
- 左侧状态指示器新增「问号」形态（等待回答），压过 run running 的转圈；终端态 failed/ended 仍权威优先
- 无 pending 对话的会话展示零回归（既有五分类不变）
- 后端注入与前端指示器有单测覆盖，触及面测试全绿

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 列表端点批量注入等待回答标记（照 current_run_status 的 IN 批查先例，零 N+1），存在 pending 对话请求的会话下发该标记
2. 左侧状态指示器新增「问号」形态（等待回答），压过 run running 的转圈；终端态 failed/ended 仍权威优先
3. 无 pending 对话的会话展示零回归（既有五分类不变）
4. 后端注入与前端指示器有单测覆盖，触及面测试全绿

## 成功标准（可验证）

1. 列表端点批量注入等待回答标记（照 current_run_status 的 IN 批查先例，零 N+1），存在 pending 对话请求的会话下发该标记
2. 左侧状态指示器新增「问号」形态（等待回答），压过 run running 的转圈；终端态 failed/ended 仍权威优先
3. 无 pending 对话的会话展示零回归（既有五分类不变）
4. 后端注入与前端指示器有单测覆盖，触及面测试全绿
