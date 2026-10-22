---
author: flow-machine-draft
created_at: 2026-10-20T04:30:33.059Z
---
# 决策记录（Decisions）— 2026-10-20-codex-requires-openai-auth

## D-001@v1: 设计期风险与放弃方案（底稿）
- 类型：process
- 状态：confirmed
- 答案：最大风险：`requires_openai_auth` 是 codex CLI 的非 stability-guaranteed 配置键（cc-switch 生产配置与官方智谱接入文档均在用，当前 CLI 0.162.0 实测有效），未来 codex 大版本若更名/移除该键，症状回归为「不发认证 → 断流」——与 wire_api="chat" 被移除的先例同类。缓解：daemon 已有版本基线注记惯例（R-03），本变更在常量注释处注明 CLI 基线与实测依据；升级 codex 基线时冒烟面覆盖。 试过但放弃的方案： - 改走 openai_chat/litellm 代理通道（零代码）：模型选择退化为 usr-<uid>-<pid> 路由键、链路多 hub+LiteLLM 两跳，且该通道对 codex 从未被真实验证过（30 天零成功 run）；放弃。 - base_url 层面绕过（如要求用户把 key 拼进 URL）：bigmodel 不支持 URL 内嵌 key，且 key 进 URL 有日志泄漏面；放弃。 - 供应商配置面透传任意 provider 表键（settings_config 加 codex 专属段）：配置面扩大、需要 backend+daemon 双端改动，超出本次最小修复面；如未来需要 per-provider 差异键再立变更。
