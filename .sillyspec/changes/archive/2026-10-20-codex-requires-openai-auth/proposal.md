---
author: flow-machine-draft
created_at: 2026-10-20T03:44:58.848Z
---
# 提案书（Proposal）— 2026-10-20-codex-requires-openai-auth

## 动机

任务原话转写：动机与背景：腾讯云平台 codex 会话选直连（anthropic 形态）供应商时稳定断流（stream disconnected before completion）。根因已 A/B 实验锁定：daemon codex-settings.ts 写 per-session config.toml 时只写 name/base_url/wire_api，从不写 requires_openai_auth——codex CLI 对自定义 provider 默认不发 Authorization，auth.json 里的 key 永远不带出；上游（智谱 bigmodel 等）对无认证的流式请求直接掐流。2026-10-16 供应商 agent_kinds 合并后 codex 挂上 claude 的 anthropic 端点供应商，双重叠加（端点错 + 无认证头）暴露。端点错已由配置层拆分修复（新建「智谱 GLM Codex (wp)」/api/v1 条目），本变更修代码层的认证头缺失。

成功标准：
- daemon 对有 api_key 的 anthropic 直连形态 codex 供应商，写出的 config.toml [model_providers.sillyhub] 段含 requires_openai_auth = true；端到端：平台 codex 会话选直连供应商真实对话跑通（不再 stream disconnected）
- keyless 供应商（api_key 缺省）行为不变：不写该键，产物与现状逐字一致（spike A3a keyless 语义零回归）

## 变更范围

按成功标准机械推导，共 2 条验收面：
1. daemon 对有 api_key 的 anthropic 直连形态 codex 供应商，写出的 config.toml [model_providers.sillyhub] 段含 requires_openai_auth = true；端到端：平台 codex 会话选直连供应商真实对话跑通（不再 stream disconnected）
2. keyless 供应商（api_key 缺省）行为不变：不写该键，产物与现状逐字一致（spike A3a keyless 语义零回归）

## 成功标准（可验证）

1. daemon 对有 api_key 的 anthropic 直连形态 codex 供应商，写出的 config.toml [model_providers.sillyhub] 段含 requires_openai_auth = true；端到端：平台 codex 会话选直连供应商真实对话跑通（不再 stream disconnected）
2. keyless 供应商（api_key 缺省）行为不变：不写该键，产物与现状逐字一致（spike A3a keyless 语义零回归）
