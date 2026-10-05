---
author: flow-machine-draft
created_at: 2026-10-05T17:26:47.337Z
---
# 提案书（Proposal）— 2026-10-06-opencode-go-direct-anthropic

## 动机

任务原话转写：修复 opencode 供应商路由：改走 go 端点原生 anthropic 直连（x-api-key 鉴权），替代依赖已隔离 LiteLLM 的 openai_chat 死链路
成功标准：
- 前端 opencode_go 预设 auth_field 修正为 ANTHROPIC_API_KEY（实测 opencode /zen/go/v1/messages 仅认 x-api-key，Bearer 恒 401）
- 预设默认模型更新为 deepseek-v4.1-flash 且 4 角色槽全填该模型
- 阿里云服务器 OpenCode Go 供应商行已切 anthropic 直连，真实 Claude Code 端到端会话验证通过（纯文本 + 工具调用）
- 前端预设相关测试通过，未跑全量测试

## 变更范围

按成功标准机械推导，共 4 条验收面：
1. 前端 opencode_go 预设 auth_field 修正为 ANTHROPIC_API_KEY（实测 opencode /zen/go/v1/messages 仅认 x-api-key，Bearer 恒 401）
2. 预设默认模型更新为 deepseek-v4.1-flash 且 4 角色槽全填该模型
3. 阿里云服务器 OpenCode Go 供应商行已切 anthropic 直连，真实 Claude Code 端到端会话验证通过（纯文本 + 工具调用）
4. 前端预设相关测试通过，未跑全量测试

## 成功标准（可验证）

1. 前端 opencode_go 预设 auth_field 修正为 ANTHROPIC_API_KEY（实测 opencode /zen/go/v1/messages 仅认 x-api-key，Bearer 恒 401）
2. 预设默认模型更新为 deepseek-v4.1-flash 且 4 角色槽全填该模型
3. 阿里云服务器 OpenCode Go 供应商行已切 anthropic 直连，真实 Claude Code 端到端会话验证通过（纯文本 + 工具调用）
4. 前端预设相关测试通过，未跑全量测试
