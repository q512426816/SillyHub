---
author: qinyi
created_at: 2026-07-25 16:30:03
---

# 提案书（Proposal）

## 动机

当前 daemon 直接调用 claude code 等 agent，LLM 凭证（API key + base_url + model）**100% 靠 daemon 本机环境变量 / `~/.sillyhub/daemon/credentials.json`**，平台零管控。用户要换供应商、换模型、轮换密钥，必须登录每台跑 daemon 的机器改配置。本变更加一层「供应商管理」，让用户在网页直接管控 agent 用的 模型 / apikey / 接口地址，类似 cc-switch，并抽象解耦为其他 agent 接入预留口子。

## 关键问题（现有方案为什么不够）

1. **配置割裂无法集中管控**：多机器 / 多用户场景下，每台 daemon 本机各自配置，无法在平台统一查看 / 切换 / 轮换供应商。
2. **无法网页操作**：换供应商 / 模型必须 SSH 到机器改 env 或 credentials.json，非技术用户无法自助。
3. **账号无法按用户隔离**：所有用户共用 daemon 本机的同一套凭证，无法做到「每人用自己的 API key / 计费」。

## 变更范围

- **后端**：新建 `llm_provider` 模块（`llm_providers` 表 + 加密 CRUD + `/api/llm-providers` 端点），复用 `core/crypto.py` + git_identity 范式；lease 的 `build_claim_payload` 加 `provider_config` 字段，按用户默认供应商下发。
- **daemon**：新建 `CredentialInjector` 抽象 + `ClaudeCredentialInjector` 实现；`spawn-env` 加第 0 层把 provider_config 注入为 `ANTHROPIC_*` env（最高优先级）；扩展 `redactEnv` 脱敏。
- **前端**：设置页「我的供应商」区块（列表 + 新建 / 编辑 / 设默认 / 删除）。
- 第一版只做 claude code，`agent_kind` 枚举 + injector 抽象为 codex / gemini / pi 预留口子。

## 不在范围内（显式清单）

- 不做供应商预设库（官方 / Kimi / 中转内置模板）—— 第一版纯自定义（D-003）；
- 不做工作空间级 / 全局级配置覆盖 —— 第一版纯用户级（D-002）；
- 不做 OAuth provider（Copilot / Codex OAuth / xAI）—— 只走 API key；
- 不做本地反代 / failover（cc-switch proxy 层不搬）；
- 不改 daemon 本机 credentials.json 机制（保留兜底，D-007）；
- 不做 provider 连通性测试端点（后续）；
- 不实现 codex / gemini / pi 的实际注入器（第一版只做 claude，抽象接口预留）。

## 成功标准（可验证）

- 用户未配供应商时：daemon 行为与现状完全一致（零回归，D-007）；
- 用户配了供应商并设默认：跑 agent 时 claude 进程的环境变量含平台下发的 `ANTHROPIC_BASE_URL` / `AUTH_TOKEN` / `MODEL`（可经验证：daemon 侧单测断言 env + 脱敏后日志）；
- 用户只能 CRUD 自己的供应商（越权 403 / 404，D-008）；
- api_key 后端加密存储，API 返回 masked，不落日志 / 审计 / 回传消息（R-02 / R-04）；
- 加 codex 时：后端表 / lease 协议不变，只动 daemon 加 `CodexCredentialInjector` + agent_kind 加值（解耦验证，D-006）。
