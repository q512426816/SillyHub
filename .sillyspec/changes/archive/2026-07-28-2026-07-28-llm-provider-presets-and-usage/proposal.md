---
author: qinyi
created_at: 2026-07-28 10:14:18
---

# 提案书（Proposal）

## 动机

「我的供应商」模块（参考 cc-switch 已落地：CRUD + 启动/停止 + fetch-models + `settings_config`）缺两个能力：① 新建供应商要反复手填常用中转站配置；② 看不到供应商剩余额度，用超/欠费了才知道。参考 cc-switch 补**预设模版** + **用量查询**。

## 关键问题

1. 每次新建供应商都要手填 base_url / 认证字段 / 默认模型，国内常用中转站反复劳动且易填错。
2. 看不到每个供应商剩多少额度/余额，无法提前预警。
3. cc-switch 桌面端有这两能力，但本平台是 Web 服务，部分路径（官方订阅 / Copilot）云端不可行，需取舍。

## 变更范围

- **Wave A · 预设模版**（纯前端）：10 家 claude 风格预设常量 + 表单顶部预设选择器，点预设一键填表单（只剩 API Key 手填）。
- **Wave B · 用量查询**（后端代查 + 前端展示）：`POST /{id}/usage` 按 base_url 识别供应商走 balance/token_plan 硬编码 handler，统一返回 `UsageResult`（多 tier）；前端列表每行余额条（多窗口/翻红/保留上次值）+ 手动查 + 进页面自动查一次。

## 不在范围内（显式清单）

- 不做官方订阅查询（Claude/Codex/Gemini 官方，需读本机凭据，Web 不可行）
- 不做 GitHub Copilot 用量（需 OAuth 托管）
- 不做自定义 JS 脚本查询（Python 无 QuickJS 沙箱）
- 百炼 / Bailian For Coding 不做用量查询（阿里云需 AK/SK 签名，cc-switch 亦未实现）
- Anthropic 官方不做用量查询
- 不改 `agent_kind`（仍仅 claude）/ 不改下发链路 / daemon / lease
- 不做后台定时自动刷新
- 不做预设后端存储 / seed（预设纯前端常量）
- 智谱团队版用量查询第一版不做（同 base_url 需额外 org/project 参数，B-01）

## 成功标准（可验证）

- 不选预设时表单行为不变（用户手填），既有供应商不受影响
- 选预设后表单自动填好 base_url / 认证 / 默认模型 / 官网，只剩 API Key 手填
- 支持用量的供应商（DeepSeek / Kimi / Kimi For Coding / 智谱 / MiniMax / 硅基流动 / OpenRouter）能查到余额/套餐额度（多 tier）
- 不支持用量的供应商（百炼 / Anthropic 官方）显示「该供应商暂不支持余额查询」，不报错
- 用量查询失败：网络抖动保留上次成功值 10 分钟，鉴权失败翻红
- 用量查询 api_key 明文不出后端 / 不入响应 / 不入日志
- 新增端点不影响既有 CRUD / 启动停止 / fetch-models
- backend llm_provider 测试 + 前端组件测试通过
